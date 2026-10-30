import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useVault } from "../../state/vault";
import { PageHeader, Panel, EmptyState, Badge, Stat } from "../../Components/UI/ui";
import ItemAvatar from "../../Components/Item/ItemAvatar";
import NavIcon from "../../Components/AppShell/NavIcon";
import { openPalette } from "../../Components/CommandPalette/CommandPalette";
import { Plus, Upload, KeyLine, Arrow, ShieldCheck, Folder } from "../../Components/Icons/Icons";
import { sectionCounts } from "../../lib/vaultView";
import { domainOf } from "../../lib/items";
import { STATUS_LABEL } from "../../lib/projectItems";
import { greeting, attentionItems, recentItems, favoriteItems, projectSummary, ago } from "../../lib/dashboard";
import VaultBackdrop from "../../Components/Vault/VaultBackdrop";
import { securityStatus } from "../../lib/vaultView";
import "../../Components/Vault/Vault.css";
import "./Dashboard.css";

const PROJECT_TONE = { deployed: "ok", broken: "danger", in_progress: "info", paused: "warn", planning: "neutral", archived: "neutral" };
const SCORE_TONE = (s) => (s >= 80 ? "ok" : s >= 55 ? "warn" : "danger");

function ItemRow({ item, icons }) {
  const sub = item.username || domainOf(item.url) || (item.type === "note" ? "Secure note" : "");
  return (
    <li>
      <Link className="ui-row" to={"/passwords?q=" + encodeURIComponent(item.name || item.username || "")}>
        <ItemAvatar name={item.name} url={item.url} icons={icons} size={32} />
        <span className="ui-row__main">
          <span className="ui-row__title">{item.name || "Untitled"}</span>
          {sub ? <span className="ui-row__meta">{sub}</span> : null}
        </span>
        <span className="ui-row__end">{ago(item.updatedAt || item.createdAt)}</span>
      </Link>
    </li>
  );
}

/** Signed-in home: what is saved, what needs attention, and where to go next. */
export default function Dashboard() {
  const { profile, items, trash, health, breaches, projects, prefs } = useVault();
  const firstName = (profile?.name || "").trim().split(/\s+/)[0];
  const counts = useMemo(() => sectionCounts(items, trash), [items, trash]);
  const breachChecked = Object.keys(breaches || {}).length > 0;
  const attention = useMemo(() => attentionItems(health, { breachChecked }), [health, breachChecked]);
  const recent = useMemo(() => recentItems(items, 5), [items]);
  const favorites = useMemo(() => favoriteItems(items, 6), [items]);
  const projectsOn = profile?.features?.projects !== false;
  const proj = useMemo(() => projectSummary(projects || []), [projects]);
  const empty = items.length === 0;
  const status = securityStatus(health, breachChecked);

  const subtitle = empty
    ? "Your vault is ready. Add a login or import from another manager to get started."
    : `${items.length} item${items.length === 1 ? "" : "s"} in your vault${projectsOn ? ` · ${proj.active} active project${proj.active === 1 ? "" : "s"}` : ""}`;

  return (
    <main className="page dash vx" aria-labelledby="dash-title">
      <div className="ui-page">
        <div className="vx-head vx-head--v2 dash__hero">
          <VaultBackdrop />
          <p className="vx-board" aria-label={`Security status: ${status.label}`}>
            <span className="vx-board__cell vx-hide-sm">Gate</span>
            <span className="vx-board__cell vx-board__cell--strong">Home</span>
            <span className={`vx-board__status is-${status.tone}`}><i aria-hidden="true" />{status.label}</span>
            <span className="vx-board__cell">{items.length} item{items.length === 1 ? "" : "s"}</span>
            {projectsOn ? <span className="vx-board__cell vx-hide-sm">{proj.active} project{proj.active === 1 ? "" : "s"}</span> : null}
          </p>
        <PageHeader
          title={<span id="dash-title">{greeting()}{firstName ? `, ${firstName}` : ""}</span>}
          subtitle={subtitle}
          actions={
            <>
              <button type="button" className="btn btn--quiet" onClick={openPalette}><NavIcon name="search" size={16} /> Search</button>
              <Link to="/passwords?new=1" className="btn btn--primary"><Plus size={15} /> Add password</Link>
            </>
          }
        />
        </div>

        {empty ? (
          <EmptyState
            icon={<KeyLine size={24} />}
            title="Start your vault"
            actions={
              <>
                <Link to="/passwords?new=1" className="btn btn--primary"><Plus size={15} /> Add your first login</Link>
                <Link to="/passwords?import=1" className="btn btn--ghost"><Upload size={15} /> Import from a CSV</Link>
              </>
            }
          >
            Each item is encrypted with AES-256-GCM before it is stored. Import works with exports from Chrome, Bitwarden, 1Password and LastPass.
          </EmptyState>
        ) : (
          <div className="dash__grid">
            <Panel
              className="dash__health"
              title="Vault health"
              subtitle={health.total ? `${health.total} password${health.total === 1 ? "" : "s"} checked on this device` : "No logins with passwords yet"}
              actions={<Link to="/security-center" className="btn btn--quiet btn--sm">Security center <Arrow size={13} /></Link>}
            >
              <div className="dash__score">
                <div className={`dash__ring is-${SCORE_TONE(health.score)}`} style={{ "--p": health.score }} role="img" aria-label={`Security score ${health.score} out of 100`}>
                  <strong>{health.score}</strong><small>/100</small>
                </div>
                {attention.length ? (
                  <ul className="dash__issues">
                    {attention.map((a) => (
                      <li key={a.id}>
                        <Link to={a.to} className="dash__issue">
                          <Badge tone={a.tone === "neutral" ? "neutral" : a.tone} dot>{a.tone === "danger" ? "Fix" : a.tone === "warn" ? "Review" : "Info"}</Badge>
                          <span><strong>{a.title}</strong><small>{a.hint}</small></span>
                          <Arrow size={14} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="dash__clear">
                    <ShieldCheck size={20} />
                    <span><strong>Nothing needs attention</strong><small>No weak, reused or breached passwords found.</small></span>
                  </div>
                )}
              </div>
            </Panel>

            <div className="dash__stats" role="list" aria-label="Vault contents">
              {[
                ["Logins", counts.__logins, "__logins"],
                ["Secure notes", counts.__note, "__note"],
                ["Cards", counts.__card, "__card"],
                ["Identities", counts.__identity, "__identity"],
              ].map(([label, n, section]) => (
                <Link key={section} role="listitem" to={`/passwords?section=${section}`} className="dash__statlink">
                  <Stat label={label} value={n} />
                </Link>
              ))}
            </div>

            <Panel title="Recently updated" actions={<Link to="/passwords" className="btn btn--quiet btn--sm">All items <Arrow size={13} /></Link>}>
              <ul className="ui-list">{recent.map((i) => <ItemRow key={i.id} item={i} icons={prefs.icons} />)}</ul>
            </Panel>

            <Panel title="Favourites" actions={favorites.length ? <Link to="/passwords?section=__fav" className="btn btn--quiet btn--sm">See all <Arrow size={13} /></Link> : null}>
              {favorites.length ? (
                <ul className="ui-list">{favorites.map((i) => <ItemRow key={i.id} item={i} icons={prefs.icons} />)}</ul>
              ) : (
                <p className="dash__muted">Star the logins you use most and they will appear here for one-click access.</p>
              )}
            </Panel>
          </div>
        )}

        {projectsOn ? (
          <Panel
            className="dash__projects"
            title="Projects"
            subtitle={proj.total ? `${proj.active} active · ${proj.deployed} deployed${proj.broken ? ` · ${proj.broken} broken` : ""}` : "Hosting, databases and environment variables for the apps you run."}
            actions={proj.total ? <Link to="/projects" className="btn btn--quiet btn--sm">All projects <Arrow size={13} /></Link> : <Link to="/projects/new" className="btn btn--ghost btn--sm"><Plus size={14} /> New project</Link>}
          >
            {proj.recent.length ? (
              <ul className="dash__projlist">
                {proj.recent.map((p) => (
                  <li key={p.id}>
                    <Link to={"/projects/" + p.id} className="dash__proj">
                      <span className="dash__projicon" aria-hidden="true"><Folder size={16} /></span>
                      <span className="ui-row__main">
                        <span className="ui-row__title">{p.name || "Untitled"}</span>
                        <span className="ui-row__meta">{[p.hostingProvider, p.liveUrl && domainOf(p.liveUrl)].filter(Boolean).join(" · ") || "No hosting linked"}</span>
                      </span>
                      <Badge tone={PROJECT_TONE[p.status] || "neutral"}>{STATUS_LABEL[p.status] || p.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dash__muted">No projects yet. Connect GitHub or Render on the Projects page to import them automatically.</p>
            )}
          </Panel>
        ) : null}

        <section className="dash__quick" aria-label="Quick actions">
          <Link to="/generator" className="dash__qa"><NavIcon name="wand" /><span><strong>Generate a password</strong><small>Random password or passphrase</small></span></Link>
          <Link to="/passwords?import=1" className="dash__qa"><Upload size={18} /><span><strong>Import</strong><small>CSV from a browser or manager</small></span></Link>
          <Link to="/security-center" className="dash__qa"><NavIcon name="shield" /><span><strong>Security check-up</strong><small>2FA, devices and breaches</small></span></Link>
          <Link to="/apps" className="dash__qa"><NavIcon name="apps" /><span><strong>Get the apps</strong><small>Android autofill and Chrome</small></span></Link>
        </section>
      </div>
    </main>
  );
}
