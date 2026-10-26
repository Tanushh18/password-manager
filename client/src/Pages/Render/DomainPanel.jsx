import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getCustomDomains, addCustomDomain, verifyCustomDomain, removeCustomDomain, getRegistry, saveRegistry, findUrlReferences, replaceUrlReferences } from "../../api/client";
import { Section, Skeleton } from "./RenderUi";
import { errorMessage, timeAgo } from "./renderUtils";

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return ""; } };
const RENDER_APEX_IP = "216.24.57.1";

/**
 * A service's addresses: its Render URL, custom domains (add / verify / remove) and which apps use it through
 * the Stashr server registry. "Use in web + app" puts the new address first in that app's registry list, so the
 * website and the mobile app switch to it on their next start, with no redeploy; the old address stays as backup.
 */
export default function DomainPanel({ service, askConfirm, onAudit }) {
  const renderUrl = service.serviceDetails?.url || "";
  const renderHost = hostOf(renderUrl);
  const [domains, setDomains] = useState(null);
  const [registry, setRegistry] = useState(null); // null = loading, [] = none / not admin
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { setDomains((await getCustomDomains(service.accountId, service.id)).domains || []); }
    catch (e) { setDomains([]); toast.error(errorMessage(e, "Could not read the custom domains.")); }
    try { setRegistry((await getRegistry()).data.apps || []); } catch { setRegistry([]); }
  }, [service.accountId, service.id]);
  useEffect(() => { void load(); }, [load]);

  const hosts = useMemo(() => [renderHost, ...(domains || []).map((d) => d.name.toLowerCase())].filter(Boolean), [renderHost, domains]);
  const usedBy = useMemo(() => (registry || []).map((app) => ({ ...app, match: app.urls.find((u) => hosts.includes(hostOf(u))) })).filter((a) => a.match), [registry, hosts]);

  /* Frontends that bake this address into env vars (no registry): find them and switch them. */
  const [refs, setRefs] = useState(null);
  const [pick, setPick] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const addresses = useMemo(() => [renderUrl, ...(domains || []).map((d) => "https://" + d.name)].filter(Boolean).map((u) => u.replace(/\/+$/, "")), [renderUrl, domains]);
  // Only addresses that already work can be switched to: the Render URL and verified domains.
  const usable = useMemo(() => [renderUrl, ...(domains || []).filter((d) => d.verificationStatus === "verified").map((d) => "https://" + d.name)].filter(Boolean).map((u) => u.replace(/\/+$/, "")), [renderUrl, domains]);
  useEffect(() => { if (!from && addresses.length) setFrom(addresses[0]); }, [addresses]); // eslint-disable-line react-hooks/exhaustive-deps
  const scanRefs = async () => {
    setBusy("scan");
    try { const r = await findUrlReferences(from); setRefs(r.references || []); setPick((r.references || []).map((x) => x.serviceId + "|" + x.key)); }
    catch (err) { toast.error(errorMessage(err, "Could not scan.")); }
    finally { setBusy(""); }
  };
  const switchRefs = async () => {
    const targets = (refs || []).filter((x) => pick.includes(x.serviceId + "|" + x.key));
    if (!targets.length || !to || to === from) return;
    const ok = await askConfirm({ title: "Switch " + targets.length + " variable" + (targets.length === 1 ? "" : "s") + " to " + to + "?", message: targets.map((x) => x.serviceName + " → " + x.key).join(", ") + ". Only the address part is changed; each changed service is redeployed so the new address is built in.", confirmLabel: "Switch and redeploy" });
    if (!ok) return;
    setBusy("switch");
    try {
      const r = await replaceUrlReferences({ fromUrl: from, toUrl: to, targets: targets.map((x) => ({ accountId: x.accountId, serviceId: x.serviceId, key: x.key })), deploy: true });
      const failed = r.results.filter((x) => !x.ok);
      toast.success(r.changed + " variable" + (r.changed === 1 ? "" : "s") + " switched; " + r.results.filter((x) => x.deployed).length + " service(s) redeploying.");
      if (failed.length) toast.error(failed.length + " service(s) failed: " + failed.map((x) => x.error).join("; "));
      await scanRefs();
      onAudit?.();
    } catch (err) { toast.error(errorMessage(err, "Could not switch.")); }
    finally { setBusy(""); }
  };

  const add = async (e) => {
    e.preventDefault();
    const value = name.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!value) return;
    setBusy("add");
    try { await addCustomDomain(service.accountId, service.id, value); setName(""); toast.success(value + " added. Create the DNS record below, then press Verify."); await load(); onAudit?.(); }
    catch (err) { toast.error(errorMessage(err, "Render did not accept this domain.")); }
    finally { setBusy(""); }
  };
  const verify = async (d) => {
    setBusy("v" + d.name);
    try { await verifyCustomDomain(service.accountId, service.id, d.name); toast.info("Verification requested. DNS changes can take a few minutes."); await load(); }
    catch (err) { toast.error(errorMessage(err, "Verification failed. Check the DNS record.")); }
    finally { setBusy(""); }
  };
  const remove = async (d) => {
    const ok = await askConfirm({ title: "Remove " + d.name + "?", message: "The service stops answering on this domain. Apps that use it should be switched first.", confirmLabel: "Remove domain", danger: true });
    if (!ok) return;
    setBusy("r" + d.name);
    try { await removeCustomDomain(service.accountId, service.id, d.name); toast.success("Removed."); await load(); onAudit?.(); }
    catch (err) { toast.error(errorMessage(err, "Could not remove the domain.")); }
    finally { setBusy(""); }
  };
  const applyInApp = async (app, url) => {
    const suffix = pathOf(app.match);
    const next = url.replace(/\/+$/, "") + suffix;
    const urls = [next, ...app.urls.filter((u) => u !== next)].slice(0, 10);
    const ok = await askConfirm({ title: "Point " + (app.label || app.app) + " at " + next + "?", message: "The website and the mobile app of " + (app.label || app.app) + " use this address first from their next start (no redeploy). The others stay as backups: " + urls.slice(1).join(", "), confirmLabel: "Use in web + app" });
    if (!ok) return;
    setBusy("a" + app.app);
    try { await saveRegistry(app.app, urls); toast.success((app.label || app.app) + " now uses " + next + "."); await load(); }
    catch (err) { toast.error(errorMessage(err, "Could not update the server list.")); }
    finally { setBusy(""); }
  };

  const dnsFor = (d) => (d.name.split(".").length <= 2
    ? { type: "A", host: "@ (" + d.name + ")", value: RENDER_APEX_IP }
    : { type: "CNAME", host: d.name.split(".")[0], value: renderHost || "<service>.onrender.com" });

  return (
    <div className="rd-stack">
      <Section title="Addresses" subtitle="Where this service answers. Add your own domain here; Render issues the HTTPS certificate automatically.">
        <ul className="rd-domains">
          <li><span className="rd-domains__name"><a href={renderUrl} target="_blank" rel="noreferrer noopener">{renderHost || "—"}</a></span><span className="rd-chip-ok">Render URL · always on</span></li>
          {domains == null ? <li><Skeleton lines={2} /></li> : domains.map((d) => {
            const ok = d.verificationStatus === "verified";
            const dns = dnsFor(d);
            return (
              <li key={d.id || d.name} className={ok ? "" : "is-pending"}>
                <span className="rd-domains__name"><a href={"https://" + d.name} target="_blank" rel="noreferrer noopener">{d.name}</a>{d.redirectForName ? <small>redirects to {d.redirectForName}</small> : null}</span>
                <span className={ok ? "rd-chip-ok" : "rd-chip-warn"}>{ok ? "Verified" : "Waiting for DNS"}</span>
                {!ok && <span className="rd-dns">Create <b>{dns.type}</b> record · name <code>{dns.host}</code> · value <code>{dns.value}</code></span>}
                <span className="rd-domains__actions">
                  {!ok && <button type="button" className="rd-btn rd-btn--quiet" disabled={Boolean(busy)} onClick={() => void verify(d)}>{busy === "v" + d.name ? "Checking…" : "Verify"}</button>}
                  <button type="button" className="rd-btn rd-btn--danger-quiet" disabled={Boolean(busy)} onClick={() => void remove(d)}>Remove</button>
                </span>
              </li>
            );
          })}
        </ul>
        <form className="rd-toolrow" onSubmit={add}>
          <input className="rd-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="api.yourdomain.com" aria-label="New domain" />
          <button type="submit" className="rd-btn rd-btn--primary" disabled={!name.trim() || Boolean(busy)}>{busy === "add" ? "Adding…" : "＋ Add domain"}</button>
        </form>
      </Section>

      <Section title="Frontends that have this address built in" subtitle="For web apps that do not read the Stashr server list: Stashr finds env vars (VITE_API_URL, NEXT_PUBLIC_API_URL, …) that still point at the old address in any of your Render services, rewrites them and redeploys. Values are never shown.">
        <div className="rd-toolrow">
          <label className="rd-inline">Old address<select value={from} onChange={(e) => { setFrom(e.target.value); setRefs(null); }}>{addresses.map((u) => <option key={u}>{u}</option>)}</select></label>
          <label className="rd-inline">New address<select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{usable.filter((u) => u !== from).map((u) => <option key={u}>{u}</option>)}</select></label>
          <button type="button" className="rd-btn rd-btn--quiet" disabled={!from || Boolean(busy)} onClick={() => void scanRefs()}>{busy === "scan" ? "Scanning every service…" : "🔍 Find references"}</button>
        </div>
        {refs && (!refs.length ? <p className="rd-muted">No env var in your Render services points at {from}.</p> : <>
          <ul className="rd-domains">{refs.map((x) => { const k = x.serviceId + "|" + x.key; return (
            <li key={k}><label className="rd-check"><input type="checkbox" checked={pick.includes(k)} onChange={() => setPick((o) => (o.includes(k) ? o.filter((y) => y !== k) : [...o, k]))} /> <strong>{x.serviceName}</strong></label><code>{x.key}</code><small className="rd-muted">{x.accountName}{x.suspended ? " · suspended" : ""}</small></li>
          ); })}</ul>
          <button type="button" className="rd-btn rd-btn--primary" disabled={!to || to === from || !pick.length || Boolean(busy)} onClick={() => void switchRefs()}>{busy === "switch" ? "Switching…" : "Switch " + pick.length + " to " + (to || "…") + " and redeploy"}</button>
          {!to && <small className="rd-muted"> Add and verify a new domain above first.</small>}
        </>)}
      </Section>

      <Section title="Used by your apps" subtitle="Apps that read their server address from Stashr (web + mobile). Switching here updates both at once, without a redeploy.">
        {registry == null ? <Skeleton lines={2} /> : !registry.length ? <p className="rd-muted">Only the Stashr admin account can change app addresses.</p> : !usedBy.length ? (
          <p className="rd-muted">No app in the Stashr server list uses this service. Apps with only a website or only a mobile app are both fine: whichever exists reads the same list. If an app has its address built in instead, use “Frontends that have this address built in” above.</p>
        ) : usedBy.map((app) => (
          <div key={app.app} className="rd-appuse">
            <div><strong>{app.label || app.app}</strong><small>{app.urls.map((u, i) => (i === 0 ? "main: " : "backup: ") + u).join(" · ")}{app.updatedAt ? " · changed " + timeAgo(app.updatedAt) : ""}</small></div>
            <div className="rd-appuse__actions">
              {[renderUrl, ...(domains || []).filter((d) => d.verificationStatus === "verified").map((d) => "https://" + d.name)].filter(Boolean).map((u) => {
                const target = u.replace(/\/+$/, "") + pathOf(app.match);
                const current = app.urls[0] === target;
                return <button key={u} type="button" className={"rd-btn " + (current ? "rd-btn--quiet" : "rd-btn--primary")} disabled={current || Boolean(busy)} onClick={() => void applyInApp(app, u)}>{current ? "✓ Using " + hostOf(u) : "Use " + hostOf(u) + " in web + app"}</button>;
              })}
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
