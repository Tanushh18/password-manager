/**
 * The Stashr Home assistant: turns a short sentence ("tv ki volume badhao", "pause the movie", "open netflix") into
 * a command for one of your devices. Plain rules, no AI service, so it works offline and never guesses wildly:
 * a sentence it does not understand is answered with a question, not an action.
 *
 * Understands English and Hinglish. Returns { reply, commands: [{ kind, type, args }] } or { reply } alone.
 */

const APPS = [
    { names: ["netflix"], package: "com.netflix.ninja", label: "Netflix" },
    { names: ["prime", "amazon", "prime video"], package: "com.amazon.amazonvideo.livingroom", label: "Prime Video" },
    { names: ["hotstar", "jiohotstar", "disney"], package: "in.startv.hotstar", label: "JioHotstar" },
    { names: ["youtube music", "yt music"], package: "com.google.android.youtube.tvmusic", label: "YouTube Music" },
    { names: ["youtube", "yt"], package: "com.google.android.youtube.tv", label: "YouTube" },
    { names: ["mx player", "mx"], package: "com.mxtech.videoplayer.television", label: "MX Player" },
    { names: ["zee5", "zee 5"], package: "com.graymatrix.did", label: "Zee5" },
    { names: ["discovery"], package: "com.discoveryplus.tv.android", label: "Discovery+" },
    { names: ["news18"], package: "com.news18.atv", label: "News18" },
    { names: ["abp"], package: "com.abpnewslive", label: "ABP News" },
    { names: ["ndtv"], package: "com.july.ndtv", label: "NDTV" },
    { names: ["india today"], package: "com.indiatoday.tv", label: "India Today" },
    { names: ["zee news"], package: "com.zeenews.tv", label: "Zee News" },
    { names: ["cnbc"], package: "com.cnbc.client", label: "CNBC" }
];

const has = (text, words) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`).test(text));
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s.%+-]/gu, " ").replace(/\s+/g, " ").trim();

function findApp(text) {
    // Longest name first, so "zee news" is not taken for "zee5" and "prime video" not for "prime".
    const all = APPS.flatMap((a) => a.names.map((n) => ({ n, a }))).sort((x, y) => y.n.length - x.n.length);
    const hit = all.find(({ n }) => has(text, [n.replace(/ /g, " ")]));
    return hit ? hit.a : null;
}

function parse(sentence, devices) {
    const text = norm(sentence);
    if (!text) return { reply: "Say something like “pause the movie” or “tv ki volume badhao”." };
    const tv = (devices || []).find((d) => d.kind === "tv");
    const hub = (devices || []).find((d) => d.kind === "hub");
    const toTv = (type, args = {}, reply) => (tv ? { reply, commands: [{ kind: "tv", type, args }] } : { reply: "No TV is added to Stashr Home yet." });

    // Questions about the house are answered from what the devices last reported.
    if (has(text, ["status", "kya chal raha", "whats on", "what is playing", "kya chal rha"])) return { reply: "status", status: true };

    if (has(text, ["scan", "wifi", "wi-fi", "devices"]) && hub && has(text, ["scan", "refresh", "check", "dekho", "update"])) {
        return { reply: "Scanning the Wi-Fi now.", commands: [{ kind: "hub", type: "scan_now", args: {} }] };
    }

    // A YouTube link: opened in the TV's YouTube app (your Premium account is signed in there).
    const link = /https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i.exec(String(sentence || ""));
    if (link) return toTv("open_url", { url: link[0] }, "Opening that on the TV’s YouTube app.");

    // Volume
    const level = /(?:volume|awaaz|awaz)[^0-9]*([0-9]{1,3})\b|\b([0-9]{1,3}) ?%/.exec(text);
    if (has(text, ["volume", "awaaz", "awaz", "sound", "mute", "unmute", "louder", "quieter"])) {
        if (has(text, ["mute", "unmute", "chup"])) return toTv("volume", { action: "mute" }, "Toggling mute on the TV.");
        if (level && Number(level[1] || level[2]) <= 100) return toTv("volume", { level: Number(level[1] || level[2]) }, `Setting the TV volume to ${level[1] || level[2]}.`);
        if (has(text, ["up", "badhao", "badha", "zyada", "jyada", "increase", "louder", "high", "tez"])) return toTv("volume", { action: "up" }, "Turning the TV volume up.");
        if (has(text, ["down", "kam", "ghatao", "decrease", "lower", "quieter", "low", "dheere", "dhire"])) return toTv("volume", { action: "down" }, "Turning the TV volume down.");
    }

    // Play / pause / next / previous: whatever is playing on the TV
    if (has(text, ["pause", "roko", "rok", "ruko", "stop"])) return toTv("media", { action: "play_pause" }, "Pausing.");
    if (has(text, ["resume", "play", "chalao", "chala", "continue", "shuru"]) && !findApp(text) && !/movie|film/.test(text.replace(/the (movie|film)/, "$1")) ) return toTv("media", { action: "play_pause" }, "Playing.");
    if (has(text, ["next", "agla", "agli", "skip"])) return toTv("media", { action: "next" }, "Next.");
    if (has(text, ["previous", "pichla", "pichli", "back track", "prev"])) return toTv("media", { action: "previous" }, "Previous.");

    // Home / back
    if (has(text, ["home"]) && has(text, ["tv", "jao", "go", "screen", "button"]) || text === "home") return toTv("key", { key: "HOME" }, "Going to the TV home screen.");
    if (text === "back" || has(text, ["peeche", "pichhe"]) && has(text, ["jao", "go"])) return toTv("key", { key: "BACK" }, "Going back.");

    // Open an app
    const app = findApp(text);
    if (app && has(text, ["open", "kholo", "khol", "launch", "start", "chalao", "chala", "lagao", "laga", "play", "dikhao", "on"])) {
        return toTv("launch_app", { package: app.package }, `Opening ${app.label} on the TV.`);
    }

    // Sync movies from the cloud folder
    if (has(text, ["sync"]) || (has(text, ["download", "update"]) && has(text, ["movies", "movie", "film"]))) return toTv("sync_now", {}, "Asking the TV to sync its movies.");

    return { reply: "I did not understand that. Try: “volume up”, “pause”, “open netflix”, “mute the tv”, or “status”." };
}

/** One line about everything, built from the devices' last reports. */
function statusLine(devices) {
    const lines = [];
    for (const d of devices || []) {
        if (d.kind === "tv") {
            if (!d.online) { lines.push(`${d.name} is off or not connected.`); continue; }
            const s = d.status || {};
            if (s.screen === "off") { lines.push(`${d.name} is in standby.`); continue; }
            const m = s.media && s.media.title ? `, ${s.media.state === "paused" ? "paused" : "playing"} “${s.media.title}”` : "";
            lines.push(`${d.name} is on${s.app && s.app.label ? ", showing " + s.app.label : ""}${m}.`);
        } else if (d.kind === "hub") {
            lines.push(d.online ? `${d.name}: ${(d.lan || []).filter((x) => x.up).length} devices on the Wi-Fi.` : `${d.name} is not reporting.`);
        }
    }
    return lines.length ? lines.join(" ") : "No devices added yet.";
}

module.exports = { parse, statusLine, APPS };
