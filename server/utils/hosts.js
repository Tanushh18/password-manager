/*
 * Hosting providers other than Render: Vercel, Netlify, Railway and Cloudflare Pages.
 * Each one can validate an API token and create + deploy a project from a GitHub repository and branch.
 * Tokens only ever go to that provider's own API host. No function here returns or logs a token.
 * `http` is injectable so every call can be tested without the network.
 */

const TIMEOUT_MS = 30000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function defaultHttp(url, { method = "GET", headers = {}, json, form } = {}) {
  try {
    const response = await fetch(url, {
      method,
      headers: { "User-Agent": "Stashr-Hosting", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : form,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: error.name === "TimeoutError" || error.name === "AbortError" ? 504 : 502, body: null, network: true };
  }
}

const bearer = (token) => ({ Authorization: "Bearer " + token });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const first = (...values) => values.find((v) => typeof v === "string" && v.trim()) || "";
const envList = (vars) => (vars || []).filter((v) => v && ENV_NAME.test(v.name || "") && typeof v.value === "string");
const httpsUrl = (host) => (host ? (/^https?:\/\//.test(host) ? host : "https://" + host) : "");

/** A short, safe reason for a failed call. Never includes request data. */
function reason(res, fallback) {
  if (res.status === 401 || res.status === 403) return "The token was rejected or does not have enough permission.";
  if (res.status === 429) return "The provider is rate limiting this token. Try again in a minute.";
  if (res.network) return "Could not reach the provider. Try again.";
  const msg = first(res.body?.error?.message, res.body?.message, res.body?.errors?.[0]?.message, Array.isArray(res.body?.errors) ? "" : "");
  return msg ? msg.slice(0, 220) : fallback;
}

/* ───────────── Vercel ───────────── */
const vercel = {
  id: "vercel", label: "Vercel", kind: "frontend",
  async validate(token, { teamId = "" } = {}, http = defaultHttp) {
    const res = await http("https://api.vercel.com/v2/user", { headers: bearer(token) });
    if (!res.ok) return fail(res.status === 401 || res.status === 403 ? "Vercel rejected this token." : reason(res, "Could not read your Vercel account."));
    const user = res.body?.user || {};
    return { ok: true, label: first(user.username, user.name, user.email, "Vercel"), teamId: String(teamId || "") };
  },
  async deploy(token, account, input, http = defaultHttp) {
    const q = account.teamId ? "?teamId=" + encodeURIComponent(account.teamId) : "";
    const body = {
      name: input.name,
      gitRepository: { type: "github", repo: input.owner + "/" + input.repo },
      environmentVariables: envList(input.envVars).map((v) => ({ key: v.name, value: v.value, type: "encrypted", target: ["production", "preview", "development"] }))
    };
    if (input.framework) body.framework = input.framework;
    if (input.buildCommand) body.buildCommand = input.buildCommand;
    if (input.outputDir) body.outputDirectory = input.outputDir;
    if (input.branch && input.branch === input.defaultBranch) body.productionBranch = input.branch;
    const created = await http("https://api.vercel.com/v11/projects" + q, { method: "POST", headers: bearer(token), json: body });
    if (!created.ok) {
      const code = created.body?.error?.code;
      if (created.status === 409 || code === "project_name_taken") return fail("A Vercel project with that name already exists. Use a different project name.");
      if (/repo|git|install|connect/i.test(created.body?.error?.message || "")) return fail("Vercel cannot see that repository. Connect GitHub to Vercel first (Vercel → Account Settings → Authentication → GitHub) and give it access to the repo.");
      return fail(reason(created, "Vercel could not create the project."));
    }
    const projectId = created.body?.id;
    const deployBody = { name: input.name, project: projectId || input.name, gitSource: { type: "github", org: input.owner, repo: input.repo, ref: input.branch || input.defaultBranch || "main" } };
    if (input.branch && input.branch === input.defaultBranch) deployBody.target = "production";
    const dep = await http("https://api.vercel.com/v13/deployments" + q + (q ? "&" : "?") + "forceNew=1", { method: "POST", headers: bearer(token), json: deployBody });
    const base = { id: projectId || input.name, url: "https://" + input.name + ".vercel.app", dashboardUrl: "https://vercel.com/dashboard" };
    if (!dep.ok) return { ok: true, service: base, note: "The project was created, but the first deploy did not start: " + reason(dep, "Vercel refused it") + ". Push a commit or press Redeploy in Vercel." };
    return { ok: true, service: { ...base, deployId: dep.body?.id || "", url: dep.body?.url && input.branch !== input.defaultBranch ? httpsUrl(dep.body.url) : base.url } };
  }
};

/* ───────────── Netlify ───────────── */
/* Netlify can't be linked to a GitHub repo through its API alone, so a read-only deploy key is added to the repo. */
const netlify = {
  id: "netlify", label: "Netlify", kind: "frontend",
  async validate(token, _extra, http = defaultHttp) {
    const res = await http("https://api.netlify.com/api/v1/user", { headers: bearer(token) });
    if (!res.ok) return fail(res.status === 401 ? "Netlify rejected this token." : reason(res, "Could not read your Netlify account."));
    return { ok: true, label: first(res.body?.full_name, res.body?.email, "Netlify") };
  },
  async deploy(token, account, input, http = defaultHttp, github) {
    if (!github) return fail("Netlify needs a GitHub token that can add a deploy key to the repository.");
    const key = await http("https://api.netlify.com/api/v1/deploy_keys", { method: "POST", headers: bearer(token) });
    if (!key.ok || !key.body?.id || !key.body?.public_key) return fail(reason(key, "Netlify could not create a deploy key."));
    const added = await github("POST", "/repos/" + encodeURIComponent(input.owner) + "/" + encodeURIComponent(input.repo) + "/keys", { title: "Netlify (" + input.name + ")", key: key.body.public_key, read_only: true });
    if (!added.ok && added.status !== 422) return fail("GitHub would not let Stashr add a deploy key to " + input.owner + "/" + input.repo + ". The GitHub token needs the “repo” scope and admin access to the repository.");
    const env = {};
    for (const v of envList(input.envVars)) env[v.name] = v.value;
    const repo = {
      provider: "manual", repo_path: input.owner + "/" + input.repo, repo_url: "git@github.com:" + input.owner + "/" + input.repo + ".git",
      repo_branch: input.branch || input.defaultBranch || "main", deploy_key_id: key.body.id,
      cmd: input.buildCommand || "", dir: input.outputDir || "", env
    };
    const created = await http("https://api.netlify.com/api/v1/sites", { method: "POST", headers: bearer(token), json: { name: input.name, repo } });
    if (!created.ok) {
      if (created.status === 422) return fail("A Netlify site named “" + input.name + "” already exists. Use a different project name.");
      return fail(reason(created, "Netlify could not create the site."));
    }
    const site = created.body || {};
    const build = await http("https://api.netlify.com/api/v1/sites/" + encodeURIComponent(site.id) + "/builds", { method: "POST", headers: bearer(token), json: {} });
    const out = { id: site.id, url: httpsUrl(site.ssl_url || site.url) || "https://" + input.name + ".netlify.app", dashboardUrl: site.admin_url || "https://app.netlify.com" };
    const note = "Netlify builds from the deploy key. To redeploy on every push, add a build hook in Netlify (Site configuration → Build & deploy) or use Redeploy there.";
    return build.ok ? { ok: true, service: { ...out, deployId: build.body?.id || "" }, note } : { ok: true, service: out, note: "The site was created, but the first build did not start. Press “Trigger deploy” in Netlify. " + note };
  }
};

/* ───────────── Railway ───────────── */
const RAILWAY = "https://backboard.railway.com/graphql/v2";
const gql = async (http, token, query, variables) => {
  const res = await http(RAILWAY, { method: "POST", headers: bearer(token), json: { query, variables } });
  const message = res.body?.errors?.[0]?.message;
  return { ...res, ok: res.ok && !res.body?.errors, data: res.body?.data || null, message };
};
const railway = {
  id: "railway", label: "Railway", kind: "server",
  async validate(token, _extra, http = defaultHttp) {
    const me = await gql(http, token, "query { me { name email } }");
    if (me.ok && me.data?.me) return { ok: true, label: first(me.data.me.name, me.data.me.email, "Railway") };
    const probe = await gql(http, token, "query { projects { edges { node { id } } } }");
    if (probe.ok) return { ok: true, label: "Railway (workspace token)" };
    return fail(me.status === 401 || probe.status === 401 || /not authorized|unauthorized/i.test(me.message || "") ? "Railway rejected this token." : reason(me, "Could not read your Railway account."));
  },
  async deploy(token, account, input, http = defaultHttp) {
    const project = await gql(http, token,
      "mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id name environments { edges { node { id } } } services { edges { node { id } } } } }",
      { input: { name: input.name, defaultEnvironmentName: "production", repo: { fullRepoName: input.owner + "/" + input.repo, branch: input.branch || input.defaultBranch || "main" } } });
    const node = project.data?.projectCreate;
    if (!project.ok || !node?.id) {
      if (/github|repo|install/i.test(project.message || "")) return fail("Railway cannot see that repository. Install the Railway GitHub app on it (Railway → Account Settings → Integrations → GitHub).");
      return fail(reason(project, project.message ? "Railway: " + project.message.slice(0, 160) : "Railway could not create the project."));
    }
    const environmentId = node.environments?.edges?.[0]?.node?.id;
    const serviceId = node.services?.edges?.[0]?.node?.id;
    const out = { id: node.id, url: "", dashboardUrl: "https://railway.com/project/" + node.id };
    let note = "";
    const vars = envList(input.envVars);
    if (vars.length && environmentId && serviceId) {
      const variables = {};
      for (const v of vars) variables[v.name] = v.value;
      const set = await gql(http, token, "mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }", { input: { projectId: node.id, environmentId, serviceId, variables } });
      if (!set.ok) note += "The project was created but the environment variables were not saved; add them in Railway. ";
    }
    if (environmentId && serviceId) {
      const domain = await gql(http, token, "mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }", { input: { serviceId, environmentId } });
      if (domain.ok && domain.data?.serviceDomainCreate?.domain) out.url = httpsUrl(domain.data.serviceDomainCreate.domain);
      else note += "Railway did not give the service a public domain yet; generate one in its Settings → Networking. ";
    }
    return { ok: true, service: out, note: note.trim() || undefined };
  }
};

/* ───────────── Cloudflare Pages ───────────── */
const CF = "https://api.cloudflare.com/client/v4";
const cfError = (res, fallback) => (res.status === 401 || res.status === 403 ? "Cloudflare rejected this token or it lacks the Pages Edit permission." : first(res.body?.errors?.[0]?.message) ? "Cloudflare: " + res.body.errors[0].message.slice(0, 200) : reason(res, fallback));
const cloudflare = {
  id: "cloudflare", label: "Cloudflare Pages", kind: "frontend",
  async validate(token, _extra, http = defaultHttp) {
    const verify = await http(CF + "/user/tokens/verify", { headers: bearer(token) });
    if (!verify.ok || verify.body?.result?.status !== "active") return fail(verify.status === 401 || verify.status === 403 || verify.ok ? "Cloudflare rejected this token." : reason(verify, "Could not verify the Cloudflare token."));
    const accounts = await http(CF + "/accounts", { headers: bearer(token) });
    const list = accounts.body?.result;
    if (!accounts.ok || !Array.isArray(list) || !list.length) return fail("This token can verify but cannot read an account. Add the “Account · Cloudflare Pages · Edit” permission and an account scope.");
    return { ok: true, label: first(list[0].name, "Cloudflare"), accountId: String(list[0].id) };
  },
  async deploy(token, account, input, http = defaultHttp) {
    if (!account.accountId) return fail("Reconnect this Cloudflare token: its account could not be found.");
    const branch = input.branch || input.defaultBranch || "main";
    const env_vars = {};
    for (const v of envList(input.envVars)) env_vars[v.name] = { type: "plain_text", value: v.value };
    const hasEnv = Object.keys(env_vars).length > 0;
    const body = {
      name: input.name, production_branch: branch,
      source: { type: "github", config: { owner: input.owner, repo_name: input.repo, production_branch: branch, pr_comments_enabled: false, deployments_enabled: true, production_deployments_enabled: true, preview_deployment_setting: "all" } },
      build_config: { build_command: input.buildCommand || "", destination_dir: input.outputDir || "", root_dir: "" }
    };
    if (hasEnv) body.deployment_configs = { production: { env_vars }, preview: { env_vars } };
    const base = CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects";
    const created = await http(base, { method: "POST", headers: bearer(token), json: body });
    if (!created.ok) {
      if (/already|exists|8000002/i.test(JSON.stringify(created.body?.errors || ""))) return fail("A Cloudflare Pages project named “" + input.name + "” already exists. Use a different project name.");
      if (/github|repo|install|source/i.test(JSON.stringify(created.body?.errors || ""))) return fail("Cloudflare cannot see that repository. Authorize the Cloudflare Pages GitHub app for it (Cloudflare → Workers & Pages → Create → Connect to Git).");
      return fail(cfError(created, "Cloudflare could not create the Pages project."));
    }
    const result = created.body?.result || {};
    const form = new FormData();
    form.append("branch", branch);
    const dep = await http(base + "/" + encodeURIComponent(input.name) + "/deployments", { method: "POST", headers: bearer(token), form });
    const sub = first(result.subdomain, input.name + ".pages.dev");
    const out = { id: result.id || input.name, url: httpsUrl(sub), dashboardUrl: "https://dash.cloudflare.com/?to=/:account/pages/view/" + encodeURIComponent(input.name), deployId: dep.body?.result?.id || "" };
    return dep.ok ? { ok: true, service: out } : { ok: true, service: out, note: "The project was created, but the first deploy did not start: " + cfError(dep, "Cloudflare refused it") + " Push a commit to " + branch + " to build it." };
  }
};

const PROVIDERS = { vercel, netlify, railway, cloudflare };
const ids = () => Object.keys(PROVIDERS);

/** A valid Pages/Vercel/Netlify/Railway project name derived from free text. */
const hostName = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 58);

module.exports = { PROVIDERS, ids, hostName, defaultHttp };
