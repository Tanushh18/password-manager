const { describe, test } = require("node:test");
const expect = require("./expect");
const { makeProviders } = require("../utils/usageProviders");
const { respEncode, respParse, parseInfo, parseListing } = require("../utils/usageProvidersMore");
const { signGet } = require("../utils/awsSigV4");
const { detectServices, schemeOwner, hostLabel } = require("../utils/usageCatalog");
const { normalizeSettings } = require("../utils/usageIO");

const MB = 1024 * 1024;
const NOW = new Date("2026-10-11T12:00:00Z");
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const PUBLIC_DNS = async () => [{ address: "203.0.113.7" }]; // tests never touch real DNS
const make = (extra = {}) => makeProviders({ now: () => NOW, lookup: PUBLIC_DNS, ...extra });
const settings = (limitsMb = {}) => ({ settings: { limitsMb } });

describe("detecting every database by its connection string", () =>
{
    test("the scheme decides, whatever the variable is called", () =>
    {
        expect(schemeOwner("postgres://u:p@h/db")).toBe("postgres");
        expect(schemeOwner("postgresql://u:p@h/db")).toBe("postgres");
        expect(schemeOwner("mysql://u:p@h/db")).toBe("mysql");
        expect(schemeOwner("mariadb://u:p@h/db")).toBe("mysql");
        expect(schemeOwner("rediss://:p@h:6380")).toBe("redis");
        expect(schemeOwner("mongodb+srv://u:p@h/db")).toBe("mongodb");
        expect(schemeOwner("libsql://x.turso.io")).toBe("turso");
        expect(schemeOwner("https://example.com")).toBe(null);
    });

    test("a Supabase / Neon / Render Postgres URL is PostgreSQL, labelled by host, with credentials kept server-side", () =>
    {
        const r = detectServices({ SUPABASE_DB_URL: "postgresql://u:pw@db.abc.supabase.co:5432/postgres", OTHER_URL: "postgres://u:pw@ep-1.neon.tech/db" });
        const pg = r.services.find((s) => s.key === "postgres");
        expect(pg.label).toBe("PostgreSQL");
        expect(pg.host).toBe("Supabase");
        expect(pg.hasCredentials).toBe(true);
        expect(JSON.stringify(pg.vars)).not.toContain("pw");
        expect(hostLabel("postgres://u:p@ep-1.neon.tech/db")).toBe("Neon");
    });

    test("every provider is found from typical variable names", () =>
    {
        const r = detectServices({
            DATABASE_URL: "mysql://u:p@x.aivencloud.com/db", REDIS_URL: "rediss://:p@x.upstash.io:6379",
            UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "tok",
            TURSO_DATABASE_URL: "libsql://x.turso.io", TURSO_AUTH_TOKEN: "t", PINECONE_API_KEY: "pk",
            ELASTICSEARCH_URL: "https://es.example.com", ELASTICSEARCH_API_KEY: "k",
            AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "sec", AWS_S3_BUCKET: "b", AWS_REGION: "ap-south-1",
            R2_ACCOUNT_ID: "acc", SENDGRID_API_KEY: "SG.x", ELEVENLABS_API_KEY: "e", VONAGE_API_KEY: "a", VONAGE_API_SECRET: "b",
            ALGOLIA_APP_ID: "x", CLERK_SECRET_KEY: "s", AUTH0_DOMAIN: "x", CLOUDFLARE_API_TOKEN: "t", AMQP_URL: "amqps://x", KAFKA_BROKERS: "x"
        });
        const keys = r.services.map((s) => s.key);
        for (const k of ["mysql", "redis", "turso", "pinecone", "elasticsearch", "aws", "sendgrid", "elevenlabs", "vonage", "algolia", "clerk", "auth0", "cloudflare", "queue"]) expect(keys).toContain(k);
        const withReader = ["mysql", "redis", "turso", "pinecone", "elasticsearch", "aws", "sendgrid", "elevenlabs", "vonage"];
        for (const k of withReader) expect(r.services.find((s) => s.key === k).hasCredentials).toBe(true);
    });

    test("an Upstash REST pair is preferred over a TCP url, and secrets never appear in the public view", () =>
    {
        const redis = detectServices({ REDIS_URL: "rediss://:secret@x.upstash.io:6379", UPSTASH_REDIS_REST_URL: "https://x.upstash.io/", UPSTASH_REDIS_REST_TOKEN: "tok" }).services.find((s) => s.key === "redis");
        expect(redis.credentials.restUrl).toBe("https://x.upstash.io");
    });

    test("R2 is read through its S3 endpoint", () =>
    {
        const aws = detectServices({ R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "media", R2_ACCOUNT_ID: "acc123" }).services.find((s) => s.key === "aws");
        expect(aws.credentials.endpoint).toBe("https://acc123.r2.cloudflarestorage.com");
        expect(aws.credentials.region).toBe("auto");
    });
});

describe("the catalog recognises the services apps really use", () =>
{
    const NAMES = "MISTRAL_API_KEY PERPLEXITY_API_KEY DEEPSEEK_API_KEY OPENROUTER_API_KEY AZURE_OPENAI_API_KEY LEMON_SQUEEZY_API_KEY PADDLE_API_KEY PLAID_CLIENT_ID SLACK_BOT_TOKEN SLACK_WEBHOOK_URL DISCORD_TOKEN NOTION_API_KEY AIRTABLE_API_KEY SHOPIFY_API_KEY MUX_TOKEN_ID SANITY_PROJECT_ID CONTENTFUL_SPACE_ID STRAPI_TOKEN NEXTAUTH_SECRET NEXTAUTH_URL AUTH_SECRET KINDE_CLIENT_ID AZURE_STORAGE_CONNECTION_STRING GCS_BUCKET GOOGLE_CLOUD_PROJECT ONESIGNAL_APP_ID PUSHER_APP_ID ABLY_API_KEY STREAM_API_KEY AGORA_APP_ID DAILY_API_KEY ZOOM_CLIENT_ID DATADOG_API_KEY NEW_RELIC_LICENSE_KEY BUGSNAG_API_KEY ROLLBAR_ACCESS_TOKEN AXIOM_TOKEN INNGEST_EVENT_KEY TRIGGER_SECRET_KEY QSTASH_TOKEN VERCEL_TOKEN NETLIFY_AUTH_TOKEN GITLAB_TOKEN HASURA_GRAPHQL_ENDPOINT CONVEX_DEPLOYMENT NEO4J_URI CLICKHOUSE_URL QDRANT_URL WEAVIATE_URL LINEAR_API_KEY OPENWEATHER_API_KEY TMDB_API_KEY RECAPTCHA_SECRET_KEY TURNSTILE_SECRET_KEY UPLOADCARE_PUBLIC_KEY IMGIX_TOKEN MAILCHIMP_API_KEY".split(" ");

    test("none of the common variables is left unrecognised", () =>
    {
        const r = detectServices(Object.fromEntries(NAMES.map((n) => [n, "x".repeat(24)])));
        const found = new Set(r.services.flatMap((s) => s.vars.map((v) => v.name)));
        expect(NAMES.filter((n) => !found.has(n))).toEqual([]);
        expect(r.other).toHaveLength(0);
    });

    test("generic names are not stolen by a service (DAILY_LIMIT, STREAM_URL, MAKE_NOISE stay out)", () =>
    {
        const r = detectServices({ DAILY_LIMIT: "50", DAILY_BUDGET: "5", STREAM_BUFFER: "9", MAKEFLAGS: "-j", LOOPS: "3", TRIGGER_MODE: "cron", LINEAR_SCALE: "2", PORT: "10000" });
        expect(r.services).toHaveLength(0);
    });

    test("a service with no usage reader still gets an honest note", () =>
    {
        const r = detectServices({ SLACK_BOT_TOKEN: "xoxb-" + "a".repeat(30) });
        const slack = r.services[0];
        expect(slack.key).toBe("slack");
        expect(slack.hasCredentials).toBe(false);
    });
});

describe("PostgreSQL usage", () =>
{
    const fakePg = (behaviour = {}) => class {
        constructor(config) { fakePg.last = config; this.config = config; }
        on() {}
        async connect() { if (behaviour.connect) await behaviour.connect(this.config); }
        async query() { return { rows: [{ size: String(120 * MB), name: "appdb", conns: 4, max_conns: 100, version: "PostgreSQL 16.2 on x86_64" }] }; }
        async end() {}
    };

    test("reads size and connections; the plan limit is yours, never guessed", async () =>
    {
        const p = make({ Pg: fakePg() });
        const r = await p.postgres.run({ uri: "postgres://u:p%40ss@db.example.com:5432/appdb" }, settings({ postgres: 1024 }));
        expect(r.ok).toBe(true);
        const [size, conns] = r.reports[0].metrics;
        expect(size.used).toBe(120 * MB);
        expect(size.limit).toBe(1024 * MB);
        expect(size.limitAssumed).toBe(true);
        expect(conns).toEqual({ key: "connections", label: "Connections", used: 4, limit: 100, unit: "count" });
        expect(r.reports[0].plan).toContain("PostgreSQL 16");
        expect(fakePg.last.password).toBe("p@ss");
        const noLimit = await p.postgres.run({ uri: "postgres://u:p@db.example.com/appdb" }, settings());
        expect(noLimit.reports[0].metrics[0].limit).toBe(null);
        expect(noLimit.reports[0].plan).toMatch(/set a storage limit/);
    });

    test("falls back to an unverified certificate only after a verified attempt fails, and says so", async () =>
    {
        const seen = [];
        const p = make({ Pg: fakePg({ connect: async (c) => { seen.push(c.ssl); if (c.ssl && c.ssl.rejectUnauthorized) throw new Error("self signed certificate in certificate chain"); } }) });
        const r = await p.postgres.run({ uri: "postgres://u:p@db.example.com/appdb" }, settings());
        expect(r.ok).toBe(true);
        expect(seen).toEqual([{ rejectUnauthorized: true }, { rejectUnauthorized: false }]);
        expect(r.reports[0].notes[0]).toMatch(/could not be verified/);
        const disabled = [];
        await make({ Pg: fakePg({ connect: async (c) => disabled.push(c.ssl) }) }).postgres.run({ uri: "postgres://u:p@db.example.com/x?sslmode=disable" }, settings());
        expect(disabled).toEqual([false]);
    });

    test("bad password, private hosts and missing drivers are explained without leaking anything", async () =>
    {
        const bad = await make({ Pg: fakePg({ connect: async () => { throw Object.assign(new Error("password authentication failed for user u"), { code: "28P01" }); } }) }).postgres.run({ uri: "postgres://u:secretpw@db.example.com/x" }, settings());
        expect(bad.code).toBe("auth");
        expect(JSON.stringify(bad)).not.toContain("secretpw");
        expect((await make({ Pg: fakePg() }).postgres.run({ uri: "postgres://u:p@10.0.0.4/x" }, settings())).code).toBe("blocked");
        expect((await make().postgres.run({ uri: "postgres://u:p@db.example.com/x" }, settings())).code).toBe("unsupported");
    });
});

describe("MySQL usage", () =>
{
    const create = (behaviour = {}) => async (config) => {
        if (behaviour.fail) throw behaviour.fail(config);
        return {
            async query(sql) {
                if (/information_schema/.test(sql)) return [[{ size: String(300 * MB), name: "shop" }]];
                if (/Threads_connected/.test(sql)) return [[{ Variable_name: "Threads_connected", Value: "7" }]];
                return [[{ Variable_name: "max_connections", Value: "151" }]];
            },
            async end() {}
        };
    };

    test("reads size and connections", async () =>
    {
        const r = await make({ mysqlCreate: create() }).mysql.run({ uri: "mysql://u:p@db.example.com:3306/shop" }, settings({ mysql: 5120 }));
        expect(r.ok).toBe(true);
        expect(r.reports[0].metrics[0]).toEqual({ key: "db-storage", label: "Database “shop” size", used: 300 * MB, limit: 5120 * MB, unit: "bytes", limitAssumed: true });
        expect(r.reports[0].metrics[1].limit).toBe(151);
    });

    test("tries verified TLS, then unverified, then plain; wrong password is an auth error", async () =>
    {
        const seen = [];
        const p = make({ mysqlCreate: create({ fail: (c) => { seen.push(c.ssl); return seen.length < 3 ? new Error("SSL connection error") : null; } }) });
        const flaky = await make({ mysqlCreate: async (c) => { seen.push(c.ssl); if (seen.length < 3) throw new Error("self signed certificate"); return (await create()(c)); } }).mysql.run({ uri: "mysql://u:p@db.example.com/shop" }, settings());
        expect(flaky.ok).toBe(true);
        expect(seen.length).toBe(3);
        void p;
        const denied = await make({ mysqlCreate: create({ fail: () => Object.assign(new Error("Access denied for user"), { code: "ER_ACCESS_DENIED_ERROR" }) }) }).mysql.run({ uri: "mysql://u:p@db.example.com/shop" }, settings());
        expect(denied.code).toBe("auth");
        expect((await make({ mysqlCreate: create() }).mysql.run({ uri: "mysql://u:p@127.0.0.1/shop" }, settings())).code).toBe("blocked");
    });
});

describe("Redis usage", () =>
{
    test("RESP encoding and parsing round-trip, including partial data and errors", () =>
    {
        expect(respEncode(["AUTH", "pw"])).toBe("*2\r\n$4\r\nAUTH\r\n$2\r\npw\r\n");
        const info = "# Memory\r\nused_memory:1048576\r\nmaxmemory:0\r\n";
        const wire = Buffer.from("+OK\r\n$" + Buffer.byteLength(info) + "\r\n" + info + "\r\n:42\r\n");
        const out = respParse(wire, 3);
        expect(out.replies[0]).toBe("OK");
        expect(parseInfo(out.replies[1]).used_memory).toBe("1048576");
        expect(out.replies[2]).toBe(42);
        expect(respParse(wire.subarray(0, 12), 3)).toBe(null);
        expect(respParse(Buffer.from("-WRONGPASS bad\r\n"), 1).replies[0] instanceof Error).toBe(true);
    });

    test("native redis: memory and keys; a plan limit is used only when the server has none", async () =>
    {
        const info = "# Memory\r\nused_memory:5242880\r\nmaxmemory:0\r\nredis_version:7.2.4\r\n";
        const call = async (opts, commands) => { expect(commands.map((c) => c[0])).toEqual(["INFO", "DBSIZE"]); return [info, 321]; };
        const r = await make({ redisCall: call }).redis.run({ uri: "rediss://:pw@cache.example.com:6380" }, settings({ redis: 256 }));
        expect(r.ok).toBe(true);
        expect(r.reports[0].metrics[0]).toMatchObject({ used: 5 * MB, limit: 256 * MB, limitAssumed: true });
        expect(r.reports[0].metrics[1]).toMatchObject({ key: "keys", used: 321 });
        const real = await make({ redisCall: async () => ["# Memory\r\nused_memory:100\r\nmaxmemory:1000\r\n", 1] }).redis.run({ uri: "redis://cache.example.com" }, settings({ redis: 256 }));
        expect(real.reports[0].metrics[0]).toMatchObject({ limit: 1000, limitAssumed: false });
    });

    test("bad password, unreachable and private hosts", async () =>
    {
        expect((await make({ redisCall: async () => [new Error("WRONGPASS invalid username-password pair"), 0] }).redis.run({ uri: "redis://:x@cache.example.com" }, settings())).code).toBe("auth");
        expect((await make({ redisCall: async () => { throw new Error("ECONNREFUSED"); } }).redis.run({ uri: "redis://cache.example.com" }, settings())).code).toBe("unavailable");
        expect((await make({ redisCall: async () => [] }).redis.run({ uri: "redis://localhost:6379" }, settings())).code).toBe("blocked");
    });

    test("Upstash REST", async () =>
    {
        const calls = [];
        const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return res(200, { result: JSON.parse(init.body)[0] === "DBSIZE" ? 9 : "# Memory\r\nused_memory:2097152\r\nmaxmemory:0\r\n" }); };
        const r = await make({ fetchImpl }).redis.run({ restUrl: "https://x.upstash.io", restToken: "tok" }, settings({ redis: 256 }));
        expect(r.reports[0].metrics[0].used).toBe(2 * MB);
        expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
        const denied = await make({ fetchImpl: async () => res(401, { error: "Unauthorized" }) }).redis.run({ restUrl: "https://x.upstash.io", restToken: "bad" }, settings());
        expect(denied.code).toBe("auth");
    });
});

describe("Turso, Pinecone and Elasticsearch", () =>
{
    test("turso: size = pages x page size, read over HTTPS", async () =>
    {
        const fetchImpl = async (url, init) => { expect(url).toBe("https://db-org.turso.io/v2/pipeline"); expect(init.headers.Authorization).toBe("Bearer t"); return res(200, { results: [{ response: { result: { rows: [[{ value: "100" }]] } } }, { response: { result: { rows: [[{ value: "4096" }]] } } }] }); };
        const r = await make({ fetchImpl }).turso.run({ url: "https://db-org.turso.io", token: "t" }, settings({ turso: 500 }));
        expect(r.reports[0].metrics[0]).toMatchObject({ used: 409600, limit: 500 * MB });
    });

    test("pinecone: vectors per index; indexes on private hosts are skipped", async () =>
    {
        const fetchImpl = async (url) => {
            if (url === "https://api.pinecone.io/indexes") return res(200, { indexes: [{ name: "docs", host: "docs-abc.svc.pinecone.io", spec: { serverless: {} } }, { name: "evil", host: "localhost" }] });
            return res(200, { totalVectorCount: 1234 });
        };
        const r = await make({ fetchImpl }).pinecone.run({ apiKey: "k" });
        expect(r.reports).toHaveLength(1);
        expect(r.reports[0].metrics[0]).toMatchObject({ used: 1234, unit: "count" });
        expect(r.reports[0].plan).toBe("Serverless");
    });

    test("elasticsearch: store size and documents; bad key is an auth error", async () =>
    {
        const fetchImpl = async (url, init) => init.headers.Authorization === "ApiKey good" ? res(200, { cluster_name: "prod", indices: { store: { size_in_bytes: 50 * MB }, docs: { count: 1000 } }, nodes: { versions: ["8.13.0"] } }) : res(401, {});
        const ok = await make({ fetchImpl }).elasticsearch.run({ url: "https://es.example.com", auth: "ApiKey good" }, settings({ elasticsearch: 1024 }));
        expect(ok.reports[0].metrics[0]).toMatchObject({ used: 50 * MB, limit: 1024 * MB });
        expect((await make({ fetchImpl }).elasticsearch.run({ url: "https://es.example.com", auth: "ApiKey bad" }, settings())).code).toBe("auth");
        expect((await make({ fetchImpl }).elasticsearch.run({ url: "https://10.0.0.1", auth: "x" }, settings())).code).toBe("blocked");
    });
});

describe("S3 / R2 usage", () =>
{
    const page = (sizes, next) => "<ListBucketResult>" + sizes.map((n) => "<Contents><Key>k</Key><Size>" + n + "</Size></Contents>").join("") + "<IsTruncated>" + (next ? "true" : "false") + "</IsTruncated>" + (next ? "<NextContinuationToken>" + next + "</NextContinuationToken>" : "") + "</ListBucketResult>";
    const creds = { accessKey: "AKIAEXAMPLE", secretKey: "secret", bucket: "my-bucket", region: "ap-south-1", endpoint: "", sessionToken: "" };

    test("lists the bucket with a signed request and totals it, following pages", async () =>
    {
        const urls = [];
        const fetchImpl = async (url, init) => { urls.push({ url, auth: init.headers.Authorization }); return urls.length === 1 ? res(200, page([100, 200], "tok123")) : res(200, page([300])); };
        const r = await make({ fetchImpl }).aws.run(creds, settings({ aws: 10240 }));
        expect(r.ok).toBe(true);
        expect(urls[0].url.startsWith("https://my-bucket.s3.ap-south-1.amazonaws.com/?")).toBe(true);
        expect(urls[0].auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261011\/ap-south-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
        expect(urls[1].url).toContain("continuation-token=tok123");
        expect(r.reports[0].metrics[0].used).toBe(600);
        expect(r.reports[0].metrics[1].used).toBe(3);
        expect(JSON.stringify(r)).not.toContain("secret");
    });

    test("R2 uses the account endpoint, path style; more than the page cap is flagged as approximate", async () =>
    {
        const urls = [];
        const fetchImpl = async (url) => { urls.push(url); return res(200, page([10], "more")); };
        const r = await make({ fetchImpl }).aws.run({ ...creds, endpoint: "https://acc.r2.cloudflarestorage.com", region: "auto", bucket: "media" }, settings());
        expect(urls[0].startsWith("https://acc.r2.cloudflarestorage.com/media?")).toBe(true);
        expect(urls).toHaveLength(5);
        expect(r.reports[0].notes[0]).toMatch(/first 5000 objects/);
    });

    test("access denied, missing bucket and private endpoints are explained", async () =>
    {
        expect((await make({ fetchImpl: async () => res(403, "AccessDenied") }).aws.run(creds, settings())).code).toBe("auth");
        expect((await make({ fetchImpl: async () => res(404, "NoSuchBucket") }).aws.run(creds, settings())).message ?? "").toBe("");
        expect((await make({ fetchImpl: async () => res(200, "") }).aws.run({ ...creds, endpoint: "https://10.0.0.1" }, settings())).code).toBe("blocked");
    });

    test("signature matches AWS's published test vector", () =>
    {
        const r = signGet({ host: "example.amazonaws.com", path: "/", region: "us-east-1", service: "service", accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", date: new Date("2015-08-30T12:36:00Z"), contentHashHeader: false });
        expect(r.headers.Authorization).toContain("Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
        expect(parseListing(page([1, 2], "n"))).toEqual({ count: 2, bytes: 3, truncated: true, next: "n" });
    });
});

describe("SendGrid, ElevenLabs and Vonage", () =>
{
    test("sendgrid credits with their own reset date", async () =>
    {
        const r = await make({ fetchImpl: async () => res(200, { total: 40000, used: 1500, remain: 38500, reset_frequency: "monthly", next_reset: "2026-11-01" }) }).sendgrid.run({ apiKey: "SG.x" });
        expect(r.reports[0].metrics[0]).toMatchObject({ key: "credits", used: 1500, limit: 40000, unit: "emails" });
        expect(r.reports[0].metrics[0].period.resetsAt).toBe("2026-11-01T00:00:00.000Z");
        const none = await make({ fetchImpl: async () => res(200, { total: 0, used: 0 }) }).sendgrid.run({ apiKey: "SG.x" });
        expect(none.reports[0].metrics).toHaveLength(0);
        expect(none.reports[0].notes[0]).toMatch(/no credit allowance/);
    });

    test("elevenlabs characters", async () =>
    {
        const r = await make({ fetchImpl: async (url, init) => { expect(init.headers["xi-api-key"]).toBe("k"); return res(200, { character_count: 2500, character_limit: 10000, next_character_count_reset_unix: 1793000000, tier: "free" }); } }).elevenlabs.run({ apiKey: "k" });
        expect(r.reports[0].metrics[0]).toMatchObject({ used: 2500, limit: 10000, unit: "characters" });
        expect(r.reports[0].plan).toBe("free");
    });

    test("vonage balance and wrong credentials", async () =>
    {
        const r = await make({ fetchImpl: async () => res(200, { value: 12.5 }) }).vonage.run({ apiKey: "a", apiSecret: "b" });
        expect(r.reports[0].metrics[0]).toMatchObject({ remaining: 12.5, unit: "EUR", kind: "balance" });
        expect((await make({ fetchImpl: async () => res(401, {}) }).vonage.run({ apiKey: "a", apiSecret: "b" })).code).toBe("auth");
    });
});

describe("hosts that resolve to internal addresses are refused", () =>
{
    test("a public-looking name pointing at a private address is blocked for every kind of reader", async () =>
    {
        const lookup = async (host) => [{ address: host === "sneaky.example.com" ? "10.0.0.5" : "169.254.169.254" }];
        const never = async () => { throw new Error("must not connect"); };
        const p = make({ lookup, fetchImpl: never, Pg: class { constructor() { throw new Error("must not connect"); } }, mysqlCreate: never, redisCall: never });
        expect((await p.postgres.run({ uri: "postgres://u:p@sneaky.example.com/db" }, settings())).code).toBe("blocked");
        expect((await p.mysql.run({ uri: "mysql://u:p@sneaky.example.com/db" }, settings())).code).toBe("blocked");
        expect((await p.redis.run({ uri: "redis://sneaky.example.com" }, settings())).code).toBe("blocked");
        expect((await p.redis.run({ restUrl: "https://sneaky.example.com", restToken: "t" }, settings())).code).toBe("blocked");
        expect((await p.turso.run({ url: "https://sneaky.example.com", token: "t" }, settings())).code).toBe("blocked");
        expect((await p.elasticsearch.run({ url: "https://sneaky.example.com", auth: "x" }, settings())).code).toBe("blocked");
        expect((await p.aws.run({ accessKey: "a", secretKey: "s", bucket: "b", region: "auto", endpoint: "https://sneaky.example.com" }, settings())).code).toBe("blocked");
    });

    test("a name that cannot be resolved is not 'blocked': the connection reports the real problem", async () =>
    {
        const p = make({ lookup: async () => { throw new Error("ENOTFOUND"); }, Pg: class { constructor() {} on() {} async connect() { throw new Error("getaddrinfo ENOTFOUND") } async end() {} } });
        expect((await p.postgres.run({ uri: "postgres://u:p@nowhere.example.com/db" }, settings())).code).toBe("unavailable");
    });
});

describe("usage settings", () =>
{
    test("per-provider limits are validated, kept, and removable; Mongo stays compatible", () =>
    {
        const a = normalizeSettings({ enabled: true, limitsMb: { postgres: 1024, redis: "256", nonsense: 5, mysql: -1 } });
        expect(a.limitsMb.postgres).toBe(1024);
        expect(a.limitsMb.redis).toBe(256);
        expect("nonsense" in a.limitsMb).toBe(false);
        expect("mysql" in a.limitsMb).toBe(false);
        expect(a.mongoLimitMb).toBe(512);
        const b = normalizeSettings({ limitsMb: { postgres: "" } }, a);
        expect("postgres" in b.limitsMb).toBe(false);
        expect(b.limitsMb.redis).toBe(256);
        const c = normalizeSettings({ mongoLimitMb: 2048 }, b);
        expect(c.mongoLimitMb).toBe(2048);
        expect(c.limitsMb.mongodb).toBe(2048);
        expect(normalizeSettings({}, c).limitsMb.mongodb).toBe(2048);
    });
});
