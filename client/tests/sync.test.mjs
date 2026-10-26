import test from "node:test";
import assert from "node:assert/strict";
import { mergeDelta, createSseParser, reconnectDelay } from "../src/lib/sync.js";

const make = (e) => ({ id: e._id, updatedAt: e.updatedAt, name: e.name });

test("mergeDelta replaces changed, adds new, drops deleted", () => {
  const list = [{ id: "a", updatedAt: "1", name: "A" }, { id: "b", updatedAt: "1", name: "B" }, { id: "c", updatedAt: "1", name: "C" }];
  const out = mergeDelta(list, [{ _id: "b", updatedAt: "2", name: "B2" }, { _id: "d", updatedAt: "2", name: "D" }], ["a", "b", "d"], make);
  assert.deepEqual(out.map((i) => i.name), ["D", "A", "B2"]);
});

test("mergeDelta returns the same array when nothing changed", () => {
  const list = [{ id: "a", updatedAt: "1", name: "A" }];
  assert.equal(mergeDelta(list, [{ _id: "a", updatedAt: "1", name: "A" }], ["a"], make), list);
  assert.equal(mergeDelta(list, [], ["a"], make), list);
});

test("SSE parser handles split chunks, comments and CRLF", () => {
  const seen = [];
  const push = createSseParser((e) => seen.push(e));
  push(": ping\n\nevent: chan");
  push('ge\ndata: {"type":"vault"}\n');
  push("\n");
  push("event: ready\r\ndata: {}\r\n\r\n");
  assert.deepEqual(seen, [{ event: "change", data: '{"type":"vault"}' }, { event: "ready", data: "{}" }]);
});

test("reconnectDelay backs off and caps", () => {
  assert.equal(reconnectDelay(0), 2000);
  assert.equal(reconnectDelay(2), 8000);
  assert.equal(reconnectDelay(50), 60000);
});
