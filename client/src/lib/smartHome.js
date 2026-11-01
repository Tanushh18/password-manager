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
