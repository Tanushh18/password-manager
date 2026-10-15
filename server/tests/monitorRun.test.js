const { describe, test, beforeEach, afterEach } = require("node:test");
const crypto = require("crypto");
const mongoose = require("mongoose");
const expect = require("./expect");
const User = require("../models/schema");
const renderOps = require("../utils/renderOps");
const { openEvents } = require("../utils/incidentFold");

/*
 * End to end through runUserMonitoring with a faked Render API, faked service and faked Telegram: the monitor must
 * open only real incidents, explain them, close them only when the service is really fine, and never turn a
 * missing /health route into an incident.
 */
const SERVICE = { id: "srv-1", name: "demo-api", type: "web_service", suspended: "not_suspended", repo: "https://github.com/o/demo", rootDir: "", serviceDetails: { url: "https://demo.onrender.com", plan: "free", runtime: "node" } };
const ACCOUNT_ID = new mongoose.Types.ObjectId();
const KEY = ACCOUNT_ID + ":srv-1";

let dataKey, user, world, clock, realNow, realFetch, realUpdate, telegram;
const seal = (fields) => ({ _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: new Date(), updatedAt: new Date() });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function installFakes() {
    global.fetch = async (url, init = {}) => {
        url = String(url);
        if (url.startsWith("https://api.telegram.org/")) { telegram.push(JSON.parse(init.body)); return json({ ok: true, result: {} }); }
        if (url === "https://api.render.com/") return json({});
        if (url.startsWith("https://api.render.com/v1/services?")) return json(world.listed ? [{ service: SERVICE, cursor: "c" }] : []);
        if (url === "https://api.render.com/v1/services/srv-1") return world.renderApi === "down" ? json({ message: "boom" }, 500) : world.renderApi === "gone" ? json({ message: "not found" }, 404) : json({ service: SERVICE, ...SERVICE });
        if (url.includes("/v1/services/srv-1/deploys")) return json([{ deploy: { id: "d1", status: world.deploy || "live", createdAt: new Date(clock - 3600e3).toISOString(), commit: { message: "ship it" } } }]);
        if (url.includes("/v1/metrics/")) return json({ data: [] });
        if (url.startsWith("https://demo.onrender.com")) {
            if (world.site === "timeout") throw Object.assign(new Error("t"), { name: "TimeoutError" });
            if (world.site === "500") return new Response("err", { status: 500 });
            if (world.site === "404") return new Response("nope", { status: 404 });
            if (world.site === "429") return new Response("slow down", { status: 429 });
            return new Response("ok", { status: 200 });
        }
        return json({}, 404);
    };
}

const round = async (site, extra = {}, options = {}) => {
    clock += 6 * 60 * 1000; // the monitor's own interval is 5 minutes
    Object.assign(world, { site, listed: true, renderApi: "ok", deploy: "live" }, extra);
    return renderOps.runUserMonitoring(user, options);
};
const incidents = async () => renderOps.encryptedList(user, "renderIncidents", dataKey, 200);
const openNow = async () => openEvents(await incidents());
const lastHistory = async () => renderOps.encryptedList(user, "renderMetricHistory", dataKey, 200).slice(-1)[0];

beforeEach(() => {
    dataKey = crypto.randomBytes(32);
    realNow = Date.now; realFetch = global.fetch; realUpdate = User.updateOne;
    clock = Date.parse("2026-10-15T12:00:00Z");
    Date.now = () => clock;
    telegram = []; world = {};
    const config = renderOps.normalizeConfig({ monitor: { enabled: true, checkHealth: true }, notifications: { telegramBotToken: "123456789:" + "a".repeat(35), telegramChatId: "42" } });
    user = {
        _id: new mongoose.Types.ObjectId(), getDataKey: async () => dataKey,
        renderOps: [seal(config)], renderAccounts: [{ _id: ACCOUNT_ID, ...seal({ name: "main", apiKey: "rnd_key" }) }],
        renderIncidents: [], renderMetricHistory: [], githubAccounts: []
    };
    User.updateOne = async (_filter, update) => {
        for (const [field, spec] of Object.entries(update.$push || {})) user[field].push(...spec.$each);
        for (const [field, spec] of Object.entries(update.$pull || {})) { const drop = new Set(spec._id.$in.map(String)); user[field] = user[field].filter((e) => !drop.has(String(e._id))); }
        return {};
    };
    installFakes();
});
afterEach(() => { Date.now = realNow; global.fetch = realFetch; User.updateOne = realUpdate; });

describe("monitor, end to end", () => {
    test("a single failed round is only a suspect: no incident, no alert", async () => {
        await round("up");
        await round("timeout");
        expect(await openNow()).toHaveLength(0);
        expect((await lastHistory()).services[0].verdict).toBe("suspect");
        await round("up");
        expect(await incidents()).toHaveLength(0);
        expect(telegram).toHaveLength(0);
    });

    test("two failed rounds open ONE explained incident with buttons; one healthy round closes it", async () => {
        await round("up");
        await round("timeout");
        const second = await round("timeout");
        expect(second.incidentsOpened).toBe(1);
        const [incident] = await openNow();
        expect(incident.type).toBe("health");
        expect(incident.severity).toBe("critical");
        expect(incident.cause).toBe("no_response");
        expect(incident.causeLabel).toBe("Not responding");
        expect(incident.labels).toContain("outage");
        expect(incident.labels).toContain("free-plan");
        expect(incident.message).toContain("demo-api is DOWN");
        expect(incident.message).toContain("2 checks in a row");
        expect(incident.details.probe.cause).toBe("no_response");
        expect(incident.details.timeline.lastHealthyAt).toBeTruthy();
        expect(incident.details.trend.length >= 2).toBe(true);
        expect(incident.details.hints[0]).toMatch(/free instance/);

        const alert = telegram.find((t) => t.reply_markup);
        expect(alert.text).toContain("Not responding");
        expect(alert.reply_markup.inline_keyboard[0].map((b) => b.text)).toEqual(["🔍 Check", "🔄 Restart", "✓ Resolve"]);

        await round("timeout"); // still down: no duplicate
        expect((await incidents()).filter((e) => e.state === "open")).toHaveLength(1);

        await round("up");
        expect(await openNow()).toHaveLength(0);
        const closed = (await incidents()).filter((e) => e.state === "resolved");
        expect(closed).toHaveLength(1);
        expect(closed[0].message).toContain("healthy again");
        expect(telegram.some((t) => /recovered/.test(t.text))).toBe(true);
    });

    test("404 on / and 429 are alive, never incidents", async () => {
        for (const site of ["404", "429", "404", "429"]) await round(site);
        expect(await incidents()).toHaveLength(0);
    });

    test("a 5xx is an app error, confirmed on the second round", async () => {
        await round("500");
        await round("500");
        const [incident] = await openNow();
        expect(incident.cause).toBe("app_error");
        expect(incident.message).toMatch(/HTTP 500/);
    });

    test("an open incident survives a Render API outage (not 'recovered' by guesswork)", async () => {
        await round("timeout"); await round("timeout");
        expect(await openNow()).toHaveLength(1);
        await round("up", { renderApi: "down" });
        await round("up", { renderApi: "down" });
        expect(await openNow()).toHaveLength(1);
        await round("up");
        expect(await openNow()).toHaveLength(0);
    });

    test("a deploy in progress never raises a health incident", async () => {
        await round("up");
        await round("timeout", { deploy: "update_in_progress" });
        await round("timeout", { deploy: "update_in_progress" });
        expect(await incidents()).toHaveLength(0);
    });

    test("a failed deploy is its own labelled incident, opened at once", async () => {
        await round("up", { deploy: "build_failed" });
        const [incident] = await openNow();
        expect(incident.type).toBe("deploy_failure");
        expect(incident.causeLabel).toBe("Deploy failed");
        expect(incident.labels).toContain("deploy");
        expect(incident.details.deploy.status).toBe("build_failed");
    });

    test("a manual check on a dead service opens it immediately", async () => {
        await round("up");
        const r = await round("timeout", {}, { force: true });
        expect(r.incidentsOpened).toBe(1);
    });

    test("a live server with no /health route is NOT an incident; the monitor reports what it needs instead", async () => {
        await round("404");
        const sample = await lastHistory();
        expect(await incidents()).toHaveLength(0);
        expect(sample.services[0].verdict).toBe("up");
        expect(sample.services[0].healthRoute.status).toBe("manual");
        expect(sample.services[0].healthRoute.message).toMatch(/GitHub/);
    });

    test("a service deleted from Render closes its open incident silently", async () => {
        await round("timeout"); await round("timeout");
        expect(await openNow()).toHaveLength(1);
        const before = telegram.length;
        await round("up", { renderApi: "gone" });
        expect(await openNow()).toHaveLength(0);
        const closing = (await incidents()).filter((e) => e.state === "resolved").pop();
        expect(closing.resolvedBy).toBe("auto");
        expect(telegram.length).toBe(before);
    });

    test("a busy log is compacted without ever losing an open incident or recent history", async () => {
        const at = (days) => new Date(clock - days * 86400e3).toISOString();
        const event = (serviceKey, state, days, id) => ({ id, groupId: "auto-old", groupName: "old", serviceKey, serviceName: serviceKey, type: "health", severity: "critical", state, message: "x", openedAt: at(days), at: at(days) });
        // 60 finished incidents from 10 days ago (open + resolved), one resolved yesterday, and one still open from 9 days ago
        for (let n = 0; n < 60; n += 1) { user.renderIncidents.push(seal(event("a:old" + n, "open", 10, "o" + n)), seal(event("a:old" + n, "resolved", 10, "r" + n))); }
        user.renderIncidents.push(seal(event("a:recent", "open", 1.1, "recent-o")), seal(event("a:recent", "resolved", 1, "recent-r")), seal(event("a:stillopen", "open", 9, "still-open")));
        const removed = await renderOps.compactIncidents(user, dataKey, clock);
        expect(removed.removed).toBe(120);
        const left = await incidents();
        expect(left.map((e) => e.id).sort()).toEqual(["recent-o", "recent-r", "still-open"]);
        expect((await openNow()).map((e) => e.id)).toEqual(["still-open"]);
    });
});

