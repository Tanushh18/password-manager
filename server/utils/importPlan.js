/* Pure helpers for the Google Photos import pipeline. */
const CHUNK = 8 * 1024 * 1024; // Drive wants multiples of 256 KiB; 8 MiB keeps memory low and retries cheap
const MAX_ATTEMPTS = 5;

/** Delay before retrying an item: 30 s, 1 min, 2 min ... capped at 30 min, with jitter. */
const backoffMs = (attempts, random = Math.random) => Math.min(30 * 60000, 30000 * 2 ** Math.max(0, attempts - 1)) * (0.75 + random() * 0.5);

/**
 * Splits a byte stream reader into pieces of `size` bytes. The last piece is flagged, so the uploader knows the
 * total only when the stream really ends (a transcoded video has no Content-Length).
 */
async function* chunker(reader, size = CHUNK) {
  let parts = [], len = 0, done = false;
  for (;;) {
    while (len < size && !done) {
      const r = await reader.read();
      if (r.done) { done = true; break; }
      parts.push(Buffer.from(r.value)); len += r.value.length;
    }
    let buf = Buffer.concat(parts);
    parts = []; len = 0;
    if (buf.length > size) { parts = [buf.subarray(size)]; len = parts[0].length; buf = buf.subarray(0, size); }
    const last = done && len === 0;
    yield { buf, last };
    if (last) return;
  }
}

/** Content-Range for one piece. The total is "*" until the final piece. */
function contentRange(offset, length, total) {
  if (length === 0) return `bytes */${total}`;
  return `bytes ${offset}-${offset + length - 1}/${total == null ? "*" : total}`;
}

/** Bytes Drive has stored, from the Range header of a 308 answer ("bytes=0-1234"); 0 when nothing yet. */
function committedFrom(rangeHeader) {
  const m = /bytes=0-(\d+)/.exec(rangeHeader || "");
  return m ? Number(m[1]) + 1 : 0;
}

/**
 * Speed and time left from items finished recently. `done` rows: { bytes, finishedAt, startedAt }.
 * Uses the last `windowMs` so it reflects the current speed, not the whole run.
 */
function estimate(done, remaining, now = Date.now(), windowMs = 10 * 60000) {
  const recent = done.filter((d) => d.finishedAt && now - new Date(d.finishedAt).getTime() <= windowMs);
  if (!recent.length) return { bytesPerSec: 0, itemsPerMin: 0, etaSeconds: null };
  const first = Math.min(...recent.map((d) => new Date(d.startedAt || d.finishedAt).getTime()));
  const span = Math.max(1, (now - first) / 1000);
  const bytes = recent.reduce((n, d) => n + (d.bytes || 0), 0);
  const itemsPerSec = recent.length / span;
  return { bytesPerSec: Math.round(bytes / span), itemsPerMin: Math.round(itemsPerSec * 600) / 10, etaSeconds: remaining.items > 0 && itemsPerSec > 0 ? Math.round(remaining.items / itemsPerSec) : remaining.items === 0 ? 0 : null };
}

const FINAL = new Set(["done", "failed", "skipped"]);

module.exports = { CHUNK, MAX_ATTEMPTS, backoffMs, chunker, contentRange, committedFrom, estimate, FINAL };
