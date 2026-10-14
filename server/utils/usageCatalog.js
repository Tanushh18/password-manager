/*
 * Pure: works out which external services a deployed project uses from its environment variables, groups the
 * variables, and masks them for display. No I/O. Secrets and credentials in URLs are NEVER part of any output.
 */

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|CREDENTIAL|PRIVATE|SESSION|SALT|HASH|AUTH|COOKIE|CERT|DSN|SID|SIGNATURE|CA_BASE64)/i;
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i;
const TOKEN_LIKE = /^[A-Za-z0-9+/=_-]{20,}$/;
const MAX_CONFIG_DISPLAY = 80;

/** How a variable is shown. Secrets are only ever reported as "set". */
function classifyVar(name, value) {
  const text = typeof value === "string" ? value : "";
  if (!text.trim()) return { name, kind: "empty", set: false, display: null };
  if (URL_VALUE.test(text.trim())) {
    try {
      const url = new URL(text.trim());
      // Credentials and query strings are dropped; secret-ish or webhook URLs keep the host only.
      const hostOnly = SECRET_NAME.test(name) || /WEBHOOK/i.test(name);
      const path = hostOnly || url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
      return { name, kind: "url", set: true, hasCredentials: Boolean(url.username || url.password), display: url.protocol + "//" + url.host + path };
    } catch { return { name, kind: "secret", set: true, display: null }; }
  }
  if (SECRET_NAME.test(name) || (TOKEN_LIKE.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text))) return { name, kind: "secret", set: true, display: null };
  if (text.length <= MAX_CONFIG_DISPLAY && !/[\r\n]/.test(text)) return { name, kind: "config", set: true, display: text };
  return { name, kind: "secret", set: true, display: null };
}

const consoleLink = {
  mongodb: "https://cloud.mongodb.com", cloudinary: "https://console.cloudinary.com", brevo: "https://app.brevo.com",
  twilio: "https://console.twilio.com", deepgram: "https://console.deepgram.com", groq: "https://console.groq.com",
  openai: "https://platform.openai.com/usage", anthropic: "https://console.anthropic.com", gemini: "https://aistudio.google.com",
  firebase: "https://console.firebase.google.com", telegram: "https://t.me/BotFather", turso: "https://turso.tech/app",
  redis: "https://console.upstash.com", postgres: "https://dashboard.render.com", pinecone: "https://app.pinecone.io",
  sentry: "https://sentry.io", assemblyai: "https://www.assemblyai.com/app", livekit: "https://cloud.livekit.io",
  github: "https://github.com/settings/tokens", stripe: "https://dashboard.stripe.com", supabase: "https://supabase.com/dashboard"
};

/* Order matters: the first provider whose pattern matches a variable name owns it. */
const PROVIDERS = [
  { key: "mongodb", label: "MongoDB", category: "Database", vars: /^(MONGO(DB)?(_[A-Z0-9_]+)?|MONGO_?DB_?URL|DB_URI|DATABASE)$/i },
  { key: "turso", label: "Turso (libSQL)", category: "Database", vars: /^(TURSO|LIBSQL)[A-Z0-9_]*$/i },
  { key: "redis", label: "Redis / Upstash", category: "Database", vars: /^(REDIS|UPSTASH)[A-Z0-9_]*$/i },
  { key: "pinecone", label: "Pinecone", category: "Database", vars: /^PINECONE[A-Z0-9_]*$/i },
  { key: "elasticsearch", label: "Elasticsearch", category: "Database", vars: /^ELASTIC(SEARCH)?[A-Z0-9_]*$/i },
  { key: "supabase", label: "Supabase", category: "Database", vars: /^(NEXT_PUBLIC_)?SUPABASE[A-Z0-9_]*$/i },
  { key: "firebase", label: "Firebase / FCM", category: "Database", vars: /^((REACT_APP|EXPO_PUBLIC|VITE|NEXT_PUBLIC)_)?(FIREBASE|FCM)[A-Z0-9_]*$|^GOOGLE_APPLICATION_CREDENTIALS$/i },
  { key: "cloudinary", label: "Cloudinary", category: "Media", vars: /^(CLOUDINARY[A-Z0-9_]*|CLOUD_NAME)$/i },
  { key: "twilio", label: "Twilio", category: "SMS / Voice", vars: /^TWILIO[A-Z0-9_]*$/i },
  { key: "sms", label: "SMS gateway", category: "SMS / Voice", vars: /^(SMS|MSG91|FAST2SMS|EXOTEL|VONAGE|NEXMO|PLIVO)[A-Z0-9_]*$/i },
  { key: "deepgram", label: "Deepgram", category: "Voice / speech", vars: /^DEEPGRAM[A-Z0-9_]*$/i },
  { key: "assemblyai", label: "AssemblyAI", category: "Voice / speech", vars: /^ASSEMBLYAI[A-Z0-9_]*$/i },
  { key: "cartesia", label: "Cartesia", category: "Voice / speech", vars: /^CARTESIA[A-Z0-9_]*$/i },
  { key: "livekit", label: "LiveKit", category: "Realtime", vars: /^LIVEKIT[A-Z0-9_]*$/i },
  { key: "brevo", label: "Brevo", category: "Email", vars: /^(BREVO|SENDINBLUE)[A-Z0-9_]*$/i },
  { key: "email", label: "Email (SMTP / API)", category: "Email", vars: /^(SMTP|MAIL|IMAP|GMAIL|SENDGRID|RESEND|MAILGUN|POSTMARK)[A-Z0-9_]*$|^EMAIL(_(USER|PASS|HOST|PORT|FROM|SERVICE)[A-Z0-9_]*)?$/i },
  { key: "telegram", label: "Telegram", category: "Messaging", vars: /^(TELEGRAM[A-Z0-9_]*|TG_[A-Z0-9_]+|BOT_TOKEN)$/i },
  { key: "groq", label: "Groq", category: "AI", vars: /^GROQ[A-Z0-9_]*$/i },
  { key: "openai", label: "OpenAI", category: "AI", vars: /^OPENAI[A-Z0-9_]*$/i },
  { key: "anthropic", label: "Anthropic (Claude)", category: "AI", vars: /^(ANTHROPIC|CLAUDE)[A-Z0-9_]*$/i },
  { key: "gemini", label: "Google Gemini", category: "AI", vars: /^(GEMINI|GENAI|GOOGLE_API_KEY)[A-Z0-9_]*$/i },
  { key: "ai-other", label: "Other AI (Cohere / Fireworks / Ollama / Hugging Face)", category: "AI", vars: /^(COHERE|FIREWORKS|HF|HUGGINGFACE|REPLICATE|OLLAMA|LANGCHAIN|LANGSMITH)[A-Z0-9_]*$/i },
  { key: "rapidapi", label: "RapidAPI / Judge0", category: "APIs", vars: /^(RAPIDAPI|JUDGE0)[A-Z0-9_]*$/i },
  { key: "google", label: "Google APIs (OAuth / Drive / Sheets)", category: "APIs", vars: /^(GOOGLE_(CLIENT|REDIRECT|REFRESH|DRIVE|SHEET)[A-Z0-9_]*|SERVICE_ACCOUNT[A-Z0-9_]*)$/i },
  { key: "payments", label: "Payments", category: "APIs", vars: /^(STRIPE|RAZORPAY|CASHFREE|PAYPAL)[A-Z0-9_]*$/i },
  { key: "sentry", label: "Sentry", category: "Monitoring", vars: /^SENTRY[A-Z0-9_]*$/i },
  { key: "affiliate", label: "Affiliate / data APIs", category: "APIs", vars: /^(CUELINK|BUYHATKE|GNEWS|LOCATIONIQ|AFFILIATE)[A-Z0-9_]*$/i },
  { key: "github", label: "GitHub", category: "DevOps", vars: /^GITHUB[A-Z0-9_]*$/i },
  { key: "render", label: "Render (platform)", category: "DevOps", vars: /^RENDER[A-Z0-9_]*$/i },
  { key: "expo", label: "Expo / EAS", category: "DevOps", vars: /^(EXPO|EAS|OTA)[A-Z0-9_]*$/i }
];

/** Variables that are app internals, not external services. Shown in one collapsed group. */
const INTERNAL = /^(PORT|NODE_ENV|NODE_VERSION|PYTHON_VERSION|HOST|BASE_URL|SELF_URL|PUBLIC_URL|CORS[A-Z0-9_]*|ALLOWED_ORIGINS?|CLIENT_ORIGINS?|LOG_LEVEL|DEBUG|TZ|LANG|JWT[A-Z0-9_]*|SECRET_KEY|CRYPTO_SECRET_KEY|HASH_KEY|SESSION[A-Z0-9_]*|COOKIE[A-Z0-9_]*|ACCESS_TOKEN[A-Z0-9_]*|REFRESH_TOKEN[A-Z0-9_]*|ADMIN[A-Z0-9_]*|KEEP_?ALIVE[A-Z0-9_]*|RATE_LIMIT[A-Z0-9_]*|REGISTRY[A-Z0-9_]*)$/i;

const NUMBERISH = /^\s*\d+(\.\d+)?\s*$/;
const LIMIT_NAME = /(LIMIT|MAX|CAP|QUOTA|RPD|RPM|TPD|TPM|BUDGET)/i;

function ownerOf(name, values) {
  const text = typeof values.get(name) === "string" ? values.get(name).trim() : "";
  if (/^DATABASE_URL$/i.test(name)) {
    if (/^postgres(ql)?:/i.test(text)) return "postgres";
    if (/^mysql/i.test(text)) return "mysql";
    if (/^mongodb/i.test(text)) return "mongodb";
    return "database";
  }
  for (const p of PROVIDERS) if (p.vars.test(name)) return p.key;
  return null;
}

const lookup = (values, ...patterns) => {
  for (const [name, value] of values) for (const p of patterns) if (p.test(name) && typeof value === "string" && value.trim()) return { name, value: value.trim() };
  return null;
};

/** Cloudinary can be configured as several accounts (e.g. CLOUDINARY_CLOUD_NAME and CLOUDINARY_CLOUD_NAME_shine). */
function cloudinarySets(values) {
  const sets = new Map();
  const part = /^(?:cloudinary[_-]?)?(cloud[_-]?name|name|api[_-]?key|api[_-]?secret)(?:[_-]([a-z0-9]+))?$/i;
  for (const [name, value] of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (/^CLOUDINARY_URL(_[A-Z0-9]+)?$/i.test(name)) {
      try { const u = new URL(value.trim()); if (u.protocol === "cloudinary:") sets.set(name, { label: name, cloudName: u.hostname, apiKey: decodeURIComponent(u.username), apiSecret: decodeURIComponent(u.password) }); } catch { /* ignore */ }
      continue;
    }
    if (!/^(CLOUDINARY|CLOUD_NAME|API_KEY|API_SECRET)/i.test(name)) continue;
    const m = part.exec(name);
    if (!m) continue;
    const kind = m[1].toLowerCase().replace(/[_-]/g, "");
    const suffix = (m[2] || "").toLowerCase();
    const set = sets.get(suffix) || { label: suffix || "default" };
    if (kind === "cloudname" || kind === "name") set.cloudName = value.trim();
    else if (kind === "apikey") set.apiKey = value.trim();
    else if (kind === "apisecret") set.apiSecret = value.trim();
    sets.set(suffix, set);
  }
  return [...sets.values()].filter((s) => s.cloudName && s.apiKey && s.apiSecret);
}

const CREDENTIALS = {
  mongodb: (values) => {
    const hit = [...values].find(([name, value]) => PROVIDERS[0].vars.test(name) && /^mongodb(\+srv)?:\/\//i.test(String(value).trim()));
    return hit ? { uri: String(hit[1]).trim(), varName: hit[0] } : null;
  },
  cloudinary: (values) => { const sets = cloudinarySets(values); return sets.length ? { sets } : null; },
  brevo: (values) => { const k = lookup(values, /^(BREVO|SENDINBLUE)_API_KEY$/i); return k ? { apiKey: k.value } : null; },
  deepgram: (values) => { const k = lookup(values, /^DEEPGRAM_API_KEY$/i); return k ? { apiKey: k.value } : null; },
  twilio: (values) => {
    const sid = lookup(values, /^TWILIO_ACCOUNT_SID$/i);
    if (!sid) return null;
    const token = lookup(values, /^TWILIO_AUTH_TOKEN$/i);
    if (token) return { accountSid: sid.value, user: sid.value, pass: token.value };
    const keySid = lookup(values, /^TWILIO_API_KEY(_SID)?$/i), keySecret = lookup(values, /^TWILIO_API_KEY_SECRET$/i);
    return keySid && keySecret ? { accountSid: sid.value, user: keySid.value, pass: keySecret.value } : null;
  }
};

/**
 * values: Map(name -> value). Returns { services, internal, other, unassigned } with masked variables only,
 * plus `credentials` (kept separate, for server-side use ONLY and never serialised to a client).
 */
function detectServices(values) {
  const map = values instanceof Map ? values : new Map(Object.entries(values || {}));
  // Bare API_KEY / API_SECRET only mean Cloudinary when CLOUD_NAME is also present.
  const hasCloudName = [...map.keys()].some((n) => /^CLOUD_NAME$/i.test(n));
  const groups = new Map();
  const internal = [];
  const other = [];
  for (const [name, value] of map) {
    let owner = ownerOf(name, map);
    if (!owner && hasCloudName && /^API_(KEY|SECRET)$/i.test(name)) owner = "cloudinary";
    if (!owner && INTERNAL.test(name)) { internal.push(classifyVar(name, value)); continue; }
    if (!owner) { other.push(classifyVar(name, value)); continue; }
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push({ ...classifyVar(name, value), _raw: value });
  }
  const services = [];
  for (const [owner, vars] of groups) {
    const def = PROVIDERS.find((p) => p.key === owner) || ({ postgres: { label: "PostgreSQL", category: "Database" }, mysql: { label: "MySQL", category: "Database" }, database: { label: "Database", category: "Database" } })[owner] || { label: owner, category: "Other" };
    const limits = vars.filter((v) => LIMIT_NAME.test(v.name) && NUMBERISH.test(String(v._raw))).map((v) => ({ name: v.name, value: Number(String(v._raw).trim()) }));
    const creds = CREDENTIALS[owner] ? CREDENTIALS[owner](map) : null;
    services.push({
      key: owner, label: def.label, category: def.category, console: consoleLink[owner] || null,
      vars: vars.map(({ _raw, ...safe }) => safe), configuredLimits: limits,
      hasCredentials: Boolean(creds), credentials: creds
    });
  }
  const order = ["Database", "Media", "SMS / Voice", "Voice / speech", "Email", "Messaging", "AI", "Realtime", "APIs", "Monitoring", "DevOps", "Other"];
  services.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.label.localeCompare(b.label));
  return { services, internal, other };
}

/** Removes server-only credentials before anything is sent to a client. */
function publicService(service) {
  const { credentials, ...rest } = service;
  return rest;
}

module.exports = { detectServices, classifyVar, cloudinarySets, publicService, PROVIDERS, SECRET_NAME, LIMIT_NAME };
