const { describe, test } = require("node:test");
const expect = require("./expect");
const { pickDestination } = require("../utils/photoRouting");

const acct = (id, over = {}) => ({ id, status: "connected", eligible: true, priority: 1, usedGb: 1, limitGb: 15, accessToken: "t", ...over });
const MB = 1024 ** 2;

describe("pickDestination", () => {
  test("picks the highest-priority account with room", () => {
    expect(pickDestination([acct("b", { priority: 2 }), acct("a", { priority: 1 })], 5 * MB).id).toBe("a");
  });
  test("prefers the chosen default account", () => {
    expect(pickDestination([acct("a"), acct("b", { priority: 2 })], 5 * MB, { defaultId: "b" }).id).toBe("b");
  });
  test("keeps the safety buffer free and moves to the next account", () => {
    const full = acct("a", { usedGb: 13.5, limitGb: 15 });
    expect(pickDestination([full, acct("b", { priority: 2 })], 100 * MB, { bufferGb: 2 }).id).toBe("b");
  });
  test("skips paused, disconnected, excluded and token-less accounts", () => {
    const list = [acct("a", { eligible: false }), acct("b", { status: "disconnected" }), acct("c", { accessToken: "" }), acct("d"), acct("e", { priority: 5 })];
    expect(pickDestination(list, MB, { excludeIds: ["d"] }).id).toBe("e");
  });
  test("an unknown limit ranks after accounts known to have room, and is never treated as unlimited first", () => {
    const list = [acct("a", { limitGb: null, priority: 1 }), acct("b", { priority: 2 })];
    expect(pickDestination(list, MB).id).toBe("b");
    expect(pickDestination([list[0]], MB).id).toBe("a");
  });
  test("returns null when nothing can take the file", () => {
    expect(pickDestination([acct("a", { usedGb: 15 })], MB)).toBe(null);
  });
});
