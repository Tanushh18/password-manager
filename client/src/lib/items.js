/**
 * Vault item model (same file in client/ and mobile/).
 * Everything here is encrypted as one blob on the device before upload.
 */
export const emptyItem = () => ({
  name: "",
  username: "",
  password: "",
  url: "",
  notes: "",
  totp: "",
  folder: "",
  favorite: false,
  passwordUpdatedAt: null,
});

const clean = (v) => (v == null ? "" : String(v).replace(/ /g, " ").trim());

export function normalizeItem(raw = {}) {
  return {
    ...emptyItem(),
    name: clean(raw.name).slice(0, 200),
    username: clean(raw.username).slice(0, 300),
    password: raw.password == null ? "" : String(raw.password).slice(0, 2000),
    url: clean(raw.url).slice(0, 2000),
    notes: raw.notes == null ? "" : String(raw.notes).slice(0, 20000),
    totp: clean(raw.totp).slice(0, 500),
    folder: clean(raw.folder).slice(0, 60),
    favorite: Boolean(raw.favorite),
    passwordUpdatedAt: raw.passwordUpdatedAt || null,
  };
}

/** Legacy server entry → item fields (after the server decrypted the password). */
export const fromLegacy = (entry, password) =>
  normalizeItem({
    name: entry.platform && entry.platform !== "NA" ? entry.platform : "Untitled",
    username: entry.platEmail && entry.platEmail !== "NA" ? entry.platEmail : "",
    password,
    passwordUpdatedAt: entry.updatedAt || entry.createdAt || null,
  });

export function domainOf(url) {
  const text = clean(url);
  if (!text) return "";
  // Regex rather than URL(): React Native's URL has no reliable hostname.
  const m = text.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/:?#\s]+)/i);
  const host = m ? m[1].toLowerCase().replace(/^www\./, "") : "";
  return host.includes(".") ? host : "";
}

export const openableUrl = (url) => {
  const d = clean(url);
  if (!d) return "";
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
};

/** Website icon via DuckDuckGo's icon service (only used when the user turns icons on). */
export const faviconUrl = (url) => {
  const d = domainOf(url);
  return d ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico` : "";
};

/* ── CSV ── */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim()));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(items) {
  const cols = ["name", "url", "username", "password", "totp", "notes", "folder", "favorite"];
  return [cols.join(","), ...items.map((it) => cols.map((c) => csvCell(it[c])).join(","))].join("\n");
}

const pick = (row, keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => h.trim().toLowerCase() === k);
    if (hit && clean(row[hit])) return row[hit];
  }
  return "";
};

/**
 * Maps spreadsheet / CSV rows from Aurelia, Chrome, Bitwarden, 1Password and
 * LastPass exports (plus the old platform/email/password sheet) to items.
 */
export const rowsToItems = (rows) =>
  rows
    .map((row) =>
      normalizeItem({
        name: pick(row, ["name", "title", "platform", "site", "account"]) || domainOf(pick(row, ["url", "login_uri", "website", "origin"])),
        username: pick(row, ["username", "login_username", "user", "email", "platemail", "login"]),
        password: pick(row, ["password", "login_password", "userpass", "pass"]),
        url: pick(row, ["url", "login_uri", "website", "origin", "web site"]),
        notes: pick(row, ["notes", "note", "extra", "comments"]),
        totp: pick(row, ["totp", "login_totp", "otpauth", "one-time password", "otp"]),
        folder: pick(row, ["folder", "grouping", "group", "category", "vault"]),
        favorite: /^(1|true|yes)$/i.test(pick(row, ["favorite", "fav", "starred"])),
      })
    )
    .filter((it) => it.name || it.password);
