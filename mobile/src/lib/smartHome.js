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

/**
 * Reads a place from what people paste: "28.6139, 77.2090", "28.6139 77.2090", "28.6139N 77.2090E", or a Google Maps / OpenStreetMap
 * link ("…/@28.6139,77.2090,17z", "?q=28.6139,77.2090", "!3d28.6139!4d77.2090", "mlat=…&mlon=…"). Returns { lat, lon } or null.
 */
export function parseCoords(text) {
  const t = decodeURIComponent(String(text || "")).trim();
  if (!t) return null;
  const ok = (la, lo) => (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 } : null);
  let m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t) || /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(t) || /[?&](?:q|ll|query|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/.exec(t);
  if (m) return ok(Number(m[1]), Number(m[2]));
  m = /mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/.exec(t);
  if (m) return ok(Number(m[1]), Number(m[2]));
  m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(t);
  if (m) {
    let la = Number(m[1]), lo = Number(m[3]);
    if (/s/i.test(m[2] || "")) la = -Math.abs(la);
    if (/w/i.test(m[4] || "")) lo = -Math.abs(lo);
    return ok(la, lo);
  }
  return null;
}

/** Battery from either shape a device reports: a number (with `charging` beside it) or { pct, charging }. -> { pct, charging } or null. */
export function batteryOf(status) {
  const b = status && status.battery;
  if (b && typeof b === "object") return Number.isFinite(Number(b.pct)) ? { pct: Math.round(Number(b.pct)), charging: Boolean(b.charging) } : null;
  return b !== null && b !== undefined && b !== "" && Number.isFinite(Number(b)) ? { pct: Math.round(Number(b)), charging: Boolean(status.charging) } : null;
}

/**
 * The health checklist of one device, from what its app reports about itself (status.health).
 * -> [{ id, label, state: "ok" | "bad" | "warn" | "unknown", fix }]. "bad" = something that stops a feature, "warn" = it works but worse.
 * `now` is a parameter so it can be tested.
 */
export function healthItems(device, now = Date.now()) {
  const st = device.status || {}, h = st.health;
  const out = [];
  const add = (id, label, state, fix = "") => out.push({ id, label, state, fix });
  const kind = device.kind;
  const phoneApp = kind === "phone" && st.agent === "stashr-where";
  const online = Boolean(device.online);
  const age = device.lastSeen ? now - new Date(device.lastSeen).getTime() : Infinity;
  if (kind === "phone") add("online", "Reached Stashr recently", age < 3 * 3600 * 1000 ? "ok" : "bad", "The phone has not reported for hours: open Stashr Location once, check it has internet, and turn off battery restrictions for it.");
  else add("online", "Online", online ? "ok" : "bad", kind === "tv" ? "Open Stashr TV (and check the TV is on the Wi-Fi). If it keeps going offline, set Stashr TV to 'unrestricted' battery use." : "Open Stashr Hub on the tablet and check its internet. Keep it on the charger.");
  if (!h) {
    add("health", "Reports its health", "unknown", kind === "tv" ? "Update Stashr TV to 1.3 or later (it updates itself when it is online)." : kind === "hub" ? "Update Stashr Hub to 1.9 or later." : phoneApp ? "Update Stashr Location to 1.5 or later." : "This app does not report its health.");
    return out;
  }
  const flag = (id, label, value, badState, fix) => add(id, label, value === undefined ? "unknown" : value ? "ok" : badState, fix);
  if (kind === "hub") {
    flag("overlay", "Can show messages over other apps", h.overlay, "bad", "Tablet: Settings → Apps → Stashr Hub → Display over other apps → allow. Without it announcements show only as a notification.");
    flag("notifications", "Notifications allowed", h.notifications, "warn", "Tablet: Settings → Apps → Stashr Hub → Notifications → allow.");
    flag("camera", "Camera allowed", h.camera, "bad", "Tablet: Settings → Apps → Stashr Hub → Permissions → Camera → allow.");
    flag("microphone", "Microphone allowed", h.microphone, "warn", "Tablet: Settings → Apps → Stashr Hub → Permissions → Microphone → allow (for Hey Stashr).");
    flag("batteryUnrestricted", "Runs without battery limits", h.batteryUnrestricted, "warn", "Tablet: Settings → Apps → Stashr Hub → Battery → Unrestricted. Keep the tablet charging.");
    flag("accessibility", "WhatsApp helper (Accessibility) on", h.accessibility, "warn", "Only for WhatsApp messages: Tablet: Settings → Accessibility → Stashr Hub → on (Android 13+: App info → ⋮ → Allow restricted settings first).");
  } else if (kind === "tv") {
    flag("overlay", "Can show messages over a playing video", h.overlay, "bad", "TV: Stashr TV → Settings → Display over other apps → allow (or Settings → Apps → Stashr TV → Display over other apps).");
    flag("accessibility", "'Stashr TV remote' (Accessibility) on", h.accessibility, "bad", "TV: Stashr TV → Settings → Accessibility → Stashr TV remote → on. Home/Back commands and 'which app is playing' need it.");
    flag("usbStorage", "USB drive for movies found", h.usbStorage, "warn", "TV: plug in the USB drive for movies (only needed for movie sync).");
    flag("batteryUnrestricted", "Runs without battery limits", h.batteryUnrestricted, "warn", "TV: Settings → Apps → Stashr TV → Battery → Unrestricted.");
  } else if (phoneApp) {
    add("location", "Location: 'Allow all the time'", h.location === "always" ? "ok" : h.location === undefined ? "unknown" : "bad", "Phone: Settings → Apps → Stashr Location → Permissions → Location → Allow all the time (and Precise).");
    flag("gpsEnabled", "Location services on", h.gpsEnabled, "bad", "Phone: turn on Location in the quick settings.");
    flag("notifications", "Notifications allowed", h.notifications, "warn", "Phone: Settings → Apps → Stashr Location → Notifications → allow (to get 'X is arriving').");
    flag("batteryUnrestricted", "Not stopped by battery saver", h.batteryUnrestricted, "warn", "Phone: Settings → Apps → Stashr Location → Battery → Unrestricted (Xiaomi/Oppo/Vivo: also allow autostart).");
  }
  if (h.lastError && now - h.lastError.at < 7 * 24 * 3600 * 1000) {
    add("lastError", `Last error (${h.lastError.where || "app"}, ${new Date(h.lastError.at).toLocaleString()})`, "warn", h.lastError.text);
  }
  return out;
}

/** One text block with every problem found, to paste into a chat instead of copying logs. */
export function healthReport(devices, now = Date.now()) {
  const lines = [`Stashr health report · ${new Date(now).toLocaleString()}`];
  for (const d of devices) {
    const st = d.status || {}, h = st.health || {};
    const items = healthItems(d, now);
    lines.push("", `${d.name} (${d.kind}${st.agent ? ", " + st.agent : ""}) · app ${h.appVersion || "?"}${h.sdk ? ` · Android API ${h.sdk}` : ""}${h.model ? ` · ${h.model}` : ""} · ${d.online ? "online" : "offline"}`);
    for (const i of items) lines.push(`  [${i.state.toUpperCase()}] ${i.label}${i.state === "ok" ? "" : " — " + i.fix}`);
  }
  return lines.join("\n");
}
