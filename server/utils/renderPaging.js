/**
 * Follows Render's cursor pagination. Render list endpoints return an array of `{ <kind>, cursor }`;
 * the next page is requested with `cursor=<cursor of the last row>` until a short page comes back.
 *
 * `request` is `(path) => Promise<payload>`. When `maxPages` is exhausted the result is flagged
 * `truncated` so callers can refuse destructive operations instead of acting on partial data.
 */
async function fetchAllPages(request, path, { limit = 100, maxPages = 10 } = {}) {
  const items = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await request(path + separator + "limit=" + limit + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    const rows = Array.isArray(payload) ? payload : [];
    items.push(...rows);
    const next = rows[rows.length - 1]?.cursor;
    if (rows.length < limit || !next || next === cursor) return { items, truncated: false };
    cursor = String(next);
  }
  return { items, truncated: true };
}

module.exports = { fetchAllPages };
