/**
 * Questions about what happened at home, answered from the Home timeline, the last 24 hours of every phone and each person's learned habits.
 * English and Hinglish, no outside service: "Papa kab nikle kal?", "kal raat tablet kab band hua", "is hafte Mukta kitni baar late aayi",
 * "Papa kahan kahan gaya", "Papa ka usual time". `answer` returns the reply text, or null when the sentence is not a question about the
 * past (so commands like "tv band karo" and "kab aayenge" keep going to their own handlers).
 */
const HomeEvent = require("../models/homeEvent");
const HomeDevice = require("../models/homeDevice");
const { TIMELINE_ONLY } = require("./homeEvents");
const habits = require("./homeHabits");
const trail = require("./homeTrail");

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s:.]/gu, " ").replace(/\s+/g, " ").trim();
const has = (text, words) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`).test(text));

const QUESTION = ["kab", "kitni baar", "kitne baar", "kitna baar", "when", "how many", "how often", "kya hua", "what happened", "kahan kahan", "kidhar kidhar", "where did", "where was", "where all", "kitne baje", "what time", "usual", "aam taur", "aadat", "habit", "kahan gaya", "kahan gayi", "kahan gaye", "kahan tha", "kahan thi", "kahan the"];
const FUTURE = ["aayenge", "aayega", "aayegi", "pahunchenge", "pahunchega", "pahunchegi", "will", "jaayenge", "nikalenge", "aaenge"];
const PAST = ["kal", "yesterday", "raat", "night", "hafte", "week", "aaj", "today", "pichle", "last", "hua", "hui", "tha", "thi", "the", "aaye", "aayi", "aaya", "gaye", "gayi", "gaya", "nikle", "nikla", "nikli", "pahunche", "pahuncha", "pahunchi", "left", "came", "reached", "did", "was", "were", "late"];

const LEFT = ["nikle", "nikla", "nikli", "gaye", "gayi", "gaya", "left", "bahar", "nikalte"];
const CAME = ["aaye", "aayi", "aaya", "came", "reached", "pahunche", "pahuncha", "pahunchi", "wapas", "ghar aaye", "aate"];

function isQuestion(text) {
    if (!QUESTION.some((q) => new RegExp(`(^|[^a-z0-9])${q}($|[^a-z0-9])`).test(text))) return false;
    if (has(text, FUTURE) && !has(text, ["kal", "yesterday", "hafte", "week", "pichle", "last", "kitni baar", "kitne baar", "how many"])) return false;
    return has(text, PAST) || has(text, ["usual", "aam taur", "aadat", "habit", "kahan kahan", "kidhar kidhar", "where all"]);
}

/** { from, to, label } in ms for the words in the sentence; the default is the last 24 hours. */
function windowOf(text, now, tz, localParts) {
    const mid = (ms) => { const p = localParts(ms, tz); return ms - p.minutes * 60000; };     // local midnight of that day (approximate across a DST change, which India has none of)
    const today = mid(now), day = 86400000;
    const night = has(text, ["raat", "night"]);
    if (has(text, ["hafte", "week", "7 din", "saat din"])) return { from: now - 7 * day, to: now, label: "pichle 7 din" };
    if (has(text, ["kal", "yesterday"])) return night ? { from: today - day + 20 * 3600000, to: today + 6 * 3600000, label: "kal raat" } : { from: today - day, to: today, label: "kal" };
    if (night) return { from: today - day + 20 * 3600000, to: Math.min(now, today + 6 * 3600000), label: "kal raat" };
    if (has(text, ["aaj", "today"])) return { from: today, to: now, label: "aaj" };
    return { from: now - day, to: now, label: "pichle 24 ghante" };
}

const stamp = (ms, tz, withDay) => new Date(ms).toLocaleString("en-GB", { timeZone: tz, ...(withDay ? { day: "numeric", month: "short" } : {}), hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");

/** "Papa office se nikle ya nahi?", "abhi office mein hain?": asks where somebody is relative to a named place right now. */
const PRESENT = /(ya nahi|ya nhi|or not|\bstill\b|\babhi\b|\bnow\b)/;

async function answer(owner, sentence, now = Date.now()) {
    const text = norm(sentence);
    if (!text) return null;
    const question = isQuestion(text);
    if (!question && !PRESENT.test(text)) return null;
    const automation = require("./homeAutomation");
    const settings = await automation.settingsOf(owner);
    const tz = settings.timezone || "Asia/Kolkata";
    const devices = await HomeDevice.find({ owner }).lean();
    const phones = devices.filter((d) => d.kind === "phone");
    const names = [...new Set(phones.map((p) => p.person || p.name))];
    const who = names.find((n) => has(text, [n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]));
    const win = windowOf(text, now, tz, automation.localParts);

    // 0. is somebody at (or gone from) a named place right now? Uses the phone's latest location; a stale one is said plainly and the phone is asked to report.
    const personOf = (pl) => { const ph = phones.find((x) => String(x._id) === String(pl.phone)); return ph ? (ph.person || ph.name) : ""; };
    const place = (settings.places || []).find((pl) => pl && pl.name && has(text, [norm(pl.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]) && (!who || personOf(pl) === who));
    if (place && PRESENT.test(text)) {
        const ph = phones.find((x) => String(x._id) === String(place.phone));
        const loc = ph && ph.status && ph.status.location;
        const name = personOf(place);
        if (!loc || !Number.isFinite(Number(loc.lat))) return `${name} ka abhi tak koi location nahi aaya, isliye ${place.name} ke baare mein pata nahi.`;
        const m = Math.round(require("./homeInsights").dist({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: place.lat, lon: place.lon }));
        const dist = m >= 1000 ? `${Math.round(m / 100) / 10} km` : `${m} m`;
        const ageMin = Math.max(0, Math.round((now - Number(loc.at)) / 60000));
        const inside = m <= (place.radius || 150);
        const lastLeft = await HomeEvent.findOne({ owner, kind: "place_left", person: name, text: { $regex: place.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }, at: { $gte: new Date(now - 24 * 3600000) } }).sort({ at: -1 }).lean();
        const leftAt = lastLeft && !inside ? ` ${stamp(new Date(lastLeft.at).getTime(), tz)} par nikle the.` : "";
        if (ageMin > 12) {
            void require("./phonePush").nudgeOwner(owner, now).catch(() => {});
            return `${name} ka location ${ageMin} min purana hai (tab ${place.name} ${inside ? "ke andar" : "se bahar, " + dist + " door"} the), isliye pakka nahi bata sakta. Phone ko abhi location bhejne ko bol diya hai, thodi der baad dobara pucho.`;
        }
        return inside ? `✅ ${name} abhi ${place.name} mein hain (${dist} door, location ${ageMin} min pehle).` : `🚶 ${name} ${place.name} se nikal chuke hain: abhi ${dist} door (location ${ageMin} min pehle).${leftAt}`;
    }
    if (!question) return null;

    // 1. usual times
    if (has(text, ["usual", "aam taur", "aadat", "habit", "roz"]) && !has(text, ["kitni baar", "kitne baar"])) {
        const rows = await HomeEvent.find({ owner, kind: { $in: ["presence_away", "presence_home"] }, person: { $ne: "" }, at: { $gte: new Date(now - habits.WINDOW_DAYS * 86400000) } }).select("person kind at").lean();
        const learned = habits.learn(rows.map((r) => ({ person: r.person, kind: r.kind, at: new Date(r.at).getTime() })), (ms) => automation.localParts(ms, tz), now);
        return (who ? [who] : names).map((n) => habits.habitLine(n, learned[n])).join("\n") || "Abhi koi phone linked nahi hai.";
    }

    // 2. where did somebody go (the last 24 hours of their phone)
    if (has(text, ["kahan kahan", "kidhar kidhar", "where all", "where did", "kahan gaya", "kahan gayi", "kahan gaye", "kahan tha", "kahan thi", "kahan the", "where was"])) {
        const ph = who ? phones.filter((p) => (p.person || p.name) === who) : phones;
        if (!ph.length) return "Kis ka phone? Naam bolo, jaise “Papa kahan kahan gaye”.";
        const people = await trail.dayTrail(owner, settings, ph, now);
        const old = win.from < now - 24 * 3600000 - 60000 ? ["(Location ka detail sirf pichle 24 ghante ka rakha jaata hai, isliye wahi dikha raha hoon.)"] : [];
        // Street addresses for the unnamed stays (at most 5, one a second, and never more than 7 seconds of waiting).
        const geocode = require("./geocode"), addresses = {};
        const todo = people.flatMap((t) => t.timeline.filter((e) => e.type === "stay" && !e.name)).slice(0, 5);
        await Promise.race([
            (async () => { for (const e of todo) { const r = await geocode.reverse(e.lat, e.lon); if (r && r.address) addresses[geocode.keyOf(e.lat, e.lon)] = r.address; } })(),
            new Promise((r) => setTimeout(r, 7000))
        ]);
        return [...old, ...people.flatMap((t) => trail.describe(t, tz, addresses))].join("\n");
    }

    // 3. person events: how many times / when
    const left = has(text, LEFT), came = has(text, CAME);
    const personKinds = left && !came ? ["presence_away"] : came && !left ? ["presence_home"] : ["presence_away", "presence_home"];
    const lateQ = has(text, ["late"]);
    if (who || ((left || came) && !has(text, ["tablet", "tv", "camera", "hub"]))) {
        const rows = await HomeEvent.find({ owner, kind: { $in: personKinds }, ...(who ? { person: who } : {}), at: { $gte: new Date(win.from), $lte: new Date(win.to) } }).sort({ at: 1 }).limit(200).lean();
        if (lateQ && who) {
            const old = await HomeEvent.find({ owner, kind: { $in: ["presence_away", "presence_home"] }, person: who, at: { $gte: new Date(now - habits.WINDOW_DAYS * 86400000) } }).select("person kind at").lean();
            const h = habits.learn(old.map((r) => ({ person: r.person, kind: r.kind, at: new Date(r.at).getTime() })), (ms) => automation.localParts(ms, tz), now)[who];
            const arrivals = rows.filter((r) => r.kind === "presence_home");
            const lateDays = arrivals.filter((r) => { const p = automation.localParts(new Date(r.at).getTime(), tz); const k = p.weekday === 0 || p.weekday === 6 ? "weekend" : "weekday"; const u = h && h[k] && h[k].arrive; return u && p.minutes > u.at + 45; });
            if (!h || (!h.weekday.arrive && !h.weekend.arrive)) return `${who} ki pakki aadat abhi nahi bani, isliye “late” ginna mumkin nahi (kam se kam ${habits.MIN_DAYS} din ka data chahiye).`;
            return `${who} ${win.label} mein ${lateDays.length} baar late ghar pahunche${lateDays.length ? ": " + lateDays.map((r) => stamp(new Date(r.at).getTime(), tz, true)).join(", ") : ""} (${arrivals.length} baar ghar aaye).`;
        }
        if (has(text, ["kitni baar", "kitne baar", "kitna baar", "how many", "how often"])) {
            const n = rows.length;
            return `${who || "Family"} ${win.label} mein ${n} baar ${personKinds.length === 1 ? (personKinds[0] === "presence_away" ? "ghar se nikle" : "ghar aaye") : "aaye-gaye"}.`;
        }
        if (!rows.length) return `${win.label} mein ${who || "kisi"} ka ghar aana-jaana record nahi mila.`;
        return rows.slice(-8).map((r) => `${stamp(new Date(r.at).getTime(), tz, win.to - win.from > 36 * 3600000)} · ${r.text.replace(/^[🟢⚪]\s*/u, "")}`).join("\n");
    }

    // 4. a device (tablet, TV, camera…) or anything on the timeline
    const kindWord = has(text, ["tablet", "hub"]) ? "hub" : has(text, ["tv"]) ? "tv" : has(text, ["camera"]) ? "camera" : null;
    const off = has(text, ["band", "off", "offline", "disconnect", "disconnected"]), on = has(text, ["chalu", "on", "online", "connected", "start", "shuru"]);
    const subjects = kindWord === "camera" ? [] : devices.filter((d) => !kindWord || d.kind === kindWord).map((d) => d.name);
    const clauses = [{ at: { $gte: new Date(win.from), $lte: new Date(win.to) } }];
    if (kindWord === "camera") clauses.push({ kind: { $regex: "camera" } });
    else if (kindWord && subjects.length) clauses.push({ $or: subjects.map((n) => ({ text: { $regex: n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })) });
    if (off && !on) clauses.push({ text: { $regex: "switched off|disconnected|offline|is off|left the Wi-Fi", $options: "i" } });
    else if (on && !off) clauses.push({ text: { $regex: "is on|turned on|back online|connected|joined", $options: "i" } });
    const rows = (await HomeEvent.find({ owner, $and: clauses }).sort({ at: -1 }).limit(60).lean()).filter((r) => !TIMELINE_ONLY.has(r.kind) || kindWord).slice(0, 8).reverse();
    if (!rows.length) return `${win.label} mein koi matching record nahi mila. (Events 60 din tak rakhe jaate hain.)`;
    return rows.map((r) => `${stamp(new Date(r.at).getTime(), tz, win.to - win.from > 36 * 3600000)} · ${r.text}`).join("\n");
}

module.exports = { answer, isQuestion, windowOf, norm };
