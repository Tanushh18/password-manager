const HomeEvent = require("../models/homeEvent");

/** Writes one line to the Home timeline, and (when asked) sends it to the user's Telegram bot. Never throws. */
async function record({ owner, device, deviceName, kind, text, notify = false, at }) {
    try {
        await HomeEvent.create({ owner, device, deviceName: deviceName || "", kind, text: String(text).slice(0, 300), ...(at ? { at } : {}) });
        if (notify) await require("./homeReport").sendReport(owner, { headline: String(text) });
    } catch (e) {
        console.log("[home] could not record event:", e.message);
    }
}

module.exports = { record };
