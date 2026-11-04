/**
 * The on-phone assistant for the Overview page. Phone only: nothing here is sent to a server.
 *
 * "give me the ggnhome firebase creds"  ->  every matching field from that project, grouped, values masked until tapped.
 *
 * Step 1 (this file, no model needed): read the sentence, drop filler words, expand a few synonyms (creds -> key, secret,
 * token, password...), score every project and field, and return the best group.
 * Step 2 (optional): `askAgent(text, projects, { model })`. When a small on-device model is installed, it receives only the
 * matched fields' labels (never values) and may re-rank or write a one-line answer. If it is missing or fails, step 1 stands.
 */
import { flattenProject, looksSecret } from "./projectTree.js";

const FILLER = new Set(("give me the a an of for from to my all every please show get find fetch need want tell what is are where " +
  "in on at and or with that this those these it its i can you could would should folder repo repository project server " +
  "servers app apps details detail info information stuff things thing everything").split(" "));

const SYNONYMS = {
  creds: ["key", "secret", "token", "password", "credential", "api", "uri", "url"],
  credentials: ["key", "secret", "token", "password", "api", "uri"],
  env: ["env", "variable", "key", "secret", "uri", "url"],
  envs: ["env", "variable", "key", "secret", "uri", "url"],
  keys: ["key", "api", "secret"],
  login: ["email", "password", "user", "username"],
  db: ["database", "mongo", "postgres", "uri"],
  database: ["db", "mongo", "postgres", "uri"],
  firebase: ["firebase", "google", "fcm", "gcp"],
  home: ["home", "ggnhome"]
};

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);

/** { subject: words that name the thing, kind: words that name the kind of value } */
export function understand(text) {
  const all = words(text).filter((w) => !FILLER.has(w));
  const subject = [], kind = [];
  all.forEach((w) => (SYNONYMS[w] && !["firebase", "home"].includes(w) ? kind.push(...SYNONYMS[w]) : subject.push(w)));
  return { subject: [...new Set(subject)], kind: [...new Set(kind)] };
}

const has = (hay, needle) => hay.includes(needle);

/**
 * Scores one project against the question. A project matches when its name/tags/stack mention the subject words; its
 * fields are then ranked by how well their label fits the kind words and the subject words.
 */
export function scoreProject(project, q) {
  const head = [project.name, project.tags, project.techStack, project.hostingServiceName, project.firebaseProjectId, project.repoUrl, project.category]
    .map((v) => String(v || "").toLowerCase()).join(" ");
  const fields = flattenProject(project);
  let projectScore = 0;
  q.subject.forEach((w) => { if (has(head, w)) projectScore += 10; });
  const scored = fields.map((f) => {
    const label = `${f.path.join(" ")} ${f.label}`.toLowerCase();
    let s = 0;
    q.subject.forEach((w) => { if (has(label, w)) s += 6; });
    q.kind.forEach((w) => { if (has(label, w)) s += 3; });
    if (s && (f.secret || looksSecret(`${f.label}=${f.value}`))) s += 1;
    return { field: f, score: s };
  }).filter((x) => x.score > 0 && String(x.field.value || "").trim());
  // A subject word that only appears in a field label still counts toward the project (e.g. "FIREBASE_KEY").
  if (!projectScore && q.subject.length) q.subject.forEach((w) => { if (scored.some((x) => has(`${x.field.path.join(" ")} ${x.field.label}`.toLowerCase(), w))) projectScore += 4; });
  scored.sort((a, b) => b.score - a.score || a.field.label.localeCompare(b.field.label));
  return { project, projectScore, fields: scored };
}

/** Pure step 1. Returns { answer, groups: [{ project, fields: [{ label, path, value, secret }] }] }. */
export function answerLocally(text, projects = [], { maxProjects = 3, maxFields = 25 } = {}) {
  const q = understand(text);
  if (!q.subject.length && !q.kind.length) return { answer: "Ask for something, like “ggnhome firebase creds” or “MONGO_URI for the api server”.", groups: [] };
  const ranked = projects.map((p) => scoreProject(p, q))
    .filter((r) => (q.subject.length ? r.projectScore > 0 : true) && r.fields.length)
    .sort((a, b) => b.projectScore + b.fields[0].score - (a.projectScore + a.fields[0].score))
    .slice(0, maxProjects);
  const groups = ranked.map((r) => ({
    project: { id: r.project._id || r.project.id || null, name: r.project.name || "Untitled project" },
    fields: r.fields.slice(0, maxFields).map((x) => ({ label: x.field.label, path: x.field.path, value: x.field.value, secret: Boolean(x.field.secret) || looksSecret(`${x.field.label}=${x.field.value}`) }))
  }));
  if (!groups.length) return { answer: "I couldn't find that in your projects. Try the project name plus what you need (key, URI, token, login).", groups };
  const n = groups.reduce((c, g) => c + g.fields.length, 0);
  return { answer: `Found ${n} ${n === 1 ? "field" : "fields"} in ${groups.map((g) => g.project.name).join(", ")}. Tap a value to reveal or copy it.`, groups };
}

/** Values are hidden unless the owner taps. */
export const mask = (value) => (String(value).length <= 4 ? "••••" : `${"•".repeat(8)}${String(value).slice(-2)}`);

/**
 * Step 2, optional. `model.generate(prompt)` must return text. The prompt holds labels only, never secret values.
 * Any failure falls back to the step 1 answer.
 */
export async function askAgent(text, projects, { model } = {}) {
  const base = answerLocally(text, projects);
  if (!model || !base.groups.length) return base;
  try {
    const outline = base.groups.map((g) => `${g.project.name}: ${g.fields.map((f) => f.label).join(", ")}`).join("\n");
    const out = await model.generate(`Question: ${text}\nMatching fields (names only):\n${outline}\nIn one short sentence, say what was found.`);
    const line = String(out || "").trim().split("\n")[0].slice(0, 200);
    return line ? { ...base, answer: line } : base;
  } catch { return base; }
}
