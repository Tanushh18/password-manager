const HomeEvent = require("../models/homeEvent");

/**
 * Events that stay on the timeline only, because Telegram would drown in them or already says it another way:
 * a device joining or leaving the Wi-Fi (phones do it all day), the technical "crossed the circle" line (the place message follows),
 * and "came home / left home", which the presence watch announces once, for GPS and Wi-Fi alike.
 */
const TIMELINE_ONLY = new Set(["lan_joined", "lan_left", "home_arrived", "home_left", "place_state"]);

/** Said whatever the "every update" switch is: the person asked for these on a place ("tell me when they leave"). */
const ALWAYS = new Set(["place_left", "place_arrived", "wifi_test"]);

const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One short Telegram line for an event that did not ask for the full report ("every update" is on unless switched off in Smart home). */
async function sendLine(owner, kind, text, at) {
    if (TIMELINE_ONLY.has(kind)) return false;
    const HomeSettings = require("../models/homeSettings");
    const s = await HomeSettings.findOne({ owner }).select("alerts.everything timezone").lean();
    if (s && s.alerts && s.alerts.everything === false && !ALWAYS.has(kind)) return false;
    let clock;
    try { clock = new Date(at || Date.now()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: (s && s.timezone) || "Asia/Kolkata" }); } catch (e) { clock = ""; }
    return require("./homeAutomation").sendTelegram(owner, `🏠 <b>STASHR HOME</b>${clock ? " · " + clock : ""}\n📣 ${esc(text)}`);
}

/** Writes one line to the Home timeline, and sends it to the user's Telegram bot: the full report when asked (notify), else one short line. Never throws. */
async function record({ owner, device, deviceName, kind, text, notify = false, at, person }) {
    try {
        await HomeEvent.create({ owner, device, deviceName: deviceName || "", ...(person ? { person: String(person).slice(0, 60) } : {}), kind, text: String(text).slice(0, 300), ...(at ? { at } : {}) });
        if (notify) await require("./homeReport").sendReport(owner, { headline: String(text) });
        else await sendLine(owner, kind, String(text).slice(0, 300), at);
    } catch (e) {
        console.log("[home] could not record event:", e.message);
    }
}

module.exports = { record, TIMELINE_ONLY };
