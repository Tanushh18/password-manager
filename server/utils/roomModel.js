/**
 * The room model: "which room is this phone in?" from what the phone can hear (Wi-Fi networks and Bluetooth devices with their signal
 * strength). Pure code, no database, so every rule below is tested.
 *
 * HOW IT WORKS, in five steps:
 *  1. A SCAN is a list of "what I hear and how loud": { "w:ab12cd": -48 dBm, "w:99ee01": -71, "b:77aa10": -80 ... }.
 *     A network that is not heard counts as -100 dBm ("too quiet to hear"). Wi-Fi names are never kept: ids are hashed.
 *  2. TRAINING = you stand in a room and tap "main yahan hoon": the scan(s) are saved with the room's name. These are the SAMPLES.
 *  3. To find the room of a NEW scan, it is compared with EVERY sample: the DISTANCE is how different the two lists are (the root of the
 *     average squared difference in dBm). A sample that is close counts a lot, a far one almost nothing:  weight = exp(-(distance/width)^2).
 *     Nothing is thrown away: all samples take part (not just the nearest few). Samples also fade with age (half after 30 days),
 *     so a moved router or furniture slowly stops mattering.
 *  4. Each room's SCORE is the average weight of its samples (an average, so a room with many samples does not win just for having many).
 *     The scores add up to 1: that is the CONFIDENCE for each room. Below 50%, or when nothing is close at all, the answer is "not sure".
 *  5. SMOOTHING: one scan never changes the room. The new room must win twice in a row, so a single noisy scan cannot make a person
 *     "teleport" and come back.
 * HOW GOOD IS IT: `crossValidate` hides each sample (and every sample of the same tap) and asks the model to guess it from the rest.
 * The share it gets right, and which rooms it mixes up, is the honest accuracy, shown before anyone trusts it.
 */
const crypto = require("crypto");

const FLOOR = -100;                    // "not heard"
const WEIGHT = { w: 1, b: 0.6 };       // Wi-Fi counts fully, Bluetooth less (phones and earbuds change their address)
const MIN_WIDTH = 5;                   // dBm: how quickly a sample stops counting as it gets different
const FAR = 30;                        // dBm: if even the closest sample is this different, nothing here looks familiar
const HALF_LIFE_DAYS = 30;
const SURE = 0.5;

/** A stable but unreadable id for a Wi-Fi network or Bluetooth device, different for every household. */
const hashId = (owner, raw) => crypto.createHash("sha256").update(String(owner) + ":" + String(raw).toLowerCase()).digest("hex").slice(0, 12);

/** A scan from the phone -> { key: dBm }. kind "w" = Wi-Fi, "b" = Bluetooth; the strongest reading wins when an id repeats. */
function vectorOf(scan) {
    const v = {};
    for (const [kind, list] of [["w", scan && scan.wifi], ["b", scan && scan.ble]]) {
        for (const x of Array.isArray(list) ? list : []) {
            const r = Number(x && x.r);
            if (!x || !x.b || !(r <= -1 && r >= -127)) continue;
            const k = kind + ":" + x.b;
            if (v[k] === undefined || r > v[k]) v[k] = r;
        }
    }
    return v;
}

/** How different two scans are, in dBm (0 = the same). Ids heard in only one count as "-100 in the other". */
function distance(a, b) {
    let sum = 0, wsum = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const w = WEIGHT[k[0]] || 1;
        const d = (a[k] === undefined ? FLOOR : a[k]) - (b[k] === undefined ? FLOOR : b[k]);
        sum += w * d * d; wsum += w;
    }
    return wsum ? Math.sqrt(sum / wsum) : FAR * 2;
}

const ageFactor = (at, now) => Math.pow(0.5, Math.max(0, now - at) / (HALF_LIFE_DAYS * 86400000));

/**
 * samples: [{ room, vec, at (ms), session? }]. Returns { room, confidence, ranking: [{ room, p }], nearest }.
 * `room` is null when the model is not sure (fewer than two rooms trained, nothing familiar, or under 50%).
 */
function classify(samples, vec, now = Date.now()) {
    const rooms = [...new Set(samples.map((s) => s.room))];
    if (rooms.length < 2) return { room: null, confidence: 0, ranking: rooms.map((r) => ({ room: r, p: 1 })), nearest: null, why: "train at least two rooms" };
    const ds = samples.map((s) => distance(vec, s.vec));
    const nearest = Math.min(...ds);
    const width = Math.max(MIN_WIDTH, nearest * 1.5);                 // wider when nothing matches well, so every sample still has a say
    const sums = {}, counts = {};
    samples.forEach((s, i) => {
        const w = Math.exp(-((ds[i] / width) ** 2)) * ageFactor(s.at, now);
        sums[s.room] = (sums[s.room] || 0) + w; counts[s.room] = (counts[s.room] || 0) + 1;
    });
    const score = rooms.map((r) => ({ room: r, s: sums[r] / counts[r] + 1e-9 }));
    const total = score.reduce((t, x) => t + x.s, 0);
    const ranking = score.map((x) => ({ room: x.room, p: Math.round((x.s / total) * 1000) / 1000 })).sort((a, b) => b.p - a.p);
    const top = ranking[0];
    const sure = top.p >= SURE && nearest <= FAR;
    return { room: sure ? top.room : null, confidence: top.p, ranking, nearest: Math.round(nearest * 10) / 10, why: sure ? "" : nearest > FAR ? "nothing here looks familiar" : "two rooms look alike" };
}

/**
 * The honest accuracy. Each sample is hidden together with the other samples of its tap (same session) and guessed from the rest.
 * -> { accuracy, unsure, tested, perRoom: { room: { n, right, accuracy } }, confusion: { actual: { guessed: count } }, thin: [rooms with < 5 samples] }
 */
function crossValidate(samples, now = Date.now()) {
    const perRoom = {}, confusion = {};
    let right = 0, unsure = 0, tested = 0;
    const counts = {};
    for (const s of samples) counts[s.room] = (counts[s.room] || 0) + 1;
    samples.forEach((s) => {
        const rest = samples.filter((o) => o !== s && !(s.session && o.session === s.session));
        if (new Set(rest.map((o) => o.room)).size < 2) return;
        const g = classify(rest, s.vec, now);
        tested++;
        const pr = perRoom[s.room] || (perRoom[s.room] = { n: 0, right: 0, accuracy: 0 });
        pr.n++;
        const guessed = g.room || "(not sure)";
        confusion[s.room] = confusion[s.room] || {};
        confusion[s.room][guessed] = (confusion[s.room][guessed] || 0) + 1;
        if (!g.room) unsure++;
        if (g.room === s.room) { right++; pr.right++; }
    });
    for (const r of Object.values(perRoom)) r.accuracy = r.n ? Math.round((100 * r.right) / r.n) : 0;
    return { accuracy: tested ? Math.round((100 * right) / tested) : 0, unsure: tested ? Math.round((100 * unsure) / tested) : 0, tested, perRoom, confusion, thin: Object.keys(counts).filter((r) => counts[r] < 5) };
}

/**
 * Smoothing: the room only changes after the same new room wins twice in a row. state: { room, pending, count } -> next state + whether the room changed.
 * "Not sure" (null) keeps the old room but does not count towards a change.
 */
function smooth(state, guess) {
    const s = state || { room: null, pending: null, count: 0 };
    if (!guess) return { state: { ...s, pending: null, count: 0 }, changed: false };
    if (!s.room) return { state: { room: guess, pending: null, count: 0 }, changed: true };      // the very first answer is taken at once
    if (guess === s.room) return { state: { room: s.room, pending: null, count: 0 }, changed: false };
    const count = s.pending === guess ? s.count + 1 : 1;
    if (count >= 2) return { state: { room: guess, pending: null, count: 0 }, changed: true };
    return { state: { room: s.room, pending: guess, count }, changed: false };
}

module.exports = { hashId, vectorOf, distance, classify, crossValidate, smooth, FLOOR, FAR, SURE };
