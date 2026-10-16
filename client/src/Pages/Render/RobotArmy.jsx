import React, { useMemo, useState } from "react";
import Robot from "../../Components/Robot/Robot";
import { robotMood, MOODS } from "../../lib/robots";
import { Sparkline } from "./RenderUi";
import { serviceKey, safeUrl, timeAgo } from "./renderUtils";
import "./RobotArmy.css";

const fmt = (v, unit) => (v == null ? "—" : Math.round(v) + unit);
const MOOD_ORDER = ["fire", "dead", "transforming", "sweaty", "chill", "confused", "sleeping"];
const DEPLOY = { live: ["ok", "Live"], build_failed: ["bad", "Build fail"], update_failed: ["bad", "Deploy fail"], canceled: ["mid", "Cancelled"], build_in_progress: ["mid", "Building"], update_in_progress: ["mid", "Deploying"], pre_deploy_in_progress: ["mid", "Pre-deploy"], deactivated: ["mid", "Old"] };

/** A server's robot stats from its latest monitoring sample. */
export function botFor(s, series) {
  const key = serviceKey(s);
  const data = series.get(key);
  const last = data?.last;
  const stats = robotMood({
    name: s.name, suspended: s.suspended === "suspended", verdict: last?.verdict, health: last?.health,
    deployStatus: last?.deploy?.status, cpu: last?.cpu, memory: last?.memory, latency: last?.latency
  });
  return { key, s, last, points: data?.points || [], stats };
}

function Bar({ value, label, tone }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="ra-bar" title={label + ": " + (value == null ? "no data" : Math.round(value) + "%")}>
      <span>{label}</span>
      <div className={"ra-bar__track is-" + (tone || (v >= 85 ? "hot" : v >= 60 ? "warm" : "ok"))}><i style={{ transform: "scaleX(" + v / 100 + ")" }} /></div>
      <b>{value == null ? "—" : Math.round(value) + "%"}</b>
    </div>
  );
}
const hpTone = (hp) => (hp == null ? "idle" : hp < 30 ? "hot" : hp < 60 ? "warm" : "ok");

function BotCard({ bot, onOpen, onAction, busy, incident, project }) {
  const { s, stats, key, last, points } = bot;
  const suspended = s.suspended === "suspended";
  const isBusy = busy === key;
  const d = s.serviceDetails || {};
  const deploy = last?.deploy;
  const [dTone, dLabel] = deploy?.status ? DEPLOY[deploy.status] || ["mid", deploy.status.replace(/_/g, " ")] : ["mid", "—"];
  return (
    <article className={"ra-card is-" + stats.tone}>
      <div className="ra-card__bot">
        <Robot mood={stats.mood} load={stats.load} size={76} />
        {incident && <span className="ra-badge ra-badge--bad" title="This server has an open incident">🚨 incident</span>}
      </div>
      <div className="ra-card__body">
        <div className="ra-card__head">
          <button type="button" className="ra-card__name" onClick={() => onOpen(key)} title="Details, graphs, logs and environment">{s.name}</button>
          {project}
        </div>
        <span className="ra-card__mood">{stats.face} {stats.title}</span>
        <p className="ra-card__line">{stats.line}</p>
        <Bar label="HP" value={stats.hp} tone={hpTone(stats.hp)} />
        <Bar label="CPU" value={last?.cpu ?? null} />
        <Bar label="RAM" value={last?.memory ?? null} />
        {points.length > 1 && <div className="ra-card__trend"><span>CPU trend</span><Sparkline values={points.map((p) => p.cpu)} max={100} width={150} height={22} label={"CPU trend of " + s.name} /></div>}
        <dl className="ra-chips">
          {last?.latency != null && <div><dt>⚡</dt><dd>{fmt(last.latency, " ms")}</dd></div>}
          {deploy?.status && <div className={"is-" + dTone} title={deploy.commitMessage || ""}><dt>🚀</dt><dd>{dLabel}{deploy.createdAt ? " · " + timeAgo(deploy.createdAt) : ""}</dd></div>}
          {(d.plan || d.region) && <div><dt>📦</dt><dd>{[d.plan, d.region].filter(Boolean).join(" · ")}</dd></div>}
          {d.numInstances != null && <div><dt>🤖×</dt><dd>{d.numInstances}</dd></div>}
          {s.branch && <div title={s.autoDeploy === "yes" ? "Auto-deploys on push" : "Manual deploys"}><dt>🌿</dt><dd>{s.branch}{s.autoDeploy === "yes" ? " · auto" : ""}</dd></div>}
          {!suspended && <div><dt>🕒</dt><dd>{last?.t ? "checked " + timeAgo(last.t) : "not checked yet"}</dd></div>}
        </dl>
        {deploy?.commitMessage && <p className="ra-card__commit" title={deploy.commitMessage}>“{deploy.commitMessage.split("\n")[0]}”</p>}
        <div className="ra-card__actions">
          {!suspended && <button type="button" disabled={isBusy} onClick={() => onAction("restart", s)} title="Restart">↻ Restart</button>}
          <button type="button" disabled={isBusy} onClick={() => onAction("deploy", s)} title="Deploy the latest commit">⇪ Deploy</button>
          <button type="button" disabled={isBusy} className={suspended ? "is-wake" : "is-sleep"} onClick={() => onAction(suspended ? "resume" : "suspend", s)}>
            {isBusy ? "…" : suspended ? "⏰ Jagao" : "😴 Sulao"}
          </button>
          {d.url && <a href={safeUrl(d.url)} target="_blank" rel="noreferrer noopener">open ↗</a>}
        </div>
      </div>
    </article>
  );
}

/** A compact row of robots, one per server, used where there is less room (Monitoring). */
export function RobotSquad({ services, series, onOpen, title = "Squad status" }) {
  const bots = useMemo(() => services.map((s) => botFor(s, series)), [services, series]);
  if (!bots.length) return null;
  const worst = [...bots].sort((a, b) => MOOD_ORDER.indexOf(a.stats.mood) - MOOD_ORDER.indexOf(b.stats.mood))[0];
  return (
    <div className="ra ra--compact">
      <div className="ra-squadline">
        <strong>🛰️ {title}</strong>
        <span>{worst.stats.line}</span>
      </div>
      <div className="ra-mini">
        {bots.map((b) => (
          <button key={b.key} type="button" className={"ra-mini__bot is-" + b.stats.tone} onClick={() => onOpen?.(b.key)} title={b.stats.line}>
            <Robot mood={b.stats.mood} load={b.stats.load} size={48} />
            <b>{b.s.name}</b>
            <small>{b.stats.face} {b.stats.hp != null ? "HP " + b.stats.hp : b.stats.title}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Render servers as a robot army: a robot per server whose mood follows its live health and load. */
export default function RobotArmy({ groups, series, onOpen, onAction, busy, incidentKeys, projectCell }) {
  const [mood, setMood] = useState("all");
  const bots = useMemo(() => groups.flatMap((group) => group.members.map((s) => ({ ...botFor(s, series), app: group.name }))), [groups, series]);
  const counts = useMemo(() => bots.reduce((m, b) => ({ ...m, [b.stats.mood]: (m[b.stats.mood] || 0) + 1 }), {}), [bots]);
  const visible = mood === "all" ? bots : bots.filter((b) => b.stats.mood === mood);
  const byApp = visible.reduce((m, b) => m.set(b.app, [...(m.get(b.app) || []), b]), new Map());
  if (!bots.length) return null;
  const hasIncident = (key) => Boolean(incidentKeys && (incidentKeys.has ? incidentKeys.has(key) : incidentKeys.includes?.(key)));

  return (
    <div className="ra">
      <div className="ra-squad" role="group" aria-label="Filter robots by mood">
        <button type="button" aria-pressed={mood === "all"} className={mood === "all" ? "is-on" : ""} onClick={() => setMood("all")}>🤖 Sab ({bots.length})</button>
        {MOOD_ORDER.filter((m) => counts[m]).map((m) => (
          <button key={m} type="button" aria-pressed={mood === m} className={(mood === m ? "is-on " : "") + "is-" + MOODS[m].tone} onClick={() => setMood(mood === m ? "all" : m)}>
            {MOODS[m].face} {MOODS[m].title} ({counts[m]})
          </button>
        ))}
      </div>

      {[...byApp].map(([app, list]) => (
        <section key={app} className="ra-squadron" aria-label={app}>
          <h3>{app} <span>{list.length} bot{list.length === 1 ? "" : "s"}</span></h3>
          <div className="ra-grid">{list.map((bot) => (
            <BotCard key={bot.key} bot={bot} onOpen={onOpen} onAction={onAction} busy={busy} incident={hasIncident(bot.key)} project={projectCell ? projectCell([bot.s]) : null} />
          ))}</div>
        </section>
      ))}
    </div>
  );
}
