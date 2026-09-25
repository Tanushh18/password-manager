import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import Reveal from "../../Components/Reveal/Reveal";
import VaultHealth from "../../Components/VaultHealth/VaultHealth";
import ItemCard from "../../Components/Item/ItemCard";
import ItemEditor from "../../Components/Item/ItemEditor";
import ImportModal from "../../Components/Item/ImportModal";
import { ShieldLine, KeyLine, Plus, Search, Upload, Arrow, Star, Folder, Grid, LockLine, Gear, Alert } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";
import { domainOf } from "../../lib/items";
import "./Passwords.css";

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
  const [importing, setImporting] = useState(false);
  const [breachChecked, setBreachChecked] = useState(false);

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

  const firstName = (profile?.name || "").split(" ")[0];

  return (
    <div className="vault page">
      <Ambience petals={false} />

      <div className="shell">
        <header className="vault__head anim-fade-up">
          <span className="pill vault__pill">
            <ShieldLine size={13} />
            End-to-end encrypted
          </span>
          <h1 className="vault__title">
            Kept for you, <em className="serif-em">{firstName || "friend"}</em>
          </h1>
          <p className="vault__count">
            {items.length === 0 ? "Nothing inside yet — let's change that." : `${items.length} item${items.length === 1 ? "" : "s"}, readable only on your devices`}
          </p>
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
              placeholder="Search names, usernames, websites, notes…"
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
              <Plus size={15} /> New item
            </button>
            <button className="btn btn--ghost" onClick={() => setImporting(true)}>
              <Upload size={15} /> Import
            </button>
          </div>
        </div>

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
