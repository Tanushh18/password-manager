const { describe, test } = require("node:test");
const expect = require("./expect");
const { chunker, contentRange, committedFrom, backoffMs, estimate } = require("../utils/importPlan");

const readerOf = (pieces) => { let i = 0; return { read: async () => (i < pieces.length ? { done: false, value: pieces[i++] } : { done: true }) }; };
const collect = async (reader, size) => { const out = []; for await (const c of chunker(reader, size)) out.push({ n: c.buf.length, last: c.last }); return out; };

describe("importPlan", () => {
  test("chunker re-cuts a stream into fixed pieces and flags the last", async () => {
    const out = await collect(readerOf([Buffer.alloc(5), Buffer.alloc(7), Buffer.alloc(3)]), 4);
    expect(out.map((c) => c.n)).toEqual([4, 4, 4, 3]);
    expect(out.map((c) => c.last)).toEqual([false, false, false, true]);
  });
  test("chunker ends cleanly when the stream stops exactly on a boundary", async () => {
    const out = await collect(readerOf([Buffer.alloc(8)]), 4);
    // the end of the stream is only known after one more read, so the final piece is empty (sent as "bytes */total")
    expect(out.map((c) => c.n)).toEqual([4, 4, 0]);
    expect(out[2].last).toBe(true);
  });
  test("chunker keeps every byte in order", async () => {
    const src = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const got = [];
    for await (const c of chunker(readerOf([src.subarray(0, 333), src.subarray(333, 700), src.subarray(700)]), 128)) got.push(c.buf);
    expect(Buffer.concat(got).equals(src)).toBe(true);
  });
  test("contentRange uses * until the total is known", () => {
    expect(contentRange(0, 100, null)).toBe("bytes 0-99/*");
    expect(contentRange(100, 50, 150)).toBe("bytes 100-149/150");
    expect(contentRange(150, 0, 150)).toBe("bytes */150");
  });
  test("committedFrom reads Drive's Range header", () => {
    expect(committedFrom("bytes=0-1023")).toBe(1024);
    expect(committedFrom("")).toBe(0);
    expect(committedFrom(undefined)).toBe(0);
  });
  test("backoff grows, is capped and stays within jitter bounds", () => {
    expect(backoffMs(1, () => 0.5)).toBe(30000);
    expect(backoffMs(3, () => 0.5)).toBe(120000);
    expect(backoffMs(20, () => 0.5)).toBe(1800000);
    expect(backoffMs(2, () => 0) >= 45000).toBe(true);
  });
  test("estimate gives speed and time left from recent items only", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const mk = (secsAgo, dur, bytes) => ({ bytes, startedAt: new Date(now - (secsAgo + dur) * 1000), finishedAt: new Date(now - secsAgo * 1000) });
    const e = estimate([mk(10, 10, 1000000), mk(30, 10, 1000000), mk(50000, 10, 9e9)], { items: 20 }, now);
    expect(e.bytesPerSec > 0 && e.bytesPerSec < 100000).toBe(true);
    expect(e.etaSeconds > 0).toBe(true);
    expect(estimate([], { items: 5 }, now).etaSeconds).toBe(null);
    expect(estimate([mk(5, 5, 10)], { items: 0 }, now).etaSeconds).toBe(0);
  });
});
