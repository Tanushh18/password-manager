import React from "react";
import { StatePill, Sparkline } from "./RenderUi";
import { serviceKey, serviceKind, serviceState, timeAgo, safeUrl } from "./renderUtils";

const HEALTH = { healthy: ["ok", "Healthy"], unhealthy: ["bad", "Down"], timeout: ["bad", "Not responding"], suspended: ["mid", "Suspended"], unknown: ["mid", "Not checked yet"], unsupported: ["mid", "No public URL"] };
const DEPLOY = { live: ["ok", "Deploy live"], build_failed: ["bad", "Build failed"], update_failed: ["bad", "Deploy failed"], build_in_progress: ["mid", "Building"], update_in_progress: ["mid", "Deploying"] };
const fmt = (v, unit) => (v == null ? "—" : Math.round(v) + unit);

/** Every server as a card: health, last deploy, CPU / memory / latency trends and actions. Grouped by app. */
export default function ServerBoard({ groups, incidentKeys, series, checked, onToggle, onToggleApp, projectCell, onOpen, onAction, onDelete, busy }) {
  if (!groups.length) return null;
  return (
    <div className="rd-board">
      {groups.map((group) => {
        const keys = group.members.map(serviceKey);
        const allChecked = keys.every((k) => checked.includes(k));
        return (
          <section key={group.key} className="rd-board__app" aria-label={group.name}>
            <header className="rd-board__apphead">
              <label className="rd-check"><input type="checkbox" checked={allChecked} onChange={() => onToggleApp(keys, allChecked)} aria-label={"Select every server of " + group.name} /></label>
              <h3>{group.name}</h3>
              <span className="rd-board__meta">{group.members.length} server{group.members.length === 1 ? "" : "s"} · {group.active} running{group.suspended ? " · " + group.suspended + " suspended" : ""} · {group.accounts.join(", ")}</span>
              <span className="rd-board__project">{projectCell(group.members)}</span>
              {group.repo && <a className="rd-btn rd-btn--link" href={safeUrl(group.repo)} target="_blank" rel="noreferrer noopener">Repo ↗</a>}
            </header>
            <div className="rd-board__grid">
              {group.members.map((s) => {
                const key = serviceKey(s);
                const data = series.get(key);
                const last = data?.last;
                const suspended = s.suspended === "suspended";
                const [htone, hlabel] = suspended ? HEALTH.suspended : HEALTH[last?.health] || HEALTH.unknown;
                const [dtone, dlabel] = last?.deploy?.status ? (DEPLOY[last.deploy.status] || ["mid", last.deploy.status.replace(/_/g, " ")]) : ["mid", "Deploy —"];
                const pts = data?.points || [];
                const isBusy = busy === key;
                return (
                  <article key={key} className={"rd-server is-" + htone + (checked.includes(key) ? " is-checked" : "")}>
                    <div className="rd-server__top">
                      <input type="checkbox" checked={checked.includes(key)} onChange={() => onToggle(key)} aria-label={"Select " + s.name} />
                      <button type="button" className="rd-server__name" onClick={() => onOpen(key)} title="Open details, graphs, logs and environment">{s.name}</button>
                      <StatePill state={serviceState(s, incidentKeys)} />
                    </div>
                    {s.serviceDetails?.url ? <a className="rd-url" href={safeUrl(s.serviceDetails.url)} target="_blank" rel="noreferrer noopener">{s.serviceDetails.url.replace(/^https?:\/\//, "")} ↗</a> : <span className="rd-muted">No public URL</span>}
                    <dl className="rd-kv">
                      <div><dt>Status checks</dt><dd className={"is-" + (htone === "bad" || dtone === "bad" ? "bad" : htone === "ok" && dtone === "ok" ? "ok" : "mid")}>{suspended ? "Suspended" : last ? [htone === "ok", dtone === "ok"].filter(Boolean).length + "/2 passed" : "Not checked yet"}</dd></div>
                      <div><dt>Health</dt><dd className={"is-" + htone} title={hlabel + (last?.status ? " · HTTP " + last.status : "")}>{hlabel}{last?.status ? " · HTTP " + last.status : ""}{last?.latency != null && !suspended ? " · " + Math.round(last.latency) + " ms" : ""}</dd></div>
                      <div><dt>Last deploy</dt><dd className={"is-" + dtone}>{dlabel}</dd></div>
                      <div><dt>Last checked</dt><dd>{last ? timeAgo(last.t) : "—"}</dd></div>
                      <div><dt>Type</dt><dd>{serviceKind(s)}{s.serviceDetails?.runtime || s.serviceDetails?.env ? " · " + (s.serviceDetails.runtime || s.serviceDetails.env) : ""}</dd></div>
                      <div><dt>Plan · region</dt><dd>{[s.serviceDetails?.plan, s.serviceDetails?.region].filter(Boolean).join(" · ") || "—"}</dd></div>
                      <div><dt>Branch</dt><dd>{s.branch || "—"}{s.autoDeploy === "yes" ? " · auto-deploy" : s.autoDeploy === "no" ? " · manual deploy" : ""}</dd></div>
                      <div><dt>Instances</dt><dd>{s.serviceDetails?.numInstances ?? "—"}</dd></div>
                      <div><dt>Account</dt><dd>{s.accountName}</dd></div>
                      <div><dt>Updated</dt><dd title={s.updatedAt}>{timeAgo(s.updatedAt)}</dd></div>
                      <div className="rd-kv__wide"><dt>Service ID</dt><dd className="rd-mono">{s.id}</dd></div>
                    </dl>
                    <div className="rd-server__charts">
                      <div><span>CPU <b>{fmt(last?.cpu, "%")}</b></span><Sparkline values={pts.map((p) => p.cpu)} max={100} label={"CPU trend of " + s.name} /></div>
                      <div><span>Memory <b>{fmt(last?.memory, "%")}</b></span><Sparkline values={pts.map((p) => p.memory)} max={100} label={"Memory trend of " + s.name} /></div>
                      <div><span>Latency <b>{fmt(last?.latency, " ms")}</b></span><Sparkline values={pts.map((p) => p.latency)} label={"Latency trend of " + s.name} /></div>
                    </div>
                    <div className="rd-server__actions">
                      <button type="button" className="rd-btn rd-btn--quiet" onClick={() => onOpen(key)}>Details &amp; graphs</button>
                      {!suspended && <button type="button" className="rd-btn rd-btn--quiet" disabled={isBusy} onClick={() => onAction("restart", s)}>↻ Restart</button>}
                      <button type="button" className="rd-btn rd-btn--quiet" disabled={isBusy} onClick={() => onAction("deploy", s)}>⇪ Deploy</button>
                      <button type="button" className="rd-btn rd-btn--quiet" disabled={isBusy} onClick={() => onAction(suspended ? "resume" : "suspend", s)}>{suspended ? "▶ Resume" : "Ⅱ Suspend"}</button>
                      <button type="button" className="rd-icon-btn rd-icon-btn--danger" disabled={isBusy} aria-label={"Delete " + s.name} onClick={() => onDelete(s)}>🗑</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
