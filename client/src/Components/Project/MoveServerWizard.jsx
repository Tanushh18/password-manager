import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { getRenderAccounts, moveCopyGroups, moveCreate, moveDeleteOld, moveFrontends, moveOrigin, movePlan, movePrepareDomains, moveRelink, moveStatus, moveVerifyDomains } from "../../api/client";
import { errorMessage } from "../../Pages/Render/renderUtils";
import "./MoveServerWizard.css";

const frontendKey = (item) => String(item.ref || item.envGroupId || item.serviceId) + ":" + (item.secretFile ? "file:" : "var:") + item.key;
const frontendTarget = (item) => item.ref
  ? { ref: item.ref, key: item.key }
  : item.envGroupId
    ? { accountId: item.accountId, envGroupId: item.envGroupId, key: item.key, secretFile: Boolean(item.secretFile) }
    : { accountId: item.accountId, serviceId: item.serviceId, key: item.key, secretFile: Boolean(item.secretFile) };

const STEPS = [
  ["plan", "Check the plan"],
  ["create", "Create the new server"],
  ["config", "Copy environment groups"],
  ["live", "Wait until it is live"],
  ["frontends", "Point the frontends at it"],
  ["domains", "Transfer custom domains"],
  ["verify", "Verify the new server"],
  ["relink", "Move the project link"],
  ["delete", "Delete the old server"]
];

/**
 * Moves one Render server to another connected account, step by step. Every step is a button you press; the old
 * server is only deleted at the very end, after the project points at the new one, and only when you type its name.
 */
export default function MoveServerWizard({ projectId, target, open, onClose, onDone, initialTargetAccountId = "" }) {
  const serviceId = target.ref.replace(/^render:/, "");
  const [accounts, setAccounts] = useState([]);
  const [origin, setOrigin] = useState(null);
  const [targetAccountId, setTargetAccountId] = useState(initialTargetAccountId || "");
  const [ownerId, setOwnerId] = useState("");
  const [plan, setPlan] = useState(null);
  const [step, setStep] = useState("plan");
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [live, setLive] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [frontResult, setFrontResult] = useState(null);
  const [configResult, setConfigResult] = useState(null);
  const [domainPrep, setDomainPrep] = useState(null);
  const [domainCheck, setDomainCheck] = useState(null);
  const [dnsAcknowledged, setDnsAcknowledged] = useState(false);
  const [verified, setVerified] = useState(false);
  const [typed, setTyped] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [name, setName] = useState("");
  const activityMessage = {
    plan: "Checking source and destination account access…",
    create: "Creating the replacement server in the destination account…",
    config: "Copying linked environment groups and secret files…",
    live: "Waiting for the replacement server to become live…",
    frontends: "Updating frontend URLs and starting redeploys…",
    domains: "Preparing and verifying custom domains…",
    verify: "Saving the server verification step…",
    relink: "Switching the project link to the replacement server…",
    delete: "Finalizing the move and deleting the old server…"
  };
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInitializing(true);
    const accountsRequest = getRenderAccounts().then((r) => { if (!cancelled) setAccounts((r.accounts || []).filter((a) => a.id !== target.accountId)); }).catch(() => { if (!cancelled) setAccounts([]); });
    const restore = async () => {
      try {
        const info = await moveOrigin(projectId, serviceId);
        if (cancelled) return;
        setOrigin(info);
        const m = info.migration;
        if (!m) return;
        if (m.stage === "relinked" && m.targetServiceId === serviceId) {
          setTargetAccountId(m.targetAccountId);
          setCreated({ serviceId: m.targetServiceId, accountId: m.targetAccountId, name: m.targetName || target.name, url: m.targetUrl || "" });
          setPlan({ source: { serviceId: m.sourceServiceId, accountId: m.sourceAccountId, name: m.sourceName || "Previous server", accountName: m.sourceAccountName || "", url: m.sourceUrl || "", envCount: 0 }, target: { accountId: m.targetAccountId, accountName: m.targetAccountName || "" } });
          const s = await moveStatus(projectId, { accountId: m.targetAccountId, serviceId: m.targetServiceId });
          if (cancelled) return;
          setLive(s); setStep("delete"); return;
        }
        if (m.sourceServiceId !== serviceId || !["created", "config_pending", "domains_preparing", "domains_prepared", "domains_verified"].includes(m.stage)) return;
        setTargetAccountId(m.targetAccountId);
        const p = await movePlan(projectId, { serviceId, targetAccountId: m.targetAccountId, ownerId: "", targetServiceId: m.targetServiceId });
        const s = await moveStatus(projectId, { accountId: m.targetAccountId, serviceId: m.targetServiceId });
        if (cancelled) return;
        setPlan(p); setOwnerId(p.target.ownerId || ""); setName(m.targetName || p.source.name);
        setPicked(new Set(p.frontends.map(frontendKey)));
        setCreated({ serviceId: m.targetServiceId, accountId: m.targetAccountId, name: m.targetName || s.name, url: s.url || m.targetUrl || "" }); setLive(s);
        if (m.stage === "created" || m.stage === "config_pending") {
          setStep(m.configComplete === false ? "config" : s.ready ? "frontends" : "live");
          return;
        }
        if (m.stage === "domains_preparing") { setDomainPrep(null); setStep("domains"); return; }
        setDomainPrep({ expectedDomains: m.domains || [], domains: [], targetUrl: s.url || m.targetUrl || "", dnsTarget: (() => { try { return new URL(s.url || m.targetUrl).hostname; } catch { return ""; } })(), detachedFromOld: [] });
        if (m.stage === "domains_verified") { setDomainCheck({ verified: true, domains: [] }); setStep("verify"); }
        else { setDomainCheck(null); setDnsAcknowledged(false); setStep("domains"); }
      } catch (e) { if (!cancelled) setError(errorMessage(e, "Could not resume the saved migration. The old server has not been deleted.")); }
      finally { await accountsRequest; if (!cancelled) setInitializing(false); }
    };
    void restore();
    return () => { cancelled = true; };
  }, [open, target.accountId, target.name, projectId, serviceId]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(errorMessage(e, "That step failed.")); } finally { setBusy(false); }
  };

  const doPlan = () => run(async () => {
    const p = await movePlan(projectId, { serviceId, targetAccountId, ownerId });
    setPlan(p); setOwnerId(p.target.ownerId); setName(p.source.name);
    setPicked(new Set(p.frontends.map(frontendKey)));
  });

  const doCreate = () => run(async () => {
    const c = await moveCreate(projectId, { serviceId, targetAccountId, ownerId, name });
    setCreated(c);
    setConfigResult(null);
    setStep(c.configComplete ? "live" : "config");
  });

  const doCopyGroups = () => run(async () => {
    if (!created?.serviceId || !created?.accountId) throw new Error("The replacement server has not been created yet.");
    const result = await moveCopyGroups(projectId, { sourceServiceId: serviceId, targetAccountId: created.accountId, targetServiceId: created.serviceId });
    setConfigResult(result);
    if (!result.complete) {
      const failed = (result.groups || []).filter((g) => !g.copied);
      throw new Error("Some linked environment groups were not copied. " + failed.map((g) => (g.name || g.sourceGroupId) + ": " + (g.error || "retry required")).join(" · "));
    }
    const s = await moveStatus(projectId, { accountId: created.accountId, serviceId: created.serviceId });
    setLive(s);
    // The copy step queues a new build. Wait for that deploy to become live before touching frontend config.
    setStep(result.deployRequested || !s.ready ? "live" : "frontends");
  });

  // While the new server builds, ask Render every few seconds.
  const poll = useCallback(async () => {
    if (!created) return;
    try {
      const s = await moveStatus(projectId, { accountId: created.accountId, serviceId: created.serviceId });
      setLive(s);
      if (s.ready) {
        // The new service now exists in Render; refresh the URL-reference inventory so its copied env vars can be migrated too.
        const refreshedPlan = await movePlan(projectId, { serviceId, targetAccountId: created.accountId, targetServiceId: created.serviceId });
        setPlan(refreshedPlan);
        setPicked(new Set(refreshedPlan.frontends.map(frontendKey)));
        setStep((cur) => (cur === "live" ? "frontends" : cur));
      } else if (/fail|cancel/.test(s.deploy?.status || "")) {
        setError("The new server's deploy failed. Check it in Render; the old server is untouched.");
      }
    } catch (e) { setError(errorMessage(e, "Could not read the new server.")); }
  }, [created, projectId]);
  useEffect(() => {
    if (step !== "live" || !created) return undefined;
    void poll();
    timer.current = setInterval(() => void poll(), 8000);
    return () => clearInterval(timer.current);
  }, [step, created, poll]);
  // Before the project link moves, the replacement's latest Render deploy must be Live. Show it and keep checking.
  useEffect(() => {
    if (step !== "relink" || !created) return undefined;
    const check = () => moveStatus(projectId, { accountId: created.accountId, serviceId: created.serviceId })
      .then((s) => setLive(s))
      .catch((e) => setError(errorMessage(e, "Could not read the new server.")));
    void check();
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
  }, [step, created, projectId]);

  const newUrl = live?.url || created?.url || "";
  const doFrontends = () => run(async () => {
    const targets = plan.frontends.filter((f) => picked.has(frontendKey(f))).map(frontendTarget);
    const result = targets.length
      ? await moveFrontends(projectId, { fromUrl: plan.source.url, toUrl: newUrl, targets, deploy: true })
      : { changed: 0, results: [] };
    setFrontResult(result);
    const failures = (result.results || []).filter((item) => !item.ok);
    if (failures.length) {
      setError("Some frontend environment updates or redeploys failed. Fix or retry those services before continuing.");
      return;
    }
    // A custom domain on the client/static site is independent of the backend's Render domain mapping.
    // Only run the DNS cutover step if the source backend itself has custom domains attached.
    if (!plan.domains?.length) {
      const prepared = await movePrepareDomains(projectId, { sourceServiceId: serviceId, targetAccountId: created.accountId, targetServiceId: created.serviceId });
      setDomainPrep(prepared);
      setDomainCheck({ verified: true, domains: [] });
      setStep("verify");
      return;
    }
    setStep("domains");
  });
  const doPrepareDomains = () => run(async () => {
    if (!created?.accountId || !created?.serviceId) throw new Error("The replacement server has not been created yet.");
    const result = await movePrepareDomains(projectId, { sourceServiceId: serviceId, targetAccountId: created.accountId, targetServiceId: created.serviceId });
    setDomainPrep(result);
    setDomainCheck(null);
    if (!result.expectedDomains?.length) {
      setDomainCheck({ verified: true, domains: [] });
      setStep("verify");
    }
  });
  const doVerifyDomains = () => run(async () => {
    const result = await moveVerifyDomains(projectId, { accountId: created.accountId, serviceId: created.serviceId });
    setDomainCheck(result);
    if (result.verified) setStep("verify");
    else setError("Render has not verified every domain yet. Check the DNS records and try again after propagation.");
  });
  const doRelink = () => run(async () => {
    await moveRelink(projectId, { oldServiceId: serviceId, newAccountId: created.accountId, newServiceId: created.serviceId, newName: live?.name || created.name, newUrl });
    setStep("delete");
    onDone?.();
  });
  const doDelete = () => run(async () => {
    await moveDeleteOld(projectId, { serviceId: plan?.source?.serviceId || serviceId, accountId: plan?.source?.accountId || target.accountId, confirmName: typed, newServiceId: created?.serviceId, newAccountId: created?.accountId });
    toast.success("Moved. The old server is deleted.");
    setStep("done");
    onDone?.();
  });

  const visibleSteps = plan && !plan.domains?.length ? STEPS.filter(([id]) => id !== "domains") : STEPS;
  const order = visibleSteps.map((s) => s[0]);
  const state = (id) => (step === "done" || order.indexOf(id) < order.indexOf(step) ? "done" : id === step ? "active" : "todo");

  return (
    <Modal open={open} onClose={busy || initializing ? () => {} : onClose} center classNames={{ modal: "mv-modal" }}>
      <h2 className="mv__title">Move {target.name} to another account</h2>
      <p className="field__note">The new server is built first, and the old one is deleted last. You can stop at any step: nothing is deleted until the final one.</p>
      <ol className="mv__steps">
        {visibleSteps.map(([id, label]) => <li key={id} className={"is-" + state(id)}><span className="mv__dot">{state(id) === "done" ? "✓" : ""}</span>{label}</li>)}
      </ol>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}
      {initializing ? (
        <div className="mv__activity" role="status" aria-live="polite">
          <span className="mv__spinner" aria-hidden="true" />
          <div className="mv__activity-copy">
            <strong>Preparing account change</strong>
            <span>Connecting to Render and checking whether a previous migration needs to resume…</span>
          </div>
        </div>
      ) : null}
      {busy ? (
        <div className="mv__activity" role="status" aria-live="polite">
          <span className="mv__spinner" aria-hidden="true" />
          <div className="mv__activity-copy">
            <strong>{activityMessage[step] || "Working on the account migration…"}</strong>
            <span>Render is processing this step. Keep this window open; the old server is kept until the final confirmation.</span>
          </div>
        </div>
      ) : null}

      {!initializing && step === "plan" ? (
        <div className="mv__panel">
          <div className="field">
            <label className="field__label" htmlFor="mv-acc">Move to this account</label>
            <select id="mv-acc" className="input" value={targetAccountId} disabled={busy} onChange={(e) => { setTargetAccountId(e.target.value); setPlan(null); }}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === origin?.originalAccountId ? " (original account)" : ""}</option>)}
            </select>
            {origin?.canReturn && origin.available && accounts.some((a) => a.id === origin.originalAccountId) ? (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setTargetAccountId(origin.originalAccountId); setPlan(null); setOwnerId(""); }}>
                Return to original account: {origin.originalAccountName || "original"}
              </button>
            ) : null}
          </div>
          {!plan ? <button type="button" className="btn btn--primary" disabled={busy || !targetAccountId} onClick={() => void doPlan()}>{busy ? "Checking…" : "Check the plan"}</button> : (
            <>
              <dl className="mv__facts">
                <div><dt>Server</dt><dd>{plan.source.name} · {plan.source.accountName}</dd></div>
                <div><dt>Address</dt><dd>{plan.source.url || "—"}</dd></div>
                <div><dt>Branch · plan · region</dt><dd>{[plan.source.branch, plan.source.plan, plan.source.region].filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt>Direct environment variables</dt><dd>{plan.source.envCount}</dd></div>
                <div><dt>Direct secret files</dt><dd>{plan.source.secretFileCount || 0}</dd></div>
                <div><dt>Linked environment groups</dt><dd>{plan.source.envGroupCount || 0}</dd></div>
                <div><dt>Connected URL references to review</dt><dd>{plan.frontends.length}</dd></div>
              </dl>
              {plan.warnings.map((w) => <div key={w} className="notice" role="status">{w}</div>)}
              {plan.target.owners.length > 1 ? (
                <div className="field"><label className="field__label" htmlFor="mv-owner">Workspace in {plan.target.accountName}</label>
                  <select id="mv-owner" className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">Choose…</option>{plan.target.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              ) : null}
              <div className="field"><label className="field__label" htmlFor="mv-name">Name of the new server</label>
                <input id="mv-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
              <button type="button" className="btn btn--primary" disabled={busy || !ownerId || !name.trim()} onClick={() => { setStep("create"); }}>Continue</button>
            </>
          )}
        </div>
      ) : null}

      {!initializing && step === "create" ? (
        <div className="mv__panel">
          <p>This creates <b>{name}</b> in <b>{plan?.target.accountName}</b> from the same repository and branch, with all {plan?.source.envCount} variables. The old server keeps running.</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void doCreate()}>{busy ? "Creating…" : "Create the new server"}</button>
        </div>
      ) : null}

      {!initializing && step === "config" ? (
        <div className="mv__panel">
          <p>Direct environment variables and service-level secret files are copied when the replacement is created. Linked Render Environment Groups need a separate copy so their variables and secret files remain available in the new account.</p>
          <p><b>Linked groups:</b> {plan?.source?.envGroupCount ?? created?.envGroupCount ?? 0}</p>
          {plan?.config?.envGroups?.length ? <ul className="mv__refs">{plan.config.envGroups.map((g) => <li key={g.id}><b>{g.name}</b> · {g.envVarCount} variables · {g.secretFileCount} secret files{g.environmentScoped ? " · source environment-scoped" : ""}</li>)}</ul> : null}
          {plan?.source?.secretFileCount ? <p className="field__note">Copied {plan.source.secretFileCount} direct secret file(s); file contents are not displayed.</p> : null}
          {configResult?.groups?.length ? <ul className="mv__refs">{configResult.groups.map((g) => <li key={g.sourceGroupId}><b>{g.name}</b> · {g.copied ? "copied" : g.error || "failed"}{g.environmentScopeFlattened ? " · copied as a destination workspace-level group" : ""}</li>)}</ul> : null}
          <p className="field__note">Render environment IDs are workspace-specific. An environment-scoped group is copied into the target workspace and linked only to the replacement; review its scope if the source group was environment-scoped.</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void doCopyGroups()}>{busy ? "Copying configuration…" : configResult?.complete ? "Verify copied configuration" : (plan?.source?.envGroupCount ?? created?.envGroupCount ?? 0) ? "Copy linked environment groups" : "Confirm configuration"}</button>
        </div>
      ) : null}

      {!initializing && step === "live" ? (
        <div className="mv__panel">
          <div className="mv__activity mv__activity--live" role="status" aria-live="polite">
            <span className="mv__spinner" aria-hidden="true" />
            <div className="mv__activity-copy">
              <strong>Building {created?.name || "the replacement server"} in the destination account</strong>
              <span>Render status: {live?.deploy?.status ? live.deploy.status.replace(/_/g, " ") : "starting"} · The original server is still running.</span>
            </div>
            <div className="mv__progress" aria-hidden="true"><span /></div>
          </div>
          <p className="field__note">Checking Render every few seconds. The wizard advances automatically once the replacement is live.</p>
        </div>
      ) : null}

      {!initializing && step === "frontends" ? (
        <div className="mv__panel">
          <p>New address: <a href={newUrl} target="_blank" rel="noopener noreferrer">{newUrl || "—"}</a></p>
          {plan.frontends.length ? (
            <>
              <p className="field__note">These variables still hold the old address. Untick any you want to leave.</p>
              <ul className="mv__refs">
                {plan.frontends.map((f) => {
                  const key = frontendKey(f);
                  return <li key={key}><label><input type="checkbox" checked={picked.has(key)} onChange={() => setPicked((old) => { const n = new Set(old); if (n.has(key)) n.delete(key); else n.add(key); return n; })} /> <b>{f.serviceName}</b> · <code>{f.secretFile ? "secret file " : "env "}{f.key}</code> <small>{f.accountName}</small></label></li>;
                })}
              </ul>
              <p className="field__note">Selected variables and secret files will be updated and the affected services redeployed. Warning: a selected shared Render Environment Group changes every service linked to that group, not just this project.</p>
            </>
          ) : <p className="field__note">No other service holds the old address, so there is nothing to change.</p>}
          {frontResult?.results?.some((item) => !item.ok) ? <div className="notice notice--err" role="alert">{frontResult.results.filter((item) => !item.ok).map((item) => <p key={item.serviceId || item.envGroupId || item.ref || item.key}>{item.serviceName || item.ref || item.serviceId || item.envGroupName}: {item.error || "Update failed"}</p>)}</div> : null}
          <button type="button" className="btn btn--primary" disabled={busy || !newUrl} onClick={() => void doFrontends()}>{busy ? "Updating…" : frontResult?.results?.some((item) => !item.ok) ? "Retry failed updates" : plan.frontends.length ? "Update the frontends" : "Continue"}</button>
        </div>
      ) : null}

      {!initializing && step === "domains" ? (
        <div className="mv__panel">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setStep("frontends")}>Back to frontend URL updates</button>
          <p>Custom domains are separate from the generated Render URL. This DNS check is read-only: it reports observed CNAME/A/AAAA records but cannot edit your registrar or DNS provider. Render can transfer the domain mapping, while hard-coded old server URLs inside source code still need manual review.</p>
          {!domainPrep ? (
            <>
              <p>{plan?.domains?.length ? "Domains on the old service: " + plan.domains.map((d) => d.name).join(", ") : "No existing custom domains were found on the old service."}</p>
              {plan?.domains?.length ? (
                <>
                  <p><b>New Render target:</b> <code>{(() => { try { return new URL(newUrl).hostname; } catch { return newUrl || "—"; } })()}</code></p>
                  <ul className="mv__refs">{plan.domains.map((d) => <li key={d.name}><b>{d.name}</b> · DNS preflight: {d.dns?.status === "points_to_old_target" ? "CNAME still points to the old Render hostname; change it to the new target" : d.dns?.status === "points_to_target" ? "CNAME points to the replacement hostname" : d.dns?.status === "other_cname" ? "CNAME points to a different host; verify this is intentional" : d.domainType === "apex" ? "No CNAME detected; for an apex/root use the provider-specific Render A or ALIAS/ANAME instructions (Cloudflare uses CNAME flattening)" : "No CNAME detected; check the provider-specific subdomain CNAME record"}{d.dns?.cname?.length ? <div className="field__note">CNAME: {d.dns.cname.join(", ")}</div> : null}{d.dns?.a?.length ? <div className="field__note">A: {d.dns.a.join(", ")}</div> : null}{d.dns?.aaaa?.length ? <div className="field__note">AAAA: {d.dns.aaaa.join(", ")} · Render recommends removing AAAA records because it uses IPv4.</div> : null}</li>)}</ul>
                  <p className="field__note">For a subdomain such as www, set its CNAME to the new Render hostname shown above. For an apex/root domain, follow Render's DNS instructions for your provider: this may be A record 216.24.57.1 or ALIAS/ANAME; Cloudflare uses CNAME flattening. Render uses IPv4, so remove conflicting AAAA records. This tool only reads DNS and cannot edit your DNS provider.</p>
                  <label className="field__note"><input type="checkbox" checked={dnsAcknowledged} onChange={(e) => setDnsAcknowledged(e.target.checked)} /> I have updated or verified the domain DNS records for the new Render target.</label>
                </>
              ) : null}
              <button type="button" className="btn btn--primary" disabled={busy || Boolean(plan?.domains?.length && !dnsAcknowledged)} onClick={() => void doPrepareDomains()}>{busy ? "Preparing…" : plan?.domains?.length ? "Transfer custom domains to new server" : "Confirm no custom domains"}</button>
            </>
          ) : (
            <>
              {domainPrep.detachedFromOld?.length ? <div className="notice notice--err" role="alert">Render required these domains to be released from the old service before attaching them to the new one: {domainPrep.detachedFromOld.join(", ")}. Update DNS promptly and verify below; do not delete the old server until verification succeeds.</div> : null}
              {domainPrep.expectedDomains?.length ? (
                <>
                  <p><b>New Render target:</b> <code>{domainPrep.dnsTarget || newUrl}</code></p>
                  <ul className="mv__refs">
                    {domainPrep.expectedDomains.map((name) => {
                      const found = domainPrep.domains?.find((d) => d.name === name);
                      const status = domainCheck?.domains?.find((d) => d.name === name)?.verificationStatus || found?.verificationStatus || "pending";
                      return <li key={name}><b>{name}</b> · <span>{status}</span></li>;
                    })}
                  </ul>
                  <p className="field__note">The DNS target should now point at the replacement service. Render verification checks the current DNS configuration; an old service's verified status does not automatically make the new service verified. If verification fails, check the provider records and retry after DNS propagation.</p>
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void doVerifyDomains()}>{busy ? "Checking…" : "Verify custom domains"}</button>
                  {domainCheck && !domainCheck.verified ? <p className="field__note">Not all domains are verified yet. DNS propagation can take time; leave the old service in place and retry.</p> : null}
                </>
              ) : <p className="field__note">No custom domains need to move. Continue to the service checks.</p>}
              {!domainPrep.expectedDomains?.length ? <button type="button" className="btn btn--primary" onClick={() => setStep("verify")}>Continue</button> : null}
            </>
          )}
        </div>
      ) : null}

      {!initializing && step === "verify" ? (
        <div className="mv__panel">
          {frontResult ? <p className="field__note">Changed {frontResult.changed} variable{frontResult.changed === 1 ? "" : "s"}.</p> : null}
          {plan?.domains?.length ? <p>Verify the backend custom domains below and confirm the frontend still loads them correctly.</p> : <p>No custom domain is attached to this backend. The existing Stashr client domain stays on the client service; only its backend API URL is being updated here.</p>}
          <p>Open the new address and a frontend, and use one feature that calls the server.</p>
          <p><a href={newUrl} target="_blank" rel="noopener noreferrer">{newUrl}</a></p>
          <label className="field__note"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> I checked it and the new server answers</label>
          <button type="button" className="btn btn--primary" disabled={!verified} onClick={() => setStep("relink")}>Continue</button>
        </div>
      ) : null}

      {!initializing && step === "relink" ? (
        <div className="mv__panel">
          <p>The project will point at <b>{live?.name || created?.name}</b> instead of the old server. Nothing is deleted yet.</p>
          {live?.ready ? (
            <>
              <div className="mv__activity" role="status" aria-live="polite">
                <strong>Replacement deploy is Live.</strong>
              </div>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void doRelink()}>{busy ? "Saving…" : "Move the project link"}</button>
            </>
          ) : (
            <>
              <div className="mv__activity mv__activity--live" role="status" aria-live="polite">
                <span className="mv__spinner" aria-hidden="true" />
                <div className="mv__activity-copy">
                  <strong>Waiting for the replacement deploy to go Live</strong>
                  <span>Render status: {live?.deploy?.status ? live.deploy.status.replace(/_/g, " ") : "checking"} · The old server is still linked.</span>
                </div>
                <div className="mv__progress" aria-hidden="true"><span /></div>
              </div>
              <p className="field__note">Checking Render every few seconds. Continue unlocks when the deploy is Live.</p>
              <button type="button" className="btn btn--primary" disabled>Move the project link</button>
            </>
          )}
        </div>
      ) : null}

      {!initializing && step === "delete" ? (
        <div className="mv__panel mv__danger">
          <p>The last step. This permanently deletes <b>{plan?.source.name}</b> from {plan?.source.accountName}. Keep it a day first if you want a fallback. Its variables are all on the new server.</p>
          <div className="field"><label className="field__label" htmlFor="mv-type">Type <code>{plan?.source.name}</code> to confirm</label>
            <input id="mv-type" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div>
          <label className="field__note"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand this cannot be undone</label>
          <div className="gh-panel__row">
            <button type="button" className="btn btn--danger" disabled={busy || typed !== plan?.source.name || !understood} onClick={() => void doDelete()}>{busy ? "Deleting…" : "Delete the old server"}</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>Keep it for now</button>
          </div>
        </div>
      ) : null}

      {!initializing && step === "done" ? (
        <div className="mv__panel">
          <p><b>Done.</b> {created?.name} is the project’s server in {plan?.target.accountName}.</p>
          <button type="button" className="btn btn--primary" onClick={onClose}>Close</button>
        </div>
      ) : null}
    </Modal>
  );
}
