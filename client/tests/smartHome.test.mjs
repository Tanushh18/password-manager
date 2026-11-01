import { test } from "node:test";
import assert from "node:assert/strict";
import { stateOf, fmtBytes, ago, nowPlaying, signalWord, groupByRoom, lanName } from "../src/lib/smartHome.js";

test("a TV is off, in standby or on", () => {
  assert.equal(stateOf({ kind: "tv", online: false }), "off");
  assert.equal(stateOf({ kind: "tv", online: true, status: { screen: "off" } }), "standby");
  assert.equal(stateOf({ kind: "tv", online: true, status: { screen: "on" } }), "on");
  assert.equal(stateOf({ kind: "hub", online: true, status: {} }), "idle");
  assert.equal(stateOf(null), "off");
});

test("sizes and times read naturally", () => {
  assert.equal(fmtBytes(10_722_902_016), "11 GB");
  assert.equal(fmtBytes(3_000_000), "3 MB");
  assert.equal(fmtBytes(0), "0 MB");
  assert.equal(fmtBytes(1_500_000_000), "1.5 GB");
  const now = Date.UTC(2026, 10, 2, 12);
  assert.equal(ago(null, now), "never");
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
  assert.equal(ago(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(ago(now - 2 * 86400_000, now), "2 d ago");
});

test("what is playing", () => {
  assert.equal(nowPlaying({ media: { title: "Dark", state: "playing" }, app: { label: "Netflix" } }), "Playing: Dark");
  assert.equal(nowPlaying({ media: { title: "Song", artist: "A", state: "paused" } }), "Paused: Song · A");
  assert.equal(nowPlaying({ app: { label: "YouTube" } }), "YouTube");
  assert.equal(nowPlaying({}), "Home screen");
});

test("signal words", () => {
  assert.equal(signalWord(-50), "Excellent");
  assert.equal(signalWord(-60), "Good");
  assert.equal(signalWord(-70), "Fair");
  assert.equal(signalWord(-85), "Weak");
  assert.equal(signalWord(undefined), "");
});

test("devices group by room, with the unplaced ones last", () => {
  const groups = groupByRoom([{ room: "Kitchen", ip: "1" }, { ip: "2" }, { room: "Bedroom", ip: "3" }, { room: " Kitchen ", ip: "4" }]);
  assert.deepEqual(groups.map(([r]) => r), ["Bedroom", "Kitchen", "No room"]);
  assert.equal(groups[1][1].length, 2);
  assert.equal(lanName({ label: "Mom's phone", name: "pixel" }), "Mom's phone");
  assert.equal(lanName({ ip: "192.168.1.9" }), "192.168.1.9");
  assert.equal(lanName({}), "Unknown device");
});
