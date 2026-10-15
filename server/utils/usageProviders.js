const { monthPeriod } = require("./usageProjection");
const { makeMoreProviders } = require("./usageProvidersMore");

/*
 * Read-only usage readers for providers that expose usage with the keys your apps already hold.
 * Every call is a GET (or a read-only database command), has a timeout, and returns only numbers and plan names:
 * response bodies and credentials are never echoed into errors or results.
 *
 * Result: { ok: true, reports: [{ label, plan, metrics: [...], notes: [] }] }  or  { ok: false, code, error }
 * Metric: { key, label, used?, limit?, remaining?, unit, kind?, period?, limitAssumed? }
 */
const MB = 1024 * 1024;
const TIMEOUT_MS = 10000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => { const n = typeof v === "string" ? Number(v) : v; return isNum(n) ? n : null; };

const fail = (code, error) => ({ ok: false, code, error });
/** The provider's own error text (never our request or its credentials), trimmed for display. */
function providerMessage(body) {
  const raw = typeof body?.message === "string" ? body.message : typeof body?.error?.message === "string" ? body.error.message : typeof body?.error === "string" ? body.error : typeof body?.err_msg === "string" ? body.err_msg : "";
  return raw.replace(/[A-Za-z0-9_-]{24,}/g, "…").replace(/\s+/g, " ").trim().slice(0, 200);
}

const httpError = (status, body, hint = "") => {
  const said = providerMessage(body);
  const base = status === 401 || status === 403 ? fail("auth", "The provider rejected this key (it may be revoked or lack permission).")
    : status === 429 ? fail("rate-limit", "The provider is rate limiting usage requests. It will retry on the next refresh.")
    : status === 0 ? fail("unavailable", "The provider could not be reached.")
    : fail("unavailable", "The provider returned an error (HTTP " + status + ").");
  if (said) base.detail = said;
  if (hint) base.hint = hint;
  return base;
};

/** Hosts we refuse to connect to: loopback, private ranges and single-label internal names. */
function isPrivateHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return true;
  if (h === "::1" || h.startsWith("fc") && h.includes(":") || h.startsWith("fd") && h.includes(":") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
  }
  return false;
}

function mongoHosts(uri) {
  const rest = String(uri).replace(/^mongodb(\+srv)?:\/\//i, "");
  const authority = rest.split("/")[0].split("?")[0];
  const hostList = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
  return hostList.split(",").map((h) => h.trim().replace(/:\d+$/, "")).filter(Boolean);
}

function mongoDbName(uri) {
  const m = String(uri).replace(/^mongodb(\+srv)?:\/\//i, "").match(/^[^/]*\/([^?]*)/);
  return m && m[1] ? decodeURIComponent(m[1]) : "test";
}

function makeProviders({ fetchImpl = globalThis.fetch, MongoClient, Pg, mysqlCreate, redisCall, lookup, now = () => new Date() } = {}) {
  const getJson = async (url, headers) => {
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body };
    } catch { return { ok: false, status: 0, body: null, network: true }; }
  };
  const basic = (user, pass) => "Basic " + Buffer.from(user + ":" + pass).toString("base64");

  const more = makeMoreProviders({ fetchImpl, getJson, fail, httpError, isPrivateHost, drivers: { Pg, mysqlCreate, redisCall, lookup }, now });

  return {
    ...more,
    mongodb: {
      async run({ uri }, { settings = {} } = {}) {
        if (!MongoClient) return fail("unsupported", "MongoDB driver is not available on this server.");
        const hosts = mongoHosts(uri);
        if (!hosts.length || hosts.some(isPrivateHost)) return fail("blocked", "Stashr only reads usage from publicly reachable MongoDB hosts.");
        const limitBytes = (num(settings.mongoLimitMb) || 512) * MB;
        const dbName = mongoDbName(uri);
        let client;
        try {
          client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 10000, maxPoolSize: 1, appName: "stashr-usage" });
          await client.connect();
          const stats = await client.db(dbName).command({ dbStats: 1 });
          let total = null;
          try { const listing = await client.db("admin").command({ listDatabases: 1 }); total = num(listing.totalSize); } catch { /* needs extra privileges; the per-database numbers still work */ }
          const used = (num(stats.dataSize) || 0) + (num(stats.indexSize) || 0);
          const metrics = [];
          if (total != null) metrics.push({ key: "cluster-storage", label: "Cluster storage (all databases)", used: total, limit: limitBytes, unit: "bytes", limitAssumed: true });
          metrics.push({ key: "db-storage", label: "Database “" + dbName + "” (data + indexes)", used, limit: total == null ? limitBytes : null, unit: "bytes", limitAssumed: total == null });
          if (num(stats.objects) != null) metrics.push({ key: "documents", label: "Documents", used: num(stats.objects), limit: null, unit: "count" });
          const atlas = hosts.some((h) => /\.mongodb\.net$/i.test(h));
          return { ok: true, reports: [{ label: dbName, plan: atlas ? "MongoDB Atlas · limit " + Math.round(limitBytes / MB) + " MB (your setting)" : "MongoDB · limit " + Math.round(limitBytes / MB) + " MB (your setting)", metrics, notes: [] }] };
        } catch (error) {
          const text = String(error?.message || "");
          if (/auth|not authorized|unauthorized|bad auth/i.test(text) || error?.code === 13 || error?.code === 18) return fail("auth", "MongoDB rejected the credentials or this user cannot read statistics.");
          return fail("unavailable", "Could not connect to MongoDB to read usage.");
        } finally { try { await client?.close(); } catch { /* ignore */ } }
      }
    },

    cloudinary: {
      async run({ sets }) {
        const reports = [];
        let firstError = null;
        for (const set of sets) {
          const res = await getJson("https://api.cloudinary.com/v1_1/" + encodeURIComponent(set.cloudName) + "/usage", { Authorization: basic(set.apiKey, set.apiSecret) });
          if (!res.ok) { firstError = firstError || httpError(res.status, res.body); continue; }
          const b = res.body || {};
          const period = monthPeriod(now());
          const metrics = [];
          if (isNum(b.credits?.usage)) metrics.push({ key: "credits", label: "Credits used this month", used: b.credits.usage, limit: num(b.credits.limit), unit: "credits", period });
          if (isNum(b.storage?.usage)) metrics.push({ key: "storage", label: "Storage", used: b.storage.usage, limit: num(b.storage.limit), unit: "bytes" });
          if (isNum(b.bandwidth?.usage)) metrics.push({ key: "bandwidth", label: "Bandwidth this month", used: b.bandwidth.usage, limit: num(b.bandwidth.limit), unit: "bytes", period });
          if (isNum(b.transformations?.usage)) metrics.push({ key: "transformations", label: "Transformations this month", used: b.transformations.usage, limit: num(b.transformations.limit), unit: "count", period });
          if (isNum(b.objects?.usage ?? b.resources)) metrics.push({ key: "assets", label: "Assets", used: b.objects?.usage ?? b.resources, limit: null, unit: "count" });
          reports.push({ label: set.label === "default" ? set.cloudName : set.cloudName + " (" + set.label + ")", plan: typeof b.plan === "string" ? b.plan : null, metrics, notes: [] });
        }
        return reports.length ? { ok: true, reports } : firstError || fail("unavailable", "No Cloudinary account could be read.");
      }
    },

    brevo: {
      async run({ apiKey }) {
        const res = await getJson("https://api.brevo.com/v3/account", { "api-key": apiKey });
        if (!res.ok) {
          const ipBlocked = /ip/i.test(providerMessage(res.body)) && res.status === 401;
          return httpError(res.status, res.body, ipBlocked ? "Brevo blocks API calls from unknown IP addresses. In Brevo open Settings → Security → Authorised IPs and either add Render's outbound IPs (Render service → Connect → Outbound) or turn off IP blocking." : "");
        }
        const plans = Array.isArray(res.body?.plan) ? res.body.plan : [];
        const mail = plans.find((p) => p && p.creditsType !== "sms") || plans[0];
        const metrics = [];
        if (mail && isNum(mail.credits)) {
          // On send-limit plans the figure is the plan's limit, not what is left, so it is reported as a limit only.
          if (/^sendLimit$/i.test(String(mail.creditsType))) metrics.push({ key: "send-limit", label: "Sending limit (plan)", used: null, limit: mail.credits, unit: "emails", note: "Brevo reports the plan limit, not today's remaining count." });
          else metrics.push({ key: "email-credits", label: "Email credits left", remaining: mail.credits, unit: "emails", kind: "balance" });
        }
        return { ok: true, reports: [{ label: res.body?.companyName || "Brevo", plan: mail?.type ? String(mail.type) : null, metrics, notes: [] }] };
      }
    },

    twilio: {
      async run({ accountSid, user, pass }) {
        const res = await getJson("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(accountSid) + "/Balance.json", { Authorization: basic(user, pass) });
        if (!res.ok) return httpError(res.status, res.body);
        const balance = num(res.body?.balance);
        const metrics = balance == null ? [] : [{ key: "balance", label: "Account balance", remaining: balance, unit: String(res.body?.currency || "USD"), kind: "balance" }];
        return { ok: true, reports: [{ label: "Twilio", plan: null, metrics, notes: [] }] };
      }
    },

    deepgram: {
      async run({ apiKey }) {
        const headers = { Authorization: "Token " + apiKey };
        const projects = await getJson("https://api.deepgram.com/v1/projects", headers);
        if (!projects.ok) return httpError(projects.status, projects.body);
        const project = (projects.body?.projects || [])[0];
        if (!project?.project_id) return { ok: true, reports: [{ label: "Deepgram", plan: null, metrics: [], notes: ["No project found for this key."] }] };
        const balances = await getJson("https://api.deepgram.com/v1/projects/" + encodeURIComponent(project.project_id) + "/balances", headers);
        if (!balances.ok) return httpError(balances.status, balances.body);
        const metrics = (balances.body?.balances || []).filter((b) => num(b.amount) != null).map((b, i) => ({ key: "balance" + (i ? "-" + i : ""), label: "Credit balance", remaining: num(b.amount), unit: String(b.units || "usd").toUpperCase(), kind: "balance" }));
        return { ok: true, reports: [{ label: project.name || "Deepgram", plan: null, metrics, notes: [] }] };
      }
    }
  };
}

module.exports = { makeProviders, isPrivateHost, mongoHosts, mongoDbName };
