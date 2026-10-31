// Project status for the ShineOne Estate website (progress %, stage, ETA). Defaults match what the site had built in.
const STAGES = ["Foundation", "Structure", "Finishing", "Interior Works", "Final Inspection", "Handover"];

const DEFAULTS = [
    { key: "sec 4", name: "Sector 4", status: "Completed", area: "5700 Sq. Feet", progress: 100, stage: "", eta: "" },
    { key: "sec 9", name: "Sector 9", status: "Completed", area: "4200 Sq. Feet", progress: 100, stage: "", eta: "" },
    { key: "sec 46", name: "Sector 46", status: "Completed", area: "4500 Sq. Feet", progress: 100, stage: "", eta: "" },
    { key: "sec 42", name: "Sector 42", status: "Ongoing", area: "3200 Sq. Feet", progress: 78, stage: "", eta: "June 2026" },
    { key: "reliance met city", name: "Reliance MET City", status: "Ongoing", area: "1620 Sq. Feet", progress: 8, stage: "Foundation", eta: "June 2027" }
];

/** Saved values over the defaults; sectors added later (extra) start as ongoing at 0%. */
const merge = (saved, extra = []) =>
{
    const byKey = new Map((saved || []).map((p) => [p.key, p]));
    const known = new Set(DEFAULTS.map((d) => d.key));
    const added = extra.filter((e) => !known.has(e.key)).map((e) => ({ key: e.key, name: e.label, status: "Ongoing", area: "", progress: 0, stage: "", eta: "" }));
    return [...DEFAULTS, ...added].map((d) =>
    {
        const s = byKey.get(d.key) || {};
        const m = {
            ...d,
            name: s.name || d.name,
            status: s.status || d.status,
            area: s.area != null ? s.area : d.area,
            progress: typeof s.progress === "number" ? s.progress : d.progress,
            stage: s.stage != null ? s.stage : d.stage,
            eta: s.eta != null ? s.eta : d.eta
        };
        if (m.status === "Completed") { m.progress = 100; m.stage = ""; }
        return m;
    });
};

/** Validates an update body; returns { value } or { error }. */
const parseUpdate = (body) =>
{
    const b = body || {};
    const out = {};
    for (const k of Object.keys(b)) if (!["status", "area", "progress", "stage", "eta"].includes(k)) return { error: "Unknown field: " + k };
    if (b.status !== undefined) { if (!["Completed", "Ongoing"].includes(b.status)) return { error: "status must be Completed or Ongoing." }; out.status = b.status; }
    if (b.progress !== undefined) { if (!Number.isInteger(b.progress) || b.progress < 0 || b.progress > 100) return { error: "progress must be 0-100." }; out.progress = b.progress; }
    if (b.stage !== undefined) { if (b.stage !== "" && !STAGES.includes(b.stage)) return { error: "Unknown stage." }; out.stage = b.stage; }
    for (const k of ["area", "eta"]) if (b[k] !== undefined) { if (typeof b[k] !== "string" || b[k].length > 60) return { error: k + " is too long." }; out[k] = b[k].trim(); }
    return { value: out };
};

module.exports = { STAGES, DEFAULTS, merge, parseUpdate };
