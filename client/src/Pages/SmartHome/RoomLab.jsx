import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useConfirm } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { getHomeRooms, getRoomLive, setRoomModel, saveHomeRooms, setRoomPhone, deleteRoomSamples } from "../../api/client";
import { confusionRows, thinRooms, liveRows, headline } from "../../lib/roomLab";
import "./techie.css";

/** One phone in the live panel: the room, every room's share as a bar, and every number the model calculated. */
function LivePhone({ p }) {
  const cur = p.current, top = cur && cur.ranking.length ? Math.max(...cur.ranking.map((r) => r.p)) : 0;
  const state = !cur ? "off" : cur.sure && cur.fresh ? "" : "unsure";
  return (
    <div className="dev-card" aria-label={`${p.person} room model`}>
      <div className="dev-head" style={{ margin: 0 }}>
        <b>{p.person}</b><span className={`dev-state ${p.on ? "on" : "off"}`}>{p.on ? "ON" : "OFF"}</span>
        <span className="dev-muted">{p.total} samples · {p.trainedRooms} kamre trained</span>
      </div>
      <div className={`dev-room ${state}`}>&gt; {headline(p)}</div>
      {cur && cur.ranking.map((r) => (
        <div key={r.room} className={`dev-bar ${r.p === top ? "top" : ""}`}>
          <span>{r.room}</span><i><b style={{ width: `${Math.round(r.p * 100)}%` }} /></i><span>{Math.round(r.p * 100)}%</span>
        </div>
      ))}
      {cur && !cur.sure && cur.why ? <div className="dev-warn">{cur.why}</div> : null}
      {!p.trained ? <div className="dev-warn">Phone par Stashr Location → Room Lab mein kam se kam 2 kamre train karo.</div> : null}
      <dl className="dev-kv">
        {liveRows(p).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
      </dl>
      {p.cv.verdict ? <div className="dev-muted">{p.cv.verdict}</div> : null}
    </div>
  );
}

/**
 * The model console: Start / Stop for the whole model, and live, for every phone, the room and every number the model calculated, from
 * the same endpoint the tablet reads (so the two always show the same). Below, the rooms and how each phone is trained.
 */
export function RoomLabCard() {
  const [live, setLive] = useState(null);
  const [d, setD] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const loadLive = useCallback(async () => { try { setLive(await getRoomLive()); } catch (e) { toast.error(errorMessage(e, "Could not load the model.")); } }, []);
  const loadRooms = useCallback(async () => { try { const r = await getHomeRooms(); setD(r); setRooms((cur) => (cur.length ? cur : r.rooms)); } catch (e) { toast.error(errorMessage(e, "Could not load the rooms.")); } }, []);
  useEffect(() => { loadLive(); loadRooms(); const a = setInterval(loadLive, 5000), b = setInterval(loadRooms, 30000); return () => { clearInterval(a); clearInterval(b); }; }, [loadLive, loadRooms]);
  if (!live || !d) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const r = await setRoomModel(!live.running);
      setLive(r.live);
      setNote(r.blocked && r.blocked.length ? r.blocked.map((b) => `${b.person}: ${b.why}`).join("\n") : "");
      toast.success(r.running ? `Model chalu: ${r.started.join(", ")}` : "Model band.");
    } catch (e) { toast.error(errorMessage(e, "Could not change the model.")); } finally { setBusy(false); }
  };
  const dirty = JSON.stringify(rooms) !== JSON.stringify(d.rooms);
  const add = () => { const n = name.trim(); if (n.length >= 2 && !rooms.includes(n) && rooms.length < d.max) { setRooms([...rooms, n]); setName(""); } };
  const save = async () => {
    const gone = d.rooms.filter((r) => !rooms.includes(r));
    if (gone.length && !(await confirm.ask({ title: `Delete ${gone.join(", ")}?`, message: "Is kamre ka saara training (sab phones ka) mit jayega.", confirmLabel: "Delete", danger: true }))) return;
    try { await saveHomeRooms(rooms); toast.success("Rooms saved."); loadRooms(); loadLive(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  const toggleOne = async (p) => { try { await setRoomPhone(p.id, !p.on); loadRooms(); loadLive(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } };
  const wipe = async (p) => {
    if (!(await confirm.ask({ title: `${p.person} ka training mita do?`, message: "Is phone ke saare kamre ke samples delete honge.", confirmLabel: "Delete", danger: true }))) return;
    try { await deleteRoomSamples({ phone: p.id }); toast.success("Deleted."); loadRooms(); loadLive(); } catch (e) { toast.error(errorMessage(e, "Could not delete.")); }
  };
  const s = live.summary;

  return (
    <div className="dev" role="region" aria-label="Room model console">
      <div className="dev-prompt">stashr room-model --live</div>
      <div className="dev-head">
        <span className={`dev-led ${live.running ? "on" : ""}`} aria-hidden="true" />
        <span className="dev-title">ROOM MODEL · {live.running ? "RUNNING" : "STOPPED"}</span>
        <button type="button" className={`rd-btn ${live.running ? "rd-btn--danger-quiet" : "rd-btn--primary"}`} onClick={toggle} disabled={busy}>{live.running ? "Stop model" : "Start model"}</button>
        <button type="button" className="rd-btn" onClick={loadLive}>Refresh</button>
      </div>
      <div className="dev-sum">{s.on}/{s.phones} phones on · {s.trained} trained{s.cvAccuracy !== null ? ` · accuracy ${s.cvAccuracy}%` : ""}{s.fieldAccuracy !== null ? ` · asli ${s.fieldAccuracy}%` : ""} · har 5 second mein update</div>
      {note ? <div className="dev-warn" style={{ whiteSpace: "pre-line" }}>{note}</div> : null}
      {!live.phones.length ? <p className="sh-dim">Koi Stashr Location phone linked nahi hai.</p> : live.phones.map((p) => <LivePhone key={p.id} p={p} />)}
      <p className="sh-dim">Accuracy do tarah se naapi jaati hai: <b>chhupa ke guess</b> (har training scan ko chhupa ke baaki se guess) aur <b>asli</b> (jab aap phone mein “Sahi hai” ya “Galat hai” dabate ho). Koi bhi sahi 100% nahi hoti; jo dikh raha hai wahi naapa hua hai.</p>

      <details>
        <summary>Kamre aur training</summary>
        <div className="sh-editor">
          <b>Kamre</b>
          <div className="sh-row" style={{ flexWrap: "wrap" }}>
            {rooms.map((r) => <span key={r} className="sh-chip">{r} <button type="button" className="rd-btn" onClick={() => setRooms(rooms.filter((x) => x !== r))} aria-label={`Remove ${r}`}>✕</button></span>)}
            {!rooms.length ? <span className="sh-dim">Abhi koi kamra nahi.</span> : null}
          </div>
          <div className="sh-row">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Kamra, jaise Bedroom" maxLength={24} aria-label="New room" />
            <button type="button" className="rd-btn" onClick={add} disabled={name.trim().length < 2 || rooms.length >= d.max}>Add</button>
            <button type="button" className="rd-btn rd-btn--primary" onClick={save} disabled={!dirty}>Save rooms</button>
          </div>
        </div>
        {d.phones.map((p) => {
          const t = confusionRows(p.report), thin = thinRooms(d.rooms, p.counts);
          return (
            <div key={p.id} className="sh-editor">
              <div className="sh-row"><b>{p.person}</b><label className="sh-switch"><input type="checkbox" checked={p.on} onChange={() => toggleOne(p)} /> Room location on</label></div>
              <span className="sh-dim">Training: {d.rooms.map((r) => `${r} ${p.counts[r] || 0}`).join(" · ") || "—"}</span>
              {thin.length ? <span className="dev-warn">Kam training: {thin.join(", ")} (kam se kam 5 scan, 4-5 alag jagah se)</span> : null}
              {t.rows.length ? (
                <table className="sh-table">
                  <thead><tr><th>Asli kamra</th><th>Sahi %</th>{t.cols.map((c) => <th key={c}>→ {c}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r) => <tr key={r.room}><td>{r.room} ({r.n})</td><td>{r.accuracy}%</td>{r.cells.map((n, i) => <td key={i} style={{ fontWeight: t.cols[i] === r.room ? 700 : 400, color: t.cols[i] === r.room ? "var(--d-green)" : undefined }}>{n}</td>)}</tr>)}</tbody>
                </table>
              ) : null}
              <div className="sh-row"><button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => wipe(p)}>Is phone ka training mita do</button></div>
            </div>
          );
        })}
      </details>
      <details>
        <summary>Ye kaise kaam karta hai? (5 steps)</summary>
        <ol className="sh-dim">
          <li><b>Scan:</b> phone sunta hai ki kaun se Wi-Fi network aur Bluetooth device kitne zor se dikhte hain. Network ke naam kabhi nahi rakhe jaate, sirf hash.</li>
          <li><b>Training:</b> kamre mein “Main yahan hoon” dabate ho to wo scan us kamre ke naam se save hota hai (4-5 jagah, har kamre mein).</li>
          <li><b>Pehchan:</b> naye scan ko <b>saare</b> samples se milaya jata hai; jo zyada milta hai uska asar zyada, purane samples ka kam.</li>
          <li><b>Pakka ya nahi:</b> har kamre ka score % mein; 50% se kam ya kuch jaana-pehchana nahi to “pakka nahi”. Kamra tabhi badalta hai jab naya kamra lagaatar do baar jeete.</li>
          <li><b>Hisaab:</b> har training scan chhupa ke guess karwaya jaata hai; jitne sahi wahi accuracy. Aapke “Sahi hai/Galat hai” taps se asli accuracy bhi.</li>
        </ol>
      </details>
    </div>
  );
}
