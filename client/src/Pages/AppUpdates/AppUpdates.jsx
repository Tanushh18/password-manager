import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getAppRollout, saveAppRollout } from "../../api/client";
import { errorMessage } from "../Render/renderUtils";
import { summary, cannotBePicked, payload } from "../../lib/rollout";
import "../SmartHome/SmartHome.css";
import "../SmartHome/techie.css";

const MODES = [
  ["all", "Sab ko", "Jo bhi app khol ke update dekhega use naya version dikhega (jaise pehle)."],
  ["selected", "Sirf chune hue devices ko", "Sirf neeche tick kiye hue device ko update dikhega. Baaki ko kuch nahi."],
  ["hold", "Kisi ko nahi (hold)", "Abhi koi nahi. Jab theek lage tab chuno."]
];

/** One app: its newest release, who is offered it, and the choice. */
function AppCard({ app, onSaved }) {
  const [mode, setMode] = useState(app.rule.mode);
  const [ticked, setTicked] = useState(new Set(app.rule.devices));
  const [wait, setWait] = useState(app.defaultMode === "hold");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMode(app.rule.mode); setTicked(new Set(app.rule.devices)); setWait(app.defaultMode === "hold"); }, [app]);
  const toggle = (id) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    try { await saveAppRollout(app.key, payload(mode, ticked, wait)); toast.success("Saved."); onSaved(); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); } finally { setBusy(false); }
  };
  const warn = mode === "selected" ? cannotBePicked(app, ticked) : [];
  return (
    <section className="sh-editor" aria-label={app.label}>
      <h3 style={{ margin: 0 }}>{app.label}</h3>
      {app.latest ? <p className="sh-dim">Naya release: <b>{app.latest.version}</b>{app.latest.publishedAt ? ` · ${new Date(app.latest.publishedAt).toLocaleString()}` : ""}{app.latest.releaseNotes ? ` · ${app.latest.releaseNotes}` : ""}</p> : <p className="sh-dim">{app.error}</p>}
      <p><b>{summary(app)}</b></p>
      {app.latest ? (
        <>
          {MODES.filter(([m]) => app.selectable || m !== "selected").map(([m, label, hint]) => (
            <label key={m} className="sh-switch" style={{ display: "block" }}>
              <input type="radio" name={`mode-${app.key}`} checked={mode === m} onChange={() => setMode(m)} /> <b>{label}</b> <span className="sh-dim">{hint}</span>
            </label>
          ))}
          {!app.selectable ? <p className="sh-dim">Is app (Stashr) mein har phone alag se pehchana nahi jata, isliye yahan sirf “sab ko” ya “hold” ho sakta hai.</p> : null}
          {mode === "selected" ? (
            app.devices.length ? (
              <ul className="sh-lan">
                {app.devices.map((d) => (
                  <li key={d.id}>
                    <label className="sh-lan__main">
                      <span><input type="checkbox" checked={ticked.has(d.id)} onChange={() => toggle(d.id)} /> <b>{d.name}</b>{d.person && d.person !== d.name ? ` (${d.person})` : ""}</span>
                      <span>app {d.installedVersion || "?"} · {d.upToDate === true ? "naya version hai" : d.upToDate === false ? "update baaki" : ""} · {d.online ? "online" : "offline"}{d.canIdentify === false ? ` · purana app: pehle ${app.identityFrom} haath se install karo` : ""}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="sh-dim">Koi device linked nahi hai.</p>
          ) : null}
          {warn.length ? <p className="sh-bad" role="alert">{warn.map((d) => d.name).join(", ")}: inka app abhi apni pehchaan server ko nahi bhejta, isliye update inhe dikhega hi nahi. Pehle {app.identityFrom} (ya naya) APK ek baar haath se install karo, uske baad chune hue update aate rahenge.</p> : null}
          <label className="sh-switch"><input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} /> Is app ke <b>aane wale naye versions</b> pehle mere OK ka intezaar karein (hold), apne aap sab ko na jayein.</label>
          <div className="sh-row"><button type="button" className="rd-btn rd-btn--primary" onClick={save} disabled={busy || (mode === "selected" && !ticked.size)}>Save</button></div>
        </>
      ) : null}
    </section>
  );
}

/** Who gets a new app version: Stashr, Stashr Location, Stashr Hub and Stashr TV (administrators only). */
export default function AppUpdates() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { try { setData(await getAppRollout()); setErr(""); } catch (e) { setErr(errorMessage(e, "Could not load.")); } }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <main className="page dev" style={{ maxWidth: 900, margin: "1rem auto", padding: "1.2rem" }}>
      <div className="dev-prompt">stashr app-updates --rollout</div>
      <h1>App updates: kise kaun sa naya APK jaye</h1>
      <p className="sh-dim">Jab naya APK GitHub par banta hai, ye page tay karta hai ki kaun se devices ke app use “update available” ke roop mein dekhenge. APK ki file GitHub par public rehti hai, yahan sirf wo tay hota hai jo apps khud offer karte hain. Chune hue device tabhi pehchane jaate hain jab unke app mein device-pehchaan wala naya version ho (Location {data ? (data.apps.find((a) => a.key === "where") || {}).identityFrom : ""}+, Hub {data ? (data.apps.find((a) => a.key === "hub") || {}).identityFrom : ""}+, TV {data ? (data.apps.find((a) => a.key === "tv") || {}).identityFrom : ""}+).</p>
      {err ? <p className="sh-bad" role="alert">{err}</p> : null}
      {!data && !err ? <p className="sh-dim">Loading…</p> : null}
      {data ? data.apps.map((a) => <AppCard key={a.key} app={a} onSaved={load} />) : null}
    </main>
  );
}
