/** Small pure helpers for the "App updates" page. */

/** One line that says what will happen with the newest release of an app. */
export function summary(app) {
  if (!app.latest) return app.error || "No release found yet.";
  const total = app.devices.length, offered = app.devices.filter((d) => d.offered).length;
  const v = app.latest.version;
  if (app.rule.mode === "hold") return `${v}: kisi ko offer nahi ho raha (hold).`;
  if (app.rule.mode === "all") return app.selectable ? `${v}: sab ko offer ho raha hai (${total} device${total === 1 ? "" : "s"}).` : `${v}: sab ko offer ho raha hai.`;
  return `${v}: sirf ${offered} device${offered === 1 ? "" : "s"} ko offer ho raha hai${total ? ` (${total} mein se)` : ""}.`;
}

/** The ticked devices that would NOT really be offered the update: their app is too old to say who it is. */
export function cannotBePicked(app, ticked) {
  const set = new Set(ticked);
  return app.devices.filter((d) => set.has(d.id) && d.canIdentify === false);
}

/** What to send to the server for "Save": the mode, the devices only for "selected", and the default for later releases. */
export function payload(mode, ticked, waitForMe) {
  return { mode, ...(mode === "selected" ? { devices: [...ticked] } : {}), defaultMode: waitForMe ? "hold" : "all" };
}
