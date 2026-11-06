import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getHomeTrail, getHomeAddress } from "../../api/client";
import { Section } from "../Render/RenderUi";
import "./techie.css";
import { errorMessage } from "../Render/renderUtils";
import { colourFor, pointsSince, itemsSince, coordKey, placeLabel, mapsLink, kmOf } from "../../lib/trailView";

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);
const esc = (s) => String(s).replace(/[<>&"]/g, "");
const badge = (text, colour, pos = "") => L.divIcon({ className: `tm-badge ${pos}`, html: `<span style="background:${colour}">${esc(text)}</span>`, iconSize: [0, 0] });

/**
 * Where everyone went in the last 24 hours, on a map: pick whose phones to show, the hours to show, and see the route (a line through
 * every stored location, in time order), where each person stayed, and the address and exact coordinates of any point (click it).
 * The line is straight between locations: the phones report every 1 to 30 minutes, so the road taken in between is not known.
 */
export function TrailCard() {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);                 // Set of phone ids shown; null = everybody
  const [hours, setHours] = useState(24);
  const [addr, setAddr] = useState({});                 // "lat,lon" -> { name, address, full }
  const box = useRef(null);
  const live = useRef({});
  const cache = useRef(new Map());
  const chain = useRef(Promise.resolve());

  const load = useCallback(async () => { try { setD(await getHomeTrail()); } catch (e) { toast.error(errorMessage(e, "Could not load the last 24 hours.")); } }, []);
  useEffect(() => { load(); }, [load]);

  /** One address, from memory or from the server (one at a time: the free address service allows a request a second). */
  const resolve = useCallback((lat, lon) => {
    const k = coordKey(lat, lon);
    if (cache.current.has(k)) return cache.current.get(k);
    const job = chain.current.then(() => getHomeAddress(lat, lon)).then((r) => { setAddr((a) => ({ ...a, [k]: r })); return r; }).catch(() => null);
    chain.current = job.catch(() => {});
    cache.current.set(k, job);
    return job;
  }, []);

  const people = d ? d.people : [];
  const shown = people.filter((p) => !sel || sel.has(p.phone));
  const now = d ? d.at : Date.now();

  // the map itself
  useEffect(() => {
    if (!d || !box.current) return undefined;
    const map = L.map(box.current, { zoomControl: true }).setView([22.9, 79.6], 5);
    L.tileLayer(TILES, { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
    live.current = { map, layer: L.layerGroup().addTo(map) };
    return () => { map.remove(); live.current = {}; };
  }, [d === null]);   // eslint-disable-line react-hooks/exhaustive-deps

  // what is drawn on it
  useEffect(() => {
    const { map, layer } = live.current;
    if (!map || !d) return;
    layer.clearLayers();
    const bounds = [];
    const popupWith = (marker, lines, lat, lon) => {
      marker.bindPopup(`<div class="tm-pop">${lines}<br><span class="tm-addr">Address dhoondh raha hoon…</span></div>`);
      marker.on("popupopen", async () => {
        const r = await resolve(lat, lon);
        const t = placeLabel(r, lat, lon);
        marker.setPopupContent(`<div class="tm-pop">${lines}<br><b>${esc(t)}</b>${r && r.full ? `<br><small>${esc(r.full)}</small>` : ""}<br><small>${lat}, ${lon}</small><br><a href="${mapsLink(lat, lon)}" target="_blank" rel="noreferrer">open in OpenStreetMap</a></div>`);
      });
    };
    shown.forEach((p) => {
      const colour = colourFor(people.indexOf(p));
      const pts = pointsSince(p.points, hours, now);
      if (!pts.length) return;
      pts.forEach((x) => bounds.push([x.lat, x.lon]));
      if (pts.length > 1) L.polyline(pts.map((x) => [x.lat, x.lon]), { color: colour, weight: 3, opacity: 0.75 }).addTo(layer);
      pts.forEach((x) => {
        const m = L.circleMarker([x.lat, x.lon], { radius: 4, color: colour, weight: 1, fillColor: colour, fillOpacity: 0.9 }).addTo(layer);
        m.bindTooltip(`${esc(p.person)} · ${clock(x.at)} · ±${x.acc} m`);
        popupWith(m, `<b>${esc(p.person)}</b> · ${clock(x.at)}<br>accuracy ±${x.acc} m`, x.lat, x.lon);
      });
      itemsSince(p.timeline, hours, now).filter((e) => e.type === "stay").forEach((e, i) => {
        const m = L.marker([e.lat, e.lon], { icon: badge(String(i + 1), colour), keyboard: false }).addTo(layer);
        popupWith(m, `<b>${esc(p.person)}</b> · stop ${i + 1}<br>${clock(e.from)}–${e.here ? "now" : clock(e.to)} (${dur(e.minutes)})${e.name ? "<br>" + esc(e.name) : ""}`, e.lat, e.lon);
      });
      L.marker([pts[0].lat, pts[0].lon], { icon: badge(`${p.person}: start ${clock(pts[0].at)}`, colour, "tm-up"), keyboard: false }).addTo(layer);
      const last = pts[pts.length - 1];
      L.marker([last.lat, last.lon], { icon: badge(`${p.person}: ${clock(last.at)}`, colour, "tm-down"), keyboard: false, zIndexOffset: 500 }).addTo(layer);
    });
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 17 });
  }, [d, sel, hours, resolve]);   // eslint-disable-line react-hooks/exhaustive-deps

  // street addresses for the stays in the list, one after another
  useEffect(() => {
    if (!d) return;
    shown.forEach((p) => itemsSince(p.timeline, hours, now).filter((e) => e.type === "stay").slice(0, 15).forEach((e) => resolve(e.lat, e.lon)));
  }, [d, sel, hours, resolve]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return null;
  const toggle = (id) => { const next = new Set(sel || people.map((p) => p.phone)); if (next.has(id)) next.delete(id); else next.add(id); setSel(next); };
  const label = (lat, lon, name) => placeLabel({ name, address: (addr[coordKey(lat, lon)] || {}).address }, lat, lon);

  return (
    <div className="dev"><div className="dev-prompt">stashr trail --last 24h</div>
    <Section title="Where everyone went (last 24 hours)" subtitle="Pick whose phones to show. The line goes through every stored location in time order; click any point for its address and exact coordinates. Each point is deleted automatically 24 hours after it is stored. Shown only here and in your own Telegram chat.">
      <div className="sh-row">
        {people.map((p) => (
          <label key={p.phone} className="sh-switch">
            <input type="checkbox" checked={!sel || sel.has(p.phone)} onChange={() => toggle(p.phone)} />
            <span className="tm-swatch" style={{ background: colourFor(people.indexOf(p)) }} />{p.person} <span className="sh-dim">({p.count})</span>
          </label>
        ))}
        <label className="sh-dim">Last <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Hours to show">{[1, 3, 6, 12, 24].map((h) => <option key={h} value={h}>{h} h</option>)}</select></label>
        <button type="button" className="rd-btn rd-btn--quiet" onClick={load}>Refresh</button>
      </div>
      {!people.length ? <p className="sh-dim">No family phone is linked yet.</p> : <div ref={box} className="tm-map" role="region" aria-label="Map of where everyone went" />}
      <p className="sh-dim">The line is straight between locations: phones report every 1–30 minutes, so the road taken in between is not known (it is an estimate of where they went, not the exact road).</p>
      {shown.map((p) => {
        const pts = pointsSince(p.points, hours, now), items = itemsSince(p.timeline, hours, now);
        return (
          <div key={p.phone} className="sh-editor">
            <b><span className="tm-swatch" style={{ background: colourFor(people.indexOf(p)) }} />{p.person}</b>
            <span className="sh-dim">{pts.length ? `${pts.length} locations · ${kmOf(pts)} km${p.last ? ` · last ${clock(p.last.at)}` : ""}` : "No location in this time yet (the phone has to report once)."}</span>
            {items.length ? (
              <ol className="sh-dim" style={{ margin: "4px 0 0 18px" }}>
                {items.map((e, i) => (e.type === "stay"
                  ? <li key={i}>📍 {clock(e.from)}–{e.here ? "now" : clock(e.to)} · <b>{label(e.lat, e.lon, e.name)}</b> · {dur(e.minutes)} · <a href={mapsLink(e.lat, e.lon)} target="_blank" rel="noreferrer">{e.lat}, {e.lon}</a></li>
                  : <li key={i} style={{ listStyle: "none" }}>↪ {dur(e.minutes)} on the way · {e.km} km</li>))}
              </ol>
            ) : null}
            {pts.length ? (
              <details>
                <summary className="sh-dim">All {pts.length} locations with coordinates</summary>
                <table className="sh-table"><thead><tr><th>Time</th><th>Latitude</th><th>Longitude</th><th>Accuracy</th><th>Address</th></tr></thead>
                  <tbody>{[...pts].reverse().map((x) => {
                    const a = addr[coordKey(x.lat, x.lon)];
                    return (<tr key={x.at}><td>{clock(x.at)}</td><td>{x.lat}</td><td>{x.lon}</td><td>±{x.acc} m</td>
                      <td>{a ? placeLabel(a, x.lat, x.lon) : <button type="button" className="rd-btn rd-btn--quiet" onClick={() => resolve(x.lat, x.lon)}>Find</button>}</td></tr>);
                  })}</tbody>
                </table>
              </details>
            ) : null}
          </div>
        );
      })}
    </Section></div>
  );
}
