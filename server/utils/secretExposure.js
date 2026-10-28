/* Finds env vars that are likely secrets but are published to the browser or app bundle by their name prefix
   (REACT_APP_, VITE_, NEXT_PUBLIC_, EXPO_PUBLIC_), because anything with those prefixes is shipped to every visitor.
   Pure: it never returns a value, only the name and a masked preview. */

const PUBLIC_PREFIX = /^(REACT_APP_|VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_|PUBLIC_)/;
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|KEY$)/i;
// Public by design (Firebase web config): the names look secret, but shipping them is normal.
const PUBLIC_BY_DESIGN = /^(REACT_APP_|VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_)?FIREBASE_(API_KEY|APP_ID|MESSAGING_SENDER_ID|MEASUREMENT_ID|AUTH_DOMAIN|PROJECT_ID|STORAGE_BUCKET)$/i;
// A value that looks like a real key even when the name does not say so (Stripe, OpenAI, GitHub, Google, AWS style).
const KEY_SHAPE = /^(sk_(live|test)_|sk-|ghp_|github_pat_|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{30,}|xox[abp]-)/;

const mask = (value) => {
  const text = String(value || "");
  if (text.length <= 8) return "••••";
  return text.slice(0, 4) + "••••" + text.slice(-2);
};

/** One env var -> a finding, or null. */
function classify(key, value) {
  const name = String(key || "");
  const text = String(value || "");
  if (!text || PUBLIC_BY_DESIGN.test(name)) return null;
  const publicName = PUBLIC_PREFIX.test(name);
  const keyShaped = KEY_SHAPE.test(text);
  const secretName = SECRET_NAME.test(name);
  if (!keyShaped && !(publicName && secretName)) return null;
  return {
    name,
    preview: mask(text),
    severity: keyShaped || secretName ? "high" : "medium",
    reason: publicName
      ? "Published to every visitor by its " + name.split("_")[0] + " prefix"
      : "Value looks like a live key"
  };
}

/** All findings for one service's env vars ([{ key, value }]). Empty when nothing is exposed. */
function findExposedSecrets(vars) {
  return (vars || []).map(({ key, value }) => classify(key, value)).filter(Boolean)
    .sort((a, b) => (a.severity === b.severity ? a.name.localeCompare(b.name) : a.severity === "high" ? -1 : 1));
}

module.exports = { findExposedSecrets, classify, mask };
