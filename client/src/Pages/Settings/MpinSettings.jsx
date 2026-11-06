import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import * as api from "../../api/client";
import { isPin, weakPin, readMpin, saveMpin, clearMpin } from "../../lib/mpin";

/* Turn the 4-digit MPIN on or off for THIS device, or change it. It works only here: other devices set their own. */
export default function MpinSettings() {
  const [mine, setMine] = useState(() => readMpin());
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState([]);

  const load = useCallback(async () => {
    try { setDevices((await api.listMpin()).devices || []); } catch { /* the list is only a convenience */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // The server forgot this device (five wrong tries, or a password change): the saved secret is useless, drop it.
  const known = mine && devices.some((d) => d.deviceId === mine.deviceId);
  useEffect(() => { if (mine && devices.length && !known) { clearMpin(); setMine(null); } }, [mine, devices, known]);

  const problem = !isPin(pin) ? "Four digits." : weakPin(pin) ? "Too easy to guess. Avoid 1234 and repeated digits." : pin !== again ? "The two entries don't match." : "";

  const save = async (e) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    try {
      if (known) await api.changeMpin(mine.deviceId, pin);
      else { const device = await api.setupMpin(pin); saveMpin(device); setMine(readMpin()); }
      toast.success(known ? "MPIN changed." : "MPIN is on for this device. Next time, just enter it.");
      setOpen(false); setPin(""); setAgain("");
      load();
    } catch (err) { toast.error(api.errorMessage(err, "Could not save the MPIN.")); }
    finally { setBusy(false); }
  };

  const turnOff = async () => {
    if (!mine || busy) return;
    setBusy(true);
    try { await api.removeMpin(mine.deviceId); } catch { /* it may already be gone */ }
    clearMpin(); setMine(null); setBusy(false); load();
    toast.success("MPIN is off for this device.");
  };

  return (
    <div>
      <p className="srow__hint">{known ? "On for this device." : "Off for this device."} {devices.length ? `${devices.length} device${devices.length === 1 ? "" : "s"} in all.` : ""} Five wrong tries switch it off on that device.</p>
      {open ? (
        <form className="settings__inline" onSubmit={save}>
          <input className="input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="New MPIN" aria-label="New MPIN" autoComplete="off" />
          <input className="input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Again" aria-label="New MPIN again" autoComplete="off" />
          <button type="submit" className="btn btn--ghost btn--sm" disabled={Boolean(problem) || busy}>Save</button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { setOpen(false); setPin(""); setAgain(""); }}>Cancel</button>
          {pin || again ? <span className="srow__hint" role="status">{problem}</span> : null}
        </form>
      ) : (
        <div className="settings__inline">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>{known ? "Change MPIN" : "Set MPIN"}</button>
          {known ? <button type="button" className="btn btn--quiet btn--sm" onClick={turnOff} disabled={busy}>Turn off</button> : null}
        </div>
      )}
    </div>
  );
}
