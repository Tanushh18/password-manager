import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getLiveDashboard, saveUsageSettings } from "../../api/client";
import { Kpi, Section, Skeleton, Empty } from "../Render/RenderUi";
import { timeAgo, errorMessage } from "../Render/renderUtils";
import { formatAmount, forecastText, summarize, STATUS_LABEL } from "./servicesUtils";
import "../Render/RenderDashboard.css";
import "./Services.css";

function Metric({ m }) {
  const pct = m.percent == null ? null : Math.min(100, m.percent);
  return (
    <li className={"sv-metric is-" + (m.status || "unknown")}>
      <div className="sv-metric__head">
        <strong>{m.label}</strong>
        <span className="sv-chip">{STATUS_LABEL[m.status] || STATUS_LABEL.unknown}</span>
      </div>
      {pct != null && <div className="sv-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={m.label}><i style={{ width: pct + "%" }} /></div>}
      <div className="sv-nums">
        {m.kind === "balance"
          ? <span><b>{formatAmount(m.remaining, m.unit)}</b> left</span>
          : <>
              <span><b>{formatAmount(m.used, m.unit)}</b> used{m.limit != null && <> of <b>{formatAmount(m.limit, m.unit)}</b>{m.limitAssumed ? " (your limit)" : ""}</>}</span>
              {m.remaining != null && <span><b>{formatAmount(m.remaining, m.unit)}</b> left{pct != null ? " · " + Math.round(m.percent) + "% used" : ""}</span>}
            </>}
      </div>
      {forecastText(m) && <p className="sv-forecast">{forecastText(m)}</p>}
      {m.projectedAtReset != null && m.limit != null && <p className="sv-forecast">Projected at reset: {formatAmount(m.projectedAtReset, m.unit)}</p>}
      {m.note && m.note !== forecastText(m) && <p className="sv-forecast sv-forecast--note">{m.note}</p>}
    </li>
  );
}

function ServiceCard({ project, svc, onToggle }) {
  const [showVars, setShowVars] = useState(false);
  return (
    <article className="sv-service">
      <header>
        <div><strong>{svc.label}</strong><small>{svc.category}</small></div>
        <div className="sv-actions">
          {svc.console && <a className="rd-btn rd-btn--quiet" href={svc.console} target="_blank" rel="noopener noreferrer">Open console ↗</a>}
          <label className="rd-check"><input type="checkbox" checked={svc.state !== "disabled"} onChange={() => onToggle(project.id + "|" + svc.key, svc.state !== "disabled")} /> Track usage</label>
        </div>
      </header>
      {svc.state === "error" && <p className="sv-warn">Could not read usage: {svc.error?.message}</p>}
      {svc.state === "no-credentials" && <p className="sv-muted">Usage can’t be read automatically — the needed credentials aren’t among this service’s environment variables.</p>}
      {svc.state === "no-reader" && <p className="sv-muted">This provider has no public usage API Stashr can read. Check its console for current usage.</p>}
      {svc.state === "disabled" && <p className="sv-muted">Usage tracking is switched off for this service.</p>}
      {svc.reports.map((r, i) => (
        <section key={i} className="sv-report">
          <h4>{r.label}{r.plan && <small> · {r.plan}</small>}</h4>
          {r.metrics.length ? <ul className="sv-metrics">{r.metrics.map((m) => <Metric key={m.key} m={m} />)}</ul> : <p className="sv-muted">No usage figures returned.</p>}
          {(r.notes || []).map((n, j) => <p key={j} className="sv-muted">{n}</p>)}
        </section>
      ))}
      {svc.configuredLimits.length > 0 && (
        <p className="sv-limits">Limits set in env: {svc.configuredLimits.map((l) => l.name + " = " + l.value + (l.period ? " / " + l.period : "")).join(" · ")}</p>
      )}
      <button type="button" className="rd-btn rd-btn--quiet" aria-expanded={showVars} onClick={() => setShowVars((v) => !v)}>{showVars ? "Hide" : "Show"} variables ({svc.vars.length})</button>
      {showVars && (
        <ul className="sv-vars">
          {svc.vars.map((v) => (
            <li key={v.name}><code>{v.name}</code><span>{!v.set ? "empty" : v.display != null ? v.display : "set (hidden)"}</span></li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function Services() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mongoMb, setMongoMb] = useState("512");

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError("");
    try {
      const result = await getLiveDashboard({ refresh });
      setData(result);
      if (result?.settings?.mongoLimitMb) setMongoMb(String(result.settings.mongoLimitMb));
    } catch (e) { setError(errorMessage(e, "Could not load the services dashboard.")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (patch, message) => {
    try {
      await saveUsageSettings(patch);
      if (message) toast.success(message);
      await load(true);
    } catch (e) { toast.error(errorMessage(e, "Could not save settings.")); }
  };
  const toggle = (key, currentlyOn) => {
    const disabled = { ...(data?.settings?.disabled || {}) };
    if (currentlyOn) disabled[key] = true; else delete disabled[key];
    void save({ disabled });
  };

  const summary = useMemo(() => summarize(data), [data]);

  return (
    <main className="rd-page">
      <div className="rd-shell sv-wrap">
        <header className="sv-top">
          <div><div className="rd-eyebrow"><span />LIVE SERVICES</div><h1>Services in use</h1>
            <p className="sv-muted">Only projects running on Render right now. New repos, projects and Render accounts appear automatically.</p></div>
          <button type="button" className="rd-btn rd-btn--primary" disabled={loading} onClick={() => void load(true)}>{loading ? "Refreshing…" : "Refresh"}</button>
        </header>

        {error && <p className="sv-warn" role="alert">{error}</p>}
        {loading && !data && <Skeleton lines={6} height={60} />}

        {data && !data.enabled && (
          <Section title="Turn on usage tracking" subtitle="Read-only. Nothing is ever changed on any provider.">
            <p>Stashr will read each running service’s environment variables from Render, work out which databases and APIs it uses, and ask each provider (MongoDB, Cloudinary, Brevo, Twilio, Deepgram) how much you have used. Keys stay on the server and are never shown.</p>
            <label className="sv-field">MongoDB storage limit (MB)<input className="rd-field" type="number" min="1" value={mongoMb} onChange={(e) => setMongoMb(e.target.value)} /></label>
            <p className="sv-muted">Atlas free (M0) clusters have 512 MB.</p>
            <button type="button" className="rd-btn rd-btn--primary" onClick={() => void save({ enabled: true, mongoLimitMb: Number(mongoMb) || 512 }, "Usage tracking enabled.")}>Enable usage tracking</button>
          </Section>
        )}

        {data?.enabled && (
          <>
            <div className="rd-kpis">
              <Kpi label="Live projects" value={data.liveCount} hint={"of " + data.totalCount + " Render services"} />
              <Kpi label="Services tracked" value={summary.tracked} />
              <Kpi label="Needs attention" value={summary.warn + summary.critical} tone={summary.critical ? "danger" : summary.warn ? "warn" : "ok"} hint={summary.critical ? summary.critical + " almost out" : summary.warn ? summary.warn + " getting low" : "All within limits"} />
              <Kpi label="Soonest to run out" value={summary.soonest ? new Date(summary.soonest.at).toLocaleDateString() : "—"} hint={summary.soonest ? summary.soonest.project + " · " + summary.soonest.label : "Nothing projected to run out"} />
            </div>
            <p className="sv-muted">Updated {timeAgo(data.generatedAt)} · {data.historyPoints || 0} history snapshot(s). Forecasts for storage and balances sharpen after about a day of history.</p>

            {data.workspaces.length > 0 && (
              <Section title="Render workspace" subtitle="Free instance hours are shared by all free services in a workspace.">
                <ul className="sv-metrics">{data.workspaces.map((w) => <li key={w.accountId}><strong>{w.accountName}</strong> · {w.liveServices} free service(s)<ul className="sv-metrics"><Metric m={w.metric} /></ul></li>)}</ul>
              </Section>
            )}

            {data.projects.map((p) => (
              <Section key={p.id} title={p.name} subtitle={[p.accountName, p.plan, p.repo].filter(Boolean).join(" · ")}
                actions={<>{p.url && <a className="rd-btn rd-btn--quiet" href={p.url} target="_blank" rel="noopener noreferrer">Open app ↗</a>}{p.dashboardUrl && <a className="rd-btn rd-btn--quiet" href={p.dashboardUrl} target="_blank" rel="noopener noreferrer">Render ↗</a>}</>}>
                {p.envReadFailed && <p className="sv-warn">Couldn’t read this service’s environment variables from Render.</p>}
                {p.services.length === 0 && !p.envReadFailed && <p className="sv-muted">No third-party services detected from its environment variables.</p>}
                <div className="sv-grid">{p.services.map((s) => <ServiceCard key={s.key} project={p} svc={s} onToggle={toggle} />)}</div>
              </Section>
            ))}
            {data.projects.length === 0 && <Empty icon="▣" title="No live services">Connect a Render account and deploy a project; it will show up here automatically.</Empty>}

            <Section title="Settings">
              <label className="sv-field">MongoDB storage limit (MB)<input className="rd-field" type="number" min="1" value={mongoMb} onChange={(e) => setMongoMb(e.target.value)} /></label>
              <div className="sv-actions">
                <button type="button" className="rd-btn rd-btn--primary" onClick={() => void save({ mongoLimitMb: Number(mongoMb) || 512 }, "Saved.")}>Save</button>
                <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => void save({ enabled: false }, "Usage tracking turned off.")}>Turn off tracking</button>
              </div>
            </Section>
          </>
        )}
      </div>
    </main>
  );
}
