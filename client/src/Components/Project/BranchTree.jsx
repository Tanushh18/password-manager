import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getGithubAccounts, getGithubBranches, deleteGithubBranches, getDeployTargets } from "../../api/client";
import { UrlMenu, DEPLOY_LABEL, PlatformBadge } from "./DeployParts";
import { errorMessage, safeUrl, timeAgo } from "../../Pages/Render/renderUtils";
import "./BranchTree.css";

const SORTS = [["name", "Name"], ["deployed", "Deployed first"]];
const parseRepo = (url) => { const m = String(url || "").match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i); return m ? { owner: m[1], repo: m[2] } : null; };

/** Branch → every server (any provider) that runs it, with its URL, status and dashboard link. */
function buildTree(branches, targets, defaultBranch) {
  const byBranch = new Map();
  for (const t of targets) { const key = t.branch || ""; if (!byBranch.has(key)) byBranch.set(key, []); byBranch.get(key).push(t); }
  const names = new Set(branches.map((b) => b.name));
  const rows = branches.map((b) => ({ name: b.name, isDefault: b.isDefault || b.name === defaultBranch, protected: b.protected, deployed: byBranch.get(b.name) || [] }));
  // Servers on a branch that no longer exists are still shown, so nothing is hidden.
  for (const [name, items] of byBranch) if (name && !names.has(name)) rows.push({ name, isDefault: false, protected: false, gone: true, deployed: items });
  return rows;
}

const liveOf = (t) => !t.suspended && !(t.error && !t.url) && !/fail|error|cancel/.test(String(t.latestDeploy?.status || ""));
const stateOf = (t) => (t.suspended ? "Suspended" : t.error && !t.url ? "Unreadable" : DEPLOY_LABEL[String(t.latestDeploy?.status || "").toLowerCase()] || "Running");

/** The repository's branches as a tree, with multi-select delete. Each branch opens to show what runs it. Closed by default. */
export default function BranchTree({ project, refreshKey, hideRefresh }) {
  const repo = useMemo(() => parseRepo(project.repoUrl), [project.repoUrl]);
  const [account, setAccount] = useState(null);
  const [noAccount, setNoAccount] = useState(false);
  const [branches, setBranches] = useState(null);
  const [targets, setTargets] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [sort, setSort] = useState("deployed");
  const [showAll, setShowAll] = useState(false);
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
  useEffect(() => { if (refreshKey) void loadAll(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    getDeployTargets(project.id).then((r) => { if (live) setTargets(r.targets || []); }).catch(() => { if (live) setTargets([]); });
    return () => { live = false; };
  }, [project.id, (project.renderServices || []).length, (project.hostLinks || []).length]);

  const rows = useMemo(() => {
    if (!branches) return [];
    const all = buildTree(branches.list, targets, branches.default);
    const sorted = [...all].sort((a, b) => {
      if (sort === "deployed" && (a.deployed.length > 0) !== (b.deployed.length > 0)) return a.deployed.length ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
  }, [branches, targets, sort]);

  const deletable = rows.filter((r) => !r.isDefault && !r.gone && !r.protected).map((r) => r.name);
  const togglePick = (name) => setPicked((old) => { const next = new Set(old); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const allPicked = deletable.length > 0 && deletable.every((n) => picked.has(n));

  const removeSelected = async () => {
    const names = [...picked].filter((n) => deletable.includes(n));
    if (!names.length || !account) return;
    const live = rows.filter((r) => names.includes(r.name) && r.deployed.some(liveOf)).map((r) => r.name);
    const msg = `Delete ${names.length} branch${names.length === 1 ? "" : "es"} from GitHub?\n\n${names.join("\n")}` +
      (live.length ? `\n\n⚠ ${live.length} of them run a live server or site: ${live.join(", ")}. Those deployments keep running their last build, but they will stop updating.` : "") +
      "\n\nThe default branch is never deleted. This cannot be undone from Stashr.";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await deleteGithubBranches({ githubAccountId: account.id, url: project.repoUrl, branches: names, live });
      const ok = r.results.filter((x) => x.ok).map((x) => x.name);
      if (ok.length) toast.success(`Deleted ${ok.length} branch${ok.length === 1 ? "" : "es"}.`);
      r.results.filter((x) => !x.ok).forEach((x) => toast.error(`${x.name}: ${x.error}`));
      (r.refused || []).forEach((x) => toast.info(`${x.name}: ${x.reason}`));
      setPicked(new Set());
      await loadBranches(account.id);
    } catch (e) { toast.error(errorMessage(e, "Could not delete the branches.")); }
    finally { setBusy(false); }
  };

  if (!repo) return null;
  const branchUrl = (name) => `https://github.com/${repo.owner}/${repo.repo}/tree/${name.split("/").map(encodeURIComponent).join("/")}`;
  const deployedCount = rows.filter((r) => r.deployed.length).length;
  const LIMIT = 6; // the default branch and the deployed ones sort first; the rest wait behind "Show all"
  const shownRows = showAll ? rows : rows.slice(0, LIMIT);

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
          {hideRefresh ? null : <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadAll()}>↻ Refresh</button>}
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
          {shownRows.map((r) => {
            const live = r.deployed.filter(liveOf).length;
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
                        {r.deployed.map((t) => (
                          <li key={t.ref} className="btree__leaf">
                            <PlatformBadge target={t} />
                            <strong>{t.name}</strong>
                            <span className={"pdep__pill is-" + (liveOf(t) ? "live" : t.suspended ? "suspended" : "gone")}>{stateOf(t)}</span>
                            {t.latestDeploy ? <span className="pdep__deploy is-mid">{DEPLOY_LABEL[String(t.latestDeploy.status).toLowerCase()] || t.latestDeploy.status}{t.latestDeploy.at ? " · " + timeAgo(t.latestDeploy.at) : ""}</span> : null}
                            <UrlMenu urls={[t.url]} />
                            {t.accountName ? <small>{t.accountName}</small> : null}
                            {t.dashboardUrl ? <a href={safeUrl(t.dashboardUrl, "")} target="_blank" rel="noopener noreferrer">Open in {t.label} ↗</a> : null}
                            {t.error ? <small className="pdep__err">{t.error}</small> : null}
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
      {rows.length > LIMIT ? <button type="button" className="btn btn--ghost btn--sm btree__more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${rows.length} branches`}</button> : null}
    </section>
  );
}
