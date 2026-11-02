import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getHomeLive, searchPlace } from "../../api/client";
import { Section } from "../Render/RenderUi";
import { usePolling } from "../Render/renderHooks";
import { errorMessage } from "../Render/renderUtils";
import { parseCoords } from "../../lib/smartHome";

/*
 * Maps for the Smart home page, drawn with Leaflet on OpenStreetMap tiles (light personal use; the tiles are fetched by this
 * browser from tile.openstreetmap.org). Markers are plain HTML (no image files), so they work with the bundler and in dark mode.
 */

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = "© OpenStreetMap contributors";

function makeMap(el, center, zoom) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return map;
}

const pin = (label, cls) => L.divIcon({ className: "hm-pin " + cls, html: `<span>${label.replace(/[<>&"]/g, "")}</span>`, iconSize: [0, 0] });

/** Click the map (or search / paste) to set a place. */
export function MapPicker({ lat, lon, radius, onPick }) {
  const box = useRef(null);
  const state = useRef({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const has = Number.isFinite(lat) && Number.isFinite(lon);
    const map = makeMap(box.current, has ? [lat, lon] : [22.9, 79.6], has ? 16 : 5);
    state.current = { map };
    map.on("click", (e) => onPick({ lat: Math.round(e.latlng.lat * 1e6) / 1e6, lon: Math.round(e.latlng.lng * 1e6) / 1e6 }));
    return () => { map.remove(); state.current = {}; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { map } = state.current;
    if (!map) return;
    const s = state.current;
    if (s.marker) { s.marker.remove(); s.circle?.remove(); s.marker = null; }
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      s.marker = L.marker([lat, lon], { icon: pin("Home", "hm-home"), keyboard: false }).addTo(map);
      s.circle = L.circle([lat, lon], { radius: radius || 200, color: "#2a78d6", weight: 1, fillOpacity: 0.12 }).addTo(map);
      map.setView([lat, lon], Math.max(map.getZoom(), 16));
    }
  }, [lat, lon, radius]);

  const search = async (e) => {
    e.preventDefault();
    const pasted = parseCoords(query);
    if (pasted) { onPick(pasted); setFound([]); return; }
    setBusy(true);
    try { setFound((await searchPlace(query)).results); }
    catch (err) { toast.error(errorMessage(err, "Could not search.")); }
    finally { setBusy(false); }
  };

  return (
    <div className="hm">
      <form className="sh-row" onSubmit={search}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search an address, or paste coordinates or a Google Maps link" aria-label="Search a place" />
        <button className="rd-btn rd-btn--quiet" type="submit" disabled={busy || query.trim().length < 3}>{busy ? "Searching…" : "Find"}</button>
      </form>
      {found.length ? (
        <ul className="sh-lan">{found.map((r) => (
          <li key={`${r.lat},${r.lon}`}>
            <div className="sh-lan__main"><b>{r.name}</b><span>{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</span></div>
            <button className="rd-btn rd-btn--quiet" onClick={() => { onPick({ lat: r.lat, lon: r.lon }); setFound([]); }}>Use this</button>
          </li>
        ))}</ul>
      ) : null}
      <div ref={box} className="hm__map" role="application" aria-label="Map: click to set the place" />
      <p className="sh-dim">Click the map to move the pin. The circle is the “at home” area.</p>
    </div>
  );
}

const when = (s) => (s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`);

/** The family on a map: who is out, the road home, and how long. Only runs while it is switched on, so phones are not asked to hurry for nothing. */
export function LiveMapCard() {
  const [on, setOn] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const box = useRef(null);
  const st = useRef({ layers: [], fitted: "" });

  useEffect(() => {
    if (!on) return undefined;
    const map = makeMap(box.current, [22.9, 79.6], 5);
    st.current = { map, layers: [], fitted: "" };
    return () => { map.remove(); st.current = { layers: [], fitted: "" }; };
  }, [on]);

  const load = useCallback(async () => {
    try { setData(await getHomeLive()); setErr(""); } catch (e) { setErr(errorMessage(e, "Could not load.")); }
  }, []);
  useEffect(() => { if (on) load(); }, [on, load]);
  usePolling(load, 5000, on);

  useEffect(() => {
    const s = st.current;
    if (!on || !s.map || !data || !data.ok) return;
    s.layers.forEach((l) => l.remove());
    s.layers = [];
    const pts = [];
    if (data.home) {
      s.layers.push(L.marker([data.home.lat, data.home.lon], { icon: pin("Home", "hm-home"), keyboard: false }).addTo(s.map));
      s.layers.push(L.circle([data.home.lat, data.home.lon], { radius: data.home.radius, color: "#2a78d6", weight: 1, fillOpacity: 0.12 }).addTo(s.map));
      pts.push([data.home.lat, data.home.lon]);
    }
    data.devices.forEach((d, i) => {
      const color = ["#eb6834", "#2a78d6", "#1a8f4d", "#8a4fd6", "#c49000"][i % 5];
      if (d.route && d.route.length > 1) s.layers.push(L.polyline(d.route, { color, weight: 4, opacity: 0.8 }).addTo(s.map));
      if (d.acc) s.layers.push(L.circle([d.lat, d.lon], { radius: d.acc, color, weight: 1, fillOpacity: 0.1 }).addTo(s.map));
      s.layers.push(L.marker([d.lat, d.lon], { icon: pin(d.name.split(" ")[0], d.live ? "hm-live" : "hm-old"), keyboard: false }).addTo(s.map));
      pts.push([d.lat, d.lon]);
    });
    const sig = data.devices.map((d) => d.id).join(",") + (data.home ? "h" : "");
    if (pts.length && s.fitted !== sig) { s.fitted = sig; s.map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 }); }
  }, [data, on]);

  return (
    <Section title="Live map" subtitle="Where everyone is right now and the road home. While this is open, phones that are out send their location every few seconds (it takes a minute or two to start).">
      <div className="sh-row">
        <button className={"rd-btn " + (on ? "rd-btn--quiet" : "rd-btn--primary")} onClick={() => { setOn(!on); setData(null); }}>{on ? "Stop live view" : "Start live view"}</button>
        {on && data?.devices?.length ? <button className="rd-btn rd-btn--quiet" onClick={() => { st.current.fitted = ""; setData({ ...data }); }}>Fit everyone</button> : null}
      </div>
      {err ? <p className="sh-bad" role="alert">{err}</p> : null}
      {on && data && !data.ok ? <p className="sh-bad">{data.error}</p> : null}
      {on && data?.ok && !data.home ? <p className="sh-bad">Set the home location first (Automations → Places → Home location).</p> : null}
      {on ? <div ref={box} className="hm__map hm__map--big" role="application" aria-label="Live map of the family" /> : <p className="sh-dim">Not running, so phones keep their battery-saving pace.</p>}
      {on && data?.ok ? (
        data.devices.length ? (
          <ul className="sh-lan">{data.devices.map((d) => (
            <li key={d.id}>
              <div className="sh-lan__main">
                <b>{d.state === "coming" ? "🚗" : d.state === "away" ? "📍" : "🏠"} {d.name}</b>
                <span>
                  {d.state === "coming" || d.state === "away" ? `${d.etaMinutes ? `About ${d.etaMinutes} min` : "—"} to home · ${d.km ?? "?"} km${d.traffic ? " · live traffic" : ""}` : "At home"}
                  {d.speedKmh != null ? ` · ${d.speedKmh} km/h` : ""} · {d.live ? "live" : "waiting for live updates"} · updated {when(d.ageSec)} · accuracy ±{d.acc} m
                </span>
              </div>
            </li>
          ))}</ul>
        ) : <p className="sh-dim">No linked phone has sent a location yet.</p>
      ) : null}
    </Section>
  );
}
