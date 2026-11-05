import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { Section } from "../Render/RenderUi";
import "./techie.css";
import { errorMessage } from "../Render/renderUtils";
import { getHomeMap, saveHomeMap, saveHouseLayout } from "../../api/client";
import { shapes, awayLine, SCALE_2D, moveBlock, resizeBlock, clampBlock, overlapping, layoutOf, exportText, parseLayoutFile } from "../../lib/homeMap";

/** A picture from a phone scan app, shrunk so it fits the 2 MB the server accepts. */
function shrink(file, max = 1400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This picture could not be read.")); };
    img.src = url;
  });
}

/** The house, drawn from what Stashr has learned by itself (Wi-Fi access points = zones), in 2D or 3D. */
export function HouseMapCard() {
  const [map, setMap] = useState(null);
  const [mode, setMode] = useState("2d");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);          // the layout editor: drag a room, pull its corner, set its height
  const [draft, setDraft] = useState([]);
  const [sel, setSel] = useState("");
  const file = useRef(null);
  const layoutFile = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const load = useCallback(async () => { try { setMap(await getHomeMap()); } catch (e) { toast.error(errorMessage(e, "Could not load the map.")); } }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (!map) return null;
  const save = async (body, ok) => { setBusy(true); try { setMap(await saveHomeMap(body)); if (ok) toast.success(ok); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } finally { setBusy(false); } };
  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try { await save({ plan: await shrink(f) }, "Floor plan added behind the map."); } catch (err) { toast.error(errorMessage(err, "Could not use that picture.")); }
  };
  const roomBlocks = map.zones.filter((z) => z.roomBlock);
  const shown = edit ? { ...map, zones: [...draft, ...map.zones.filter((z) => !z.roomBlock)] } : map;
  const view = shapes(shown, edit ? "2d" : mode, true, edit ? { w: 12, h: 8 } : undefined);
  const startEdit = () => { setDraft(roomBlocks.map((z) => clampBlock({ ...z }))); setSel(roomBlocks[0] ? roomBlocks[0].name : ""); setMode("2d"); setEdit(true); };
  const pointerDown = (e, name, how) => {
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    const r = svgRef.current.getBoundingClientRect();
    drag.current = { name, how, sx: e.clientX, sy: e.clientY, orig: draft.find((b) => b.name === name), k: view.width / r.width / SCALE_2D };   // screen pixels -> grid units
    setSel(name);
  };
  const pointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) * d.k, dy = (e.clientY - d.sy) * d.k;
    setDraft((cur) => cur.map((b) => (b.name === d.name ? (d.how === "move" ? moveBlock(d.orig, dx, dy) : resizeBlock(d.orig, dx, dy)) : b)));
  };
  const pointerUp = () => { drag.current = null; };
  const setField = (name, patch) => setDraft((cur) => cur.map((b) => (b.name === name ? clampBlock({ ...b, ...patch }) : b)));
  const saveLayout = async () => { setBusy(true); try { setMap(await saveHouseLayout(layoutOf(draft))); setEdit(false); toast.success("Layout saved: tablet par bhi yahi dikhega."); } catch (e) { toast.error(errorMessage(e, "Could not save the layout.")); } finally { setBusy(false); } };
  const autoArrange = async () => { setBusy(true); try { setMap(await saveHouseLayout(null, true)); setEdit(false); toast.success("Wapas automatic layout."); } catch (e) { toast.error(errorMessage(e, "Could not reset.")); } finally { setBusy(false); } };
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([exportText(draft)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "stashr-house-layout.json"; a.click(); URL.revokeObjectURL(url);
  };
  const importFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const r = parseLayoutFile(await f.text(), draft.map((b) => b.name));
    if (!r.ok) { toast.error(r.error); return; }
    setDraft((cur) => cur.map((b) => (r.layout[b.name] ? clampBlock({ ...b, ...r.layout[b.name] }) : b)));
    toast.success(`${r.used.length} room(s) imported${r.ignored.length ? `; ${r.ignored.length} not in your rooms: ${r.ignored.join(", ")}` : ""}. Save karo.`);
  };
  const stacked = edit ? overlapping(draft) : [];
  const picked = draft.find((b) => b.name === sel);
  const learned = map.zones.filter((z) => !z.labelOnly);
  return (
    <div className="dev"><div className="dev-prompt">stashr house-map --{mode}</div>
    <Section title="Ghar ka map" subtitle="Stashr learns the zones of the house by itself from the Wi-Fi access point each phone and the tablet connects to, and keeps improving it as more data comes in. It is a diagram, not a measured floor plan.">
      <div className="sh-row">
        <div role="group" aria-label="View">
          <button type="button" className={`rd-btn ${mode === "2d" ? "rd-btn--primary" : "rd-btn--quiet"}`} onClick={() => setMode("2d")} aria-pressed={mode === "2d"}>2D</button>{" "}
          <button type="button" className={`rd-btn ${mode === "3d" ? "rd-btn--primary" : "rd-btn--quiet"}`} onClick={() => setMode("3d")} aria-pressed={mode === "3d"}>3D</button>
        </div>
        <button type="button" className="rd-btn rd-btn--quiet" onClick={load}>Refresh</button>
        {roomBlocks.length && !edit ? <button type="button" className="rd-btn rd-btn--quiet" onClick={startEdit}>Edit layout</button> : null}
      </div>
      {!roomBlocks.length ? <p className="sh-dim">Layout edit tab hoga jab kamre ban jayenge (Room Lab mein kamre banao): phir har kamre ka block aap drag, resize aur ऊँचा-नीचा kar sakoge.</p> : null}
      <p className="sh-dim">{map.note}</p>
      {map.zones.length ? (
        <div className="hm-wrap">
          <svg ref={svgRef} className={`hm-svg${edit ? " hm-edit" : ""}`} viewBox={`0 0 ${view.width} ${view.height}`} role="img" aria-label="Map of the house" style={{ maxWidth: view.width, touchAction: edit ? "none" : undefined }} onPointerMove={edit ? pointerMove : undefined} onPointerUp={edit ? pointerUp : undefined} onPointerCancel={edit ? pointerUp : undefined}>
            {view.items.map((it, i) => {
              if (it.type === "plan") return <image key={i} href={it.href} x={it.x} y={it.y} width={it.w} height={it.h} preserveAspectRatio="none" opacity="0.9" />;
              if (it.type === "rect") {
                const name = edit && String(it.id).startsWith("r:") ? String(it.id).slice(2) : "";
                return (
                  <g key={i}>
                    <rect className={`hm-${it.cls}${it.plan ? " hm-over" : ""}${name && name === sel ? " hm-sel" : ""}`} x={it.x} y={it.y} width={it.w} height={it.h} rx="10" onPointerDown={name ? (e) => pointerDown(e, name, "move") : undefined} />
                    {name ? <rect className="hm-handle" x={it.x + it.w - 10} y={it.y + it.h - 10} width="20" height="20" rx="4" onPointerDown={(e) => pointerDown(e, name, "resize")}><title>Khinch ke size badlo</title></rect> : null}
                  </g>
                );
              }
              if (it.type === "poly") return <polygon key={i} className={`hm-${it.cls}`} points={it.points} />;
              if (it.type === "text") return <text key={i} className={`hm-t-${it.cls}`} x={it.x} y={it.y}>{it.text}</text>;
              return <g key={i}><circle className={`hm-dot hm-dot--${it.kind}`} cx={it.x} cy={it.y} r={it.r} /><title>{it.label}</title></g>;
            })}
          </svg>
        </div>
      ) : null}
      {edit ? (
        <div className="sh-editor">
          <b>Layout edit</b>
          <span className="sh-dim">Kamre ko pakad ke khicho; neeche-daayein kone ke chhote chaukor se size badlo. Sab kuch aadhe unit par snap hota hai.</span>
          {picked ? (
            <div className="sh-row" style={{ flexWrap: "wrap" }}>
              <b>{picked.name}</b>
              {["x", "y", "w", "h"].map((k) => (
                <label key={k} className="sh-dim">{k === "w" ? "chaudai" : k === "h" ? "lambai" : k}{" "}
                  <input type="number" step="0.5" value={picked[k]} onChange={(e) => setField(picked.name, { [k]: Number(e.target.value) })} style={{ width: 70 }} aria-label={`${picked.name} ${k}`} /></label>
              ))}
              <label className="sh-dim">ऊँचाई (3D){" "}<input type="range" min="0.3" max="3" step="0.05" value={picked.z} onChange={(e) => setField(picked.name, { z: Number(e.target.value) })} aria-label={`${picked.name} height`} /> {picked.z}</label>
            </div>
          ) : null}
          {stacked.length ? <span className="dev-warn">Ye kamre ek-doosre par chadhe hain: {stacked.join(", ")}</span> : null}
          <div className="sh-row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="rd-btn rd-btn--primary" onClick={saveLayout} disabled={busy}>Save layout</button>
            <button type="button" className="rd-btn" onClick={() => setEdit(false)} disabled={busy}>Cancel</button>
            <button type="button" className="rd-btn" onClick={autoArrange} disabled={busy}>Auto-arrange (reset)</button>
            <button type="button" className="rd-btn" onClick={exportFile}>Export layout (JSON)</button>
            <input ref={layoutFile} type="file" accept="application/json,.json" onChange={importFile} hidden />
            <button type="button" className="rd-btn" onClick={() => layoutFile.current && layoutFile.current.click()}>Import layout (JSON)</button>
          </div>
        </div>
      ) : null}
      <p className="sh-dim">
        <span className="hm-key hm-dot--person" /> person at home · <span className="hm-key hm-dot--hub" /> tablet · <span className="hm-key hm-dot--device-up" /> device on the Wi-Fi · <span className="hm-key hm-dot--device-down" /> device not seen lately
        {awayLine(map) ? ` · ${awayLine(map)}` : ""}
        {map.homeNoZone && map.homeNoZone.length ? ` · Ghar par, zone pata nahi: ${map.homeNoZone.map((p) => p.person).join(", ")}` : ""}
      </p>
      {learned.length ? (
        <ul className="sh-lan">
          {learned.map((z) => (
            <li key={z.id}>
              <div className="sh-lan__main"><b>{z.name}</b><span>{z.auto ? "named by Stashr" : "your name"}{z.hint ? ` · ${z.hint}` : ""} · {z.observations} sightings over {z.days} day{z.days === 1 ? "" : "s"} · {Math.round(z.confidence * 100)}% sure</span></div>
              <input defaultValue={z.auto ? "" : z.name} placeholder="Name it, e.g. Bedroom" maxLength={30} aria-label={`Name for ${z.name}`} disabled={busy}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (z.auto ? "" : z.name)) save({ zoneNames: { [z.id]: v } }, "Name saved."); }} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sh-row">
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} hidden />
        <button type="button" className="rd-btn rd-btn--quiet" disabled={busy} onClick={() => file.current && file.current.click()}>{map.plan ? "Change floor plan picture" : "Add a floor plan picture (from a phone scan app)"}</button>
        {map.plan ? <button type="button" className="rd-btn rd-btn--danger-quiet" disabled={busy} onClick={() => save({ plan: "" }, "Floor plan removed.")}>Remove it</button> : null}
      </div>
    </Section></div>
  );
}
