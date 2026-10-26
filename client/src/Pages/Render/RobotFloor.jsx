import React from "react";
import Robot from "../../Components/Robot/Robot";
import "./RobotFloor.css";

const STATE_LABEL = { running: "Kaam chal raha hai", burning: "Overload! Bhaag raha hai", sleeping: "So raha hai", down: "Gir gaya", deploying: "Naya deploy aa raha hai" };
const pct = (v) => (v == null ? "--" : Math.round(v) + "%");

function Meter({ label, value, tone }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={"fl-meter is-" + tone} title={label + ": " + pct(value)}>
      <span>{label}</span>
      <div className="fl-meter__bar"><i style={{ width: v + "%" }} /></div>
      <b>{pct(value)}</b>
    </div>
  );
}

const cpuTone = (v) => (v == null ? "off" : v >= 85 ? "bad" : v >= 60 ? "mid" : "ok");
const ramTone = (level) => ({ full: "bad", heavy: "mid", ok: "ok", light: "ok", unknown: "off" }[level]);

function Lane({ lane, onOpen }) {
  const moving = lane.state === "running" || lane.state === "burning" || lane.state === "deploying";
  const size = 58;
  return (
    <section className={"fl-lane is-" + lane.state + (lane.incident ? " has-incident" : "")} aria-label={lane.name}>
      <div className="fl-hud">
        <div className="fl-hud__head">
          {lane.demo || !onOpen
            ? <strong>{lane.name}</strong>
            : <button type="button" onClick={() => onOpen(lane.key)} title="Details, graphs, logs and environment">{lane.name}</button>}
          <span className="fl-hud__mood" title={lane.title}>{lane.face}</span>
        </div>
        <small className="fl-hud__state">{STATE_LABEL[lane.state]}{lane.deploy && lane.deploy !== "live" ? " · " + lane.deploy : ""}</small>
        <Meter label="CPU" value={lane.cpu} tone={cpuTone(lane.cpu)} />
        <Meter label="RAM" value={lane.memory} tone={ramTone(lane.mem.level)} />
        <div className="fl-hud__foot">
          <span title="Response time">NET {lane.latency == null ? "--" : Math.round(lane.latency) + " ms"}</span>
          {lane.hp != null && <span title="Health points">HP {lane.hp}</span>}
        </div>
        <p className={"fl-hud__note is-" + ramTone(lane.mem.level)}>{lane.mem.note}</p>
      </div>
      <div className="fl-track" aria-hidden="true">
        <span className="fl-station fl-station--in">📥<small>Jobs</small></span>
        <span className="fl-station fl-station--out">🗄️<small>Rack</small></span>
        <div className="fl-belt" />
        <div className={"fl-bot" + (moving ? " is-moving" : "")} style={{ "--sec": lane.pace + "s", "--size": size + "px" }}>
          <div className="fl-bot__face">
            {lane.incident && <span className="fl-boom">💥</span>}
            {lane.crates > 0 && moving && <span className="fl-crates">{"📦".repeat(lane.crates)}</span>}
            {lane.state === "burning" && <span className="fl-sweat">💦</span>}
            <Robot mood={lane.mood} load={lane.load} cpu={lane.cpu} memory={lane.memory} size={size} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A factory floor: every server is a robot running between its job inbox and its rack, with live numbers beside it. */
export default function RobotFloor({ lanes, demo = false, onOpen }) {
  const deploying = lanes.filter((l) => l.state === "deploying").length;
  const hot = lanes.filter((l) => l.state === "burning" || l.state === "down").length;
  return (
    <div className="fl">
      <header className="fl-top">
        <div>
          <h3>🏭 Robot Floor {demo && <em className="fl-demo">demo fleet</em>}</h3>
          <p>{lanes.length} robot{lanes.length === 1 ? "" : "s"} on shift · {deploying ? deploying + " deploying" : "no deploys"} · {hot ? hot + " need attention" : "all calm"}</p>
        </div>
        <div className={"fl-runway" + (deploying ? " is-busy" : "")} aria-hidden="true">
          <span className="fl-runway__label">✈️ Deploy runway</span>
          <span className="fl-runway__strip" />
          <svg className="fl-plane" viewBox="0 0 130 50" width="86" height="33"><path d="M6 26 q0 -9 14 -10 h70 q26 1 34 9 q-8 8 -34 9 h-70 q-14 -1 -14 -8z" fill="#f3f6fb" stroke="#9fb0c8" /><path d="M10 22 l-8 -16 h14 l12 15z" fill="#e0463a" /><path d="M60 28 l26 14 h-14 l-26 -12z" fill="#c9d2e0" />{[34, 46, 58, 70, 82].map((x) => <circle key={x} cx={x} cy="23" r="2" fill="#3d78d8" />)}</svg>
        </div>
      </header>
      {demo && <p className="fl-demo-note">Abhi koi server connected nahi hai, isliye ye ek demo fleet hai. Render API key jodte hi aapke asli servers yahan daudenge.</p>}
      <div className="fl-lanes">{lanes.map((l) => <Lane key={l.key} lane={l} onOpen={onOpen} />)}</div>
    </div>
  );
}
