const test = require("node:test");
const expect = require("./expect");
const { openEvents, orphanedOpen, closingEvent } = require("../utils/incidentFold");

const ev = (id, state, at, o = {}) => ({ id, groupId: "g1", groupName: "App", serviceKey: "acc:srv-1", serviceName: "api", type: "health", severity: "critical", state, at, openedAt: at, ...o });

test("the newest event per group/service/type decides whether it is open", () => {
  const events = [ev("1", "open", "2026-10-01T00:00:00Z"), ev("2", "resolved", "2026-10-01T01:00:00Z"), ev("3", "open", "2026-10-02T00:00:00Z"), ev("4", "open", "2026-10-02T00:00:00Z", { type: "cpu" })];
  expect(openEvents(events).map((e) => e.id).sort()).toEqual(["3", "4"]);
});

test("incidents of removed groups, removed members and disconnected accounts are orphaned; budget alerts follow the group", () => {
  const groups = [{ id: "g1", serviceKeys: ["acc:srv-1", "acc:srv-2"] }];
  const accounts = new Set(["acc"]);
  const events = [
    ev("a", "open", "2026-10-01T00:00:00Z"),
    ev("b", "open", "2026-10-01T00:00:00Z", { groupId: "gone" }),
    ev("c", "open", "2026-10-01T00:00:00Z", { serviceKey: "acc:srv-9" }),
    ev("d", "open", "2026-10-01T00:00:00Z", { serviceKey: "other:srv-2" }),
    ev("e", "open", "2026-10-01T00:00:00Z", { serviceKey: "group-budget", type: "budget" })
  ];
  expect(orphanedOpen(events, groups, accounts).map((e) => e.id).sort()).toEqual(["b", "c", "d"]);
  expect(orphanedOpen(events, [{ id: "g1", serviceKeys: ["acc:srv-1", "other:srv-2"] }], new Set(["acc"])).map((e) => e.id).sort()).toEqual(["b", "d", "c"].sort());
});

test("a closing event supersedes the open one and records who closed it", () => {
  const open = ev("1", "open", "2026-10-01T00:00:00Z");
  const close = closingEvent(open, { id: "x", message: "done", by: "manual", at: "2026-10-01T02:00:00Z" });
  expect(close.state).toBe("resolved");
  expect(close.resolvedBy).toBe("manual");
  expect(close.openedAt).toBe("2026-10-01T00:00:00Z");
  expect(openEvents([open, close]).length).toBe(0);
});
