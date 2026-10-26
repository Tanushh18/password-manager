const { describe, test } = require("node:test");
const expect = require("./expect");
const { deviceLabel, sessionId, clientIp } = require("../utils/audit");

describe("audit helpers", () => {
  test("deviceLabel gives short readable names", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/120 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("okhttp/4.12.0")).toBe("Stashr app");
    expect(deviceLabel("")).toBe("Unknown device");
  });
  test("sessionId is stable, short and does not contain the token", () => {
    const id = sessionId("secret.jwt.token");
    expect(id).toBe(sessionId("secret.jwt.token"));
    expect(id.length).toBe(16);
    expect(id.includes("secret")).toBe(false);
    expect(sessionId("other")).not.toBe(id);
  });
  test("clientIp is trimmed and tolerates a missing request", () => {
    expect(clientIp({ ip: "1.2.3.4" })).toBe("1.2.3.4");
    expect(clientIp(null)).toBe("");
  });
});
