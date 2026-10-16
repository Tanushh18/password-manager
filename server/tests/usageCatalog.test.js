const { describe, test } = require("node:test");
const expect = require("./expect");
const { detectServices, classifyVar, cloudinarySets, publicService } = require("../utils/usageCatalog");
const { projectMetric, monthPeriod, seriesFor } = require("../utils/usageProjection");

const DAY = 24 * 3600 * 1000;
const keys = (r) => r.services.map((s) => s.key);

describe("masking never reveals secrets", () =>
{
    test("credentials, queries and tokens are stripped from URLs", () =>
    {
        const v = classifyVar("MONGO_URI", "mongodb+srv://admin:Sup3rS3cret@cluster0.ab12.mongodb.net/mydb?retryWrites=true&w=majority");
        expect(v.kind).toBe("url");
        expect(v.display).toBe("mongodb+srv://cluster0.ab12.mongodb.net/mydb");
        expect(v.hasCredentials).toBe(true);
        expect(JSON.stringify(v)).not.toContain("Sup3rS3cret");
        expect(JSON.stringify(v)).not.toContain("admin");
        expect(classifyVar("DATABASE_URL", "postgres://u:p@dpg-x.oregon-postgres.render.com:5432/db").display).toBe("postgres://dpg-x.oregon-postgres.render.com:5432/db");
        expect(classifyVar("MAIL_WEBHOOK_URL", "https://hooks.example.com/services/T000/B000/XXXXSECRET").display).toBe("https://hooks.example.com");
        expect(classifyVar("REDIS_URL", "redis://:pw@host.upstash.io:6379?x=1").display).toBe("redis://host.upstash.io:6379");
    });

    test("secret-looking names and token-shaped values are only reported as set", () =>
    {
        for (const [name, value] of [["GROQ_API_KEY", "gsk_abcdef123456"], ["JWT_SECRET", "x"], ["TELEGRAM_SESSION", "1BVtsOHcBu8"], ["WEIRD_NAME", "AbCdEf0123456789AbCdEf0123456789"], ["TURSO_AUTH_TOKEN", "eyJhbGciOi"], ["DB_SSL_CA_BASE64", "LS0tLS1CRUdJTg=="]])
        {
            const c = classifyVar(name, value);
            expect(c.kind).toBe("secret");
            expect(c.display).toBeNull();
            expect(JSON.stringify(c)).not.toContain(value);
        }
    });

    test("plain configuration is shown; empty values are flagged", () =>
    {
        expect(classifyVar("GROQ_MODEL", "llama-3.3-70b-versatile").display).toBe("llama-3.3-70b-versatile");
        expect(classifyVar("GROQ_MAX_REQUESTS_PER_DAY", "1000").kind).toBe("config");
        expect(classifyVar("SMTP_HOST", "smtp.gmail.com").display).toBe("smtp.gmail.com");
        expect(classifyVar("X", "   ").kind).toBe("empty");
        expect(classifyVar("X", undefined).set).toBe(false);
    });
});

describe("detecting services from env var names", () =>
{
    test("groups variables per service across naming styles", () =>
    {
        const r = detectServices({ MONGODB_URI: "mongodb+srv://u:p@c.mongodb.net/db", MONGODB_STORAGE_LIMIT_MB: "450", GROQ_API_KEY: "k", GROQ_MODEL: "m", TELEGRAM_BOT_TOKEN: "t", CLOUDINARY_CLOUD_NAME: "c", SMTP_HOST: "smtp.x.com", PORT: "3000", JWT_SECRET: "s", RANDOM_THING: "v" });
        expect(keys(r).sort().join()).toBe("cloudinary,email,groq,mongodb,telegram");
        expect(r.internal.map((v) => v.name).sort().join()).toBe("JWT_SECRET,PORT");
        expect(r.other.map((v) => v.name).join()).toBe("RANDOM_THING");
    });

    test("DATABASE_URL is assigned by its scheme", () =>
    {
        expect(keys(detectServices({ DATABASE_URL: "postgres://u:p@h/db" })).join()).toBe("postgres");
        expect(keys(detectServices({ DATABASE_URL: "mysql://u:p@h/db" })).join()).toBe("mysql");
        expect(keys(detectServices({ DATABASE_URL: "mongodb://u:p@h/db" })).join()).toBe("mongodb");
    });

    test("bare API_KEY / API_SECRET mean Cloudinary only alongside CLOUD_NAME", () =>
    {
        expect(keys(detectServices({ CLOUD_NAME: "c", API_KEY: "k", API_SECRET: "s" })).join()).toBe("cloudinary");
        expect(keys(detectServices({ API_KEY: "k", API_SECRET: "s" }))).toHaveLength(0);
    });

    test("configured limits are collected from numeric LIMIT/MAX variables", () =>
    {
        const groq = detectServices({ GROQ_RPD_LIMIT: "14400", GROQ_MAX_TOKENS_PER_DAY: "500000", GROQ_MODEL: "m" }).services[0];
        expect(groq.configuredLimits.map((l) => l.name + "=" + l.value).sort().join()).toBe("GROQ_MAX_TOKENS_PER_DAY=500000,GROQ_RPD_LIMIT=14400");
    });

    test("credentials stay server-side: publicService strips them and no secret appears in the public shape", () =>
    {
        const r = detectServices({ BREVO_API_KEY: "xkeysib-SECRET123", CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "111", CLOUDINARY_API_SECRET: "cldSECRET" });
        const brevo = r.services.find((s) => s.key === "brevo");
        expect(brevo.credentials.apiKey).toBe("xkeysib-SECRET123");
        const pub = JSON.stringify(r.services.map(publicService));
        expect(pub).not.toContain("xkeysib-SECRET123");
        expect(pub).not.toContain("cldSECRET");
        expect(pub).not.toContain("credentials");
        const varsJson = JSON.stringify(r.services.map((s) => s.vars));
        expect(varsJson).not.toContain("cldSECRET");
        expect(varsJson).not.toContain("xkeysib");
        expect(varsJson).toContain("CLOUDINARY_API_SECRET");
    });
});

describe("credential extraction", () =>
{
    test("Cloudinary: several accounts in one project, in any naming style", () =>
    {
        const sets = cloudinarySets(new Map(Object.entries({
            CLOUDINARY_CLOUD_NAME: "main", CLOUDINARY_API_KEY: "k1", CLOUDINARY_API_SECRET: "s1",
            CLOUDINARY_CLOUD_NAME_shine: "shine", CLOUDINARY_API_KEY_shine: "k2", CLOUDINARY_API_SECRET_shine: "s2"
        })));
        expect(sets.map((s) => s.cloudName).sort().join()).toBe("main,shine");
        const legacy = cloudinarySets(new Map(Object.entries({ Cloudinary_name: "n", Cloudinary_api_key: "k", Cloudinary_api_secret: "s" })));
        expect(legacy[0].cloudName).toBe("n");
        const url = cloudinarySets(new Map([["CLOUDINARY_URL", "cloudinary://KEY:SECRET@mycloud"]]));
        expect(url[0].cloudName).toBe("mycloud");
        expect(cloudinarySets(new Map([["CLOUDINARY_CLOUD_NAME", "x"]]))).toHaveLength(0);
    });

    test("Twilio supports auth token or API key credentials; Mongo needs a real mongodb URI", () =>
    {
        const tok = detectServices({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }).services[0].credentials;
        expect(tok.user).toBe("AC1");
        const key = detectServices({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_API_KEY: "SK1", TWILIO_API_KEY_SECRET: "sec" }).services[0].credentials;
        expect(key.user).toBe("SK1");
        expect(detectServices({ TWILIO_ACCOUNT_SID: "AC1" }).services[0].hasCredentials).toBe(false);
        expect(detectServices({ MONGO_URI: "not-a-uri" }).services[0].hasCredentials).toBe(false);
        expect(detectServices({ MONGO_URI: "mongodb+srv://u:p@h/db" }).services[0].credentials.uri).toContain("mongodb+srv://");
    });
});

describe("usage projection: remaining and days left", () =>
{
    const now = Date.parse("2026-10-11T00:00:00Z");   // 10 days into October (31 days)
    const period = monthPeriod(new Date(now));

    test("monthly quota: projects the run-rate and says when it runs out", () =>
    {
        const p = projectMetric({ used: 60, limit: 100, period }, [], now);
        expect(p.percent).toBe(60);
        expect(p.remaining).toBe(40);
        expect(p.method).toBe("period-rate");
        expect(p.willLast).toBe(false);                 // 6/day -> 186 by month end
        expect(Math.round(p.daysLeft)).toBe(7);         // 40 left at 6/day
        expect(p.status).toBe("ok");
        expect(new Date(p.exhaustsAt).getTime() > now).toBe(true);
    });

    test("monthly quota: on track when the projected end-of-month usage fits", () =>
    {
        const p = projectMetric({ used: 10, limit: 100, period }, [], now);
        expect(p.willLast).toBe(true);
        expect(p.daysLeft).toBeNull();
        expect(p.note).toMatch(/last until/);
    });

    test("status thresholds and an already-exhausted quota", () =>
    {
        expect(projectMetric({ used: 85, limit: 100, period }, [], now).status).toBe("warn");
        expect(projectMetric({ used: 96, limit: 100, period }, [], now).status).toBe("critical");
        const over = projectMetric({ used: 120, limit: 100, period }, [], now);
        expect(over.daysLeft).toBe(0);
        expect(over.method).toBe("reached");
    });

    test("grow-only storage: uses stored history, and says so when there is not enough", () =>
    {
        const none = projectMetric({ used: 200, limit: 512 }, [], now);
        expect(none.daysLeft).toBeNull();
        expect(none.note).toMatch(/Collecting data/);
        const history = [{ t: now - 10 * DAY, v: 100 }, { t: now - 5 * DAY, v: 150 }, { t: now, v: 200 }];   // +10 per day
        const p = projectMetric({ used: 200, limit: 512 }, history, now);
        expect(p.method).toBe("history");
        expect(Math.round(p.daysLeft)).toBe(31);        // 312 left at 10/day
        expect(p.growthPerDay).toBe(10);
        const flat = projectMetric({ used: 200, limit: 512 }, [{ t: now - 5 * DAY, v: 200 }, { t: now, v: 200 }], now);
        expect(flat.willLast).toBe(true);
        const tooClose = projectMetric({ used: 200, limit: 512 }, [{ t: now - 3600000, v: 190 }, { t: now, v: 200 }], now);
        expect(tooClose.daysLeft).toBeNull();
    });

    test("balances: burn rate from history", () =>
    {
        const history = [{ t: now - 4 * DAY, v: 20 }, { t: now, v: 12 }];   // 2 per day
        const p = projectMetric({ kind: "balance", remaining: 12 }, history, now);
        expect(p.daysLeft).toBe(6);
        expect(projectMetric({ kind: "balance", remaining: 12 }, [], now).note).toMatch(/Collecting data/);
        expect(projectMetric({ kind: "balance", remaining: 12 }, [{ t: now - 2 * DAY, v: 10 }, { t: now, v: 12 }], now).willLast).toBe(true);
    });

    test("missing data is never invented", () =>
    {
        expect(projectMetric({ used: null, limit: 100 }, [], now).status).toBe("unknown");
        expect(projectMetric({ used: 5, limit: null }, [], now).note).toMatch(/No limit/);
        expect(projectMetric({ used: 0, limit: 100, period }, [], now).willLast).toBe(true);
        expect(projectMetric({ used: 5, limit: 100, period }, [], Date.parse("2026-10-01T03:00:00Z")).method).toBeNull();
    });

    test("seriesFor extracts one metric from snapshots, ignoring gaps", () =>
    {
        const snaps = [{ t: 2, values: { a: 5 } }, { t: 1, values: { a: 3, b: 1 } }, { t: 3, values: { b: 2 } }, { t: 4, values: { a: "x" } }];
        expect(seriesFor(snaps, "a").map((p) => p.v).join()).toBe("3,5");
        expect(seriesFor(undefined, "a")).toHaveLength(0);
    });
});

const { cloudinaryAnalysis } = require("../utils/usageCatalog");
test("Cloudinary: prefix, infix and numbered account naming are all picked up; incomplete accounts are reported", () => {
  const { sets, incomplete } = cloudinaryAnalysis(new Map(Object.entries({
    CLOUDINARY_CLOUD_NAME: "main", CLOUDINARY_API_KEY: "k1", CLOUDINARY_API_SECRET: "s1",
    SHINE_CLOUDINARY_CLOUD_NAME: "shine", SHINE_CLOUDINARY_API_KEY: "k2", SHINE_CLOUDINARY_API_SECRET: "s2",
    CLOUDINARY_BLOG_CLOUD_NAME: "blog", CLOUDINARY_BLOG_API_KEY: "k3", CLOUDINARY_BLOG_API_SECRET: "s3",
    CLOUDINARY_URL_2: "cloudinary://k4:s4@second",
    CLOUDINARY_CLOUD_NAME_OLD: "old"
  })));
  expect(sets.map((s) => s.cloudName).sort()).toEqual(["blog", "main", "second", "shine"]);
  expect(incomplete).toEqual([{ label: "old", missing: ["API Key", "API Secret"] }]);
  expect(detectServices({ SHINE_CLOUDINARY_API_KEY: "k" }).services[0].key).toBe("cloudinary");
});
