import React, { useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { decryptThePass, deleteAPassword } from "../../axios/instance";
import { delPass } from "../../redux/actions";
import { Eye, EyeOff, Copy, Check, Trash, Close } from "../Icons/Icons";
import "./Password.css";

const MASK = "•••••••••••";

/**
 * A single stored secret: reveal, copy and remove.
 * The value only leaves the server decrypted when the reader asks for it.
 */
function Password({ id, password, iv }) {
  const [revealed, setRevealed] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const copyTimer = useRef(null);
  const dispatch = useDispatch();

  const fetchValue = async () => {
    if (value) return value;
    const res = await decryptThePass({ iv, encryptedPassword: password });
    if (res.status === 200) {
      setValue(res.data);
      return res.data;
    }
    throw new Error("Could not decrypt this password.");
  };

  const toggleReveal = async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    try {
      setBusy(true);
      await fetchValue();
      setRevealed(true);
    } catch (err) {
      toast.error("Could not decrypt that password.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      setBusy(true);
      const secret = await fetchValue();

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(secret);
      } else {
        // Fallback for browsers without the async clipboard API
        const area = document.createElement("textarea");
        area.value = secret;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }

      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      toast.error("Could not copy that password.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      setBusy(true);
      const res = await deleteAPassword({ id });
      if (res.status === 200) {
        dispatch(delPass(id));
        toast.success("Credential removed.");
      } else {
        toast.error(res.data?.error || "Could not remove that credential.");
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || "Could not remove that credential.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className={`secret ${revealed ? "is-open" : ""}`}>
      <div className="secret__value" onClick={toggleReveal} title={revealed ? "Hide" : "Reveal"}>
        {busy && !revealed ? (
          <span className="spinner spinner--accent" />
        ) : (
          <span className={`secret__text ${revealed ? "is-revealed" : ""}`}>
            {revealed ? value : MASK}
          </span>
        )}
      </div>

      <div className="secret__tools">
        <button
          type="button"
          className={`icon-btn ${revealed ? "is-on" : ""}`}
          onClick={toggleReveal}
          aria-label={revealed ? "Hide password" : "Reveal password"}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>

        <button
          type="button"
          className={`icon-btn ${copied ? "is-done" : ""}`}
          onClick={copy}
          aria-label="Copy password"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>

        {confirming ? (
          <span className="secret__confirm">
            <button type="button" className="icon-btn is-danger" onClick={remove} aria-label="Confirm remove">
              <Check size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setConfirming(false)}
              aria-label="Keep it"
            >
              <Close size={15} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="icon-btn icon-btn--quiet"
            onClick={() => setConfirming(true)}
            aria-label="Remove password"
          >
            <Trash size={16} />
          </button>
        )}
      </div>

      {copied && <span className="secret__flash">copied</span>}
      {confirming && <span className="secret__flash secret__flash--warn">remove this?</span>}
    </div>
  );
}

export default Password;
