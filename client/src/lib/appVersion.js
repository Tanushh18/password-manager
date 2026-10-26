import pkg from "../../package.json";

/** Stashr release shown in the navbar. Bump package.json (client and server) together. */
export const APP_VERSION = pkg.version;
export const APP_MAJOR_MINOR = APP_VERSION.split(".").slice(0, 2).join(".");

export const WHATS_NEW = [
  ["Robots, planes and explosions", "Robots fly across the screen, a plane lands when you save, and things blow up when you delete for good or a server goes down. The new Floor view in the Control Center shows every server as a robot running between its jobs and its rack, with live CPU and memory. Switch the effects off in Settings."],
  ["Live sync between devices", "Changes made on your phone, another browser or the extension appear here within seconds, and only what changed is downloaded."],
  ["Trash and password history", "Deleted items wait 30 days in Trash. Each login keeps its last five passwords so you can copy or restore an old one."],
  ["Select several at once", "Select mode on Passwords and Photos: favourite, move, share or trash many items in one go. Folders can be renamed or merged."],
  ["Cards, notes and identities", "Store more than logins: payment cards, secure notes and ID details, in the same vault, on the web and in the app."],
  ["Ctrl+K and the Control Center", "Jump anywhere with Ctrl+K. Servers, usage, map and cron now sit together in the Control Center, with one combined status report of what is up and what failed."],
  ["Devices and activity", "See where you are signed in, sign out any device, and read your recent security activity in Settings."]
];
