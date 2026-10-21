const { describe, test } = require("node:test");
const expect = require("./expect");
const { linkCounts, pickPrimary, duplicatesToRemove } = require("../utils/photoAccounts");

const acct = (id, over = {}) => ({ id, email: "a@gmail.com", status: "connected", oauthMode: "connected", accessToken: "t", ...over });

describe("duplicate Google account entries", () => {
  test("keeps the entry that has files linked, and removes an unlinked duplicate", () => {
    const old = acct("old");
    const current = acct("current");
    const linked = linkCounts([{ sourceConnectionId: "current" }, { sourceConnectionId: "current" }], []);
    expect(pickPrimary([old, current], linked).id).toBe("current");
    expect(duplicatesToRemove([old, current], linked).map((c) => c.id)).toEqual(["old"]);
  });

  test("never removes an entry that an import batch still points at", () => {
    const a = acct("a");
    const b = acct("b");
    const linked = linkCounts([], [{ sourceConnectionId: "b", destinationIds: ["a"] }]);
    expect(duplicatesToRemove([a, b], linked)).toEqual([]);
  });

  test("ignores accounts with different emails", () => {
    const a = acct("a", { email: "one@gmail.com" });
    const b = acct("b", { email: "two@gmail.com" });
    expect(duplicatesToRemove([a, b], new Map())).toEqual([]);
  });

  test("matches emails regardless of case and spacing", () => {
    const a = acct("a", { email: " A@gmail.com " });
    const b = acct("b", { email: "a@GMAIL.com" });
    expect(duplicatesToRemove([a, b], new Map()).length).toBe(1);
  });

  test("prefers the working entry when nothing is linked", () => {
    const broken = acct("broken", { oauthMode: "pending-provider-consent", status: "disconnected", accessToken: "" });
    const working = acct("working");
    expect(pickPrimary([broken, working], new Map()).id).toBe("working");
  });
});
