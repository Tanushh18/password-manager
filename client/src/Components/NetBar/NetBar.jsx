import React, { useEffect, useRef, useState } from "react";
import { onActivity } from "../../api/client";
import "./NetBar.css";

// Top progress bar while any request is running, plus a "Syncing in the background" pill when something takes a while,
// so a slow service never looks like a frozen page.
const BAR_DELAY_MS = 150;
const SLOW_MS = 2500;

export default function NetBar() {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const timers = useRef({});

  useEffect(() => onActivity((n) => {
    const t = timers.current;
    clearTimeout(t.bar); clearTimeout(t.slow);
    if (n > 0) {
      t.bar = setTimeout(() => setBusy(true), BAR_DELAY_MS);
      t.slow = setTimeout(() => setSlow(true), SLOW_MS);
    } else {
      t.bar = setTimeout(() => { setBusy(false); setSlow(false); }, 250);
    }
  }), []);

  return (
    <>
      <div className={"netbar" + (busy ? " netbar--on" : "")} role="progressbar" aria-hidden={!busy} aria-label="Loading" />
      {slow && busy && <div className="netpill" role="status" aria-live="polite"><span className="netpill__dot" />Syncing in the background…</div>}
    </>
  );
}
