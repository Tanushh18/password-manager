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
    const tq = teamId ? "?teamId=" + encodeURIComponent(teamId) : "";
    const res = await http("https://api.vercel.com/v2/user", { headers: bearer(token) });
    if (res.ok) {
      const user = res.body?.user || {};
      return { ok: true, label: first(user.username, user.name, user.email, "Vercel"), teamId: String(teamId || "") };
    }
    // A token scoped to a team can't read /v2/user (Vercel answers 403), but it can list that team's projects.
    const projects = await http("https://api.vercel.com/v9/projects" + tq + (tq ? "&" : "?") + "limit=1", { headers: bearer(token) });
    if (projects.ok) return { ok: true, label: teamId ? "Vercel team " + teamId : "Vercel", teamId: String(teamId || "") };
    const code = first(res.body?.error?.code, projects.body?.error?.code);
    const said = first(res.body?.error?.message, projects.body?.error?.message);
    if (res.network || projects.network) return fail("Could not reach Vercel. Try again.");
    if (res.status === 429) return fail("Vercel is rate limiting this token. Try again in a minute.");
    if (code === "invalid_token" || /invalid.*token|not.*valid/i.test(said)) return fail("Vercel says this token is not valid" + (said ? " (" + said.slice(0, 120) + ")" : "") + ". Create a new one at vercel.com/account/tokens and paste it in full, with no spaces or quotes.");
    if (res.status === 403 || projects.status === 403) {
      return fail(teamId
        ? "Vercel accepted the token but not for team " + teamId + (said ? " (" + said.slice(0, 120) + ")" : "") + ". Check the Team ID (Team Settings → General) and that the token's scope is that team."
        : "Vercel accepted the token but it has no access here" + (said ? " (" + said.slice(0, 120) + ")" : "") + ". If you created it with a team scope, enter that Team ID below. Otherwise create the token with the scope set to your personal account.");
    }
    return fail("Vercel refused this token" + (said ? ": " + said.slice(0, 160) : " (status " + res.status + ")") + ".");
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
    const dep = await http("https://api.vercel.com/v13/deployments" + q + (q ? "&" : "?") + "forceNew=1&skipAutoDetectionConfirmation=1", { method: "POST", headers: bearer(token), json: deployBody });
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
    const out = { id: node.id, url: "", dashboardUrl: "https://railway.com/project/" + node.id, meta: { projectId: node.id, serviceId: serviceId || "", environmentId: environmentId || "" } };
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


/* ───────────── Existing sites: list, inspect, redeploy ─────────────
 * A "site" is { id, name, url, dashboardUrl, repo ("owner/repo" or ""), branch, meta }. `meta` holds ids a provider
 * needs later (Railway's service and environment). Nothing here returns a token or an environment variable value.
 */
const state = (raw) => {
  const v = String(raw || "").toLowerCase();
  if (/err|fail|crash|cancel|removed/.test(v)) return "failed";
  if (/ready|success|live|published/.test(v)) return "live";
  if (/build|deploy|queue|enqueue|init|active|process|upload|new|pending/.test(v)) return "building";
  return "unknown";
};
const deployOf = (status, at, commit, sha, branch) => ({ status: state(status), raw: String(status || "").slice(0, 40), at: at || null, commit: String(commit || "").split("\n")[0].slice(0, 100), sha: String(sha || "").slice(0, 7), branch: String(branch || "").slice(0, 100) });
const asAt = (v) => (typeof v === "number" ? new Date(v).toISOString() : v || null);
const q = (account) => (account.teamId ? "?teamId=" + encodeURIComponent(account.teamId) : "");

vercel.branchDeploy = true;
vercel.siteOf = (p) => ({ id: String(p.id), name: String(p.name), url: p.targets?.production?.alias?.[0] ? httpsUrl(p.targets.production.alias[0]) : "https://" + p.name + ".vercel.app", dashboardUrl: "https://vercel.com/dashboard", repo: p.link?.org && p.link?.repo ? p.link.org + "/" + p.link.repo : "", branch: String(p.link?.productionBranch || ""), meta: {} });
vercel.list = async (token, account, http = defaultHttp) => {
  const res = await http("https://api.vercel.com/v9/projects" + (q(account) ? q(account) + "&" : "?") + "limit=100", { headers: bearer(token) });
  if (!res.ok) return fail(reason(res, "Could not list your Vercel projects."));
  return { ok: true, sites: (res.body?.projects || []).map(vercel.siteOf) };
};
vercel.inspect = async (token, account, link, http = defaultHttp) => {
  const id = encodeURIComponent(link.remoteId);
  const proj = await http("https://api.vercel.com/v9/projects/" + id + q(account), { headers: bearer(token) });
  if (!proj.ok) return fail(proj.status === 404 ? "That Vercel project no longer exists." : reason(proj, "Could not read the Vercel project."));
  const dep = await http("https://api.vercel.com/v6/deployments" + (q(account) ? q(account) + "&" : "?") + "projectId=" + id + "&limit=1", { headers: bearer(token) });
  const d = dep.body?.deployments?.[0];
  return { ok: true, site: vercel.siteOf(proj.body), latestDeploy: d ? deployOf(d.readyState || d.state, asAt(d.created), d.meta?.githubCommitMessage, d.meta?.githubCommitSha, d.meta?.githubCommitRef) : null };
};
vercel.redeploy = async (token, account, link, { branch } = {}, http = defaultHttp) => {
  const [org, repo] = String(link.repo || "").split("/");
  if (!org || !repo) return fail("This Vercel project is not linked to a GitHub repository, so it can't be redeployed from here.");
  const ref = branch || link.branch || "main";
  const body = { name: link.name, project: link.remoteId, gitSource: { type: "github", org, repo, ref } };
  if (!branch || branch === link.branch) body.target = "production";
  const res = await http("https://api.vercel.com/v13/deployments" + (q(account) ? q(account) + "&" : "?") + "forceNew=1", { method: "POST", headers: bearer(token), json: body });
  return res.ok ? { ok: true, branch: ref } : fail(reason(res, "Vercel could not start the deployment."));
};

netlify.branchDeploy = false;
netlify.siteOf = (s) => ({ id: String(s.id), name: String(s.name || s.id), url: httpsUrl(s.ssl_url || s.url), dashboardUrl: s.admin_url || "https://app.netlify.com", repo: /github\.com[:/]/.test(s.build_settings?.repo_url || "") ? String(s.build_settings.repo_url).replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "") : String(s.build_settings?.repo_path || ""), branch: String(s.build_settings?.repo_branch || ""), meta: {} });
netlify.list = async (token, account, http = defaultHttp) => {
  const res = await http("https://api.netlify.com/api/v1/sites?per_page=100", { headers: bearer(token) });
  if (!res.ok || !Array.isArray(res.body)) return fail(reason(res, "Could not list your Netlify sites."));
  return { ok: true, sites: res.body.map(netlify.siteOf) };
};
netlify.inspect = async (token, account, link, http = defaultHttp) => {
  const id = encodeURIComponent(link.remoteId);
  const site = await http("https://api.netlify.com/api/v1/sites/" + id, { headers: bearer(token) });
  if (!site.ok) return fail(site.status === 404 ? "That Netlify site no longer exists." : reason(site, "Could not read the Netlify site."));
  const dep = await http("https://api.netlify.com/api/v1/sites/" + id + "/deploys?per_page=1", { headers: bearer(token) });
  const d = Array.isArray(dep.body) ? dep.body[0] : null;
  return { ok: true, site: netlify.siteOf(site.body), latestDeploy: d ? deployOf(d.state, d.created_at, d.title, d.commit_ref, d.branch) : null };
};
netlify.redeploy = async (token, account, link, _opts, http = defaultHttp) => {
  const res = await http("https://api.netlify.com/api/v1/sites/" + encodeURIComponent(link.remoteId) + "/builds", { method: "POST", headers: bearer(token), json: {} });
  return res.ok ? { ok: true, branch: link.branch } : fail(reason(res, "Netlify could not start a build."));
};

railway.branchDeploy = false;
railway.list = async (token, account, http = defaultHttp) => {
  const res = await gql(http, token, "query { projects { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } } }");
  if (!res.ok) return fail(reason(res, res.message ? "Railway: " + res.message.slice(0, 160) : "Could not list your Railway projects."));
  const sites = [];
  for (const { node: p } of res.data?.projects?.edges || []) {
    const env = (p.environments?.edges || []).map((e) => e.node).find((e) => /prod/i.test(e.name)) || p.environments?.edges?.[0]?.node;
    for (const { node: svc } of p.services?.edges || []) {
      sites.push({ id: p.id + ":" + svc.id, name: p.name + " · " + svc.name, url: "", dashboardUrl: "https://railway.com/project/" + p.id, repo: "", branch: "", meta: { projectId: p.id, serviceId: svc.id, environmentId: env?.id || "" } });
    }
  }
  return { ok: true, sites };
};
railway.inspect = async (token, account, link, http = defaultHttp) => {
  const m = link.meta || {};
  if (!m.projectId || !m.serviceId || !m.environmentId) return fail("This Railway link is missing its service details. Unlink it and link it again.");
  const dep = await gql(http, token, "query($i: DeploymentListInput!) { deployments(first: 1, input: $i) { edges { node { id status createdAt staticUrl meta } } } }", { i: { projectId: m.projectId, serviceId: m.serviceId, environmentId: m.environmentId } });
  if (!dep.ok) return fail(reason(dep, dep.message ? "Railway: " + dep.message.slice(0, 160) : "Could not read the Railway service."));
  const d = dep.data?.deployments?.edges?.[0]?.node;
  let url = link.url || "";
  const dom = await gql(http, token, "query($p: String!, $e: String!, $s: String!) { domains(projectId: $p, environmentId: $e, serviceId: $s) { serviceDomains { domain } } }", { p: m.projectId, e: m.environmentId, s: m.serviceId });
  const domain = dom.data?.domains?.serviceDomains?.[0]?.domain;
  if (domain) url = httpsUrl(domain);
  return { ok: true, site: { id: link.remoteId, name: link.name, url, dashboardUrl: link.dashboardUrl, repo: link.repo, branch: link.branch, meta: m }, latestDeploy: d ? deployOf(d.status, d.createdAt, d.meta?.commitMessage, d.meta?.commitHash, d.meta?.branch) : null, deployId: d?.id || "" };
};
railway.redeploy = async (token, account, link, _opts, http = defaultHttp) => {
  const list = await railway.deploys(token, account, link, http);
  if (!list.ok) return list;
  const id = list.deploys[0]?.id;
  if (!id) return fail("Railway has no earlier deployment to redeploy. Push a commit to start one.");
  const res = await gql(http, token, "mutation($id: String!) { deploymentRedeploy(id: $id) { id } }", { id });
  return res.ok ? { ok: true, branch: link.branch } : fail(reason(res, res.message ? "Railway: " + res.message.slice(0, 160) : "Railway could not redeploy."));
};

cloudflare.branchDeploy = true;
cloudflare.siteOf = (p) => ({ id: String(p.name), name: String(p.name), url: httpsUrl(p.subdomain || p.name + ".pages.dev"), dashboardUrl: "https://dash.cloudflare.com/?to=/:account/pages/view/" + encodeURIComponent(p.name), repo: p.source?.config?.owner && p.source?.config?.repo_name ? p.source.config.owner + "/" + p.source.config.repo_name : "", branch: String(p.production_branch || ""), meta: {} });
cloudflare.deployOf = (d) => (d ? deployOf(d.latest_stage?.status === "success" ? "success" : d.latest_stage?.status === "failure" ? "failed" : d.latest_stage?.status || "active", d.created_on, d.deployment_trigger?.metadata?.commit_message, d.deployment_trigger?.metadata?.commit_hash, d.deployment_trigger?.metadata?.branch) : null);
cloudflare.list = async (token, account, http = defaultHttp) => {
  if (!account.accountId) return fail("Reconnect this Cloudflare token: its account could not be found.");
  const res = await http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects", { headers: bearer(token) });
  if (!res.ok) return fail(cfError(res, "Could not list your Cloudflare Pages projects."));
  return { ok: true, sites: (res.body?.result || []).map(cloudflare.siteOf) };
};
cloudflare.inspect = async (token, account, link, http = defaultHttp) => {
  const res = await http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects/" + encodeURIComponent(link.remoteId), { headers: bearer(token) });
  if (!res.ok) return fail(res.status === 404 ? "That Cloudflare Pages project no longer exists." : cfError(res, "Could not read the Cloudflare Pages project."));
  return { ok: true, site: cloudflare.siteOf(res.body.result), latestDeploy: cloudflare.deployOf(res.body.result.latest_deployment) };
};
cloudflare.redeploy = async (token, account, link, { branch } = {}, http = defaultHttp) => {
  const form = new FormData();
  const ref = branch || link.branch || "main";
  form.append("branch", ref);
  const res = await http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects/" + encodeURIComponent(link.remoteId) + "/deployments", { method: "POST", headers: bearer(token), form });
  return res.ok ? { ok: true, branch: ref } : fail(cfError(res, "Cloudflare could not start the deployment."));
};

/* ───────────── Variables, deploy history, logs and branch — the same five operations for every host ─────────────
 * Each returns { ok, ... } or { ok: false, error }. No function returns a token. A value the provider will not reveal
 * (Vercel "sensitive", Netlify secrets, Cloudflare secret variables) comes back as null: it can't be compared, so the
 * sync never overwrites it without showing it. `logsSupported` is false where the provider has no log API.
 */
const siteId = (link) => encodeURIComponent(link.remoteId);
const withTeam = (account, path) => path + (account.teamId ? (path.includes("?") ? "&" : "?") + "teamId=" + encodeURIComponent(account.teamId) : "");
const plainValue = (v) => (typeof v === "string" ? v : null);
const dedupe = (rows) => { const seen = new Set(); return rows.filter((r) => (seen.has(r.key) ? false : seen.add(r.key))); };
const logLines = (rows) => rows.map((r) => ({ at: r.at || null, text: String(r.text || "").slice(0, 400) })).filter((r) => r.text);

/* Vercel */
vercel.envRead = async (token, account, link, http = defaultHttp) => {
  const res = await http(withTeam(account, "https://api.vercel.com/v10/projects/" + siteId(link) + "/env?decrypt=true"), { headers: bearer(token) });
  if (!res.ok) return fail(reason(res, "Could not read the Vercel variables."));
  return { ok: true, vars: dedupe((res.body?.envs || []).filter((e) => e && typeof e.key === "string").map((e) => ({ key: e.key, value: e.type === "sensitive" ? null : plainValue(e.value) }))) };
};
vercel.envWrite = async (token, account, link, name, value, http = defaultHttp) => {
  const res = await http(withTeam(account, "https://api.vercel.com/v10/projects/" + siteId(link) + "/env?upsert=true"), { method: "POST", headers: bearer(token), json: { key: name, value, type: "encrypted", target: ["production", "preview"] } });
  return res.ok ? { ok: true } : fail(reason(res, "Vercel refused this variable."));
};
vercel.deploys = async (token, account, link, http = defaultHttp) => {
  const res = await http(withTeam(account, "https://api.vercel.com/v6/deployments?projectId=" + siteId(link) + "&limit=20"), { headers: bearer(token) });
  if (!res.ok) return fail(reason(res, "Could not read the Vercel deployments."));
  return { ok: true, deploys: (res.body?.deployments || []).map((d) => ({ id: String(d.uid || ""), ...deployOf(d.readyState || d.state, asAt(d.created), d.meta?.githubCommitMessage, d.meta?.githubCommitSha, d.meta?.githubCommitRef) })) };
};
vercel.logs = async (token, account, link, deployId, http = defaultHttp) => {
  const res = await http(withTeam(account, "https://api.vercel.com/v3/deployments/" + encodeURIComponent(deployId) + "/events?builds=1&limit=200"), { headers: bearer(token) });
  if (!res.ok) return fail(reason(res, "Could not read the Vercel build log."));
  return { ok: true, lines: logLines((Array.isArray(res.body) ? res.body : []).map((e) => ({ at: asAt(e.created), text: e.text || e.payload?.text || "" }))) };
};
vercel.setBranch = async (token, account, link, branch, http = defaultHttp) => {
  const res = await http(withTeam(account, "https://api.vercel.com/v9/projects/" + siteId(link)), { method: "PATCH", headers: bearer(token), json: { productionBranch: branch } });
  return res.ok ? { ok: true, branch } : fail(reason(res, "Vercel could not change the production branch."));
};

/* Netlify (variables live under the account; the site's account slug is read first) */
netlify.logsSupported = false;
const netlifyAccountSlug = async (token, link, http) => {
  const site = await http("https://api.netlify.com/api/v1/sites/" + siteId(link), { headers: bearer(token) });
  if (!site.ok) return { error: reason(site, "Could not read the Netlify site.") };
  return site.body?.account_slug ? { slug: String(site.body.account_slug) } : { error: "Netlify did not return the account for this site." };
};
netlify.envRead = async (token, account, link, http = defaultHttp) => {
  const acc = await netlifyAccountSlug(token, link, http);
  if (acc.error) return fail(acc.error);
  const res = await http("https://api.netlify.com/api/v1/accounts/" + encodeURIComponent(acc.slug) + "/env?site_id=" + siteId(link), { headers: bearer(token) });
  if (!res.ok || !Array.isArray(res.body)) return fail(reason(res, "Could not read the Netlify variables."));
  return { ok: true, vars: dedupe(res.body.filter((e) => e && typeof e.key === "string").map((e) => {
    const v = (e.values || []).find((x) => x.context === "all") || (e.values || [])[0];
    return { key: e.key, value: e.is_secret ? null : plainValue(v?.value) };
  })) };
};
netlify.envWrite = async (token, account, link, name, value, http = defaultHttp) => {
  const acc = await netlifyAccountSlug(token, link, http);
  if (acc.error) return fail(acc.error);
  const base = "https://api.netlify.com/api/v1/accounts/" + encodeURIComponent(acc.slug) + "/env";
  const values = [{ context: "all", value }];
  let res = await http(base + "?site_id=" + siteId(link), { method: "POST", headers: bearer(token), json: [{ key: name, values }] });
  if (res.status === 422 || res.status === 409) res = await http(base + "/" + encodeURIComponent(name) + "?site_id=" + siteId(link), { method: "PATCH", headers: bearer(token), json: { values } });
  return res.ok ? { ok: true } : fail(reason(res, "Netlify refused this variable."));
};
netlify.deploys = async (token, account, link, http = defaultHttp) => {
  const res = await http("https://api.netlify.com/api/v1/sites/" + siteId(link) + "/deploys?per_page=20", { headers: bearer(token) });
  if (!res.ok || !Array.isArray(res.body)) return fail(reason(res, "Could not read the Netlify deploys."));
  return { ok: true, deploys: res.body.map((d) => ({ id: String(d.id || ""), ...deployOf(d.state, d.created_at, d.title, d.commit_ref, d.branch) })) };
};
netlify.logs = async () => fail("Netlify does not publish build logs through its API. Open the deploy in Netlify to read them.");
netlify.setBranch = async (token, account, link, branch, http = defaultHttp) => {
  const res = await http("https://api.netlify.com/api/v1/sites/" + siteId(link), { method: "PATCH", headers: bearer(token), json: { build_settings: { repo_branch: branch } } });
  return res.ok ? { ok: true, branch } : fail(reason(res, "Netlify could not change the branch."));
};

/* Railway (GraphQL; the service, environment and project ids are stored on the link) */
railway.envRead = async (token, account, link, http = defaultHttp) => {
  const m = link.meta || {};
  const res = await gql(http, token, "query($p: String!, $e: String!, $s: String!) { variables(projectId: $p, environmentId: $e, serviceId: $s) }", { p: m.projectId, e: m.environmentId, s: m.serviceId });
  if (!res.ok) return fail(res.message ? "Railway: " + res.message.slice(0, 160) : reason(res, "Could not read the Railway variables."));
  const map = res.data?.variables && typeof res.data.variables === "object" ? res.data.variables : {};
  return { ok: true, vars: Object.entries(map).map(([key, value]) => ({ key, value: plainValue(value) })) };
};
railway.envWrite = async (token, account, link, name, value, http = defaultHttp) => {
  const m = link.meta || {};
  const res = await gql(http, token, "mutation($i: VariableUpsertInput!) { variableUpsert(input: $i) }", { i: { projectId: m.projectId, environmentId: m.environmentId, serviceId: m.serviceId, name, value } });
  return res.ok ? { ok: true } : fail(res.message ? "Railway: " + res.message.slice(0, 160) : reason(res, "Railway refused this variable."));
};
railway.deploys = async (token, account, link, http = defaultHttp) => {
  const m = link.meta || {};
  const res = await gql(http, token, "query($i: DeploymentListInput!) { deployments(first: 20, input: $i) { edges { node { id status createdAt meta } } } }", { i: { projectId: m.projectId, serviceId: m.serviceId, environmentId: m.environmentId } });
  if (!res.ok) return fail(res.message ? "Railway: " + res.message.slice(0, 160) : "Could not read the Railway deployments.");
  return { ok: true, deploys: (res.data?.deployments?.edges || []).map((e) => ({ id: String(e.node.id), ...deployOf(e.node.status, e.node.createdAt, e.node.meta?.commitMessage, e.node.meta?.commitHash, e.node.meta?.branch) })) };
};
railway.logs = async (token, account, link, deployId, http = defaultHttp) => {
  const res = await gql(http, token, "query($d: String!) { deploymentLogs(deploymentId: $d, limit: 300) { message timestamp } }", { d: deployId });
  if (!res.ok) return fail(res.message ? "Railway: " + res.message.slice(0, 160) : "Could not read the Railway logs.");
  return { ok: true, lines: logLines((res.data?.deploymentLogs || []).map((l) => ({ at: l.timestamp, text: l.message }))) };
};
railway.setBranch = async (token, account, link, branch, http = defaultHttp) => {
  const m = link.meta || {};
  const res = await gql(http, token, "mutation($s: String!, $e: String!, $i: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $i) }", { s: m.serviceId, e: m.environmentId, i: { branch } });
  return res.ok ? { ok: true, branch } : fail(res.message ? "Railway: " + res.message.slice(0, 160) : "Railway could not change the branch.");
};

/* Cloudflare Pages. Secret variables are never returned, and the API replaces the whole map, so a project
   with secrets is refused rather than risking them. */
const cfProject = (token, account, link, http) => http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects/" + siteId(link), { headers: bearer(token) });
cloudflare.envRead = async (token, account, link, http = defaultHttp) => {
  const res = await cfProject(token, account, link, http);
  if (!res.ok) return fail(res.status === 404 ? "That Cloudflare Pages project no longer exists." : cfError(res, "Could not read the Cloudflare variables."));
  const map = res.body?.result?.deployment_configs?.production?.env_vars || {};
  return { ok: true, vars: Object.entries(map).map(([key, v]) => ({ key, value: v?.type === "plain_text" ? plainValue(v.value) : null })) };
};
cloudflare.envWrite = async (token, account, link, name, value, http = defaultHttp) => {
  const res = await cfProject(token, account, link, http);
  if (!res.ok) return fail(cfError(res, "Could not read the Cloudflare project."));
  const current = res.body?.result?.deployment_configs?.production?.env_vars || {};
  if (Object.values(current).some((v) => v?.type !== "plain_text")) return fail("This Cloudflare project has secret variables, which Stashr cannot read back, so it will not rewrite the list. Change them in Cloudflare.");
  const env_vars = {};
  for (const [key, v] of Object.entries(current)) env_vars[key] = { type: "plain_text", value: v.value };
  env_vars[name] = { type: "plain_text", value };
  const put = await http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects/" + siteId(link), { method: "PATCH", headers: bearer(token), json: { deployment_configs: { production: { env_vars } } } });
  return put.ok ? { ok: true } : fail(cfError(put, "Cloudflare refused this variable."));
};
cloudflare.deploys = async (token, account, link, http = defaultHttp) => {
  const res = await http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects/" + siteId(link) + "/deployments?per_page=20", { headers: bearer(token) });
  if (!res.ok) return fail(cfError(res, "Could not read the Cloudflare deployments."));
  return { ok: true, deploys: (res.body?.result || []).map((d) => ({ id: String(d.id || ""), ...cloudflare.deployOf(d) })) };
};
cloudflare.logs = async (token, account, link, deployId, http = defaultHttp) => {
  const res = await http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects/" + siteId(link) + "/deployments/" + encodeURIComponent(deployId) + "/history/logs", { headers: bearer(token) });
  if (!res.ok) return fail(cfError(res, "Could not read the Cloudflare build log."));
  return { ok: true, lines: logLines((res.body?.result?.data || []).map((l) => ({ at: l.ts, text: l.line }))) };
};
cloudflare.setBranch = async (token, account, link, branch, http = defaultHttp) => {
  const res = await http(CF + "/accounts/" + encodeURIComponent(account.accountId) + "/pages/projects/" + siteId(link), { method: "PATCH", headers: bearer(token), json: { production_branch: branch } });
  return res.ok ? { ok: true, branch } : fail(cfError(res, "Cloudflare could not change the production branch."));
};

const PROVIDERS = { vercel, netlify, railway, cloudflare };
const ids = () => Object.keys(PROVIDERS);

/** A valid Pages/Vercel/Netlify/Railway project name derived from free text. */
const hostName = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 58);

module.exports = { PROVIDERS, ids, hostName, defaultHttp };
