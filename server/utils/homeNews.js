/*
 * Latest headlines for the TV's morning screen, from Google News RSS (free, no key): India top stories in English,
 * Hindi, or both. Only the titles and source names are kept (about 8 each), cached for 20 minutes. Nothing about you
 * is sent: it is the same public feed anyone can open.
 */
const FEEDS = {
    en: "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
    hi: "https://news.google.com/rss?hl=hi&gl=IN&ceid=IN:hi"
};
const cache = new Map();
let override = null;
const use = (fn) => { override = fn; cache.clear(); };

const decode = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();

/** Titles look like "Headline text - Source name". */
function parse(xml, limit = 8) {
    const out = [];
    for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const block = m[1];
        const raw = decode((/<title>([\s\S]*?)<\/title>/.exec(block) || [])[1]);
        if (!raw) continue;
        const cut = raw.lastIndexOf(" - ");
        const source = decode((/<source[^>]*>([\s\S]*?)<\/source>/.exec(block) || [])[1]) || (cut > 0 ? raw.slice(cut + 3) : "");
        const title = (cut > 0 && raw.slice(cut + 3) === source ? raw.slice(0, cut) : raw).slice(0, 160);
        const at = Date.parse(decode((/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block) || [])[1]));
        out.push({ title, source: source.slice(0, 40), at: Number.isFinite(at) ? at : null });
        if (out.length >= limit) break;
    }
    return out;
}

async function fetchFeed(lang) {
    if (override) return override(lang);
    const hit = cache.get(lang);
    if (hit && Date.now() - hit.at < 20 * 60 * 1000) return hit.items;
    const r = await fetch(FEEDS[lang], { headers: { "User-Agent": "Stashr-Home/1.0", Accept: "application/rss+xml" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`News answered HTTP ${r.status}`);
    const items = parse(await r.text());
    cache.set(lang, { at: Date.now(), items });
    return items;
}

/** lang: "en" | "hi" | "both". Never throws: a failed feed just means no headlines. */
async function headlines(lang = "en", count = 6) {
    const langs = lang === "both" ? ["en", "hi"] : [lang === "hi" ? "hi" : "en"];
    const lists = [];
    for (const l of langs) { try { lists.push(await fetchFeed(l)); } catch (e) { lists.push([]); } }
    const out = [];
    for (let i = 0; out.length < count && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i] && out.length < count) out.push(l[i]);
    return out;
}

module.exports = { headlines, parse, use };
