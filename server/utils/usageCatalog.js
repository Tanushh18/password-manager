/*
 * Pure: works out which external services a deployed project uses from its environment variables, groups the
 * variables, and masks them for display. No I/O. Secrets and credentials in URLs are NEVER part of any output.
 */

const { valueOwner } = require("./serviceSignals");

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
  github: "https://github.com/settings/tokens", stripe: "https://dashboard.stripe.com", supabase: "https://supabase.com/dashboard",
  mysql: "https://console.aiven.io", aws: "https://console.aws.amazon.com/s3", sendgrid: "https://app.sendgrid.com", vonage: "https://dashboard.nexmo.com",
  elevenlabs: "https://elevenlabs.io/app/subscription", elasticsearch: "https://cloud.elastic.co", imagekit: "https://imagekit.io/dashboard",
  uploadthing: "https://uploadthing.com/dashboard", vercelblob: "https://vercel.com/dashboard/stores", algolia: "https://dashboard.algolia.com", search: "https://cloud.meilisearch.com",
  queue: "https://customer.cloudamqp.com", slack: "https://api.slack.com/apps", discord: "https://discord.com/developers/applications", push: "https://dashboard.onesignal.com", observability: "https://app.datadoghq.com", cms: "https://www.sanity.io/manage", saas: "https://zapier.com/app/dashboard", platform: "https://vercel.com/dashboard", clerk: "https://dashboard.clerk.com", auth0: "https://manage.auth0.com", cloudflare: "https://dash.cloudflare.com", b2: "https://secure.backblaze.com/b2_buckets.htm"
};

/* Order matters: the first provider whose pattern matches a variable name owns it. */
const PROVIDERS = [
  { key: "mongodb", label: "MongoDB", category: "Database", vars: /^(MONGO(DB)?(_[A-Z0-9_]+)?|MONGO_?DB_?URL|DB_URI|DATABASE)$/i },
  { key: "postgres", label: "PostgreSQL", category: "Database", vars: /^(POSTGRES(QL)?|PG|NEON|COCKROACH(DB)?|PGHOST|PGUSER|PGPASSWORD|PGDATABASE)[A-Z0-9_]*$/i },
  { key: "mysql", label: "MySQL / MariaDB", category: "Database", vars: /^(MYSQL|MARIADB|PLANETSCALE|TIDB)[A-Z0-9_]*$/i },
  { key: "turso", label: "Turso (libSQL)", category: "Database", vars: /^(TURSO|LIBSQL)[A-Z0-9_]*$/i },
  { key: "redis", label: "Redis / Upstash", category: "Database", vars: /^(REDIS|UPSTASH)[A-Z0-9_]*$/i },
  { key: "pinecone", label: "Pinecone", category: "Database", vars: /^PINECONE[A-Z0-9_]*$/i },
  { key: "elasticsearch", label: "Elasticsearch", category: "Database", vars: /^ELASTIC(SEARCH)?[A-Z0-9_]*$/i },
  { key: "supabase", label: "Supabase", category: "Database", vars: /^(NEXT_PUBLIC_)?SUPABASE[A-Z0-9_]*$/i },
  { key: "firebase", label: "Firebase / FCM", category: "Database", vars: /^((REACT_APP|EXPO_PUBLIC|VITE|NEXT_PUBLIC)_)?(FIREBASE|FCM)[A-Z0-9_]*$|^GOOGLE_APPLICATION_CREDENTIALS$/i },
  { key: "imagekit", label: "ImageKit", category: "Media", vars: /^IMAGEKIT[A-Z0-9_]*$/i },
  { key: "uploadthing", label: "UploadThing", category: "Media", vars: /^UPLOADTHING[A-Z0-9_]*$/i },
  { key: "vercelblob", label: "Vercel Blob", category: "Media", vars: /^(BLOB_READ_WRITE_TOKEN|VERCEL_BLOB[A-Z0-9_]*)$/i },
  { key: "b2", label: "Backblaze B2 / Spaces / Wasabi", category: "Media", vars: /^(B2|BACKBLAZE|SPACES|DO_SPACES|WASABI)_[A-Z0-9_]+$/i },
  { key: "cloudinary", label: "Cloudinary", category: "Media", vars: /(^|_)CLOUDINARY(_|$)|^CLOUD_NAME(_[A-Z0-9_]+)?$/i },
  { key: "twilio", label: "Twilio", category: "SMS / Voice", vars: /^TWILIO[A-Z0-9_]*$/i },
  { key: "vonage", label: "Vonage (Nexmo)", category: "SMS / Voice", vars: /^(VONAGE|NEXMO)[A-Z0-9_]*$/i },
  { key: "sms", label: "SMS gateway", category: "SMS / Voice", vars: /^(SMS|MSG91|FAST2SMS|EXOTEL|PLIVO)[A-Z0-9_]*$/i },
  { key: "deepgram", label: "Deepgram", category: "Voice / speech", vars: /^DEEPGRAM[A-Z0-9_]*$/i },
  { key: "assemblyai", label: "AssemblyAI", category: "Voice / speech", vars: /^ASSEMBLYAI[A-Z0-9_]*$/i },
  { key: "cartesia", label: "Cartesia", category: "Voice / speech", vars: /^CARTESIA[A-Z0-9_]*$/i },
  { key: "livekit", label: "LiveKit", category: "Realtime", vars: /^LIVEKIT[A-Z0-9_]*$/i },
  { key: "brevo", label: "Brevo", category: "Email", vars: /^(BREVO|SENDINBLUE)[A-Z0-9_]*$/i },
  { key: "sendgrid", label: "SendGrid", category: "Email", vars: /^SENDGRID[A-Z0-9_]*$/i },
  { key: "email", label: "Email (SMTP / API)", category: "Email", vars: /^(SMTP|MAIL|IMAP|GMAIL|RESEND|MAILGUN|POSTMARK|MAILCHIMP|MAILERLITE|CONVERTKIT|KLAVIYO|LOOPS_|MANDRILL)[A-Z0-9_]*$|^EMAIL(_(USER|PASS|HOST|PORT|FROM|SERVICE)[A-Z0-9_]*)?$/i },
  { key: "telegram", label: "Telegram", category: "Messaging", vars: /^(TELEGRAM[A-Z0-9_]*|TG_[A-Z0-9_]+|BOT_TOKEN)$/i },
  { key: "groq", label: "Groq", category: "AI", vars: /^GROQ[A-Z0-9_]*$/i },
  { key: "openai", label: "OpenAI", category: "AI", vars: /^OPENAI[A-Z0-9_]*$/i },
  { key: "anthropic", label: "Anthropic (Claude)", category: "AI", vars: /^(ANTHROPIC|CLAUDE)[A-Z0-9_]*$/i },
  { key: "gemini", label: "Google Gemini", category: "AI", vars: /^(GEMINI|GENAI|GOOGLE_API_KEY)[A-Z0-9_]*$/i },
  { key: "ai-other", label: "Other AI (Cohere / Fireworks / Ollama / Hugging Face)", category: "AI", vars: /^(COHERE|FIREWORKS|HF|HUGGINGFACE|REPLICATE|OLLAMA|LANGCHAIN|LANGSMITH|MISTRAL|PERPLEXITY|DEEPSEEK|XAI|GROK|TOGETHER|OPENROUTER|AZURE_OPENAI|AI21|STABILITY|VOYAGE|REKA|LLAMA)[A-Z0-9_]*$/i },
  { key: "rapidapi", label: "RapidAPI / Judge0", category: "APIs", vars: /^(RAPIDAPI|JUDGE0)[A-Z0-9_]*$/i },
  { key: "google", label: "Google APIs (OAuth / Drive / Sheets)", category: "APIs", vars: /^(GOOGLE_(CLIENT|REDIRECT|REFRESH|DRIVE|SHEET)[A-Z0-9_]*|SERVICE_ACCOUNT[A-Z0-9_]*)$/i },
  { key: "payments", label: "Payments", category: "APIs", vars: /^(STRIPE|RAZORPAY|CASHFREE|PAYPAL|LEMON_?SQUEEZY|PADDLE|PLAID|SQUARE_(ACCESS|APPLICATION|LOCATION|ENV)|BRAINTREE|PAYU|PHONEPE|PAYTM|INSTAMOJO|CCAVENUE)[A-Z0-9_]*$/i },
  { key: "sentry", label: "Sentry", category: "Monitoring", vars: /^SENTRY[A-Z0-9_]*$/i },
  { key: "affiliate", label: "Affiliate / data APIs", category: "APIs", vars: /^(CUELINK|BUYHATKE|GNEWS|LOCATIONIQ|AFFILIATE)[A-Z0-9_]*$/i },
  { key: "aws", label: "AWS / S3", category: "Media", vars: /^(AWS|S3|R2)_[A-Z0-9_]+$/i },
  { key: "whatsapp", label: "WhatsApp", category: "Messaging", vars: /^(WHATSAPP|WA|META_WA|INTERAKT|GUPSHUP)_[A-Z0-9_]+$/i },
  { key: "elevenlabs", label: "ElevenLabs", category: "Voice / speech", vars: /^(ELEVENLABS|ELEVEN|XI)_[A-Z0-9_]+$/i },
  { key: "maps", label: "Maps (Google Maps / Mapbox)", category: "APIs", vars: /^((REACT_APP|EXPO_PUBLIC|VITE|NEXT_PUBLIC)_)?(GOOGLE_MAPS|MAPS|MAPBOX)[A-Z0-9_]*$/i },
  { key: "analytics", label: "Analytics (PostHog / Mixpanel / GA)", category: "Monitoring", vars: /^((REACT_APP|EXPO_PUBLIC|VITE|NEXT_PUBLIC)_)?(POSTHOG|MIXPANEL|GA_|GA4|AMPLITUDE)[A-Z0-9_]*$/i },
  { key: "algolia", label: "Algolia", category: "Database", vars: /^ALGOLIA[A-Z0-9_]*$/i },
  { key: "search", label: "Search (Meilisearch / Typesense)", category: "Database", vars: /^(MEILI(SEARCH)?|TYPESENSE)[A-Z0-9_]*$/i },
  { key: "queue", label: "Queues (RabbitMQ / Kafka / SQS)", category: "Realtime", vars: /^(AMQP|RABBITMQ|CLOUDAMQP|KAFKA|UPSTASH_KAFKA|SQS|PUBSUB|NATS|INNGEST|TRIGGER_(SECRET|API|PROJECT|DEV)|QSTASH|TEMPORAL|BULLMQ)[A-Z0-9_]*$/i },
  { key: "clerk", label: "Clerk", category: "Auth", vars: /^((NEXT_PUBLIC|VITE|REACT_APP)_)?CLERK[A-Z0-9_]*$/i },
  { key: "auth0", label: "Auth0", category: "Auth", vars: /^AUTH0[A-Z0-9_]*$/i },
  { key: "cloudflare", label: "Cloudflare", category: "DevOps", vars: /^CLOUDFLARE[A-Z0-9_]*$/i },
  { key: "slack", label: "Slack", category: "Messaging", vars: /^SLACK[A-Z0-9_]*$/i },
  { key: "discord", label: "Discord", category: "Messaging", vars: /^DISCORD[A-Z0-9_]*$/i },
  { key: "push", label: "Push & realtime (OneSignal / Pusher / Ably / Stream)", category: "Realtime", vars: /^(ONESIGNAL|PUSHER|ABLY|STREAM_(API|SECRET|KEY|APP)|GETSTREAM|SENDBIRD|VAPID|APNS|NOVU|KNOCK|COURIER|PUSHOVER)[A-Z0-9_]*$/i },
  { key: "video", label: "Video & meetings (Agora / Daily / Zoom / Mux)", category: "Realtime", vars: /^(AGORA|DAILY_(API|DOMAIN|ROOM|KEY)|ZOOM_(CLIENT|API|ACCOUNT|SDK|SECRET)|MUX|TWITCH|HMS_(ACCESS|APP|TEMPLATE|SECRET|MANAGEMENT)|100MS|VONAGE_VIDEO|JITSI)[A-Z0-9_]*$/i },
  { key: "cloud-storage", label: "Azure / Google Cloud storage", category: "Media", vars: /^(AZURE_(STORAGE|BLOB)|GCS|GCP|GOOGLE_CLOUD|GOOGLE_STORAGE|FIREBASE_STORAGE)[A-Z0-9_]*$/i },
  { key: "cdn", label: "CDN & file services (Uploadcare / Filestack / imgix / Bunny / Fastly)", category: "Media", vars: /^(UPLOADCARE|FILESTACK|IMGIX|BUNNY|FASTLY|CLOUDFRONT|CDN_)[A-Z0-9_]*$/i },
  { key: "db-other", label: "Other databases (Convex / Hasura / Neo4j / ClickHouse / Qdrant / Weaviate / ...)", category: "Database", vars: /^(HASURA|CONVEX|XATA|FAUNA|COUCH(DB|BASE)?|NEO4J|INFLUX(DB)?|CLICKHOUSE|SNOWFLAKE|BIGQUERY|DYNAMODB|QDRANT|WEAVIATE|CHROMA|ZILLIZ|CASSANDRA|SCYLLA|SURREAL(DB)?|APPWRITE|POCKETBASE|DIRECTUS|COCKROACH|TIDB|SINGLESTORE|DRIZZLE|PRISMA)[A-Z0-9_]*$/i },
  { key: "authlib", label: "Auth.js / NextAuth / Better Auth", category: "Auth", vars: /^(NEXTAUTH|AUTH_(SECRET|URL|TRUST_HOST|[A-Z0-9]+_(ID|SECRET))|BETTER_AUTH|STYTCH|WORKOS|KINDE|OKTA|COGNITO)[A-Z0-9_]*$/i },
  { key: "bot", label: "Bot protection (reCAPTCHA / Turnstile / hCaptcha)", category: "Auth", vars: /^((NEXT_PUBLIC|REACT_APP|VITE)_)?(RECAPTCHA|TURNSTILE|HCAPTCHA|ARCJET)[A-Z0-9_]*$/i },
  { key: "observability", label: "Logging & APM (Datadog / New Relic / Axiom / Bugsnag / ...)", category: "Monitoring", vars: /^(DATADOG|DD_(API|APP|SITE)|NEW_?RELIC|NEWRELIC|BUGSNAG|ROLLBAR|LOGROCKET|LOGTAIL|BETTERSTACK|AXIOM|HONEYCOMB|GRAFANA|LOKI|PAPERTRAIL|UPTIMEROBOT|OTEL_|HIGHLIGHT_(PROJECT|API)|APPSIGNAL)[A-Z0-9_]*$/i },
  { key: "cms", label: "Headless CMS (Sanity / Contentful / Strapi / Prismic)", category: "APIs", vars: /^((NEXT_PUBLIC|REACT_APP|VITE)_)?(SANITY|CONTENTFUL|STRAPI|STORYBLOK|PRISMIC|DATOCMS|HYGRAPH|GHOST_(API|CONTENT|ADMIN)|BUTTERCMS)[A-Z0-9_]*$/i },
  { key: "saas", label: "SaaS APIs (Notion / Airtable / Shopify / Linear / Jira / HubSpot / ...)", category: "APIs", vars: /^(NOTION|AIRTABLE|SHOPIFY|LINEAR_(API|TOKEN|KEY)|JIRA|ATLASSIAN|HUBSPOT|SALESFORCE|ZENDESK|INTERCOM|TYPEFORM|CALENDLY|ZAPIER|N8N|MAKE_(API|TOKEN|WEBHOOK)|WOOCOMMERCE|BIGCOMMERCE|SEGMENT_(WRITE|API|KEY)|CUSTOMERIO)[A-Z0-9_]*$/i },
  { key: "data-apis", label: "Data & media APIs (OpenWeather / News / TMDB / Unsplash / Spotify / YouTube)", category: "APIs", vars: /^(OPENWEATHER|NEWS_?API|TMDB|UNSPLASH|GIPHY|PEXELS|SPOTIFY|YOUTUBE|TWITTER|X_API|STRAVA|ALPHAVANTAGE|COINGECKO|FINNHUB|POLYGON)[A-Z0-9_]*$/i },
  { key: "platform", label: "Hosting platforms (Vercel / Netlify / GitLab / Fly / Railway / Heroku)", category: "DevOps", vars: /^(VERCEL|NETLIFY|GITLAB|BITBUCKET|FLY_|RAILWAY|HEROKU|DIGITALOCEAN|CIRCLECI|TRAVIS|DOCKER(HUB)?)[A-Z0-9_]*$/i },
  { key: "github", label: "GitHub", category: "DevOps", vars: /^GITHUB[A-Z0-9_]*$/i },
  { key: "render", label: "Render (platform)", category: "DevOps", vars: /^RENDER[A-Z0-9_]*$/i },
  { key: "expo", label: "Expo / EAS", category: "DevOps", vars: /^(EXPO|EAS|OTA)[A-Z0-9_]*$/i }
];

/** Variables that are app internals, not external services. Shown in one collapsed group. */
const INTERNAL = /^(PORT|NODE_ENV|NODE_VERSION|PYTHON_VERSION|HOST|BASE_URL|SELF_URL|PUBLIC_URL|CORS[A-Z0-9_]*|ALLOWED_ORIGINS?|CLIENT_ORIGINS?|LOG_LEVEL|DEBUG|TZ|LANG|JWT[A-Z0-9_]*|SECRET_KEY|CRYPTO_SECRET_KEY|HASH_KEY|SESSION[A-Z0-9_]*|COOKIE[A-Z0-9_]*|ACCESS_TOKEN[A-Z0-9_]*|REFRESH_TOKEN[A-Z0-9_]*|ADMIN[A-Z0-9_]*|KEEP_?ALIVE[A-Z0-9_]*|RATE_LIMIT[A-Z0-9_]*|REGISTRY[A-Z0-9_]*)$/i;

const NUMBERISH = /^\s*\d+(\.\d+)?\s*$/;
const LIMIT_NAME = /(LIMIT|MAX|CAP|QUOTA|RPD|RPM|TPD|TPM|BUDGET)/i;

/** A connection string says what it is by its scheme, whatever the variable is called (DB_URL, SUPABASE_DB_URL, ...). */
function schemeOwner(text) {
  if (/^mongodb(\+srv)?:\/\//i.test(text)) return "mongodb";
  if (/^postgres(ql)?:\/\//i.test(text)) return "postgres";
  if (/^(mysql2?|mariadb):\/\//i.test(text)) return "mysql";
  if (/^rediss?:\/\//i.test(text)) return "redis";
  if (/^libsql:\/\//i.test(text)) return "turso";
  return null;
}

/** Which service owns a variable, and how we know: its name, its value, or what the app's code does with it. */
function ownerInfo(name, values, hints) {
  const text = typeof values.get(name) === "string" ? values.get(name).trim() : "";
  const bySchema = schemeOwner(text);
  if (bySchema) return { owner: bySchema, via: "value" };
  if (/^DATABASE_URL$/i.test(name)) return { owner: "database", via: "name" };
  for (const p of PROVIDERS) if (p.vars.test(name)) return { owner: p.key, via: "name" };
  // The name says nothing: look at the value, then at the code that reads the variable.
  if (!INTERNAL.test(name)) {
    const byValue = valueOwner(text);
    if (byValue) return { owner: byValue, via: "value" };
    const byCode = hints?.envLinks?.[name];
    if (byCode) return { owner: byCode, via: "code" };
  }
  return { owner: null, via: null };
}
const ownerOf = (name, values, hints) => ownerInfo(name, values, hints).owner;

const lookup = (values, ...patterns) => {
  for (const [name, value] of values) for (const p of patterns) if (p.test(name) && typeof value === "string" && value.trim()) return { name, value: value.trim() };
  return null;
};

/** The first variable holding a connection string of this kind (server-side only: the value is never sent to a client). */
function dbUri(values, scheme) {
  const hit = [...values].find(([, value]) => typeof value === "string" && scheme.test(value.trim()));
  return hit ? { uri: String(hit[1]).trim(), varName: hit[0] } : null;
}

/* The hosting provider behind a connection string, from its host name (never from credentials). */
const HOST_LABELS = [[/neon\.tech$/, "Neon"], [/supabase\.(co|com)$/, "Supabase"], [/render\.com$/, "Render"], [/amazonaws\.com$/, "AWS RDS"], [/aivencloud\.com$/, "Aiven"], [/cockroachlabs\.cloud$/, "CockroachDB"], [/planetscale\.com$|psdb\.cloud$/, "PlanetScale"], [/railway\.app$|rlwy\.net$/, "Railway"], [/mongodb\.net$/, "Atlas"], [/upstash\.io$/, "Upstash"], [/redislabs\.com$|redis-cloud\.com$/, "Redis Cloud"], [/elephantsql\.com$/, "ElephantSQL"], [/digitalocean\.com$|ondigitalocean\.com$/, "DigitalOcean"], [/tidbcloud\.com$/, "TiDB Cloud"]];
const hostLabel = (uri) => { try { const host = new URL(uri.replace(/^mongodb\+srv:/i, "mongodb:").replace(/^(mysql2|mariadb|rediss?|postgres(ql)?|mongodb):/i, "http:")).hostname.toLowerCase(); return (HOST_LABELS.find(([re]) => re.test(host)) || [])[1] || ""; } catch { return ""; } };

/** Which Cloudinary part a variable name carries, and which account (group) it belongs to, whatever the naming style. */
function cloudinaryPart(name) {
  // NEXT_PUBLIC_ / VITE_ / REACT_APP_ ... only expose a variable to the browser; they are not an account name.
  const up = name.toUpperCase().replace(/-/g, "_").replace(/^(NEXT_PUBLIC|NUXT_PUBLIC|EXPO_PUBLIC|REACT_APP|VITE|PUBLIC)_/, "");
  const hasBrand = /(^|_)CLOUDINARY(_|$)/.test(up);
  const rest = up.replace(/(^|_)CLOUDINARY(?=_|$)/g, "_");
  const kinds = [["cloudname", /(^|_)CLOUD_?NAME(?=_|$)/], ["apikey", /(^|_)API_?KEY(?=_|$)/], ["apisecret", /(^|_)API_?SECRET(?=_|$)/], ["url", /(^|_)URL(?=_|$)/]];
  if (hasBrand) kinds.push(["cloudname", /(^|_)NAME(?=_|$)/], ["apikey", /(^|_)KEY(?=_|$)/], ["apisecret", /(^|_)SECRET(?=_|$)/]);
  for (const [kind, re] of kinds) {
    const m = re.exec(rest);
    if (!m) continue;
    const group = (rest.slice(0, m.index) + "_" + rest.slice(m.index + m[0].length)).replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
    if (kind === "url" && !hasBrand) return null;
    if (!hasBrand && !/^(cloudname|apikey|apisecret)$/.test(kind)) return null;
    return { kind, group };
  }
  return null;
}

/**
 * Cloudinary can be configured as several accounts (CLOUDINARY_CLOUD_NAME_shine, SHINE_CLOUDINARY_API_KEY,
 * CLOUDINARY_URL_2, ...). `incomplete` lists accounts whose variables are present but not enough to read usage.
 */
function cloudinaryAnalysis(values) {
  const sets = new Map();
  for (const [name, value] of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    let part = cloudinaryPart(name);
    // A cloudinary:// connection string is recognised by its value, under any variable name.
    if (!part && /^cloudinary:\/\//i.test(value.trim())) part = { kind: "url", group: name.toLowerCase().replace(/[^a-z0-9]+/g, "_") };
    if (!part) continue;
    const text = value.trim();
    const set = sets.get(part.group) || { label: part.group || "default" };
    if (part.kind === "url") {
      try { const u = new URL(text); if (u.protocol === "cloudinary:") Object.assign(set, { cloudName: u.hostname, apiKey: decodeURIComponent(u.username), apiSecret: decodeURIComponent(u.password), fromUrl: name }); } catch { /* ignore */ }
    } else if (part.kind === "cloudname") set.cloudName = text;
    else if (part.kind === "apikey") set.apiKey = text;
    else set.apiSecret = text;
    sets.set(part.group, set);
  }
  let all = [...sets.values()];
  // Parts of one account split over two groups (e.g. a cloud name under one naming style, key + secret under
  // another): when exactly two incomplete groups fill each other's gaps, they are one account.
  const partial = all.filter((s) => !(s.cloudName && s.apiKey && s.apiSecret));
  if (partial.length === 2) {
    const [a, b] = partial;
    const clash = ["cloudName", "apiKey", "apiSecret"].some((k) => a[k] && b[k]);
    if (!clash) {
      const merged = { label: a.label === "default" || b.label === "default" ? "default" : a.label, cloudName: a.cloudName || b.cloudName, apiKey: a.apiKey || b.apiKey, apiSecret: a.apiSecret || b.apiSecret };
      all = [...all.filter((s) => !partial.includes(s)), merged];
    }
  }
  const ready = all.filter((s) => s.cloudName && s.apiKey && s.apiSecret).map(({ fromUrl, ...s }) => s);
  const incomplete = all.filter((s) => !(s.cloudName && s.apiKey && s.apiSecret)).map((s) => ({ label: s.label, missing: [["Cloud Name", s.cloudName], ["API Key", s.apiKey], ["API Secret", s.apiSecret]].filter(([, v]) => !v).map(([n]) => n) }));
  return { sets: ready, incomplete };
}

const cloudinarySets = (values) => cloudinaryAnalysis(values).sets;

/* Providers whose usage needs only one API key: a key recognised by its value works under any variable name. */
const KEY_ONLY = new Set(["brevo", "sendgrid", "pinecone"]);

const CREDENTIALS = {
  mongodb: (values) => {
    return dbUri(values, /^mongodb(\+srv)?:\/\//i);
  },
  cloudinary: (values) => { const sets = cloudinarySets(values); return sets.length ? { sets } : null; },
  postgres: (values) => dbUri(values, /^postgres(ql)?:\/\//i),
  mysql: (values) => dbUri(values, /^(mysql2?|mariadb):\/\//i),
  redis: (values) => {
    const rest = lookup(values, /^(UPSTASH_REDIS_REST_URL|KV_REST_API_URL)$/i), token = lookup(values, /^(UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN)$/i);
    if (rest && token && /^https:\/\//i.test(rest.value)) return { restUrl: rest.value.replace(/\/+$/, ""), restToken: token.value };
    return dbUri(values, /^rediss?:\/\//i);
  },
  turso: (values) => {
    const url = lookup(values, /^(TURSO_DATABASE_URL|LIBSQL_URL|TURSO_URL)$/i), token = lookup(values, /^(TURSO_AUTH_TOKEN|LIBSQL_AUTH_TOKEN)$/i);
    return url && token ? { url: url.value.replace(/^libsql:/i, "https:").replace(/\/+$/, ""), token: token.value } : null;
  },
  pinecone: (values) => { const k = lookup(values, /^PINECONE_API_KEY$/i); return k ? { apiKey: k.value } : null; },
  elasticsearch: (values) => {
    const url = lookup(values, /^(ELASTIC(SEARCH)?_(URL|NODE|ENDPOINT|HOST))$/i);
    if (!url || !/^https:\/\//i.test(url.value)) return null;
    const key = lookup(values, /^ELASTIC(SEARCH)?_API_KEY$/i), user = lookup(values, /^ELASTIC(SEARCH)?_(USER(NAME)?)$/i), pass = lookup(values, /^ELASTIC(SEARCH)?_PASSWORD$/i);
    const auth = key ? "ApiKey " + key.value : user && pass ? "Basic " + Buffer.from(user.value + ":" + pass.value).toString("base64") : "";
    return auth ? { url: url.value.replace(/\/+$/, ""), auth } : null;
  },
  aws: (values) => {
    const access = lookup(values, /^(AWS_ACCESS_KEY_ID|AWS_ACCESS_KEY|S3_ACCESS_KEY(_ID)?|R2_ACCESS_KEY(_ID)?)$/i);
    const secret = lookup(values, /^(AWS_SECRET_ACCESS_KEY|AWS_SECRET_KEY|S3_SECRET(_ACCESS)?_KEY|R2_SECRET(_ACCESS)?_KEY)$/i);
    const bucket = lookup(values, /^(AWS_S3_BUCKET(_NAME)?|AWS_BUCKET(_NAME)?|S3_BUCKET(_NAME)?|R2_BUCKET(_NAME)?|BUCKET_NAME)$/i);
    if (!access || !secret || !bucket) return null;
    const r2Account = lookup(values, /^R2_ACCOUNT_ID$/i), endpoint = lookup(values, /^(S3_ENDPOINT|R2_ENDPOINT|AWS_ENDPOINT(_URL(_S3)?)?)$/i);
    const region = lookup(values, /^(AWS_REGION|AWS_DEFAULT_REGION|S3_REGION)$/i);
    const base = endpoint && /^https:\/\//i.test(endpoint.value) ? endpoint.value.replace(/\/+$/, "") : r2Account ? "https://" + r2Account.value + ".r2.cloudflarestorage.com" : "";
    return { accessKey: access.value, secretKey: secret.value, bucket: bucket.value, region: region?.value || (base ? "auto" : "us-east-1"), endpoint: base, sessionToken: lookup(values, /^AWS_SESSION_TOKEN$/i)?.value || "" };
  },
  sendgrid: (values) => { const k = lookup(values, /^SENDGRID_API_KEY$/i); return k ? { apiKey: k.value } : null; },
  elevenlabs: (values) => { const k = lookup(values, /^(ELEVENLABS_API_KEY|ELEVEN_API_KEY|XI_API_KEY)$/i); return k ? { apiKey: k.value } : null; },
  vonage: (values) => {
    const key = lookup(values, /^(VONAGE|NEXMO)_API_KEY$/i), secret = lookup(values, /^(VONAGE|NEXMO)_API_SECRET$/i);
    return key && secret ? { apiKey: key.value, apiSecret: secret.value } : null;
  },
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


/* Words that start many variable names without naming a service: never treated as a provider on their own. */
const GENERIC_PREFIX = new Set(["APP", "API", "DB", "DATABASE", "SERVER", "CLIENT", "USER", "SITE", "WEB", "MAX", "MIN", "DEFAULT", "ENABLE", "ENABLED", "DISABLE", "FEATURE", "FEATURES", "USE", "IS", "ALLOW", "ALLOWED", "NEXT", "REACT", "VITE", "EXPO", "PUBLIC", "SECRET", "KEY", "TOKEN", "URL", "HOST", "NODE", "NPM", "TEST", "DEV", "PROD", "LOCAL", "BASE", "MAIN", "SELF", "FRONTEND", "BACKEND", "ENV", "CONFIG", "CACHE", "TIMEOUT", "RETRY", "DEBUG", "VERBOSE", "LOG", "DATA", "FILE", "FILES", "UPLOAD", "STORAGE", "EMAIL", "PHONE", "ADMIN", "OWNER", "COMPANY", "PROJECT", "SERVICE", "SERVICES", "TIME", "DATE", "ORIGIN", "ORIGINS", "WEBHOOK", "CALLBACK", "REDIRECT", "VERSION", "BUILD", "SKIP", "NO", "NEW", "OLD", "AUTH", "ACCESS", "REFRESH", "RENDER", "PYTHON", "RUBY", "GO", "JAVA", "BUN", "DENO", "YARN", "PNPM", "POETRY", "PIP", "UV"]);
const CREDENTIAL_TAIL = /(KEY|TOKEN|SECRET|URI|URL|DSN|ENDPOINT|PASSWORD)$/i;
const FRAMEWORK_PREFIX = /^(REACT_APP|VITE|NEXT_PUBLIC|EXPO_PUBLIC|NUXT_PUBLIC|PUBLIC)_/i;

/** `FOO_API_KEY` -> "FOO"; null when the name does not look like it belongs to a named service. */
function autoPrefix(name) {
  const parts = name.replace(FRAMEWORK_PREFIX, "").toUpperCase().split("_").filter(Boolean);
  if (parts.length < 2) return null;
  const prefix = parts[0];
  if (prefix.length < 3 || prefix.length > 24 || !/^[A-Z][A-Z0-9]*$/.test(prefix) || GENERIC_PREFIX.has(prefix)) return null;
  return prefix;
}

const titleCase = (prefix) => prefix.charAt(0) + prefix.slice(1).toLowerCase();

/**
 * Variables no catalog entry claims are grouped by their name prefix into "auto-detected" services, so a brand-new
 * provider shows up in Services without any code change. A prefix needs at least one credential-looking variable (KEY / TOKEN / SECRET / URL / ...).
 */
function autoGroup(other) {
  const byPrefix = new Map();
  for (const v of other) {
    const prefix = autoPrefix(v.name);
    if (!prefix) continue;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(v);
  }
  const groups = new Map(), taken = new Set();
  for (const [prefix, vars] of byPrefix) {
    if (!vars.some((v) => CREDENTIAL_TAIL.test(v.name))) continue;
    groups.set("auto-" + prefix.toLowerCase(), vars);
    vars.forEach((v) => taken.add(v.name));
  }
  return { groups, taken };
}

/**
 * values: Map(name -> value). Returns { services, internal, other, unassigned } with masked variables only,
 * plus `credentials` (kept separate, for server-side use ONLY and never serialised to a client).
 */
function detectServices(values, { hints } = {}) {
  const map = values instanceof Map ? values : new Map(Object.entries(values || {}));
  // Bare API_KEY / API_SECRET only mean Cloudinary when CLOUD_NAME is also present.
  const hasCloudName = [...map.keys()].some((n) => /^CLOUD_NAME$/i.test(n));
  const groups = new Map();
  const internal = [];
  const other = [];
  for (const [name, value] of map) {
    let { owner, via } = ownerInfo(name, map, hints);
    if (!owner && hasCloudName && /^API_(KEY|SECRET)$/i.test(name)) { owner = "cloudinary"; via = "name"; }
    if (!owner && INTERNAL.test(name)) { internal.push(classifyVar(name, value)); continue; }
    if (!owner) { other.push({ ...classifyVar(name, value), _raw: value }); continue; }
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push({ ...classifyVar(name, value), _raw: value, _via: via });
  }
  const auto = autoGroup(other);
  for (const [owner, vars] of auto.groups) groups.set(owner, vars);
  const services = [];
  for (const [owner, vars] of groups) {
    const def = PROVIDERS.find((p) => p.key === owner) || (owner.startsWith("auto-") ? { label: titleCase(owner.slice(5).toUpperCase()), category: "Auto-detected" } : null) || ({ postgres: { label: "PostgreSQL", category: "Database" }, mysql: { label: "MySQL", category: "Database" }, database: { label: "Database", category: "Database" } })[owner] || { label: owner, category: "Other" };
    const limits = vars.filter((v) => LIMIT_NAME.test(v.name) && NUMBERISH.test(String(v._raw))).map((v) => ({ name: v.name, value: Number(String(v._raw).trim()) }));
    let creds = CREDENTIALS[owner] ? CREDENTIALS[owner](map) : null;
    if (!creds && KEY_ONLY.has(owner)) { const hit = vars.find((v) => v._via === "value" && typeof v._raw === "string"); if (hit) creds = { apiKey: hit._raw.trim() }; }
    const detectedBy = [...new Set(vars.map((v) => v._via).filter(Boolean))];
    if (hints?.deps?.[owner]) detectedBy.push("code");
    const host = creds?.uri ? hostLabel(creds.uri) : "";
    services.push({
      key: owner, label: def.label, host: host || "", category: def.category, console: consoleLink[owner] || null,
      vars: vars.map(({ _raw, _via, ...safe }) => safe), configuredLimits: limits,
      detectedBy: [...new Set(detectedBy.length ? detectedBy : ["name"])], packages: hints?.deps?.[owner] || undefined,
      hasCredentials: Boolean(creds), credentials: creds,
      autoDetected: owner.startsWith("auto-") || undefined,
      incompleteAccounts: owner === "cloudinary" ? cloudinaryAnalysis(map).incomplete : undefined
    });
  }
  // Services the code depends on that have no variables at all in this deployment.
  for (const [key, packages] of Object.entries(hints?.deps || {})) {
    if (groups.has(key)) continue;
    const def = PROVIDERS.find((p) => p.key === key);
    if (!def) continue;
    services.push({ key, label: def.label, host: "", category: def.category, console: consoleLink[key] || null, vars: [], configuredLimits: [], hasCredentials: false, credentials: null, detectedBy: ["code"], packages, inCodeOnly: true });
  }
  const order = ["Database", "Media", "SMS / Voice", "Voice / speech", "Email", "Messaging", "AI", "Realtime", "Auth", "APIs", "Monitoring", "DevOps", "Auto-detected", "Other"];
  services.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.label.localeCompare(b.label));
  const strip = ({ _raw, ...safe }) => safe;
  return { services, internal, other: other.filter((v) => !auto.taken.has(v.name)).map(strip), autoDetectedVars: other.filter((v) => auto.taken.has(v.name)).map(strip) };
}

/** Removes server-only credentials before anything is sent to a client. */
function publicService(service) {
  const { credentials, ...rest } = service;
  return rest;
}

module.exports = { ownerInfo, detectServices, classifyVar, cloudinarySets, cloudinaryAnalysis, publicService, schemeOwner, hostLabel, PROVIDERS, SECRET_NAME, LIMIT_NAME };
