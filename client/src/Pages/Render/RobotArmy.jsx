import React, { useMemo, useState } from "react";
import Robot from "../../Components/Robot/Robot";
import { robotMood, MOODS, telemetry, fleetTelemetry } from "../../lib/robots";
import { Sparkline } from "./RenderUi";
import { serviceKey, safeUrl, timeAgo } from "./renderUtils";
import "./RobotArmy.css";

const MOOD_ORDER = ["dead", "fire", "angry", "scared", "dizzy", "transforming", "sweaty", "tired", "celebrating", "starstruck", "chill", "bored", "confused", "sleeping"];
const DEPLOY = { live: ["ok", "Live"], build_failed: ["bad", "Build fail"], update_failed: ["bad", "Deploy fail"], canceled: ["mid", "Cancelled"], build_in_progress: ["mid", "Building"], update_in_progress: ["mid", "Deploying"], pre_deploy_in_progress: ["mid", "Pre-deploy"], deactivated: ["mid", "Old"] };

/** A server's robot stats from its latest monitoring sample. */
export function botFor(s, series, incidentKeys) {
  const key = serviceKey(s);
  const data = series.get(key);
  const last = data?.last;
  const stats = robotMood({
    name: s.name, suspended: s.suspended === "suspended", verdict: last?.verdict, health: last?.health,
    deployStatus: last?.deploy?.status, deployAt: last?.deploy?.createdAt, cpu: last?.cpu, memory: last?.memory, latency: last?.latency,
    incident: Boolean(incidentKeys?.has?.(key))
  });
  const points = data?.points || [];
  const tele = telemetry({ id: s.id, type: s.type, region: s.serviceDetails?.region, mood: stats.mood, last, points });
  return { key, s, last, points, stats, tele };
}

/* A ring gauge (0-100). Drawn with one stroke-dasharray, so it costs nothing to animate. */
function Gauge({ value, label, tone }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 19, c = 2 * Math.PI * r;
  const t = tone || (value == null ? "idle" : v >= 85 ? "hot" : v >= 60 ? "warm" : "ok");
  return (
    <div className={"ra-gauge is-" + t} title={label + ": " + (value == null ? "no data" : Math.round(value) + "%")}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="ra-gauge__track" cx="24" cy="24" r={r} />
        <circle className="ra-gauge__fill" cx="24" cy="24" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <b>{value == null ? "--" : Math.round(value)}</b>
      <span>{label}</span>
    </div>
  );
}

function Leds({ leds }) {
  return <div className="ra-leds">{leds.map((l) => <span key={l.id} className={"ra-led is-" + l.tone} title={l.id + ": " + l.label}><i aria-hidden="true" />{l.id}</span>)}</div>;
}

/** The fleet console: what the whole army is doing, at a glance. */
function FleetConsole({ bots }) {
  const f = useMemo(() => fleetTelemetry(bots), [bots]);
  const n = (v, unit = "%") => (v == null ? "--" : Math.round(v) + unit);
  const cells = [
    ["UNITS ONLINE", f.online + "/" + f.units, f.online === f.units ? "ok" : "mid"],
    ["FLEET INTEGRITY", n(f.integrity), f.integrity == null ? "idle" : f.integrity < 40 ? "bad" : f.integrity < 70 ? "mid" : "ok"],
    ["AVG CPU", n(f.cpu), f.cpu >= 85 ? "bad" : f.cpu >= 60 ? "mid" : "ok"],
    ["AVG MEM", n(f.memory), f.memory >= 90 ? "bad" : f.memory >= 70 ? "mid" : "ok"],
    ["P50 NET", n(f.p50, " ms"), f.p50 >= 1500 ? "bad" : f.p50 >= 800 ? "mid" : "ok"],
    ["ALERTS", String(f.critical), f.critical ? "bad" : "ok"],
    ["UPDATING", String(f.updating), f.updating ? "mid" : "idle"]
  ];
  return (
    <div className="ra-console" role="group" aria-label="Fleet telemetry">
      <span className="ra-console__title">◈ FLEET TELEMETRY<i className="ra-console__live" aria-hidden="true" /> LIVE</span>
      <dl>{cells.map(([k, v, tone]) => <div key={k} className={"is-" + tone}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
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
    <article className={"ra-card ra-card--hud is-" + stats.tone}>
      <header className="ra-hud__top">
        <span className="ra-hud__unit">{bot.tele.unit}</span>
        <span className="ra-hud__code">{bot.tele.code}</span>
        <span className={"ra-threat is-" + bot.tele.threat.toLowerCase()}>{bot.tele.threat}</span>
      </header>
      <div className="ra-card__bot">
        <Robot mood={stats.mood} load={stats.load} cpu={last?.cpu} memory={last?.memory} size={80} />
        {incident && <span className="ra-badge ra-badge--bad" title="This server has an open incident">🚨 incident</span>}
      </div>
      <div className="ra-card__body">
        <div className="ra-card__head">
          <button type="button" className="ra-card__name" onClick={() => onOpen(key)} title="Details, graphs, logs and environment">{s.name}</button>
          {project}
        </div>
        <span className="ra-card__mood">{stats.face} {stats.title}</span>
        <p className="ra-card__line">{stats.line}</p>
        <Leds leds={bot.tele.leds} />
        <div className="ra-gauges">
          <Gauge label="HP" value={stats.hp} tone={hpTone(stats.hp)} />
          <Gauge label="CPU" value={last?.cpu ?? null} />
          <Gauge label="RAM" value={last?.memory ?? null} />
          <div className="ra-net"><b>{last?.latency != null ? Math.round(last.latency) : "--"}<small>ms</small></b><span>NET{bot.tele.p95 != null ? " · p95 " + Math.round(bot.tele.p95) : ""}</span></div>
        </div>
        {points.length > 1 && <div className="ra-card__trend"><span>CPU {bot.tele.trend} · {bot.tele.samples} samples</span><Sparkline values={points.map((p) => p.cpu)} max={100} width={150} height={22} label={"CPU trend of " + s.name} /></div>}
        <pre className="ra-term" aria-label="Diagnostics">{bot.tele.lines.join("\n")}<i className="ra-term__cursor" aria-hidden="true" /></pre>
        <dl className="ra-chips">
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
            <Robot mood={b.stats.mood} load={b.stats.load} cpu={b.last?.cpu} memory={b.last?.memory} size={48} />
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
  const bots = useMemo(() => groups.flatMap((group) => group.members.map((s) => ({ ...botFor(s, series, incidentKeys), app: group.name }))), [groups, series, incidentKeys]);
  const counts = useMemo(() => bots.reduce((m, b) => ({ ...m, [b.stats.mood]: (m[b.stats.mood] || 0) + 1 }), {}), [bots]);
  const visible = mood === "all" ? bots : bots.filter((b) => b.stats.mood === mood);
  const byApp = visible.reduce((m, b) => m.set(b.app, [...(m.get(b.app) || []), b]), new Map());
  if (!bots.length) return null;
  const hasIncident = (key) => Boolean(incidentKeys && (incidentKeys.has ? incidentKeys.has(key) : incidentKeys.includes?.(key)));

  return (
    <div className="ra">
      <FleetConsole bots={bots} />
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
