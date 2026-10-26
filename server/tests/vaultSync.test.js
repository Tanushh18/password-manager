const { describe, test } = require("node:test");
const expect = require("./expect");
const { parseSince, buildChanges, SKEW_MS } = require("../utils/vaultSync");
const hub = require("../utils/syncHub");

const entry = (id, at) => ({ _id: id, updatedAt: new Date(at), createdAt: new Date(at) });
const user = { passwords: [entry("a", "2026-01-01T00:00:00Z"), entry("b", "2026-01-02T00:00:00Z")], projects: [entry("p", "2026-01-03T00:00:00Z")] };
const pub = (e) => ({ _id: String(e._id) });

describe("vault delta sync", () => {
  test("parseSince rejects junk and future times, and backs off by the skew", () => {
    expect(parseSince("")).toBe(null);
    expect(parseSince("nope")).toBe(null);
    expect(parseSince("2999-01-01T00:00:00Z", Date.parse("2026-01-01"))).toBe(null);
    expect(parseSince("2026-01-02T00:00:00Z")).toBe(Date.parse("2026-01-02T00:00:00Z") - SKEW_MS);
  });
  test("no since means a full load", () => {
    const c = buildChanges(user, null, pub);
    expect(c.full).toBe(true);
    expect(c.items.length).toBe(2);
    expect(c.projects.length).toBe(1);
  });
  test("only entries written after since come back, but every id is listed", () => {
    const c = buildChanges(user, parseSince("2026-01-01T12:00:00Z"), pub);
    expect(c.full).toBe(false);
    expect(c.items.map((i) => i._id)).toEqual(["b"]);
    expect(c.projects.map((p) => p._id)).toEqual(["p"]);
    expect(c.itemIds).toEqual(["a", "b"]);
    expect(c.projectIds).toEqual(["p"]);
  });
  test("an account with no entries still answers", () => {
    const c = buildChanges({}, null, pub);
    expect(c.items).toEqual([]);
    expect(c.itemIds).toEqual([]);
  });
});

describe("sync hub", () => {
  const fake = () => { const w = []; return { w, write: (x) => w.push(x), end() { this.ended = true; } }; };
  test("notify reaches every stream of the account and nobody else", () => {
    const a = fake(), b = fake(), other = fake();
    const offA = hub.subscribe("u1", a); hub.subscribe("u1", b); hub.subscribe("u2", other);
    expect(hub.notify("u1")).toBe(2);
    expect(other.w.length).toBe(0);
    expect(a.w[0].includes("event: change")).toBe(true);
    offA();
    expect(hub.notify("u1")).toBe(1);
  });
  test("a sixth stream closes the oldest", () => {
    const streams = Array.from({ length: hub.MAX_STREAMS_PER_USER + 1 }, fake);
    streams.forEach((s) => hub.subscribe("u3", s));
    expect(streams[0].ended).toBe(true);
    expect(hub.count("u3")).toBe(hub.MAX_STREAMS_PER_USER);
  });
});
