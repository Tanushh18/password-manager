const net = require("net");
const tls = require("tls");
const dns = require("dns").promises;
const { signGet } = require("./awsSigV4");
const { monthPeriod } = require("./usageProjection");

/*
 * More read-only usage readers: PostgreSQL, MySQL, Redis (native and Upstash REST), Turso, Pinecone, Elasticsearch,
 * S3 / Cloudflare R2, SendGrid, ElevenLabs and Vonage. Same rules as usageProviders: only reads, a timeout on every call,
 * only publicly reachable hosts, and never any credential or response body in a result or an error.
 */
const MB = 1024 * 1024;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => { const n = typeof v === "string" ? Number(v) : v; return isNum(n) ? n : null; };
const limitBytes = (settings, key) => { const mb = num(settings?.limitsMb?.[key]); return mb && mb > 0 ? mb * MB : null; };
const planNote = (label, limit) => label + (limit ? " · limit " + Math.round(limit / MB) + " MB (your setting)" : " · set a storage limit in Settings to see a percentage");

/* ---------------- a tiny Redis (RESP) client: AUTH + INFO + DBSIZE, nothing else ---------------- */
function respEncode(args) { return "*" + args.length + "\r\n" + args.map((a) => "$" + Buffer.byteLength(String(a)) + "\r\n" + a + "\r\n").join(""); }

/** Parses up to `count` replies from a buffer; returns { replies, rest } or null while incomplete. */
function respParse(buffer, count) {
  const replies = [];
  let at = 0;
  const line = () => { const end = buffer.indexOf("\r\n", at); if (end < 0) return null; const text = buffer.toString("utf8", at, end); at = end + 2; return text; };
  while (replies.length < count) {
    const start = at;
    const head = line();
    if (head === null) return null;
    const type = head[0], rest = head.slice(1);
    if (type === "+") replies.push(rest);
    else if (type === "-") replies.push(new Error(rest));
    else if (type === ":") replies.push(Number(rest));
    else if (type === "$") {
      const len = Number(rest);
      if (len < 0) replies.push(null);
      else { if (buffer.length < at + len + 2) { at = start; return null; } replies.push(buffer.toString("utf8", at, at + len)); at += len + 2; }
    } else replies.push(new Error("Unexpected reply"));
  }
  return { replies, rest: buffer.subarray(at) };
}

function redisCall({ host, port, useTls, username, password }, commands, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const all = [...(password ? [username ? ["AUTH", username, password] : ["AUTH", password]] : []), ...commands];
    const socket = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buffer = Buffer.alloc(0);
    const finish = (error, value) => { socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(timeoutMs, () => finish(new Error("timeout")));
    socket.on("error", (error) => finish(error));
    socket.on(useTls ? "secureConnect" : "connect", () => socket.write(all.map(respEncode).join("")));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = respParse(buffer, all.length);
      if (parsed) finish(null, parsed.replies.slice(all.length - commands.length));
    });
  });
}

const parseInfo = (text) => Object.fromEntries(String(text || "").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf(":"); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)]; }));

/* ---------------- S3 listing (approximate: the first pages of objects) ---------------- */
const MAX_PAGES = 5;
function parseListing(xml) {
  const sizes = [...String(xml).matchAll(/<Size>(\d+)<\/Size>/g)].map((m) => Number(m[1]));
  return {
    count: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0),
    truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    next: (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml) || [])[1] || ""
  };
}

function makeMoreProviders({ fetchImpl, getJson, fail, httpError, isPrivateHost, drivers = {}, now = () => new Date(), timeoutMs = 10000 }) {
  const Pg = drivers.Pg, mysqlCreate = drivers.mysqlCreate, redis = drivers.redisCall || redisCall;
  // Public by name AND by what the name resolves to (a public-looking name must not point at an internal address).
  const lookup = drivers.lookup || ((host) => dns.lookup(host, { all: true }));
  const publicHost = async (host) => {
    if (!host || isPrivateHost(host)) return false;
    if (net.isIP(host)) return true;
    try { return !(await lookup(host)).some((a) => isPrivateHost(a.address)); } catch { return true; } // unresolvable: the connection itself will fail normally
  };

  const post = async (url, headers, body) => {
    try {
      const response = await fetchImpl(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
    } catch { return { ok: false, status: 0, body: null, network: true }; }
  };

  return {
    postgres: {
      async run({ uri }, { settings = {} } = {}) {
        if (!Pg) return fail("unsupported", "The PostgreSQL driver is not available on this server.");
        let url;
        try { url = new URL(uri); } catch { return fail("unsupported", "The connection string could not be read."); }
        if (!(await publicHost(url.hostname))) return fail("blocked", "Stashr only reads usage from publicly reachable databases.");
        const mode = (url.searchParams.get("sslmode") || "").toLowerCase();
        const base = { host: url.hostname, port: Number(url.port) || 5432, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres", connectionTimeoutMillis: 8000, statement_timeout: 8000, query_timeout: 9000 };
        const attempts = mode === "disable" ? [false] : [{ rejectUnauthorized: true }, { rejectUnauthorized: false }];
        let lastError = null, unverified = false;
        for (const ssl of attempts) {
          const client = new Pg({ ...base, ssl });
          client.on?.("error", () => {});
          try {
            await client.connect();
            const r = await client.query("SELECT pg_database_size(current_database())::bigint AS size, current_database() AS name, (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS conns, current_setting('max_connections')::int AS max_conns, version() AS version");
            const row = r.rows[0] || {};
            const limit = limitBytes(settings, "postgres");
            const metrics = [{ key: "db-storage", label: "Database “" + row.name + "” size", used: num(row.size) || 0, limit, unit: "bytes", limitAssumed: Boolean(limit) }];
            if (num(row.max_conns)) metrics.push({ key: "connections", label: "Connections", used: num(row.conns) || 0, limit: num(row.max_conns), unit: "count" });
            const major = /PostgreSQL (\d+)/.exec(row.version || "")?.[1];
            return { ok: true, reports: [{ label: row.name, plan: planNote("PostgreSQL" + (major ? " " + major : ""), limit), metrics, notes: unverified ? ["The server’s TLS certificate could not be verified."] : [] }] };
          } catch (error) {
            lastError = error;
            if (/self.signed|certificate|unable to verify|issuer/i.test(String(error?.message)) && ssl && ssl.rejectUnauthorized) { unverified = true; continue; }
            break;
          } finally { try { await client.end(); } catch { /* ignore */ } }
        }
        if (lastError?.code === "28P01" || lastError?.code === "28000" || /password authentication|authentication failed/i.test(String(lastError?.message))) return fail("auth", "PostgreSQL rejected the credentials.");
        return fail("unavailable", "Could not connect to PostgreSQL to read usage.");
      }
    },

    mysql: {
      async run({ uri }, { settings = {} } = {}) {
        if (!mysqlCreate) return fail("unsupported", "The MySQL driver is not available on this server.");
        let url;
        try { url = new URL(uri.replace(/^mariadb:/i, "mysql:").replace(/^mysql2:/i, "mysql:")); } catch { return fail("unsupported", "The connection string could not be read."); }
        if (!(await publicHost(url.hostname))) return fail("blocked", "Stashr only reads usage from publicly reachable databases.");
        const base = { host: url.hostname, port: Number(url.port) || 3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined, connectTimeout: 8000 };
        let lastError = null;
        for (const ssl of [{ rejectUnauthorized: true }, { rejectUnauthorized: false }, undefined]) {
          let connection;
          try {
            connection = await mysqlCreate({ ...base, ssl });
            const [size] = await connection.query("SELECT COALESCE(SUM(data_length + index_length), 0) AS size, DATABASE() AS name FROM information_schema.tables WHERE table_schema = DATABASE()");
            const [threads] = await connection.query("SHOW STATUS LIKE 'Threads_connected'");
            const [maxConn] = await connection.query("SHOW VARIABLES LIKE 'max_connections'");
            const limit = limitBytes(settings, "mysql");
            const name = size[0]?.name || base.database || "database";
            const metrics = [{ key: "db-storage", label: "Database “" + name + "” size", used: num(size[0]?.size) || 0, limit, unit: "bytes", limitAssumed: Boolean(limit) }];
            if (num(maxConn[0]?.Value)) metrics.push({ key: "connections", label: "Connections", used: num(threads[0]?.Value) || 0, limit: num(maxConn[0]?.Value), unit: "count" });
            return { ok: true, reports: [{ label: name, plan: planNote("MySQL", limit), metrics, notes: ssl && !ssl.rejectUnauthorized ? ["The server’s TLS certificate could not be verified."] : [] }] };
          } catch (error) {
            lastError = error;
            if (/self.signed|certificate|unable to verify|issuer|SSL|secure/i.test(String(error?.message))) continue;
            break;
          } finally { try { await connection?.end(); } catch { /* ignore */ } }
        }
        if (lastError?.code === "ER_ACCESS_DENIED_ERROR" || /access denied/i.test(String(lastError?.message))) return fail("auth", "MySQL rejected the credentials.");
        return fail("unavailable", "Could not connect to MySQL to read usage.");
      }
    },

    redis: {
      async run(creds, { settings = {} } = {}) {
        let infoText, keys;
        if (creds.restUrl) {
          let host; try { host = new URL(creds.restUrl).hostname; } catch { return fail("unsupported", "The REST URL could not be read."); }
          if (!(await publicHost(host))) return fail("blocked", "Stashr only reads usage from publicly reachable databases.");
          const headers = { Authorization: "Bearer " + creds.restToken };
          const [info, size] = await Promise.all([post(creds.restUrl, headers, ["INFO"]), post(creds.restUrl, headers, ["DBSIZE"])]);
          if (!info.ok) return httpError(info.status, info.body);
          infoText = info.body?.result; keys = num(size.body?.result);
        } else {
          let url; try { url = new URL(creds.uri); } catch { return fail("unsupported", "The connection string could not be read."); }
          if (!(await publicHost(url.hostname))) return fail("blocked", "Stashr only reads usage from publicly reachable databases.");
          try {
            const [info, size] = await redis({ host: url.hostname, port: Number(url.port) || 6379, useTls: url.protocol === "rediss:", username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }, [["INFO", "memory"], ["DBSIZE"]]);
            if (info instanceof Error) return /WRONGPASS|NOAUTH|invalid/i.test(info.message) ? fail("auth", "Redis rejected the credentials.") : fail("unavailable", "Redis could not read its statistics.");
            infoText = info; keys = num(size);
          } catch { return fail("unavailable", "Could not connect to Redis to read usage."); }
        }
        const i = parseInfo(infoText);
        const used = num(i.used_memory);
        if (used == null) return fail("unavailable", "Redis did not report its memory use.");
        const limit = num(i.maxmemory) > 0 ? num(i.maxmemory) : limitBytes(settings, "redis");
        const metrics = [{ key: "memory", label: "Memory used", used, limit, unit: "bytes", limitAssumed: !(num(i.maxmemory) > 0) && Boolean(limit) }];
        if (keys != null) metrics.push({ key: "keys", label: "Keys", used: keys, limit: null, unit: "count" });
        return { ok: true, reports: [{ label: "Redis", plan: i.redis_version ? "Redis " + i.redis_version + (num(i.maxmemory) > 0 ? "" : planNote("", limit)) : null, metrics, notes: [] }] };
      }
    },

    turso: {
      async run({ url, token }, { settings = {} } = {}) {
        let host; try { host = new URL(url).hostname; } catch { return fail("unsupported", "The database URL could not be read."); }
        if (!(await publicHost(host))) return fail("blocked", "Stashr only reads usage from publicly reachable databases.");
        const res = await post(url + "/v2/pipeline", { Authorization: "Bearer " + token }, { requests: [{ type: "execute", stmt: { sql: "PRAGMA page_count" } }, { type: "execute", stmt: { sql: "PRAGMA page_size" } }, { type: "close" }] });
        if (!res.ok) return httpError(res.status, res.body);
        const cell = (n) => num(res.body?.results?.[n]?.response?.result?.rows?.[0]?.[0]?.value);
        const pages = cell(0), size = cell(1);
        if (pages == null || size == null) return fail("unavailable", "Turso did not report the database size.");
        const limit = limitBytes(settings, "turso");
        return { ok: true, reports: [{ label: host.split(".")[0], plan: planNote("Turso", limit), metrics: [{ key: "db-storage", label: "Database size", used: pages * size, limit, unit: "bytes", limitAssumed: Boolean(limit) }], notes: [] }] };
      }
    },

    pinecone: {
      async run({ apiKey }) {
        const headers = { "Api-Key": apiKey, "X-Pinecone-API-Version": "2025-01" };
        const list = await getJson("https://api.pinecone.io/indexes", headers);
        if (!list.ok) return httpError(list.status, list.body);
        const reports = [];
        for (const index of (list.body?.indexes || []).slice(0, 5)) {
          if (!index?.host || !(await publicHost(index.host))) continue;
          const stats = await post("https://" + index.host + "/describe_index_stats", headers, {});
          const metrics = stats.ok && num(stats.body?.totalVectorCount) != null ? [{ key: "vectors", label: "Vectors", used: stats.body.totalVectorCount, limit: null, unit: "count" }] : [];
          reports.push({ label: String(index.name || "index"), plan: index.spec?.serverless ? "Serverless" : index.spec?.pod ? "Pod" : null, metrics, notes: stats.ok ? [] : ["Could not read this index’s statistics."] });
        }
        return { ok: true, reports: reports.length ? reports : [{ label: "Pinecone", plan: null, metrics: [], notes: ["No indexes found."] }] };
      }
    },

    elasticsearch: {
      async run({ url, auth }, { settings = {} } = {}) {
        let host; try { host = new URL(url).hostname; } catch { return fail("unsupported", "The Elasticsearch URL could not be read."); }
        if (!(await publicHost(host))) return fail("blocked", "Stashr only reads usage from publicly reachable hosts.");
        const res = await getJson(url + "/_cluster/stats", { Authorization: auth });
        if (!res.ok) return httpError(res.status, res.body);
        const limit = limitBytes(settings, "elasticsearch");
        const metrics = [];
        if (num(res.body?.indices?.store?.size_in_bytes) != null) metrics.push({ key: "storage", label: "Index storage", used: res.body.indices.store.size_in_bytes, limit, unit: "bytes", limitAssumed: Boolean(limit) });
        if (num(res.body?.indices?.docs?.count) != null) metrics.push({ key: "documents", label: "Documents", used: res.body.indices.docs.count, limit: null, unit: "count" });
        return { ok: true, reports: [{ label: String(res.body?.cluster_name || host), plan: planNote("Elasticsearch" + (res.body?.nodes?.versions?.[0] ? " " + res.body.nodes.versions[0] : ""), limit), metrics, notes: [] }] };
      }
    },

    aws: {
      async run({ accessKey, secretKey, bucket, region, endpoint, sessionToken }, { settings = {} } = {}) {
        let host, basePath;
        if (endpoint) { try { host = new URL(endpoint).host; } catch { return fail("unsupported", "The S3 endpoint could not be read."); } basePath = "/" + encodeURIComponent(bucket); }
        else if (/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) { host = bucket + ".s3." + region + ".amazonaws.com"; basePath = "/"; }
        else { host = "s3." + region + ".amazonaws.com"; basePath = "/" + encodeURIComponent(bucket); }
        if (!(await publicHost(host.split(":")[0]))) return fail("blocked", "Stashr only reads usage from publicly reachable hosts.");
        let count = 0, bytes = 0, truncated = false, token = "";
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const query = { "list-type": "2", "max-keys": "1000", ...(token ? { "continuation-token": token } : {}) };
          const signed = signGet({ host, path: basePath, query, region, accessKey, secretKey, sessionToken, date: now() });
          let response;
          try { response = await fetchImpl("https://" + host + basePath + "?" + signed.query, { headers: signed.headers, signal: AbortSignal.timeout(timeoutMs) }); }
          catch { return fail("unavailable", "The bucket could not be reached."); }
          const text = await response.text().catch(() => "");
          if (response.status === 403 || response.status === 401) return fail("auth", "The storage provider rejected this key (it may lack list permission on the bucket).");
          if (response.status === 404) return fail("unavailable", "The bucket was not found.");
          if (!response.ok) return fail("unavailable", "The storage provider returned an error (HTTP " + response.status + ").");
          const part = parseListing(text);
          count += part.count; bytes += part.bytes; truncated = part.truncated; token = part.next;
          if (!part.truncated || !token) break;
        }
        const limit = limitBytes(settings, "aws");
        const approx = truncated ? "Counted the first " + MAX_PAGES * 1000 + " objects only, so the real size is larger." : "";
        return { ok: true, reports: [{ label: bucket, plan: planNote(endpoint ? "S3-compatible storage" : "Amazon S3", limit), metrics: [
          { key: "storage", label: "Storage" + (truncated ? " (first " + MAX_PAGES * 1000 + " objects)" : ""), used: bytes, limit, unit: "bytes", limitAssumed: Boolean(limit) },
          { key: "objects", label: "Objects" + (truncated ? " (first " + MAX_PAGES * 1000 + ")" : ""), used: count, limit: null, unit: "count" }
        ], notes: approx ? [approx] : [] }] };
      }
    },

    sendgrid: {
      async run({ apiKey }) {
        const res = await getJson("https://api.sendgrid.com/v3/user/credits", { Authorization: "Bearer " + apiKey });
        if (!res.ok) return httpError(res.status, res.body);
        const b = res.body || {};
        const metrics = [];
        if (num(b.total) > 0) {
          const resets = b.next_reset ? Date.parse(b.next_reset) : NaN;
          const period = Number.isFinite(resets) ? { startsAt: new Date(resets - 30 * 86400000).toISOString(), resetsAt: new Date(resets).toISOString() } : monthPeriod(now());
          metrics.push({ key: "credits", label: "Email credits used", used: num(b.used) || 0, limit: num(b.total), unit: "emails", period });
        }
        return { ok: true, reports: [{ label: "SendGrid", plan: b.reset_frequency ? "Resets " + b.reset_frequency : null, metrics, notes: metrics.length ? [] : ["This plan has no credit allowance to track."] }] };
      }
    },

    elevenlabs: {
      async run({ apiKey }) {
        const res = await getJson("https://api.elevenlabs.io/v1/user/subscription", { "xi-api-key": apiKey });
        if (!res.ok) return httpError(res.status, res.body);
        const b = res.body || {};
        const resets = num(b.next_character_count_reset_unix);
        const period = resets ? { startsAt: new Date((resets - 30 * 86400) * 1000).toISOString(), resetsAt: new Date(resets * 1000).toISOString() } : monthPeriod(now());
        const metrics = [];
        if (num(b.character_limit) != null) metrics.push({ key: "characters", label: "Characters used", used: num(b.character_count) || 0, limit: num(b.character_limit), unit: "characters", period });
        return { ok: true, reports: [{ label: "ElevenLabs", plan: b.tier ? String(b.tier) : null, metrics, notes: [] }] };
      }
    },

    vonage: {
      async run({ apiKey, apiSecret }) {
        const res = await getJson("https://rest.nexmo.com/account/get-balance?api_key=" + encodeURIComponent(apiKey) + "&api_secret=" + encodeURIComponent(apiSecret), {});
        if (!res.ok) return httpError(res.status, res.body);
        const value = num(res.body?.value);
        return { ok: true, reports: [{ label: "Vonage", plan: null, metrics: value == null ? [] : [{ key: "balance", label: "Account balance", remaining: value, unit: "EUR", kind: "balance" }], notes: [] }] };
      }
    }
  };
}

module.exports = { makeMoreProviders, redisCall, respEncode, respParse, parseInfo, parseListing, limitBytes };
