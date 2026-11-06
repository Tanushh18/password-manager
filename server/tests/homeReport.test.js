const { describe, test } = require("node:test");
const expect = require("./expect");
const { renderReport } = require("../utils/homeReport");

const base = { at: Date.parse("2026-11-04T02:30:00Z"), tz: "Asia/Kolkata", people: [{ person: "Papa", home: true }, { person: "Mummy", home: false }], tv: [{ name: "TV", state: "on" }], tvMinutes: 200, tvApps: { YouTube: 120, Netflix: 80 }, tvLimit: 180, alerts: [{ at: Date.parse("2026-11-04T02:00:00Z"), text: "Papa came home", ok: null }], whatsapp: [{ at: Date.parse("2026-11-04T02:00:00Z"), text: "Papa reached Home", status: "sent" }], camera: { movement: 2, photos: 2, clips: 0 }, devices: { wifiUp: 9, phones: [{ name: "Papa", online: true, battery: 12, charging: false }], newOnes: ["unknown-android"] }, internet: { down: 80, up: 20, ping: 12 }, changes: ["09:10 New device"] };

describe("home report", () => {
    test("is one message with every section", () => {
        const m = renderReport({ ...base, headline: "Papa came home" });
        for (const s of ["STASHR HOME", "NOW", "WHO IS HOME", "TV", "NOTIFICATIONS", "WHATSAPP", "CAMERA", "DEVICES", "INTERNET", "WHAT CHANGED"]) expect(m).toContain(s);
        expect(m).toContain("🟡");
        expect(m.length < 4096).toBe(true);
    });
    test("a failed WhatsApp turns it red and escapes HTML", () => {
        const m = renderReport({ ...base, whatsapp: [{ at: base.at, text: "<b>x</b> failed", status: "failed" }] });
        expect(m).toContain("🔴");
        expect(m).toContain("&lt;b&gt;");
    });
    test("never exceeds Telegram's limit", () => {
        const many = Array.from({ length: 200 }, (_, i) => ({ at: base.at, text: "event ".repeat(30) + i, ok: false }));
        expect(renderReport({ ...base, alerts: many }).length < 4096).toBe(true);
    });
});
