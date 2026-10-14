/* Pure: validates the "create & deploy" request and builds the Render API payload. FREE PLAN ONLY. */
const { TEMPLATES, RUNTIMES, REGIONS } = require("./templates");

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV = 50;
const OWN_CODE = new Set(["empty", "existing"]);

const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A GitHub-safe repository name from free text. */
function slugify(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").replace(/-{2,}/g, "-").slice(0, 60);
}

function validateProvisionInput(body) {
  const b = body && typeof body === "object" ? body : {};
  const name = clean(b.name, 80);
  if (!name) return { error: "Give the project a name." };
  const repoName = slugify(b.repoName || name);
  if (!/^[a-z0-9][a-z0-9._-]{0,59}$/.test(repoName) || repoName.endsWith(".git")) return { error: "That name can't be used for a repository. Use letters, numbers, dots, dashes or underscores." };

  const template = clean(b.template, 20);
  if (!TEMPLATES[template] && !OWN_CODE.has(template)) return { error: "Choose a template." };
  const existingRepoUrl = template === "existing" ? clean(b.existingRepoUrl, 300) : "";
  if (template === "existing" && !existingRepoUrl) return { error: "Enter the URL of the existing repository." };

  const visibility = b.visibility === "public" ? "public" : "private";
  const region = clean(b.region, 20) || "oregon";
  if (!REGIONS.includes(region)) return { error: "Choose a supported Render region." };

  const bringOwnCode = OWN_CODE.has(template);
  const runtime = bringOwnCode ? clean(b.runtime, 20) || "node" : TEMPLATES[template].render.runtime || "static";
  if (bringOwnCode && !RUNTIMES[runtime]) return { error: "Choose a runtime." };
  const defaults = bringOwnCode ? RUNTIMES[runtime] : TEMPLATES[template].render;
  const buildCommand = bringOwnCode && typeof b.buildCommand === "string" ? clean(b.buildCommand, 300) : defaults.buildCommand || "";
  const startCommand = bringOwnCode && typeof b.startCommand === "string" ? clean(b.startCommand, 300) : defaults.startCommand || "";
  if (/[\r\n\0]/.test(buildCommand + startCommand)) return { error: "Build and start commands must be a single line." };

  const envInput = Array.isArray(b.envVars) ? b.envVars : [];
  if (envInput.length > MAX_ENV) return { error: "Up to " + MAX_ENV + " environment variables per project." };
  const envVars = [];
  const seen = new Set();
  for (const row of envInput) {
    const key = clean(row?.name, 200);
    if (!key && !row?.value) continue;
    if (!NAME.test(key)) return { error: "“" + key.slice(0, 40) + "” is not a valid variable name (letters, digits and underscores)." };
    if (seen.has(key)) return { error: "Variable " + key + " appears twice." };
    const value = typeof row.value === "string" ? row.value : "";
    if (value.length > 8000 || value.includes("\0")) return { error: "The value of " + key + " is too long or invalid." };
    seen.add(key);
    envVars.push({ name: key, value });
  }

  return {
    value: {
      name, repoName, description: clean(b.description, 300), template, visibility, region, runtime, buildCommand, startCommand,
      envVars, existingRepoUrl, useExistingRepo: b.useExistingRepo === true || template === "existing",
      githubAccountId: clean(b.githubAccountId, 40), renderAccountId: clean(b.renderAccountId, 40), ownerId: clean(b.ownerId, 160)
    }
  };
}

/**
 * Render create-service body. The plan is hard-coded to "free": there is no input that can change it, and
 * static sites have no paid plan to pick. `repoUrl` must be the https URL of the repository.
 */
function buildRenderPayload(input, { ownerId, repoUrl, branch = "main" }) {
  const base = {
    ownerId, name: input.repoName, repo: repoUrl, branch, autoDeploy: "yes",
    envVars: input.envVars.map((v) => ({ key: v.name, value: v.value }))
  };
  const config = TEMPLATES[input.template]?.render || RUNTIMES[input.runtime];
  if (config.type === "static_site") {
    return { ...base, type: "static_site", serviceDetails: { buildCommand: input.buildCommand || "", publishPath: config.publishPath || "." } };
  }
  const details = {
    runtime: config.runtime, plan: "free", region: input.region,
    envSpecificDetails: input.runtime === "docker" ? {} : { buildCommand: input.buildCommand, startCommand: input.startCommand }
  };
  if (config.healthCheckPath) details.healthCheckPath = config.healthCheckPath;
  return { ...base, type: "web_service", serviceDetails: details };
}

module.exports = { validateProvisionInput, buildRenderPayload, slugify, MAX_ENV };
