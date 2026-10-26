import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import useShortcuts from "../../hooks/useShortcuts";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import Reveal from "../../Components/Reveal/Reveal";
import VaultHealth from "../../Components/VaultHealth/VaultHealth";
import ItemCard from "../../Components/Item/ItemCard";
import ItemEditor from "../../Components/Item/ItemEditor";
import ImportModal from "../../Components/Item/ImportModal";
import { KeyLine, Plus, Search, Upload, Arrow, Star, Folder, Grid, LockLine, Gear, Alert } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";
import { domainOf } from "../../lib/items";
import "./Passwords.css";

import MascotBanner from "../../Components/Robot/MascotBanner";
import { vaultMood } from "../../lib/pageMoods";
export default function Passwords() {
  const {
    profile, items, broken, health, breaches, breachProgress, prefs,
    addItem, updateItem, deleteItem, toggleFavorite, importItems, runBreachCheck, lock,
  } = useVault();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // health filter
  const [folder, setFolder] = useState("__all"); // __all | __fav | <folder>
  const [sort, setSort] = useState("recent");
  const [editing, setEditing] = useState(null); // null | "new" | item
  const searchRef = useShortcuts(() => setEditing("new"));
  const [importing, setImporting] = useState(false);
  const [breachChecked, setBreachChecked] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  /* Runs one action over every selected id; reports how many worked so a partial failure is never silent. */
  const runBulk = async (label, fn) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    const results = await Promise.allSettled(ids.map(fn));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    setBusy(false);
    if (ok === ids.length) toast.success(`${label}: ${ok} item${ok === 1 ? "" : "s"}.`);
    else toast.error(`${label}: ${ok} of ${ids.length} worked, ${ids.length - ok} failed.`);
    setSelected(new Set(results.flatMap((r, i) => (r.status === "rejected" ? [ids[i]] : []))));
  };
  const bulkFavorite = (value) => runBulk(value ? "Favourited" : "Unfavourited", (id) => updateItem(id, { favorite: value }));
  const bulkMove = () => {
    const name = window.prompt("Move selected items to which folder? (leave empty for no folder)", folder.startsWith("__") ? "" : folder);
    if (name === null) return;
    return runBulk("Moved", (id) => updateItem(id, { folder: name.trim() }));
  };
  const bulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} item${selected.size === 1 ? "" : "s"} from your vault? This cannot be undone.`)) return;
    return runBulk("Deleted", (id) => deleteItem(id));
  };
  const renameFolder = async () => {
    const name = window.prompt(`Rename "${folder}" to (an existing folder name merges them):`, folder);
    if (name === null || !name.trim() || name.trim() === folder) return;
    const target = name.trim();
    const ids = items.filter((i) => i.folder === folder).map((i) => i.id);
    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => updateItem(id, { folder: target })));
    setBusy(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) toast.error(`${failed} item${failed === 1 ? "" : "s"} could not be moved.`);
    else { toast.success(`Folder is now "${target}".`); setFolder(target); }
  };

  const folders = useMemo(
    () => [...new Set(items.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const favCount = items.filter((i) => i.favorite).length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items
      .filter((i) => folder === "__all" || (folder === "__fav" ? i.favorite : i.folder === folder))
      .filter((i) => {
        if (!term) return true;
        return [i.name, i.username, i.url, i.folder, i.notes].some((v) => (v || "").toLowerCase().includes(term)) || domainOf(i.url).includes(term);
      })
      .filter((i) => {
        if (filter === "all") return true;
        const h = health.info[i.id];
        if (!h) return false;
        if (filter === "weak") return h.score <= 1;
        if (filter === "reused") return h.reused;
        if (filter === "old") return h.old;
        if (filter === "breached") return h.breached > 0;
        if (filter === "strong") return h.score >= 3 && !h.reused && !h.breached;
        return true;
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite && sort !== "az") return a.favorite ? -1 : 1;
        if (sort === "az") return (a.name || "").localeCompare(b.name || "");
        if (sort === "weakest") return (health.info[a.id]?.score ?? 5) - (health.info[b.id]?.score ?? 5);
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      });
  }, [items, search, filter, folder, sort, health]);

  const checkBreaches = async () => {
    try {
      const found = await runBreachCheck();
      setBreachChecked(true);
      if (found) {
        toast.error(`${found} password${found === 1 ? " was" : "s were"} found in data breaches.`);
        setFilter("breached");
      } else toast.success("None of your passwords appear in known breaches.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveItem = async (form) => {
    if (editing === "new") {
      await addItem(form);
      toast.success("Encrypted and saved ✨");
    } else {
      await updateItem(editing.id, form);
      toast.success("Updated and re-encrypted.");
    }
  };


  return (
    <div className="vault page">
      <Ambience petals={false} />

      <div className="shell">
        <header className="vault__head">
          <div>
            <h1 className="vault__title">Vault</h1>
            <p className="vault__count">
              {items.length === 0 ? "Nothing saved yet." : `${items.length} item${items.length === 1 ? "" : "s"} · end-to-end encrypted`}
            </p>
          </div>
          <div className="vault__status">
            <ServiceStatus />
            <button type="button" className="btn btn--quiet btn--sm" onClick={lock} title="Lock now">
              <LockLine size={14} /> Lock
            </button>
            <Link to="/settings" className="btn btn--quiet btn--sm">
              <Gear size={14} /> Settings
            </Link>
          </div>
        </header>

        {broken ? (
          <div className="notice notice--err vault__notice">
            <Alert size={15} /> {broken} item{broken === 1 ? "" : "s"} couldn't be decrypted with this key and {broken === 1 ? "is" : "are"} hidden.
          </div>
        ) : null}

        <MascotBanner kind="safe" {...vaultMood(health, items.length)} />

        <div className="anim-fade-up d-1">
          <VaultHealth
            insights={health}
            loading={false}
            filter={filter}
            onFilter={setFilter}
            onBreachCheck={items.length ? checkBreaches : null}
            breachProgress={breachProgress}
            breachChecked={breachChecked || Object.keys(breaches).length > 0}
          />
        </div>

        <div className="vault__tools anim-fade-up d-2">
          <div className="vault__search field__wrap">
            <span className="vault__search-icon"><Search size={17} /></span>
            <input
              className="input vault__search-input"
              type="search"
              ref={searchRef}
              placeholder="Search names, usernames, websites, notes…  ( / )"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search your vault"
            />
          </div>
          <div className="vault__actions">
            <select className="input vault__sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="recent">Recently updated</option>
              <option value="az">A → Z</option>
              <option value="weakest">Weakest first</option>
            </select>
            <button className="btn btn--primary" onClick={() => setEditing("new")}>
              <span className="btn__sheen" />
              <Plus size={15} /> New item <kbd className="kbd">N</kbd>
            </button>
            <button className="btn btn--ghost" onClick={() => setImporting(true)}>
              <Upload size={15} /> Import
            </button>
            <button className="btn btn--ghost" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}>
              {selecting ? "Done" : "Select"}
            </button>
          </div>
        </div>

        {selecting ? (
          <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
            <strong>{selected.size} selected</strong>
            <button className="btn btn--quiet btn--sm" onClick={() => setSelected(new Set(visible.map((i) => i.id)))}>Select all {visible.length}</button>
            <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={() => bulkFavorite(true)}>Favourite</button>
            <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={() => bulkFavorite(false)}>Unfavourite</button>
            <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={bulkMove}>Move to folder…</button>
            <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={bulkDelete}>Delete</button>
          </div>
        ) : null}

        <nav className="folders anim-fade-up d-3" aria-label="Folders">
          <button type="button" className={`folder-chip ${folder === "__all" ? "is-active" : ""}`} onClick={() => setFolder("__all")}>
            <Grid size={13} /> All <span>{items.length}</span>
          </button>
          <button type="button" className={`folder-chip ${folder === "__fav" ? "is-active" : ""}`} onClick={() => setFolder("__fav")}>
            <Star size={13} /> Favourites <span>{favCount}</span>
          </button>
          {folders.map((f) => (
            <button key={f} type="button" className={`folder-chip ${folder === f ? "is-active" : ""}`} onClick={() => setFolder(f)}>
              <Folder size={13} /> {f} <span>{items.filter((i) => i.folder === f).length}</span>
            </button>
          ))}
        </nav>
        {!folder.startsWith("__") ? (
          <p className="folders__tools"><button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={renameFolder}>Rename or merge “{folder}”</button></p>
        ) : null}

        {items.length === 0 ? (
          <Reveal className="empty card" variant="reveal--scale">
            <span className="card__ribbon" />
            <span className="empty__icon"><KeyLine size={28} /></span>
            <h2 className="empty__title">Your vault is empty</h2>
            <p className="empty__body">Add your first login, or import everything from your browser or another password manager.</p>
            <div className="empty__actions">
              <button className="btn btn--primary btn--lg" onClick={() => setEditing("new")}>
                <span className="btn__sheen" /> Add your first item <Arrow size={16} />
              </button>
              <button className="btn btn--ghost btn--lg" onClick={() => setImporting(true)}>
                <Upload size={15} /> Import
              </button>
            </div>
          </Reveal>
        ) : visible.length === 0 ? (
          <Reveal className="empty empty--slim card">
            <span className="empty__icon"><Search size={24} /></span>
            <h2 className="empty__title">{search ? <>Nothing matches “{search}”</> : "Nothing here"}</h2>
            <p className="empty__body">{filter !== "all" && !search ? "Good news — nothing needs attention in this view." : "Try another search or clear the filters."}</p>
            <button className="btn btn--ghost" onClick={() => { setSearch(""); setFilter("all"); setFolder("__all"); }}>
              Show everything
            </button>
          </Reveal>
        ) : (
          <div className="vault__grid">
            {visible.map((item, i) => (
              <ItemCard
                key={item.id}
                item={item}
                info={health.info[item.id]}
                icons={prefs.icons}
                onEdit={() => setEditing(item)}
                selecting={selecting}
                selected={selected.has(item.id)}
                onSelect={() => toggleSelect(item.id)}
                onFavorite={() => toggleFavorite(item.id).catch(() => toast.error("Couldn't update that."))}
                style={{ animationDelay: `${Math.min(i, 10) * 0.04}s` }}
              />
            ))}
          </div>
        )}
      </div>

      <ItemEditor
        open={Boolean(editing)}
        item={editing && editing !== "new" ? editing : null}
        folders={folders}
        icons={prefs.icons}
        onClose={() => setEditing(null)}
        onSave={saveItem}
        onDelete={async () => {
          await deleteItem(editing.id);
          toast.success("Deleted from your vault.");
        }}
      />
      <ImportModal open={importing} onClose={() => setImporting(false)} onImport={importItems} />
    </div>
  );
}
