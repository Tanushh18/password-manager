import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getGithubAccounts, getGithubBranches, deleteGithubBranches, getProjectHostLinks } from "../../api/client";
import { readDeployments } from "./ProjectDeployments";
import { UrlMenu, DEPLOY_LABEL } from "./ServerParts";
import { errorMessage, safeUrl, timeAgo } from "../../Pages/Render/renderUtils";
import "./BranchTree.css";

const SORTS = [["name", "Name"], ["deployed", "Deployed first"]];
const parseRepo = (url) => { const m = String(url || "").match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i); return m ? { owner: m[1], repo: m[2] } : null; };

/** Branch → where it runs: each Render server and host site on that branch, with its URL, status and dashboard link. */
function buildTree(branches, servers, links, defaultBranch) {
  const byBranch = new Map();
  const add = (branch, item) => { const key = branch || ""; if (!byBranch.has(key)) byBranch.set(key, []); byBranch.get(key).push(item); };
  for (const s of servers) add(s.branch, { kind: "render", id: s.id, name: s.name, url: s.url, dashboardUrl: s.dashboardUrl, account: s.accountName, status: s.gone ? "gone" : s.suspended ? "suspended" : "live", deploy: s.latestDeploy, env: s.envCount, main: s.isMain, label: "Render" });
  for (const l of links) add(l.branch, { kind: "host", id: l.id || l.linkId, name: l.name || l.label, url: l.url, dashboardUrl: l.dashboardUrl, account: l.accountName, status: l.error ? "unknown" : "live", deploy: l.latestDeploy, env: null, label: l.label || l.provider || "Host", error: l.error });
  const names = new Set(branches.map((b) => b.name));
  const rows = branches.map((b) => ({ name: b.name, isDefault: b.isDefault || b.name === defaultBranch, protected: b.protected, deployed: byBranch.get(b.name) || [] }));
  // Deployments on a branch that no longer exists are shown too, so nothing is hidden.
  for (const [name, items] of byBranch) if (name && !names.has(name)) rows.push({ name, isDefault: false, protected: false, gone: true, deployed: items });
  return rows;
}

const stateLabel = (item) => (item.status === "gone" ? "Deleted on Render" : item.status === "suspended" ? "Suspended" : item.status === "unknown" ? "Unreadable" : "Running");
const deployClass = (status) => (/fail|cancel/.test(status) ? "bad" : status === "live" ? "ok" : "mid");

/** The repository's branches as a tree, with multi-select delete. Each branch opens to show what runs it. Closed by default. */
export default function BranchTree({ project }) {
  const repo = useMemo(() => parseRepo(project.repoUrl), [project.repoUrl]);
  const [account, setAccount] = useState(null); // { id, login } of the GitHub account used
  const [noAccount, setNoAccount] = useState(false);
  const [branches, setBranches] = useState(null); // { default, canDelete, list }
  const [servers, setServers] = useState([]);
  const [links, setLinks] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [sort, setSort] = useState("deployed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadBranches = useCallback(async (accountId) => {
    const r = await getGithubBranches(accountId, project.repoUrl);
    setBranches({ default: r.default, canDelete: r.canDelete, list: r.branches || [], repo: r.repo });
  }, [project.repoUrl]);

  const loadAll = useCallback(async () => {
    if (!repo) return;
    setError("");
    try {
      const accounts = (await getGithubAccounts()).accounts || [];
      const usable = accounts.find((a) => a.valid !== false && a.write) || accounts.find((a) => a.valid !== false);
      if (!usable) { setNoAccount(true); return; }
      setNoAccount(false);
      setAccount({ id: usable.id, login: usable.login });
      await loadBranches(usable.id);
    } catch (e) { setError(errorMessage(e, "Could not read the branches from GitHub.")); }
  }, [repo, loadBranches]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    let live = true;
    Promise.all([readDeployments(project.id).catch(() => null), getProjectHostLinks(project.id).catch(() => ({ links: [] }))]).then(([d, h]) => {
      if (!live) return;
      setServers(d?.servers || []);
      setLinks(h?.links || []);
    });
    return () => { live = false; };
  }, [project.id, (project.renderServices || []).length]);

  const rows = useMemo(() => {
    if (!branches) return [];
    const all = buildTree(branches.list, servers, links, branches.default);
    const sorted = [...all].sort((a, b) => {
      if (sort === "deployed" && (a.deployed.length > 0) !== (b.deployed.length > 0)) return a.deployed.length ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
  }, [branches, servers, links, sort]);

  const deletable = rows.filter((r) => !r.isDefault && !r.gone && !r.protected).map((r) => r.name);
  const togglePick = (name) => setPicked((old) => { const next = new Set(old); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const allPicked = deletable.length > 0 && deletable.every((n) => picked.has(n));

  const removeSelected = async () => {
    const names = [...picked].filter((n) => deletable.includes(n));
    if (!names.length || !account) return;
    const live = rows.filter((r) => names.includes(r.name) && r.deployed.length).map((r) => r.name);
    const msg = `Delete ${names.length} branch${names.length === 1 ? "" : "es"} from GitHub?\n\n${names.join("\n")}` +
      (live.length ? `\n\n⚠ ${live.length} of them run a live server or site: ${live.join(", ")}. Those deployments keep running their last build, but they will stop updating.` : "") +
      "\n\nThe default branch is never deleted. This cannot be undone from Stashr.";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await deleteGithubBranches({ githubAccountId: account.id, url: project.repoUrl, branches: names, live });
      const ok = r.results.filter((x) => x.ok).map((x) => x.name);
      const failed = r.results.filter((x) => !x.ok);
      if (ok.length) toast.success(`Deleted ${ok.length} branch${ok.length === 1 ? "" : "es"}.`);
      failed.forEach((x) => toast.error(`${x.name}: ${x.error}`));
      (r.refused || []).forEach((x) => toast.info(`${x.name}: ${x.reason}`));
      setPicked(new Set());
      await loadBranches(account.id);
    } catch (e) { toast.error(errorMessage(e, "Could not delete the branches.")); }
    finally { setBusy(false); }
  };

  if (!repo) return null;
  const branchUrl = (name) => `https://github.com/${repo.owner}/${repo.repo}/tree/${name.split("/").map(encodeURIComponent).join("/")}`;
  const deployedCount = rows.filter((r) => r.deployed.length).length;

  return (
    <section className="card btree" aria-label="Branches and where they run">
      <header className="btree__head">
        <div>
          <h2>Branches &amp; where they run</h2>
          <p>{branches ? `${rows.length} branch${rows.length === 1 ? "" : "es"} · ${deployedCount} deployed` : noAccount ? "" : "Reading the branches from GitHub…"}</p>
        </div>
        <div className="btree__tools">
          <label className="btree__sort">Sort
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          </label>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadAll()}>↻ Refresh</button>
        </div>
      </header>

      {noAccount ? <p className="field__note">Connect a GitHub token (the GitHub button above) to see and manage this repository’s branches.</p> : null}
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

      {branches && branches.canDelete === false ? <p className="field__note">This GitHub token cannot delete branches. Connect a classic token with the <code>repo</code> scope to delete them here.</p> : null}

      {branches && deletable.length && branches.canDelete ? (
        <div className="btree__bulk">
          <label><input type="checkbox" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(deletable) : new Set())} /> Select all except the default</label>
          <button type="button" className="btn btn--danger btn--sm" disabled={busy || !picked.size} onClick={() => void removeSelected()}>{busy ? "Deleting…" : `Delete ${picked.size} selected`}</button>
        </div>
      ) : null}

      {rows.length ? (
        <ul className="btree__list">
          {rows.map((r) => {
            const live = r.deployed.filter((d) => d.status === "live").length;
            return (
              <li key={r.name} className={"btree__branch" + (r.isDefault ? " is-default" : "") + (r.gone ? " is-gone" : "")}>
                <details>
                  <summary>
                    {branches?.canDelete && !r.isDefault && !r.gone && !r.protected ? (
                      <input type="checkbox" className="btree__check" aria-label={"Select " + r.name} checked={picked.has(r.name)} onClick={(e) => e.stopPropagation()} onChange={() => togglePick(r.name)} />
                    ) : null}
                    <span className="btree__name">⎇ {r.name}</span>
                    {r.isDefault ? <span className="btree__tag">default</span> : null}
                    {r.protected ? <span className="btree__tag">protected</span> : null}
                    {r.gone ? <span className="btree__tag btree__tag--warn">branch missing</span> : null}
                    <span className={"btree__count" + (live ? " is-live" : "")}>{r.deployed.length ? `${r.deployed.length} deployed${live ? " · " + live + " live" : ""}` : "not deployed"}</span>
                  </summary>
                  <div className="btree__body">
                    <a className="btree__gh" href={branchUrl(r.name)} target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a>
                    {r.deployed.length ? (
                      <ul className="btree__leaves">
                        {r.deployed.map((d) => (
                          <li key={d.kind + d.id} className="btree__leaf">
                            <span className="btree__platform">{d.label}{d.main ? " · main" : ""}</span>
                            <strong>{d.name}</strong>
                            <span className={"pdep__pill is-" + (d.status === "live" ? "live" : d.status === "suspended" ? "suspended" : "gone")}>{stateLabel(d)}</span>
                            {d.deploy ? <span className={"pdep__deploy is-" + deployClass(d.deploy.status)}>{DEPLOY_LABEL[d.deploy.status] || d.deploy.status}{d.deploy.at ? " · " + timeAgo(d.deploy.at) : ""}</span> : null}
                            <UrlMenu urls={[d.url]} />
                            {d.account ? <small>{d.account}</small> : null}
                            {d.env != null ? <small>{d.env} env vars</small> : null}
                            {d.dashboardUrl ? <a href={safeUrl(d.dashboardUrl, "")} target="_blank" rel="noopener noreferrer">Open in {d.label} ↗</a> : null}
                            {d.error ? <small className="pdep__err">{d.error}</small> : null}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="field__note">Nothing runs this branch. Switch a server to it from the Deployments table to test it on its own server.</p>}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
