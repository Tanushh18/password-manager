import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { Section } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { getHomeMap, saveHomeMap } from "../../api/client";
import { shapes, awayLine } from "../../lib/homeMap";

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
  const file = useRef(null);
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
  const view = shapes(map, mode);
  const learned = map.zones.filter((z) => !z.labelOnly);
  return (
    <Section title="Ghar ka map" subtitle="Stashr learns the zones of the house by itself from the Wi-Fi access point each phone and the tablet connects to, and keeps improving it as more data comes in. It is a diagram, not a measured floor plan.">
      <div className="sh-row">
        <div role="group" aria-label="View">
          <button type="button" className={`rd-btn ${mode === "2d" ? "rd-btn--primary" : "rd-btn--quiet"}`} onClick={() => setMode("2d")} aria-pressed={mode === "2d"}>2D</button>{" "}
          <button type="button" className={`rd-btn ${mode === "3d" ? "rd-btn--primary" : "rd-btn--quiet"}`} onClick={() => setMode("3d")} aria-pressed={mode === "3d"}>3D</button>
        </div>
        <button type="button" className="rd-btn rd-btn--quiet" onClick={load}>Refresh</button>
      </div>
      <p className="sh-dim">{map.note}</p>
      {map.zones.length ? (
        <div className="hm-wrap">
          <svg className="hm-svg" viewBox={`0 0 ${view.width} ${view.height}`} role="img" aria-label="Map of the house" style={{ maxWidth: view.width }}>
            {view.items.map((it, i) => {
              if (it.type === "plan") return <image key={i} href={it.href} x={it.x} y={it.y} width={it.w} height={it.h} preserveAspectRatio="none" opacity="0.9" />;
              if (it.type === "rect") return <rect key={i} className={`hm-${it.cls}${it.plan ? " hm-over" : ""}`} x={it.x} y={it.y} width={it.w} height={it.h} rx="10" />;
              if (it.type === "poly") return <polygon key={i} className={`hm-${it.cls}`} points={it.points} />;
              if (it.type === "text") return <text key={i} className={`hm-t-${it.cls}`} x={it.x} y={it.y}>{it.text}</text>;
              return <g key={i}><circle className={`hm-dot hm-dot--${it.kind}`} cx={it.x} cy={it.y} r={it.r} /><title>{it.label}</title></g>;
            })}
          </svg>
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
    </Section>
  );
}
