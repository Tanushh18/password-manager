/*
 * Pure: ways to recognise an external service that do not depend on what a variable is called.
 *   1. the VALUE of a variable (an `sk-ant-` key, a `*.supabase.co` URL, a `cloudinary://` string, ...)
 *   2. the CODE of the app: which SDK packages it depends on, and which env variables the same file reads.
 * Nothing here does I/O. Values are only pattern-matched, never copied into any output.
 */

/* ---------------------------------------------------------------- 1. values */

const KEY_RULES = [
  [/^sk-ant-/, "anthropic"],
  [/^gsk_[A-Za-z0-9]{20,}/, "groq"],
  [/^sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}$|^sk-[A-Za-z0-9]{40,}$/, "openai"],
  [/^AIza[0-9A-Za-z_-]{30,}$/, "google"],
  [/^xox[abeprs]-/, "slack"],
  [/^xapp-\d-/, "slack"],
  [/^xkeysib-/, "brevo"],
  [/^SG\.[\w-]{16,}\.[\w-]{16,}$/, "sendgrid"],
  [/^AC[0-9a-f]{32}$/, "twilio"],
  [/^re_[A-Za-z0-9_]{20,}$/, "email"],
  [/^key-[0-9a-f]{32}$/, "email"],
  [/^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/, "payments"],
  [/^rzp_(?:live|test)_[A-Za-z0-9]{8,}/, "payments"],
  [/^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}$|^github_pat_[A-Za-z0-9_]{40,}$/, "github"],
  [/^rnd_[A-Za-z0-9]{20,}$/, "render"],
  [/^(?:hf|r8)_[A-Za-z0-9]{20,}$/, "ai-other"],
  [/^pcsk_[A-Za-z0-9_]{20,}/, "pinecone"],
  [/^\d{8,11}:[A-Za-z0-9_-]{35}$/, "telegram"],
  [/^lin_api_[A-Za-z0-9]{30,}$/, "saas"],
  [/^secret_[A-Za-z0-9]{40,}$|^ntn_[A-Za-z0-9]{30,}$/, "saas"],
  [/^glc_[A-Za-z0-9+/=]{30,}$|^NRAK-[A-Z0-9]{20,}$/, "observability"],
  [/^sntrys_[A-Za-z0-9+/=_-]{30,}$/, "sentry"],
  [/^vercel_blob_rw_/, "vercelblob"],
  [/^eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}$/, null] // a JWT: says nothing on its own
];

/* Host name -> provider. Matched against the host of any URL value. */
const HOST_RULES = [
  [/(^|\.)api\.openai\.com$|(^|\.)openai\.azure\.com$/, "openai"], [/(^|\.)api\.anthropic\.com$/, "anthropic"], [/(^|\.)api\.groq\.com$/, "groq"],
  [/(^|\.)generativelanguage\.googleapis\.com$/, "gemini"], [/(^|\.)supabase\.(co|com|in)$/, "supabase"],
  [/(^|\.)(mongodb\.net|mongodb\.com)$/, "mongodb"], [/(^|\.)(neon\.tech|cockroachlabs\.cloud|elephantsql\.com)$/, "postgres"],
  [/(^|\.)(planetscale\.com|psdb\.cloud|tidbcloud\.com)$/, "mysql"], [/(^|\.)(upstash\.io|redislabs\.com|redis-cloud\.com)$/, "redis"],
  [/(^|\.)turso\.io$/, "turso"], [/(^|\.)(cloudinary\.com)$/, "cloudinary"], [/(^|\.)imagekit\.io$/, "imagekit"],
  [/(^|\.)(firebaseio\.com|firebaseapp\.com|firebasestorage\.app|fcm\.googleapis\.com)$/, "firebase"],
  [/(^|\.)(sentry\.io|ingest\.sentry\.io)$/, "sentry"], [/(^|\.)hooks\.slack\.com$|(^|\.)slack\.com$/, "slack"],
  [/(^|\.)discord(app)?\.com$/, "discord"], [/(^|\.)api\.telegram\.org$/, "telegram"], [/(^|\.)api\.twilio\.com$/, "twilio"],
  [/(^|\.)api\.brevo\.com$|(^|\.)sendinblue\.com$/, "brevo"], [/(^|\.)api\.sendgrid\.com$/, "sendgrid"],
  [/(^|\.)api\.stripe\.com$/, "payments"], [/(^|\.)api\.razorpay\.com$/, "payments"], [/(^|\.)api\.pinecone\.io$|(^|\.)pinecone\.io$/, "pinecone"],
  [/(^|\.)(algolia\.net|algolianet\.com|algolia\.io)$/, "algolia"], [/(^|\.)deepgram\.com$/, "deepgram"], [/(^|\.)assemblyai\.com$/, "assemblyai"],
  [/(^|\.)elevenlabs\.io$/, "elevenlabs"], [/(^|\.)livekit\.cloud$/, "livekit"], [/(^|\.)clerk\.(accounts\.dev|com)$/, "clerk"],
  [/(^|\.)auth0\.com$/, "auth0"], [/(^|\.)(mailgun\.(org|net)|api\.resend\.com|postmarkapp\.com)$/, "email"],
  [/(^|\.)(r2\.cloudflarestorage\.com|cloudflare\.com)$/, "cloudflare"], [/(^|\.)amazonaws\.com$/, "aws"],
  [/(^|\.)(onesignal\.com|pusher\.com|ably\.io|ably\.com)$/, "push"], [/(^|\.)(posthog\.com|mixpanel\.com|amplitude\.com)$/, "analytics"],
  [/(^|\.)(api\.cohere\.(ai|com)|api\.mistral\.ai|api\.together\.xyz|openrouter\.ai|api\.perplexity\.ai|api-inference\.huggingface\.co|api\.replicate\.com|api\.deepseek\.com|api\.fireworks\.ai)$/, "ai-other"],
  [/(^|\.)api\.github\.com$/, "github"], [/(^|\.)onrender\.com$/, "render"]
];

const schemeOf = (text) => (/^cloudinary:\/\//i.test(text) ? "cloudinary" : null);

/** The provider a value points at, or null. `text` is never returned or logged. */
function valueOwner(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 8 || text.length > 2048) return null;
  const scheme = schemeOf(text);
  if (scheme) return scheme;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let host = "";
    try { host = new URL(text.replace(/^(mongodb\+srv|rediss?|postgres(?:ql)?|mysql2?|mariadb|libsql|amqps?):/i, "https:")).hostname.toLowerCase(); } catch { return null; }
    for (const [re, key] of HOST_RULES) if (re.test(host)) return key;
    return null;
  }
  if (/\s/.test(text)) return null;
  for (const [re, key] of KEY_RULES) if (re.test(text)) return key;
  return null;
}

/* ---------------------------------------------------------------- 2. code */

/* npm package (or exact name) -> provider key used by the catalog. */
const JS_PACKAGES = {
  cloudinary: "cloudinary", "next-cloudinary": "cloudinary", "multer-storage-cloudinary": "cloudinary", "cloudinary-react": "cloudinary",
  "@supabase/supabase-js": "supabase", "@supabase/ssr": "supabase", twilio: "twilio", "@vonage/server-sdk": "vonage", nexmo: "vonage",
  openai: "openai", "@anthropic-ai/sdk": "anthropic", "groq-sdk": "groq", "@google/generative-ai": "gemini", "@google/genai": "gemini",
  firebase: "firebase", "firebase-admin": "firebase", mongodb: "mongodb", mongoose: "mongodb", pg: "postgres", postgres: "postgres",
  "@neondatabase/serverless": "postgres", "pg-promise": "postgres", "@prisma/client": "db-other", mysql: "mysql", mysql2: "mysql",
  redis: "redis", ioredis: "redis", "@upstash/redis": "redis", "@libsql/client": "turso", "@pinecone-database/pinecone": "pinecone",
  "@elastic/elasticsearch": "elasticsearch", "aws-sdk": "aws", "@sendgrid/mail": "sendgrid", "@getbrevo/brevo": "brevo",
  "sib-api-v3-sdk": "brevo", "@sendinblue/client": "brevo", nodemailer: "email", resend: "email", "mailgun.js": "email", postmark: "email",
  "node-telegram-bot-api": "telegram", telegraf: "telegram", grammy: "telegram", stripe: "payments", razorpay: "payments",
  "@deepgram/sdk": "deepgram", assemblyai: "assemblyai", elevenlabs: "elevenlabs", "livekit-server-sdk": "livekit", "discord.js": "discord",
  algoliasearch: "algolia", imagekit: "imagekit", uploadthing: "uploadthing", "@vercel/blob": "vercelblob", pusher: "push", ably: "push",
  "onesignal-node": "push", "posthog-node": "analytics", mixpanel: "analytics", auth0: "auth0", "cohere-ai": "ai-other", replicate: "ai-other",
  langchain: "ai-other", "@langchain/core": "ai-other", "@notionhq/client": "saas", airtable: "saas", "@linear/sdk": "saas",
  "@sanity/client": "cms", contentful: "cms", "meilisearch": "search", typesense: "search", amqplib: "queue", kafkajs: "queue"
};
const JS_SCOPES = {
  "@cloudinary/": "cloudinary", "@sentry/": "sentry", "@clerk/": "clerk", "@slack/": "slack", "@livekit/": "livekit", "@elevenlabs/": "elevenlabs",
  "@octokit/": "github", "@aws-sdk/": "aws", "@paypal/": "payments", "@huggingface/": "ai-other", "@mistralai/": "ai-other",
  "@sendgrid/": "sendgrid", "@vonage/": "vonage", "@twilio/": "twilio", "@datadog/": "observability", "@onesignal/": "push"
};
/* pip package / import name -> provider key. Normalised to lower case with "_" for "-". */
const PY_PACKAGES = {
  cloudinary: "cloudinary", supabase: "supabase", twilio: "twilio", openai: "openai", anthropic: "anthropic", groq: "groq",
  "google_generativeai": "gemini", "google_genai": "gemini", firebase_admin: "firebase", pymongo: "mongodb", motor: "mongodb", mongoengine: "mongodb",
  psycopg2: "postgres", psycopg: "postgres", asyncpg: "postgres", redis: "redis", boto3: "aws", sendgrid: "sendgrid", sib_api_v3_sdk: "brevo",
  stripe: "payments", razorpay: "payments", sentry_sdk: "sentry", deepgram_sdk: "deepgram", deepgram: "deepgram", assemblyai: "assemblyai",
  elevenlabs: "elevenlabs", livekit: "livekit", python_telegram_bot: "telegram", telegram: "telegram", pytelegrambotapi: "telegram", telebot: "telegram",
  pinecone: "pinecone", pinecone_client: "pinecone", cohere: "ai-other", replicate: "ai-other", huggingface_hub: "ai-other", slack_sdk: "slack",
  slack_bolt: "slack", pymysql: "mysql", mysql_connector_python: "mysql", mysqlclient: "mysql", libsql_client: "turso", algoliasearch: "algolia"
};

const jsProvider = (name) => {
  if (JS_PACKAGES[name]) return JS_PACKAGES[name];
  for (const [scope, key] of Object.entries(JS_SCOPES)) if (name.startsWith(scope)) return key;
  return null;
};
const pyKey = (name) => String(name || "").toLowerCase().replace(/[-.]/g, "_");
const pyProvider = (name) => PY_PACKAGES[pyKey(name)] || null;

/** Package names a dependency manifest declares, mapped to providers: { providerKey: [package, ...] }. */
function parseManifest(fileName, text) {
  const out = {};
  const add = (key, pkg) => { if (key) (out[key] = out[key] || new Set()).add(pkg); };
  const base = String(fileName || "").split("/").pop().toLowerCase();
  try {
    if (base === "package.json") {
      const json = JSON.parse(text);
      for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
        for (const pkg of Object.keys(json[group] || {})) add(jsProvider(pkg), pkg);
    } else if (/^requirements.*\.txt$/.test(base)) {
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
        if (m && !/^\s*#/.test(line)) add(pyProvider(m[1]), m[1]);
      }
    } else if (base === "pyproject.toml" || base === "pipfile") {
      for (const m of text.matchAll(/["']?([A-Za-z0-9][A-Za-z0-9._-]{1,60})["']?\s*(?:=|[<>=!~;[]|["'])/g)) add(pyProvider(m[1]), m[1]);
    }
  } catch { /* a manifest that does not parse tells us nothing */ }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}

const ENV_JS = [/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g, /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /Deno\.env\.get\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g];
const ENV_PY = [/os\.environ(?:\.get)?\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, /os\.environ\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, /os\.getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g];

/** What one source file imports (as provider keys + package names) and which environment variables it reads. */
function parseSource(fileName, text) {
  const py = /\.py$/i.test(fileName);
  const packages = new Map(); // provider -> Set(package)
  const add = (key, pkg) => { if (key) { if (!packages.has(key)) packages.set(key, new Set()); packages.get(key).add(pkg); } };
  const env = new Set();
  if (py) {
    for (const m of text.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_.]*)/gm)) {
      const parts = m[1].split(".");
      add(pyProvider(parts.slice(0, 2).join("_")) || pyProvider(parts[0]), parts[0]);
    }
    for (const re of ENV_PY) for (const m of text.matchAll(re)) env.add(m[1]);
  } else {
    const specs = [...text.matchAll(/require\(\s*['"`]([^'"`]+)['"`]\s*\)/g), ...text.matchAll(/(?:from|import)\s*\(?\s*['"`]([^'"`]+)['"`]/g)];
    for (const m of specs) {
      const spec = m[1];
      if (/^[./]/.test(spec)) continue;
      const parts = spec.split("/");
      const pkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      add(jsProvider(pkg), pkg);
    }
    for (const re of ENV_JS) for (const m of text.matchAll(re)) env.add(m[1]);
    for (const m of text.matchAll(/\{([^{}]{1,600})\}\s*=\s*(?:process\.env|import\.meta\.env)/g))
      for (const part of m[1].split(",")) { const name = part.split(":")[0].split("=")[0].trim(); if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) env.add(name); }
  }
  return { packages, env: [...env].filter((n) => n.length <= 80) };
}

const tokensOf = (name) => String(name).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

/* Packages that say what a folder is: a server (framework) or a browser app. */
const SERVER_FRAMEWORKS = /^(express|fastify|koa|hapi|@hapi\/hapi|@nestjs\/core|restify|polka|hono|socket\.io|apollo-server|@apollo\/server|flask|fastapi|django|aiohttp|tornado|sanic|starlette|uvicorn|gunicorn|bottle)$/i;
const FRONTEND_FRAMEWORKS = /^(react|react-dom|vue|svelte|@angular\/core|vite|react-scripts|@vitejs\/plugin-react|webpack-dev-server|parcel|solid-js|preact|expo|react-native)$/i;

/** Frameworks a dependency manifest declares: { server: [..], frontend: [..], fullstack: [..] } (names only). */
function manifestRoles(fileName, text) {
  const out = { server: [], frontend: [], fullstack: [] };
  const names = [];
  const base = String(fileName || "").split("/").pop().toLowerCase();
  try {
    if (base === "package.json") {
      const json = JSON.parse(text);
      for (const g of ["dependencies", "devDependencies"]) names.push(...Object.keys(json[g] || {}));
    } else if (/^requirements.*\.txt$/.test(base)) {
      for (const line of text.split(/\r?\n/)) { const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line); if (m && !/^\s*#/.test(line)) names.push(m[1]); }
    } else if (base === "pyproject.toml" || base === "pipfile") {
      for (const m of text.matchAll(/["']?([A-Za-z0-9][A-Za-z0-9._-]{1,60})["']?\s*(?:=|[<>=!~;[]|["'])/g)) names.push(m[1]);
    }
  } catch { /* nothing to learn from a manifest that does not parse */ }
  for (const n of names) {
    if (/^(next|nuxt|@remix-run\/node|@sveltejs\/kit|astro)$/i.test(n)) out.fullstack.push(n);
    else if (SERVER_FRAMEWORKS.test(n)) out.server.push(n);
    else if (FRONTEND_FRAMEWORKS.test(n)) out.frontend.push(n);
  }
  return out;
}

/**
 * What one file tells us (pure, no text kept): the services its dependencies / imports name, the variables it
 * reads, which of those it ties to one service, and, for a manifest, what kind of app the folder is.
 */
function analyzeFile(path, text) {
  const name = String(path || "");
  const body = String(text || "");
  if (/(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|pipfile)$/i.test(name)) {
    return { path: name, manifest: true, deps: parseManifest(name, body), roles: manifestRoles(name, body), env: [], links: {} };
  }
  const { packages, env } = parseSource(name, body);
  const deps = {};
  for (const [key, pkgs] of packages) deps[key] = [...pkgs].sort();
  const links = {};
  if (packages.size && env.length) {
    const providers = [...packages.keys()];
    for (const n of env) {
      // One SDK in the file: its variables belong to it. Several: only when the name itself points at one of them.
      const target = providers.length === 1 ? providers[0] : providers.find((p) => tokensOf(n).some((t) => p.includes(t) || t.includes(p.replace(/-/g, ""))));
      if (target) links[n] = target;
    }
  }
  return { path: name, manifest: false, deps, roles: null, env, links };
}

/** Merges per-file results (any subset of a repository) into what the catalog needs. */
function combineFiles(results) {
  const deps = {};
  const votes = new Map(); // ENV_NAME -> Map(provider -> count)
  const envNames = new Set();
  const addDep = (key, pkgs) => { deps[key] = [...new Set([...(deps[key] || []), ...pkgs])].sort(); };
  for (const r of results) {
    for (const [key, pkgs] of Object.entries(r.deps || {})) addDep(key, pkgs);
    (r.env || []).forEach((n) => envNames.add(n));
    for (const [n, target] of Object.entries(r.links || {})) {
      if (!votes.has(n)) votes.set(n, new Map());
      votes.get(n).set(target, (votes.get(n).get(target) || 0) + 1);
    }
  }
  const envLinks = {};
  for (const [n, byProvider] of votes) {
    const ranked = [...byProvider].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue; // conflicting evidence: say nothing
    envLinks[n] = ranked[0][0];
  }
  return { deps, envLinks, envNames: [...envNames].sort().slice(0, 400) };
}

/**
 * files: [{ path, text }]. Returns
 *   deps:     { providerKey: [package, ...] }       every service the code depends on
 *   envLinks: { ENV_NAME: providerKey }              variables read in a file that imports exactly one service SDK
 *   envNames: [ENV_NAME, ...]                        every variable the code reads (names only)
 */
const analyzeCode = (files) => combineFiles(files.map((f) => analyzeFile(f.path, f.text)));

module.exports = { valueOwner, parseManifest, parseSource, analyzeFile, combineFiles, manifestRoles, analyzeCode, jsProvider, pyProvider, KEY_RULES, HOST_RULES };
