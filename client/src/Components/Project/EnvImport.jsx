import React, { useState } from "react";
import { toast } from "react-toastify";
import { getRenderEnvVars, getRenderServices } from "../../api/client";
import { errorMessage } from "../../Pages/Render/renderUtils";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Copy environment variables from a server that is already deployed (a Render service) or from another Stashr project. */
export default function EnvImport({ renderAccounts, projects, repoUrl, taken, onImport }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("project"); // project | render
  const [servers, setServers] = useState(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const withVars = (projects || []).filter((p) => (p.envVars || []).length);
  const same = (p) => repoUrl && p.repoUrl && p.repoUrl.toLowerCase().replace(/\.git$/, "") === repoUrl.toLowerCase().replace(/\.git$/, "");

  const openPanel = async () => {
    setOpen(true); setErr("");
    const match = withVars.find(same) || withVars[0];
    setPick(match ? "project:" + match.id : "");
    if (!match) setSource("render");
    if (servers || !renderAccounts?.length) return;
    setBusy(true);
    try {
      const lists = await Promise.all(renderAccounts.map((a) => getRenderServices(a.id).then((d) => (d.services || []).map((s) => ({ accountId: a.id, accountName: a.name, id: s.id, name: s.name || s.id }))).catch(() => [])));
      setServers(lists.flat());
    } catch { setServers([]); } finally { setBusy(false); }
  };

  const take = (rows, from) => {
    const have = new Set(taken);
    const fresh = rows.filter((r) => ENV_NAME.test(r.name) && !have.has(r.name));
    if (!fresh.length) { toast.info(rows.length ? "Every variable from " + from + " is already in the list." : from + " has no environment variables."); return; }
    onImport(fresh);
    const blank = fresh.filter((r) => !r.value).length;
    toast.success("Added " + fresh.length + " variable" + (fresh.length === 1 ? "" : "s") + " from " + from + (rows.length > fresh.length ? " (" + (rows.length - fresh.length) + " skipped: already there)" : "") + "." + (blank ? " " + blank + " had no readable value; fill them in." : ""));
    setOpen(false);
  };

  const run = async () => {
    setErr("");
    if (pick.startsWith("project:")) {
      const p = withVars.find((x) => "project:" + x.id === pick);
      if (p) take(p.envVars.map((v) => ({ name: v.name, value: v.value || "" })), "project “" + p.name + "”");
      return;
    }
    const s = (servers || []).find((x) => "render:" + x.accountId + ":" + x.id === pick);
    if (!s) return;
    setBusy(true);
    try {
      const d = await getRenderEnvVars(s.accountId, s.id);
      take((d.envVars || []).map((v) => ({ name: v.key, value: typeof v.value === "string" ? v.value : "" })), "server “" + s.name + "”");
    } catch (e) { setErr(errorMessage(e, "Could not read that server's variables.")); }
    finally { setBusy(false); }
  };

  if (!open) return <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={() => void openPanel()}>Copy from an existing server</button></div>;
  return (
    <div className="field">
      <span className="field__label">Copy variables from an existing server</span>
      <div className="dp-templates" role="group" aria-label="Where to copy from">
        <button type="button" className="dp-template" aria-pressed={source === "project"} onClick={() => { setSource("project"); setPick(""); }}><strong>A Stashr project</strong><small>Variables saved in one of your projects.</small></button>
        <button type="button" className="dp-template" aria-pressed={source === "render"} onClick={() => { setSource("render"); setPick(""); }}><strong>A Render server</strong><small>Read live from a deployed service.</small></button>
      </div>
      <select className="input" aria-label="Server to copy from" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
        <option value="">{busy ? "Loading…" : "Choose…"}</option>
        {source === "project"
          ? withVars.map((p) => <option key={p.id} value={"project:" + p.id}>{p.name} ({p.envVars.length} variables){same(p) ? " · same repo" : ""}</option>)
          : (servers || []).map((s) => <option key={s.accountId + s.id} value={"render:" + s.accountId + ":" + s.id}>{s.name} · {s.accountName}</option>)}
      </select>
      {source === "render" && servers && !servers.length ? <p className="field__note">No Render servers found. Connect a Render account first.</p> : null}
      {err ? <p className="field__hint" role="alert">{err}</p> : null}
      <div className="gh-panel__row">
        <button type="button" className="btn btn--primary btn--sm" disabled={!pick || busy} onClick={() => void run()}>{busy ? "Reading…" : "Copy variables"}</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="field__note">Existing names in the list are kept. Values are copied into this form only; nothing is changed on the source server.</p>
    </div>
  );
}
