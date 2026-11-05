/**
 * Each person's usual time to leave and to get home, learned from the "left home" / "reached home" events of the last 3 weeks
 * (no extra hardware, no location history needed). Used to say "Papa is late today" when somebody is well past their usual time.
 *
 * Pure functions (no I/O): `learn` turns events into habits, `lateNow` says who is late right now, `habitLine` words one habit.
 * Weekdays and weekends are learned separately. A habit needs at least 5 days that agree, so a person who leaves at random
 * times never gets a "late" message.
 */
const WINDOW_DAYS = 21;
const MIN_DAYS = 5;
const MIN_SHARE = 0.6;          // the person must have left (or arrived) on at least 60% of the days of that kind
const GRACE_LEAVE = 30;         // minutes past the usual time before "has not left yet" is said
const GRACE_ARRIVE = 45;        // minutes past the usual time before "has not reached home yet" is said
const CUT_OFF = 4 * 60;         // after usual + 4 hours it is no longer "late", it is a different day

const isWeekend = (weekday) => weekday === 0 || weekday === 6;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

/**
 * events: [{ person, kind: "presence_away" | "presence_home", at (ms) }], parts: (ms) => { date, minutes, weekday }.
 * Returns { [person]: { weekday: { leave?, arrive? }, weekend: { leave?, arrive? } } } where each is { at: minutes, spread, days }.
 * The first "left" and the LAST "reached" of a day count (a trip to the shop in between is not the day's habit).
 */
function learn(events, parts, now = Date.now()) {
    const since = now - WINDOW_DAYS * 86400000;
    const days = new Map();        // person -> date -> { weekday, away: [min], home: [min] }
    const seenDates = new Map();   // person -> Set of dates with any event (the days we can speak for)
    for (const e of events) {
        if (!e.person || e.at < since || e.at > now) continue;
        if (e.kind !== "presence_away" && e.kind !== "presence_home") continue;
        const p = parts(e.at);
        if (!days.has(e.person)) days.set(e.person, new Map());
        const d = days.get(e.person);
        if (!d.has(p.date)) d.set(p.date, { weekday: p.weekday, away: [], home: [] });
        d.get(p.date)[e.kind === "presence_away" ? "away" : "home"].push(p.minutes);
    }
    // How many days of each kind the person has been watched: from their first event to now.
    const out = {};
    for (const [person, byDate] of days) {
        const first = Math.min(...[...byDate.keys()].map((k) => Date.parse(k + "T00:00:00Z")));
        const observed = { weekday: 0, weekend: 0 };
        for (let t = first; t <= now; t += 86400000) { const w = new Date(t).getUTCDay(); observed[isWeekend(w) ? "weekend" : "weekday"]++; }
        const kinds = { weekday: { leave: [], arrive: [] }, weekend: { leave: [], arrive: [] } };
        for (const v of byDate.values()) {
            const k = isWeekend(v.weekday) ? "weekend" : "weekday";
            if (v.away.length) kinds[k].leave.push(Math.min(...v.away));
            if (v.home.length) kinds[k].arrive.push(Math.max(...v.home));
        }
        out[person] = { weekday: {}, weekend: {} };
        for (const k of ["weekday", "weekend"]) {
            for (const what of ["leave", "arrive"]) {
                const list = kinds[k][what];
                if (list.length < MIN_DAYS || list.length < MIN_SHARE * observed[k]) continue;
                const mid = median(list);
                out[person][k][what] = { at: mid, spread: median(list.map((x) => Math.abs(x - mid))), days: list.length };
            }
        }
    }
    return out;
}

/**
 * Who is late right now. people: [{ person, home }], habits from `learn`, nowParts: { date, minutes, weekday },
 * todays: { [person]: { left: bool, reached: bool } } (what already happened today).
 * Returns [{ person, kind: "leave" | "arrive", usual (minutes), key }]; `key` is unique per person, day and kind (send once).
 */
function lateNow(people, habits, nowParts, todays) {
    const out = [];
    const kind = isWeekend(nowParts.weekday) ? "weekend" : "weekday";
    for (const p of people) {
        const h = habits[p.person] && habits[p.person][kind];
        if (!h) continue;
        const t = (todays && todays[p.person]) || {};
        if (p.home && h.leave && !t.left) {
            const limit = h.leave.at + Math.max(GRACE_LEAVE, Math.round(h.leave.spread * 2));
            if (nowParts.minutes > limit && nowParts.minutes < h.leave.at + CUT_OFF) out.push({ person: p.person, kind: "leave", usual: h.leave.at, key: `${nowParts.date}:${p.person}:leave` });
        } else if (!p.home && h.arrive && t.left && !t.reached) {
            const limit = h.arrive.at + Math.max(GRACE_ARRIVE, Math.round(h.arrive.spread * 2));
            if (nowParts.minutes > limit && nowParts.minutes < h.arrive.at + CUT_OFF) out.push({ person: p.person, kind: "arrive", usual: h.arrive.at, key: `${nowParts.date}:${p.person}:arrive` });
        }
    }
    return out;
}

/** The message (Hinglish, like the rest of the family messages). */
function lateText(l) {
    return l.kind === "leave"
        ? `⏰ ${l.person} aaj late hain: aam taur par ${hhmm(l.usual)} tak ghar se nikal jaate hain, abhi tak ghar par hi hain.`
        : `⏰ ${l.person} abhi tak ghar nahi pahunche: aam taur par ${hhmm(l.usual)} tak aa jaate hain.`;
}

/** One person's habits in words, for "Papa ka usual time?". */
function habitLine(person, h) {
    const parts = [];
    for (const [k, label] of [["weekday", "Mon–Fri"], ["weekend", "Sat–Sun"]]) {
        const x = h && h[k];
        if (!x || (!x.leave && !x.arrive)) continue;
        parts.push(`${label}: ${x.leave ? "nikalte " + hhmm(x.leave.at) : ""}${x.leave && x.arrive ? ", " : ""}${x.arrive ? "wapas " + hhmm(x.arrive.at) : ""}`);
    }
    return parts.length ? `${person} — ${parts.join(" · ")}` : `${person} — abhi koi pakki aadat nahi (kam se kam ${MIN_DAYS} din ka data chahiye)`;
}

module.exports = { learn, lateNow, lateText, habitLine, hhmm, WINDOW_DAYS, MIN_DAYS };
