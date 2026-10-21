import React, { useCallback, useEffect, useState } from "react";
import { getRenderAccounts, getRenderDeploys, getRenderLogs, moveProjectServerAccount } from "../../api/client";
import { normalizeList, timeAgo, safeUrl, errorMessage } from "../../Pages/Render/renderUtils";
import { toast } from "react-toastify";

export const hostOf = (url) => String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
export const DEPLOY_LABEL = { live: "Live", build_in_progress: "Building", update_in_progress: "Deploying", build_failed: "Build failed", update_failed: "Deploy failed", canceled: "Canceled", deactivated: "Replaced", created: "Queued", pre_deploy_in_progress: "Pre-deploy" };
const IN_PROGRESS = ["created", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"];
const STEPS = ["created", "build_in_progress", "update_in_progress", "live"];
const STEP_INDEX = { created: 0, build_in_progress: 1, pre_deploy_in_progress: 1, update_in_progress: 2, live: 3, build_failed: 1, update_failed: 2, canceled: 0 };

/** One URL as a link; several URLs (custom domains, or the same app on several servers) open as a dropdown. */
export function UrlMenu({ urls, label = "live URLs" }) {
  const list = [...new Set((urls || []).filter((u) => /^https:\/\//i.test(String(u || ""))))];
  if (!list.length) return <span className="pdep__dim">—</span>;
  if (list.length === 1) return <a href={safeUrl(list[0])} target="_blank" rel="noopener noreferrer" className="pdep__url">{hostOf(list[0])} ↗</a>;
  return (
    <details className="urlmenu">
      <summary>{list.length} {label}</summary>
      <ul>
        {list.map((u) => <li key={u}><a href={safeUrl(u)} target="_blank" rel="noopener noreferrer">{hostOf(u)} ↗</a></li>)}
      </ul>
    </details>
  );
}

/** Header cell that sorts its column. `sort` is { key, dir } and `onSort` receives the next one. */
export function SortTh({ id, label, sort, onSort, className }) {
  const active = sort?.key === id;
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={"pdep__sort" + (active ? " is-active" : "")} onClick={() => onSort({ key: id, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
        {label}<span aria-hidden="true">{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span>
      </button>
    </th>
  );
}

/** Which connected Render account this server is read through. Changing it moves the link; the server itself is untouched. */
export function AccountPicker({ projectId, server, onDone }) {
  const [accounts, setAccounts] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getRenderAccounts().then((r) => setAccounts(r.accounts || [])).catch(() => setAccounts([])); }, []);
  if (!accounts) return <span className="pdep__dim">…</span>;
  if (accounts.length < 2) return <span>{server.accountName || "—"}</span>;
  const change = async (accountId) => {
    if (accountId === server.accountId) return;
    setBusy(true);
    try {
      await moveProjectServerAccount(projectId, server.id, accountId);
      toast.success("Now read through " + (accounts.find((a) => a.id === accountId)?.name || "that account") + ".");
      onDone();
    } catch (e) { toast.error(errorMessage(e, "Could not change the account.")); }
    finally { setBusy(false); }
  };
  return (
    <select className="input pdep__account" value={server.accountId} disabled={busy} aria-label={"Render account for " + server.name} onChange={(e) => void change(e.target.value)}>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      {!accounts.some((a) => a.id === server.accountId) ? <option value={server.accountId}>{server.accountName || "Unknown account"}</option> : null}
    </select>
  );
}

/** Deployment progress and the latest app logs of one server. Closed by default; refreshes while open. */
export function ServerLogs({ server }) {
  // Mounted only when the row's Logs button is pressed, so it starts open.
  const [open, setOpen] = useState(true);
  const [deploys, setDeploys] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!server.accountId || !server.id) return;
    try {
      const end = new Date();
      const [d, l] = await Promise.all([
        getRenderDeploys(server.accountId, server.id),
        server.ownerId ? getRenderLogs(server.accountId, { ownerId: server.ownerId, resource: server.id, startTime: new Date(end.getTime() - 30 * 60000).toISOString(), endTime: end.toISOString(), direction: "backward", limit: "60", type: "app" }) : Promise.resolve(null)
      ]);
      setDeploys(normalizeList(d, "deploy").slice(0, 6));
      setLogs(l ? (Array.isArray(l.logs) ? l.logs.slice().reverse() : []) : null);
      setError("");
    } catch (e) { setError(errorMessage(e, "Could not read the logs from Render.")); }
  }, [server.accountId, server.id, server.ownerId]);

  useEffect(() => {
    if (!open) return undefined;
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [open, load]);

  const latest = deploys?.[0];
  const status = String(latest?.status || "").toLowerCase();
  return (
    <details className="srvlogs" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Deployment progress &amp; logs{latest ? <span className={"srvlogs__state is-" + (status === "live" ? "ok" : IN_PROGRESS.includes(status) ? "mid" : "bad")}>{DEPLOY_LABEL[status] || status || "—"}</span> : null}</summary>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}
      {!deploys && !error ? <p className="field__note">Reading from Render…</p> : null}
      {deploys ? (
        <>
          {latest ? (
            <ol className="srvlogs__steps" aria-label="Latest deploy">
              {STEPS.map((step, i) => <li key={step} className={i <= STEP_INDEX[status] ? "is-on" : ""}>{DEPLOY_LABEL[step]}</li>)}
              {/fail|canceled/.test(status) ? <li className="is-bad">{DEPLOY_LABEL[status]}</li> : null}
            </ol>
          ) : <p className="field__note">No deploys yet.</p>}
          {deploys.length ? (
            <ul className="srvlogs__deploys">
              {deploys.map((d) => (
                <li key={d.id || d.createdAt}>
                  <span className={"pdep__deploy is-" + (d.status === "live" ? "ok" : /fail/.test(d.status) ? "bad" : "mid")}>{DEPLOY_LABEL[d.status] || d.status}</span>
                  <span>{String(d.commit?.message || "").split("\n")[0].slice(0, 90) || "Manual deploy"}</span>
                  <small>{timeAgo(d.finishedAt || d.createdAt)}{d.commit?.id ? " · " + String(d.commit.id).slice(0, 7) : ""}</small>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="field__label srvlogs__label">Latest app logs (last 30 min)</p>
          <pre className="srvlogs__log" aria-label="App logs">{logs === null ? "App logs are unavailable for this service." : logs.length ? logs.map((l) => String(l.message || "").slice(0, 300)).join("\n") : "No log lines in the last 30 minutes."}</pre>
        </>
      ) : null}
    </details>
  );
}
