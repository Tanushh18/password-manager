import React, { useMemo, useState } from "react";
import Robot from "../../Components/Robot/Robot";
import { robotMood, pickFighters, arenaScore, arenaCommentary, MOODS } from "../../lib/robots";
import { serviceKey, safeUrl } from "./renderUtils";
import "./RobotArmy.css";

const fmt = (v, unit) => (v == null ? "—" : Math.round(v) + unit);
const MOOD_ORDER = ["fire", "dead", "transforming", "sweaty", "chill", "confused", "sleeping"];

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

function BotCard({ bot, onOpen, onAction, busy }) {
  const { s, stats, key } = bot;
  const suspended = s.suspended === "suspended";
  const isBusy = busy === key;
  return (
    <article className={"ra-card is-" + stats.tone}>
      <div className="ra-card__bot"><Robot mood={stats.mood} load={stats.load} size={76} /></div>
      <div className="ra-card__body">
        <button type="button" className="ra-card__name" onClick={() => onOpen(key)} title="Details, graphs, logs and environment">{s.name}</button>
        <span className="ra-card__mood">{stats.face} {stats.title}</span>
        <p className="ra-card__line">{stats.line}</p>
        <Bar label="HP" value={stats.hp} tone={stats.hp == null ? "idle" : stats.hp < 30 ? "hot" : stats.hp < 60 ? "warm" : "ok"} />
        <Bar label="CPU" value={bot.last?.cpu ?? null} />
        <Bar label="RAM" value={bot.last?.memory ?? null} />
        <div className="ra-card__meta">
          <span>⚡ {fmt(bot.last?.latency, " ms")}</span>
          {s.serviceDetails?.url ? <a href={safeUrl(s.serviceDetails.url)} target="_blank" rel="noreferrer noopener">open ↗</a> : <span>no URL</span>}
        </div>
        <div className="ra-card__actions">
          {!suspended && <button type="button" disabled={isBusy} onClick={() => onAction("restart", s)} title="Restart">↻ Restart</button>}
          <button type="button" disabled={isBusy} onClick={() => onAction("deploy", s)} title="Deploy the latest commit">⇪ Deploy</button>
          <button type="button" disabled={isBusy} className={suspended ? "is-wake" : "is-sleep"} onClick={() => onAction(suspended ? "resume" : "suspend", s)}>
            {isBusy ? "…" : suspended ? "⏰ Jagao" : "😴 Sulao"}
          </button>
        </div>
      </div>
    </article>
  );
}

function Arena({ bots, onOpen }) {
  const defaults = useMemo(() => pickFighters(bots).map((b) => b.key), [bots]);
  const [chosen, setChosen] = useState(null);
  const keys = (chosen || defaults).filter((k) => bots.some((b) => b.key === k));
  const fighters = keys.map((k) => bots.find((b) => b.key === k)).filter(Boolean);
  const best = fighters.length > 1 ? Math.max(...fighters.map((f) => arenaScore(f.stats))) : null;
  const swap = (slot, key) => setChosen(() => { const next = [...keys]; next[slot] = key; return next; });
  const rematch = () => {
    const rest = bots.filter((b) => !keys.includes(b.key));
    if (!rest.length) return;
    setChosen([...new Set([...rest, ...bots].map((b) => b.key))].slice(0, 3));
  };
  if (bots.length < 2) return null;
  return (
    <section className="ra-arena" aria-label="Robot fight arena">
      <header className="ra-arena__head">
        <h3>⚔️ Fight Arena</h3>
        <p>{arenaCommentary(fighters.map((f) => ({ name: f.s.name, stats: f.stats })))}</p>
        <button type="button" className="ra-btn" onClick={rematch}>🔁 Rematch</button>
      </header>
      <div className="ra-arena__ring">
        {fighters.map((f, slot) => {
          const score = arenaScore(f.stats);
          const winner = best != null && score === best && fighters.filter((x) => arenaScore(x.stats) === best).length === 1;
          return (
            <div key={f.key + slot} className={"ra-fighter" + (winner ? " is-winner" : "")}>
              {winner && <span className="ra-crown" aria-label="Winner">👑</span>}
              <button type="button" className="ra-fighter__bot" onClick={() => onOpen(f.key)} aria-label={"Open " + f.s.name}><Robot mood={f.stats.mood} load={f.stats.load} size={104} /></button>
              <select value={f.key} onChange={(e) => swap(slot, e.target.value)} aria-label={"Fighter " + (slot + 1)}>
                {bots.map((b) => <option key={b.key} value={b.key}>{b.s.name}</option>)}
              </select>
              <Bar label="HP" value={f.stats.hp} tone={f.stats.hp == null ? "idle" : f.stats.hp < 30 ? "hot" : f.stats.hp < 60 ? "warm" : "ok"} />
              <small>{f.stats.face} {f.stats.title} · CPU {fmt(f.last?.cpu, "%")} · RAM {fmt(f.last?.memory, "%")}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Render servers as a robot army: a robot per server whose mood follows its live health and load, plus an arena. */
export default function RobotArmy({ groups, series, onOpen, onAction, busy }) {
  const [mood, setMood] = useState("all");
  const bots = useMemo(() => groups.flatMap((group) => group.members.map((s) => {
    const key = serviceKey(s);
    const last = series.get(key)?.last;
    const stats = robotMood({
      name: s.name, suspended: s.suspended === "suspended", verdict: last?.verdict, health: last?.health,
      deployStatus: last?.deploy?.status, cpu: last?.cpu, memory: last?.memory, latency: last?.latency
    });
    return { key, s, last, stats, app: group.name };
  })), [groups, series]);
  const counts = useMemo(() => bots.reduce((m, b) => ({ ...m, [b.stats.mood]: (m[b.stats.mood] || 0) + 1 }), {}), [bots]);
  const visible = mood === "all" ? bots : bots.filter((b) => b.stats.mood === mood);
  const byApp = visible.reduce((m, b) => m.set(b.app, [...(m.get(b.app) || []), b]), new Map());
  if (!bots.length) return null;

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

      <Arena bots={bots.filter((b) => b.s.suspended !== "suspended")} onOpen={onOpen} />

      {[...byApp].map(([app, list]) => (
        <section key={app} className="ra-squadron" aria-label={app}>
          <h3>{app} <span>{list.length} bot{list.length === 1 ? "" : "s"}</span></h3>
          <div className="ra-grid">{list.map((bot) => <BotCard key={bot.key} bot={bot} onOpen={onOpen} onAction={onAction} busy={busy} />)}</div>
        </section>
      ))}
    </div>
  );
}
