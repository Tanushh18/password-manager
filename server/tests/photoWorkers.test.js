const { describe, test } = require("node:test");
const expect = require("./expect");
const { seal, open } = require("../utils/workerSeal");
const { storageTotals, suggestAccount } = require("../utils/photoRouting");

const acct = (id, over = {}) => ({ id, label: id.toUpperCase(), status: "connected", eligible: true, usedGb: 1, limitGb: 15, accessToken: "t", ...over });

describe("workerSeal", () => {
  test("round-trips a payload", () => {
    expect(open(seal({ a: 1 }, "s3cret"), "s3cret").a).toBe(1);
  });
  test("rejects a wrong secret, tampering and expiry", () => {
    const blob = seal({ a: 1 }, "s3cret");
    expect(open(blob, "other")).toBe(null);
    expect(open(blob.slice(0, -4) + "AAAA", "s3cret")).toBe(null);
    expect(open(seal({ a: 1 }, "s3cret", -1), "s3cret")).toBe(null);
    expect(open("not-a-blob", "s3cret")).toBe(null);
  });
  test("does not contain the payload in clear text", () => {
    expect(Buffer.from(seal({ token: "ya29.secret" }, "k"), "base64url").toString("utf8").includes("ya29")).toBe(false);
  });
});

describe("storageTotals", () => {
  test("adds up connected accounts and counts unknown limits separately", () => {
    const t = storageTotals([acct("a", { usedGb: 10, limitGb: 15 }), acct("b", { usedGb: 4, limitGb: 100 }), acct("c", { usedGb: 3, limitGb: null }), acct("d", { status: "disconnected", usedGb: 99 })]);
    expect(t.accounts).toBe(3);
    expect(t.usedGb).toBe(17);
    expect(t.limitGb).toBe(115);
    expect(t.freeGb).toBe(101);
    expect(t.unknownLimit).toBe(1);
  });
});

describe("suggestAccount", () => {
  test("suggests the account with the most free space", () => {
    expect(suggestAccount([acct("a", { usedGb: 10 }), acct("b", { limitGb: 100, usedGb: 5 })]).accountId).toBe("b");
  });
  test("keeps the default while it has plenty of room", () => {
    expect(suggestAccount([acct("a", { usedGb: 2 }), acct("b", { usedGb: 1 })], { defaultId: "a" }).accountId).toBe("a");
  });
  test("moves off a nearly full default and says why", () => {
    const s = suggestAccount([acct("a", { usedGb: 13.5 }), acct("b", { limitGb: 100, usedGb: 5 })], { defaultId: "a" });
    expect(s.accountId).toBe("b");
    expect(s.reason.includes("nearly full")).toBe(true);
  });
  test("asks to connect another account when everything is full", () => {
    expect(suggestAccount([acct("a", { usedGb: 14 })]).none).toBe(true);
    expect(suggestAccount([]).none).toBe(true);
  });
});
