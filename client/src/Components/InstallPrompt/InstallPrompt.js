import React, { useEffect, useState } from "react";
import { ShieldLine, Download, Close } from "../Icons/Icons";
import "./InstallPrompt.css";

const DISMISS_KEY = "aurelia:install-dismissed";
const DISMISS_DAYS = 14;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;

const dismissedRecently = () => {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    if (!at) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch (err) {
    return false;
  }
};

/**
 * "Install Aurelia" — the add-to-home-screen prompt.
 * Chrome/Edge/Android get the real prompt through beforeinstallprompt;
 * iOS Safari gets the Share → Add to Home Screen instructions instead.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return undefined;

    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferred(event);
      setVisible(true);
    };

    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt, so invite gently after a moment
    let timer;
    if (isIOS()) {
      timer = window.setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 4000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (err) {
      /* private mode — forget it, it will ask again next visit */
    }
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      setDeferred(null);
      setVisible(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="install" role="dialog" aria-label="Install Aurelia">
      <span className="install__mark">
        <ShieldLine size={18} />
      </span>

      <div className="install__copy">
        <p className="install__title">Keep Aurelia on your phone</p>
        <p className="install__body">
          {iosHint ? (
            <>
              Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
            </>
          ) : (
            <>Install it like an app — opens full screen, works offline.</>
          )}
        </p>
      </div>

      {!iosHint && (
        <button className="btn btn--primary btn--sm install__cta" onClick={install}>
          <Download size={14} />
          Install
        </button>
      )}

      <button className="install__close" onClick={dismiss} aria-label="Not now">
        <Close size={15} />
      </button>
    </div>
  );
}
