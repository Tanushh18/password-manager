/* Small rules for the Smart home page, kept apart from React so they can be tested. */

/** "off" (not reporting), "standby" (reporting, screen off), "on", or "idle" for a hub that is reporting. */
export function stateOf(device) {
  if (!device || !device.online) return "off";
  if (device.kind === "tv") return device.status?.screen === "off" ? "standby" : "on";
  return "idle";
}

export const STATE_LABEL = { off: "Off / not connected", standby: "Standby", on: "On", idle: "Online" };

export function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "0 MB";
  return v >= 1e9 ? (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + " GB" : Math.max(1, Math.round(v / 1e6)) + " MB";
}

export function ago(when, now = Date.now()) {
  if (!when) return "never";
  const s = Math.max(0, Math.round((now - new Date(when).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}

/** One line for the TV card: what is on screen, and what is playing. */
export function nowPlaying(status) {
  const s = status || {};
  const m = s.media;
  if (m && m.title) return `${m.state === "paused" ? "Paused" : "Playing"}: ${m.title}${m.artist ? " · " + m.artist : ""}`;
  if (s.app && s.app.label) return s.app.label;
  return "Home screen";
}

/** Signal strength as words. dBm is how Wi-Fi reports it: closer to 0 is stronger. */
export function signalWord(rssi) {
  const v = Number(rssi);
  if (!Number.isFinite(v) || v === 0) return "";
  if (v >= -55) return "Excellent";
  if (v >= -67) return "Good";
  if (v >= -75) return "Fair";
  return "Weak";
}

/** Wi-Fi devices grouped by the room you gave them, rooms in order, "No room" last. */
export function groupByRoom(lan) {
  const rooms = new Map();
  for (const d of lan || []) {
    const room = (d.room || "").trim() || "No room";
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(d);
  }
  return [...rooms.entries()].sort((a, b) => (a[0] === "No room") - (b[0] === "No room") || a[0].localeCompare(b[0]));
}

export function lanName(d) {
  return (d.label || d.name || d.vendor || d.ip || "Unknown device").trim();
}

/** Wi-Fi rows split into the ones worth showing and the old ones (not seen for a day), which fold away. */
export function splitStale(lan) {
  const fresh = [], old = [];
  for (const d of lan || []) (d.stale ? old : fresh).push(d);
  return { fresh, old };
}

export const TAG_LABEL = { mine: "Mine", family: "Family", guest: "Guest", unknown: "Unknown" };

/** Minutes as "1 h 35 min". */
export function fmtMinutes(m) {
  const v = Math.max(0, Math.round(Number(m) || 0));
  return v >= 60 ? `${Math.floor(v / 60)} h${v % 60 ? " " + (v % 60) + " min" : ""}` : `${v} min`;
}

/** A tidy top for a y-axis: 1, 2, 2.5 or 5 times a power of ten, at least the largest value. */
export function niceMax(v) {
  const n = Math.max(1, Number(v) || 0);
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/** Schedule days as words: [] or all seven -> "Every day", [1..5] -> "Weekdays". */
export function daysLabel(days) {
  const d = [...new Set(days || [])].sort();
  if (!d.length || d.length === 7) return "Every day";
  if (d.join() === "1,2,3,4,5") return "Weekdays";
  if (d.join() === "0,6") return "Weekends";
  return d.map((x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x]).join(", ");
}

/** What a scene or schedule step does, in words. */
export function stepLabel(s) {
  const a = s.args || {};
  if (s.type === "volume") return a.level !== undefined ? `Volume ${a.level}` : a.action === "mute" ? "Mute" : `Volume ${a.action}`;
  if (s.type === "media") return { play_pause: "Play / pause", next: "Next", previous: "Previous" }[a.action] || "Media";
  if (s.type === "key") return a.key === "HOME" ? "TV home screen" : "Back";
  if (s.type === "launch_app") return "Open " + (APP_NAMES[a.package] || a.package);
  if (s.type === "open_url") return "Open YouTube link";
  if (s.type === "play_music") return `Play “${a.query}” on the tablet`;
  if (s.type === "camera") return { arm: "Security camera on", disarm: "Security camera off", snapshot: "Camera photo", clip: "Camera clip", live: "Camera live view" }[a.action];
  if (s.type === "slideshow") return a.action === "start" ? "Photo slideshow on the tablet" : "Stop the slideshow";
  if (s.type === "scan_now") return "Scan the Wi-Fi";
  if (s.type === "speed_test") return "Internet speed test";
  return s.type.replace(/_/g, " ");
}

export const APP_NAMES = {
  "com.netflix.ninja": "Netflix", "com.amazon.amazonvideo.livingroom": "Prime Video", "in.startv.hotstar": "JioHotstar",
  "com.google.android.youtube.tv": "YouTube", "com.google.android.youtube.tvmusic": "YouTube Music", "com.mxtech.videoplayer.television": "MX Player",
  "com.graymatrix.did": "Zee5", "com.news18.atv": "News18", "com.abpnewslive": "ABP News", "com.july.ndtv": "NDTV", "com.indiatoday.tv": "India Today", "com.zeenews.tv": "Zee News"
};

/** Steps a person can pick for a scene or a schedule. */
export const STEP_CHOICES = [
  { label: "TV: pause / play", step: { kind: "tv", type: "media", args: { action: "play_pause" } } },
  { label: "TV: home screen", step: { kind: "tv", type: "key", args: { key: "HOME" } } },
  { label: "TV: mute", step: { kind: "tv", type: "volume", args: { action: "mute" } } },
  { label: "TV: volume 10", step: { kind: "tv", type: "volume", args: { level: 10 } } },
  { label: "TV: volume 30", step: { kind: "tv", type: "volume", args: { level: 30 } } },
  ...Object.entries(APP_NAMES).map(([pkg, name]) => ({ label: `TV: open ${name}`, step: { kind: "tv", type: "launch_app", args: { package: pkg } } })),
  { label: "Tablet: security camera on", step: { kind: "hub", type: "camera", args: { action: "arm" } } },
  { label: "Tablet: security camera off", step: { kind: "hub", type: "camera", args: { action: "disarm" } } },
  { label: "Tablet: photo slideshow", step: { kind: "hub", type: "slideshow", args: { action: "start" } } },
  { label: "Tablet: speed test", step: { kind: "hub", type: "speed_test", args: {} } },
  { label: "Tablet: scan the Wi-Fi", step: { kind: "hub", type: "scan_now", args: {} } }
];
