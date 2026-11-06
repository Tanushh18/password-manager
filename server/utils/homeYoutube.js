/**
 * "Play Arijit songs on the TV": finds the first YouTube video for a search and returns its link, so the TV opens it
 * in its own YouTube app, where your YouTube Premium account is signed in (no ads, background play).
 * With YOUTUBE_API_KEY set this uses the YouTube Data API. Without it, the TV gets the YouTube search page instead.
 */
async function firstVideo(query, { music = false } = {}) {
    const q = String(query || "").trim().slice(0, 120);
    if (!q) return null;
    const key = process.env.YOUTUBE_API_KEY;
    const host = music ? "https://music.youtube.com" : "https://www.youtube.com";
    if (key) {
        try {
            const p = new URLSearchParams({ part: "snippet", type: "video", maxResults: "1", q, key, ...(music ? { videoCategoryId: "10" } : {}) });
            const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`, { signal: AbortSignal.timeout(8000) });
            const j = await r.json().catch(() => ({}));
            const item = (j.items || [])[0];
            if (r.ok && item && item.id && /^[\w-]{11}$/.test(item.id.videoId || "")) {
                return { url: `${host}/watch?v=${item.id.videoId}`, title: String((item.snippet && item.snippet.title) || q).slice(0, 120), exact: true };
            }
        } catch (e) { /* fall back to the search page */ }
    }
    return { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, title: q, exact: false };
}

module.exports = { firstVideo };
