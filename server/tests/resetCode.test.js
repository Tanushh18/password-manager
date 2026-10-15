const test = require("node:test");
const expect = require("./expect");
const reset = require("../utils/resetCode");

test("codes are 6 digits, stored only as a hash, and verify once within 10 minutes", () => {
  const now = Date.parse("2026-10-15T10:00:00Z");
  const { code, state } = reset.issue(now);
  expect(/^\d{6}$/.test(code)).toBe(true);
  expect(JSON.stringify(state).includes(code)).toBe(false);
  expect(reset.verify(state, code, now + 60000).ok).toBe(true);
  expect(reset.verify(state, code, now + 11 * 60000).reason).toBe("expired");
  const wrong = reset.verify(state, code === "000000" ? "111111" : "000000", now);
  expect(wrong.reason).toBe("wrong");
  expect(wrong.attempts).toBe(1);
  expect(reset.verify({ ...state, attempts: 5 }, code, now).reason).toBe("locked");
  expect(reset.verify(null, code, now).reason).toBe("none");
});

test("resending waits a minute and is capped at 5 an hour", () => {
  const now = Date.parse("2026-10-15T10:00:00Z");
  expect(reset.canSend(null, now).ok).toBe(true);
  expect(reset.canSend({ sentAt: new Date(now - 30000) }, now).reason).toBe("wait");
  expect(reset.canSend({ sentAt: new Date(now - 120000), windowStart: new Date(now - 600000), sentCount: 5 }, now).reason).toBe("hourly");
  const later = reset.canSend({ sentAt: new Date(now - 120000), windowStart: new Date(now - 2 * 3600000), sentCount: 5 }, now);
  expect(later.ok).toBe(true);
  expect(later.sentCount).toBe(1);
});
