const HomeEvent = require("../models/homeEvent");
const User = require("../models/schema");
const bot = require("./telegramBot");

/** Writes one line to the Home timeline, and (when asked) sends it to the user's Telegram bot. Never throws. */
async function record({ owner, device, deviceName, kind, text, notify = false }) {
    try {
        await HomeEvent.create({ owner, device, deviceName: deviceName || "", kind, text: String(text).slice(0, 300) });
        if (notify) {
            // Only what the Telegram message needs: not the vault, the photo library or the monitoring histories.
            const skip = Object.fromEntries([...User.HISTORY_FIELDS, ...User.PHOTO_FIELDS, "passwords"].map((f) => [f, 0]));
            const user = await User.findById(owner, skip);
            if (user) await bot.notifyUser(user, `🏠 ${String(text).replace(/[<>&]/g, "")}`);
        }
    } catch (e) {
        console.log("[home] could not record event:", e.message);
    }
}

module.exports = { record };
