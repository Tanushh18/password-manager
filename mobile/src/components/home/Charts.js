import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, G, Line, Polyline, Rect, Text as SText } from "react-native-svg";
import { useTheme } from "../../lib/theme";
import { fmtMinutes, niceMax } from "../../lib/smartHome";
import { Dim } from "./h";

/* Small charts drawn with react-native-svg: bars, lines, and the family map. Colours come from the theme. */

const H = 170, PAD = { l: 40, r: 40, t: 10, b: 22 };
const dayLabel = (date) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

function useWidth() {
  const [w, setW] = useState(320);
  return [w, { onLayout: (e) => setW(Math.max(200, Math.round(e.nativeEvent.layout.width))) }];
}

function Axis({ w, max, unit }) {
  const { theme } = useTheme();
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  return [0, max / 2, max].map((t) => {
    const y = PAD.t + ih - (t / max) * ih;
    return (
      <G key={t}>
        <Line x1={PAD.l} x2={PAD.l + iw} y1={y} y2={y} stroke={theme.line} strokeWidth={1} />
        <SText x={PAD.l - 5} y={y + 4} fontSize={10} fill={theme.textFaint} textAnchor="end">{Math.round(t)}{unit}</SText>
      </G>
    );
  });
}

/** Bars over days (TV time, the way home). tip(d) gives the line shown under the chart for the touched bar. */
export function Bars({ days, valueKey = "minutes", limit, unit = " min", tip, labelOf = (d) => dayLabel(d.date) }) {
  const { theme } = useTheme();
  const [w, lay] = useWidth();
  const [sel, setSel] = useState(null);
  if (!days.length) return null;
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const max = niceMax(Math.max(limit || 0, ...days.map((d) => d[valueKey])) || 30);
  const slot = iw / days.length, bw = Math.max(5, Math.min(26, slot - 3));
  const y = (m) => PAD.t + ih - (m / max) * ih;
  const every = Math.ceil(days.length / 6);
  return (
    <View {...lay}>
      <Svg width={w} height={H}>
        <Axis w={w} max={max} unit={unit.trim() === "min" ? "m" : ""} />
        {days.map((d, i) => {
          const x = PAD.l + i * slot + (slot - bw) / 2, top = y(d[valueKey]);
          const over = limit && d[valueKey] > limit;
          return (
            <G key={i}>
              {d[valueKey] > 0 ? <Rect x={x} y={top} width={bw} height={Math.max(1, PAD.t + ih - top)} rx={3} fill={over ? theme.accent2 : theme.accent} opacity={sel === null || sel === i ? 1 : 0.5} /> : null}
              {i % every === 0 || i === days.length - 1 ? <SText x={x + bw / 2} y={H - 6} fontSize={9.5} fill={theme.textFaint} textAnchor="middle">{labelOf(d)}</SText> : null}
              <Rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={ih} fill="transparent" onPress={() => setSel(sel === i ? null : i)} />
            </G>
          );
        })}
        {limit ? <Line x1={PAD.l} x2={PAD.l + iw} y1={y(limit)} y2={y(limit)} stroke={theme.accent3} strokeWidth={1.5} strokeDasharray="5 4" /> : null}
      </Svg>
      <Dim>{sel !== null ? tip(days[sel]) : "Tap a bar for the details"}</Dim>
    </View>
  );
}

export const TvTimeChart = ({ days, limit }) => (
  <Bars days={days} limit={limit} tip={(d) => `${dayLabel(d.date)} · ${fmtMinutes(d.minutes)}${Object.keys(d.apps || {}).length ? " · " + Object.entries(d.apps).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, m]) => `${n} ${fmtMinutes(m)}`).join(", ") : ""}`} />
);

export const CommuteChart = ({ series, usual }) => (
  <Bars days={series} limit={usual} tip={(d) => `${dayLabel(d.date)} · ${d.minutes} min`} />
);

/** Download and upload over time. */
export function SpeedChart({ samples }) {
  const { theme } = useTheme();
  const [w, lay] = useWidth();
  const [sel, setSel] = useState(null);
  const pts = useMemo(() => samples.map((s) => ({ ...s, t: new Date(s.at).getTime() })), [samples]);
  if (pts.length < 2) return <Dim>{pts.length ? `Last test: ${pts[0].down} Mbit/s down, ${pts[0].up} up, ${pts[0].ping} ms.` : "No speed tests yet. The tablet runs one every hour."}</Dim>;
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const max = niceMax(Math.max(...pts.map((p) => Math.max(p.down, p.up))));
  const x = (t) => PAD.l + ((t - t0) / Math.max(t1 - t0, 1)) * iw;
  const y = (v) => PAD.t + ih - (v / max) * ih;
  const line = (k) => pts.map((p) => `${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const when = (t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const pick = (px) => { let best = 0; pts.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i; }); setSel(best); };
  const h = sel !== null ? pts[sel] : null;
  return (
    <View {...lay}>
      <View style={{ flexDirection: "row", gap: 14, marginBottom: 2 }}>
        <Text style={{ color: theme.accent, fontSize: 12 }}>● Download</Text>
        <Text style={{ color: theme.accent2, fontSize: 12 }}>● Upload</Text>
      </View>
      <Pressable onPress={(e) => pick(e.nativeEvent.locationX)}>
        <Svg width={w} height={H}>
          <Axis w={w} max={max} unit="" />
          <Polyline points={line("down")} fill="none" stroke={theme.accent} strokeWidth={2} />
          <Polyline points={line("up")} fill="none" stroke={theme.accent2} strokeWidth={2} />
          {h ? <><Line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={PAD.t + ih} stroke={theme.textFaint} strokeWidth={1} /><Circle cx={x(h.t)} cy={y(h.down)} r={4} fill={theme.accent} /><Circle cx={x(h.t)} cy={y(h.up)} r={4} fill={theme.accent2} /></> : null}
        </Svg>
      </Pressable>
      <Dim>{h ? `${when(h.t)} · ${h.down} Mbit/s down · ${h.up} up · ${h.ping} ms` : `Mbit/s · ${when(t0)} to ${when(t1)} · tap the chart for a test`}</Dim>
    </View>
  );
}

/* ───────── maps without tiles ───────── */

const R = 6371000;
const toM = (c, p) => ({ x: (p[1] - c.lon) * (Math.PI / 180) * R * Math.cos((c.lat * Math.PI) / 180), y: (p[0] - c.lat) * (Math.PI / 180) * R });
const PIN = ["#eb6834", "#2a78d6", "#1a8f4d", "#8a4fd6", "#c49000"];

/**
 * Home in the middle (or the centre given), distance rings, every device as a pin with its first name and the road home as a line.
 * devices: [{id,name,lat,lon,acc,state,live,route:[[lat,lon]]}], home: {lat,lon,radius}
 */
export function FamilyMap({ home, devices, height = 300 }) {
  const { theme } = useTheme();
  const [w, lay] = useWidth();
  const centre = home || (devices[0] ? { lat: devices[0].lat, lon: devices[0].lon, radius: 0 } : null);
  if (!centre) return <Dim>Nothing to draw yet.</Dim>;
  const pts = devices.flatMap((d) => [toM(centre, [d.lat, d.lon]), ...(d.route || []).map((p) => toM(centre, p))]);
  const reach = Math.max(300, ...pts.map((p) => Math.hypot(p.x, p.y))) * 1.15;
  const size = Math.min(w, height), s = (size / 2 - 22) / reach;
  const cx = w / 2, cy = height / 2;
  const sx = (m) => cx + m.x * s, sy = (m) => cy - m.y * s;
  const rings = niceMax(reach / 2.2) / (niceMax(reach / 2.2) > reach / 1.2 ? 2 : 1);
  const ringList = [rings, rings * 2].filter((r) => r <= reach * 1.05);
  return (
    <View {...lay}>
      <Svg width={w} height={height}>
        <Rect x={0} y={0} width={w} height={height} rx={12} fill={theme.surfaceRaised} />
        {ringList.map((r) => (
          <G key={r}>
            <Circle cx={cx} cy={cy} r={r * s} stroke={theme.line} strokeWidth={1} strokeDasharray="4 5" fill="none" />
            <SText x={cx + r * s + 3} y={cy - 3} fontSize={9.5} fill={theme.textFaint}>{r >= 1000 ? `${r / 1000} km` : `${r} m`}</SText>
          </G>
        ))}
        {home ? <Circle cx={cx} cy={cy} r={Math.max(6, (home.radius || 200) * s)} fill={theme.ok} opacity={0.18} /> : null}
        {devices.map((d, i) => {
          const c = PIN[i % PIN.length], line = (d.route || []).map((p) => toM(centre, p)).map((m) => `${sx(m).toFixed(1)},${sy(m).toFixed(1)}`).join(" ");
          const m = toM(centre, [d.lat, d.lon]);
          return (
            <G key={d.id || i}>
              {line ? <Polyline points={line} fill="none" stroke={c} strokeWidth={3} opacity={0.8} strokeLinecap="round" /> : null}
              {d.acc ? <Circle cx={sx(m)} cy={sy(m)} r={Math.max(4, d.acc * s)} fill={c} opacity={0.12} /> : null}
              <Circle cx={sx(m)} cy={sy(m)} r={7} fill={d.live === false ? "#7a8699" : c} stroke="#fff" strokeWidth={2} />
              <SText x={sx(m)} y={sy(m) - 12} fontSize={11} fontWeight="bold" fill={theme.heading} textAnchor="middle">{String(d.name).split(" ")[0]}</SText>
            </G>
          );
        })}
        {home ? <><Circle cx={cx} cy={cy} r={8} fill={theme.ok} stroke="#fff" strokeWidth={2} /><SText x={cx} y={cy + 22} fontSize={11} fontWeight="bold" fill={theme.heading} textAnchor="middle">Home</SText></> : null}
      </Svg>
    </View>
  );
}

/** A small preview of the chosen home point and its "at home" circle. */
export function HomePreview({ lat, lon, radius }) {
  const { theme } = useTheme();
  const ok = Number.isFinite(lat) && Number.isFinite(lon);
  return (
    <Svg width={120} height={120}>
      <Rect x={0} y={0} width={120} height={120} rx={12} fill={theme.surfaceRaised} />
      <Circle cx={60} cy={60} r={44} stroke={theme.line} strokeDasharray="4 5" fill="none" />
      <Circle cx={60} cy={60} r={Math.max(8, Math.min(44, (radius || 200) / 20))} fill={ok ? theme.ok : theme.textFaint} opacity={0.25} />
      <Circle cx={60} cy={60} r={6} fill={ok ? theme.ok : theme.textFaint} stroke="#fff" strokeWidth={2} />
      <SText x={60} y={112} fontSize={9.5} fill={theme.textFaint} textAnchor="middle">{ok ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : "not set"}</SText>
    </Svg>
  );
}
