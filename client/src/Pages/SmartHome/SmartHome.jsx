import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  getHomeDevices, removeHomeDevice, renameHomeDevice, sendHomeCommand, labelHomeLanDevice,
  getHomeEvents, askHomeAssistant
} from "../../api/client";
import { Section, Skeleton, Empty, useConfirm } from "../Render/RenderUi";
import { usePolling } from "../Render/renderHooks";
import { errorMessage } from "../Render/renderUtils";
import { stateOf, STATE_LABEL, fmtBytes, ago, nowPlaying, signalWord, groupByRoom, lanName } from "../../lib/smartHome";
import "../Render/RenderDashboard.css";
import "./SmartHome.css";

const APPS = [
  ["Netflix", "com.netflix.ninja"], ["Prime Video", "com.amazon.amazonvideo.livingroom"], ["JioHotstar", "in.startv.hotstar"],
  ["YouTube", "com.google.android.youtube.tv"], ["MX Player", "com.mxtech.videoplayer.television"], ["Zee5", "com.graymatrix.did"]
];

/** Sends one command and tells you what happened. */
function useSend(reload) {
  return useCallback(async (id, type, args, doneText) => {
    try {
      await sendHomeCommand(id, type, args);
      toast.success(doneText || "Sent. The device picks it up within a minute.");
      reload();
    } catch (e) { toast.error(errorMessage(e, "Could not send that.")); }
  }, [reload]);
}

function Dot({ state }) { return <span className={"sh-dot is-" + state} aria-hidden="true" />; }

function Pending({ commands }) {
  const list = (commands || []).slice(0, 4);
  if (!list.length) return null;
  return (
    <ul className="sh-cmds" aria-label="Recent commands">
      {list.map((c) => (
        <li key={c.id} className={"is-" + c.status}>
          <b>{c.type.replace(/_/g, " ")}{c.args?.name ? ` · ${c.args.name}` : ""}</b>
          <span>{c.status === "done" ? "done" : c.status === "failed" ? "failed" : "waiting"}{c.result ? ` · ${c.result}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function TvCard({ device, send, onChanged }) {
  const confirm = useConfirm();
  const s = device.status || {};
  const state = stateOf(device);
  const usb = s.usb || {};
  const movies = s.movies || [];
  const cmd = (type, args, text) => send(device.id, type, args, text);
  const usedPct = usb.total ? Math.round(100 * (1 - usb.free / usb.total)) : 0;
  return (
    <Section title={device.name} subtitle={`${STATE_LABEL[state]} · seen ${ago(device.lastSeen)}`}
      actions={<><Dot state={state} /><DeviceMenu device={device} onChanged={onChanged} /></>}>
      {confirm.dialog}
      <div className="sh-now">
        <strong>{state === "on" ? nowPlaying(s) : state === "standby" ? "Screen is off" : "Not connected"}</strong>
        <div className="sh-chips">
          {s.wifi?.rssi ? <span>Wi-Fi {signalWord(s.wifi.rssi)} ({s.wifi.rssi} dBm)</span> : null}
          {s.volume?.max ? <span>Volume {s.volume.level}/{s.volume.max}</span> : null}
          {s.uptimeSec ? <span>Up {Math.round(s.uptimeSec / 3600)} h</span> : null}
          {s.version ? <span>App {s.version}</span> : null}
        </div>
      </div>

      {state !== "off" && (
        <div className="sh-controls">
          <div className="sh-row">
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("media", { action: "previous" })} aria-label="Previous">⏮</button>
            <button className="rd-btn rd-btn--primary" onClick={() => cmd("media", { action: "play_pause" })} aria-label="Play or pause">⏯ Play / Pause</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("media", { action: "next" })} aria-label="Next">⏭</button>
            <span className="sh-sep" />
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("volume", { action: "down" })}>Vol −</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("volume", { action: "up" })}>Vol +</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("volume", { action: "mute" })}>Mute</button>
            <span className="sh-sep" />
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("key", { key: "HOME" })}>Home</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("key", { key: "BACK" })}>Back</button>
          </div>
          <div className="sh-row">
            {APPS.map(([label, pkg]) => <button key={pkg} className="rd-btn rd-btn--quiet" onClick={() => cmd("launch_app", { package: pkg }, `Opening ${label}…`)}>{label}</button>)}
          </div>
        </div>
      )}

      <div className="sh-block">
        <h4>USB drive</h4>
        {usb.present === false ? <p className="sh-dim">No USB drive is plugged in.</p> : usb.total ? (
          <>
            <div className="sh-bar" role="img" aria-label={`${usedPct}% used`}><i style={{ width: usedPct + "%" }} /></div>
            <p className="sh-dim">{fmtBytes(usb.free)} free of {fmtBytes(usb.total)}{usb.fs === "vfat" ? " · FAT32 (files must be under 4 GB)" : ""}</p>
          </>
        ) : <p className="sh-dim">No details yet.</p>}
        {s.upload?.active ? (
          <div className="sh-up">
            <b>Receiving {s.upload.name}</b>
            <div className="sh-bar"><i style={{ width: Math.round(100 * (s.upload.done || 0) / Math.max(1, s.upload.size || 1)) + "%" }} /></div>
          </div>
        ) : null}
        {s.sync?.line ? <p className="sh-dim">{s.sync.line}</p> : null}
        {s.sync?.error ? <p className="sh-bad">Sync: {s.sync.error}</p> : null}
        {movies.length ? (
          <ul className="sh-movies">
            {movies.map((m) => (
              <li key={m.name}>
                <div><b>{m.name}</b><span>{fmtBytes(m.size)}</span></div>
                <div className="sh-row">
                  {state === "on" && <button className="rd-btn rd-btn--quiet" onClick={() => cmd("play_movie", { name: m.name }, `Playing ${m.name}…`)}>Play on TV</button>}
                  <button className="rd-btn rd-btn--danger-quiet" onClick={async () => {
                    if (await confirm.ask({ title: "Remove from the USB drive?", message: `“${m.name}” will be deleted from the TV’s USB drive. This cannot be undone.`, confirmLabel: "Remove", danger: true })) cmd("remove_movie", { name: m.name }, "Removal sent.");
                  }}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="sh-dim">No movies on the USB drive.</p>}
        <div className="sh-row"><button className="rd-btn rd-btn--quiet" onClick={() => cmd("sync_now", {}, "Asking the TV to sync…")}>Sync now</button></div>
      </div>
      <Pending commands={device.commands} />
    </Section>
  );
}

function LanRow({ device, row, onChanged }) {
  const [edit, setEdit] = useState(false);
  const [label, setLabel] = useState(row.label || "");
  const [room, setRoom] = useState(row.room || "");
  const save = async () => {
    try { await labelHomeLanDevice(device.id, row.key, label, room); setEdit(false); onChanged(); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  return (
    <li className={row.up ? "" : "is-down"}>
      <Dot state={row.up ? "on" : "off"} />
      <div className="sh-lan__main">
        <b>{lanName(row)}</b>
        <span>{row.ip}{row.mac ? " · " + row.mac : ""}{row.name && row.label ? " · " + row.name : ""}</span>
        <span>{row.up ? (row.pingMs ? `answers in ${row.pingMs} ms` : "online") : `last seen ${ago(row.lastSeen)}`} · first seen {ago(row.firstSeen)}</span>
      </div>
      {edit ? (
        <div className="sh-row">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" maxLength={60} aria-label="Device name" />
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" maxLength={60} aria-label="Room" />
          <button className="rd-btn rd-btn--primary" onClick={save}>Save</button>
          <button className="rd-btn rd-btn--quiet" onClick={() => setEdit(false)}>Cancel</button>
        </div>
      ) : <button className="rd-btn rd-btn--quiet" onClick={() => setEdit(true)}>Name / room</button>}
    </li>
  );
}

function HubCard({ device, send, onChanged }) {
  const s = device.status || {};
  const state = stateOf(device);
  const groups = groupByRoom(device.lan);
  const up = (device.lan || []).filter((d) => d.up).length;
  return (
    <Section title={device.name} subtitle={`${STATE_LABEL[state]} · seen ${ago(device.lastSeen)} · ${up} of ${(device.lan || []).length} devices answering`}
      actions={<><Dot state={state} /><DeviceMenu device={device} onChanged={onChanged} /></>}>
      <div className="sh-chips">
        {s.battery ? <span>Battery {s.battery.pct}%{s.battery.charging ? " · charging" : ""}</span> : null}
        {s.wifi?.rssi ? <span>Wi-Fi {signalWord(s.wifi.rssi)} ({s.wifi.rssi} dBm)</span> : null}
        {s.scan?.at ? <span>Last scan {ago(s.scan.at)}{s.scan.ms ? ` (${Math.round(s.scan.ms / 1000)} s)` : ""}</span> : null}
        {s.scan?.subnet ? <span>{s.scan.subnet}</span> : null}
      </div>
      <p className="sh-dim">The tablet sees who is on the Wi-Fi and how fast each device answers. It cannot see inside a device, and it cannot tell which room a device is in, so name the room yourself.</p>
      <div className="sh-row"><button className="rd-btn rd-btn--quiet" onClick={() => send(device.id, "scan_now", {}, "Scanning the Wi-Fi…")}>Scan now</button></div>
      {groups.length ? groups.map(([room, rows]) => (
        <div className="sh-block" key={room}>
          <h4>{room}</h4>
          <ul className="sh-lan">{rows.map((r) => <LanRow key={r.key} device={device} row={r} onChanged={onChanged} />)}</ul>
        </div>
      )) : <p className="sh-dim">No devices seen yet. The first scan takes about a minute.</p>}
      <Pending commands={device.commands} />
    </Section>
  );
}

function DeviceMenu({ device, onChanged }) {
  const confirm = useConfirm();
  const rename = async () => {
    const name = window.prompt("Name for this device", device.name);
    if (name === null || !name.trim() || name.trim() === device.name) return;
    try { await renameHomeDevice(device.id, name.trim()); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not rename it.")); }
  };
  // A TV that reports through the tablet comes back by itself, so it cannot be removed here.
  if (device.viaHub) return <button className="rd-btn rd-btn--quiet" onClick={rename}>Rename</button>;
  const remove = async () => {
    if (!(await confirm.ask({ title: `Remove ${device.name}?`, message: "It stops reporting and its history is deleted. Sign in again on the tablet to bring it back.", confirmLabel: "Remove", danger: true }))) return;
    try { await removeHomeDevice(device.id); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not remove it.")); }
  };
  return (
    <>
      {confirm.dialog}
      <button className="rd-btn rd-btn--quiet" onClick={rename}>Rename</button>
      <button className="rd-btn rd-btn--danger-quiet" onClick={remove}>Remove</button>
    </>
  );
}

function Assistant({ onDone }) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async (sentence) => {
    const t = (sentence ?? text).trim();
    if (!t) return;
    setBusy(true);
    try { const r = await askHomeAssistant(t); setReply(r.reply); setText(""); onDone(); }
    catch (e) { setReply(errorMessage(e, "Could not do that.")); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Ask Stashr" subtitle="Try: “volume up”, “pause”, “open netflix”, “tv ki awaaz kam karo”, “status”">
      <form className="sh-row sh-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What should I do?" maxLength={200} aria-label="Command" />
        <button className="rd-btn rd-btn--primary" type="submit" disabled={busy}>Send</button>
      </form>
      {reply ? <p className="sh-reply" role="status">{reply}</p> : null}
    </Section>
  );
}

export default function SmartHome() {
  const [devices, setDevices] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([getHomeDevices(), getHomeEvents(30)]);
      setDevices(d.devices); setEvents(e.events); setError("");
    } catch (e) { setError(errorMessage(e, "Could not load your devices.")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 8000);
  const send = useSend(load);

  return (
    <main className="sh-page">
      <header className="sh-head">
        <div><h1>Smart home</h1><p className="sh-dim">Your TV and the Wi-Fi at home, from anywhere.</p></div>
      </header>
      {error ? <p className="sh-bad" role="alert">{error}</p> : null}
      <Assistant onDone={load} />
      {devices === null ? <Skeleton lines={5} /> : devices.length === 0 ? (
        <Empty icon="📺" title="Nothing connected yet">Open the Stashr Hub app on the always-on tablet and sign in with your Stashr account. The tablet appears here, and your TV joins by itself once its Stashr app is open.</Empty>
      ) : devices.map((d) => d.kind === "tv"
        ? <TvCard key={d.id} device={d} send={send} onChanged={load} />
        : <HubCard key={d.id} device={d} send={send} onChanged={load} />)}
      <Section title="What happened" subtitle="The last 60 days are kept">
        {events.length ? (
          <ul className="sh-events">{events.map((e) => <li key={e.id}><span>{ago(e.at)}</span><b>{e.text}</b></li>)}</ul>
        ) : <p className="sh-dim">Nothing yet.</p>}
      </Section>
    </main>
  );
}
