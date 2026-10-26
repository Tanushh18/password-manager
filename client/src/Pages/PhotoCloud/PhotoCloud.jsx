import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { useVault } from "../../state/vault";
import { getBlob, createFolderShare, createPhotoFolder, createPhotoShare, getSharedWithMe, listFolderShares, revokeFolderShare, deletePhotoFolder, importExistingPhotos, disconnectPhotoConnection, exportPhotoManifest, getPhotoCloudDashboard, getPhotoShares, revokePhotoShare, removePhotoMedia, setPhotoFavorite, savePhotoRoutingPolicy, startPhotoGoogleOAuth, syncPhotoGoogleAccount, updatePhotoConnection } from "../../api/client";
import { Check, Clock, Folder, HeartLine, Plus, Refresh, Search, Sparkle, Upload } from "../../Components/Icons/Icons";
import { mediaKind, createLru } from "../../lib/media";
import "./PhotoCloud.css";

/* Shows one photo through the signed-in API. Drive's own thumbnail links need a Google login, so a plain <img src>
   cannot load them; this fetches the file with the session and shows it from a local object URL. */
const thumbCache = createLru(300, (_, url) => URL.revokeObjectURL(url));

function AuthImage({ id, size = "thumb", alt, className, onFail }) {
  const [src, setSrc] = useState(() => thumbCache.get(id + ":" + size) || "");
  const holder = useRef(null);
  const [visible, setVisible] = useState(size !== "thumb");
  useEffect(() => {
    if (visible || !holder.current || typeof IntersectionObserver === "undefined") { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(holder.current);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    const cacheKey = id + ":" + size;
    const cached = thumbCache.get(cacheKey);
    if (cached) { setSrc(cached); return undefined; }
    if (!visible) return undefined;
    let live = true;
    setSrc("");
    getBlob("/photo-cloud/media/content?id=" + encodeURIComponent(id) + "&size=" + size)
      .then((blob) => { if (!live) return; const url = URL.createObjectURL(blob); if (size === "thumb") thumbCache.set(cacheKey, url); setSrc(url); })
      .catch(() => { if (live && onFail) onFail(); });
    return () => { live = false; };
  }, [id, size, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!src) return <span ref={holder} className="photo__loading" aria-hidden="true" />;
  return <img src={src} alt={alt || ""} className={className} loading="lazy" />;
}

const fmt = (value) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Not scanned yet";
const gb = (value) => `${Number(value || 0).toFixed(1)} GB`;

export default function PhotoCloud() {
  const { items, profile } = useVault();
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [previewMedia, setPreviewMedia] = useState(null);
  const [deletingMediaId, setDeletingMediaId] = useState("");
  const [viewTab, setViewTab] = useState("photos");
  const [pageSize, setPageSize] = useState(60);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [syncElapsed, setSyncElapsed] = useState(0);
  const [showConnect, setShowConnect] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [shares, setShares] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [folderShares, setFolderShares] = useState([]);
  const [sharedWithMe, setSharedWithMe] = useState([]);
  const [shareTarget, setShareTarget] = useState(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareDownload, setShareDownload] = useState(false);
  const [importing, setImporting] = useState(false);
  const [policy, setPolicy] = useState({ wifiOnly: true, chargingOnly: false, safetyBufferGb: 2, defaultConnectionId: "" });

  const load = async () => { try { const [next, shared, mine, theirs] = await Promise.all([getPhotoCloudDashboard(), getPhotoShares(), listFolderShares().catch(() => ({ shares: [] })), getSharedWithMe().catch(() => ({ shares: [] }))]); setFolderShares(mine.shares || []); setSharedWithMe(theirs.shares || []); setData(next); setShares(shared.shares || []); setPolicy(next.settings || policy); } catch (e) { toast.error("Photo Cloud is waking up. Try again in a moment."); } };
  useEffect(() => { void load(); }, []);
  const accounts = data?.connections || [];
  const media = useMemo(() => (data?.media || []).filter((item) => {
    const { isVideo, isImage, isScreenshot, isDriveFile } = mediaKind(item);
    const haystack = [item.filename, item.name, item.tag, item.account, item.type, item.mimeType, item.source].join(" ").toLowerCase();
    const source = String(item.provider || item.source || item.account || "").toLowerCase();
    const sourceMatch = sourceFilter === "all" || (sourceFilter === "drive" && /drive/.test(source)) || (sourceFilter === "photos" && /photos/.test(source));
    const tabMatch = viewTab === "all" || (viewTab === "photos" && isImage) || (viewTab === "videos" && isVideo) || (viewTab === "drive" && isDriveFile) || viewTab === "sync";
    const filterMatch = filter === "all" || (filter === "screenshot" && isScreenshot) || (filter === "favorites" && Boolean(item.favorite));
    return tabMatch && filterMatch && sourceMatch && (!query || haystack.includes(query.toLowerCase()));
  }).sort((a, b) => { const av = new Date(a.takenAt || a.modifiedAt || a.createdAt || 0).getTime(); const bv = new Date(b.takenAt || b.modifiedAt || b.createdAt || 0).getTime(); return sortBy === "oldest" ? av - bv : sortBy === "name" ? String(a.filename || "").localeCompare(String(b.filename || "")) : sortBy === "largest" ? Number(b.size || 0) - Number(a.size || 0) : bv - av; }), [data, query, filter, viewTab, sourceFilter, sortBy]);
  useEffect(() => { setPageSize(60); }, [query, filter, viewTab, sourceFilter, sortBy]);
  const visibleMedia = media.slice(0, pageSize);
  const previewList = media.filter((m) => mediaKind(m).isImage);
  const stepPreview = (delta) => {
    const at = previewList.findIndex((m) => m.id === previewMedia?.id);
    if (at < 0 || !previewList.length) return;
    setPreviewMedia(previewList[(at + delta + previewList.length) % previewList.length]);
  };
  useEffect(() => {
    if (!previewMedia) return undefined;
    const onKey = (e) => {
      if (e.key === "ArrowRight") stepPreview(1);
      else if (e.key === "ArrowLeft") stepPreview(-1);
      else if (e.key === "Escape") setPreviewMedia(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePick = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); };
  const bulkFavorite = async () => {
    setBulkBusy(true);
    const ids = [...picked];
    const results = await Promise.allSettled(ids.map((id) => setPhotoFavorite(id, true)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    setData((d) => d && { ...d, media: d.media.map((m) => ids.includes(m.id) ? { ...m, favorite: true } : m) });
    setBulkBusy(false);
    if (ok === ids.length) toast.success(`Favourited ${ok} item${ok === 1 ? "" : "s"}.`); else toast.error(`${ok} of ${ids.length} favourited.`);
  };
  const bulkRemove = async () => {
    if (!window.confirm(`Remove ${picked.size} item${picked.size === 1 ? "" : "s"} from Stashr Photo Cloud? Originals in Google Drive stay untouched.`)) return;
    setBulkBusy(true);
    const ids = [...picked];
    const results = await Promise.allSettled(ids.map((id) => removePhotoMedia(id)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    await load();
    setPicked(new Set(results.flatMap((r, i) => (r.status === "rejected" ? [ids[i]] : []))));
    setBulkBusy(false);
    if (ok === ids.length) toast.success(`Removed ${ok} item${ok === 1 ? "" : "s"} from the library.`); else toast.error(`${ok} of ${ids.length} removed.`);
  };
  const bulkShare = async () => {
    setBulkBusy(true);
    try {
      const result = await createPhotoShare({ mediaIds: [...picked], title: "Shared from Photo Cloud", expiresInDays: 7, allowDownload: false });
      const link = `${window.location.origin}/share/photos/${result.token}`;
      setShareLink(link);
      await navigator.clipboard?.writeText(link);
      toast.success("Share link copied. It expires in 7 days.");
      await load();
    } catch { toast.error("Could not create the share link."); }
    finally { setBulkBusy(false); }
  };
  const toggleFavorite = async (item) => {
    const favorite = !item.favorite;
    const patch = (value) => setData((d) => d && { ...d, media: d.media.map((m) => m.id === item.id ? { ...m, favorite: value } : m) });
    patch(favorite);
    setPreviewMedia((p) => p && p.id === item.id ? { ...p, favorite } : p);
    try { await setPhotoFavorite(item.id, favorite); }
    catch { patch(!favorite); setPreviewMedia((p) => p && p.id === item.id ? { ...p, favorite: !favorite } : p); toast.error("Could not update the favorite."); }
  };
  const storage = data?.totals ? data.totals.usedGb : accounts.reduce((sum, account) => sum + Number(account.usedGb || 0), 0);
  const capacity = data?.totals ? data.totals.limitGb : accounts.reduce((sum, account) => sum + Number(account.limitGb || 0), 0);
  const doneJobs = (data?.jobs || []).filter((j) => j.status === "completed").length;
  const failedJobs = (data?.jobs || []).filter((j) => ["failed", "blocked"].includes(j.status)).length;
  const linkedGoogleItems = items.filter((item) => /google|gmail|drive/i.test(`${item.name} ${item.url || ""}`));

  const connect = async (event) => {
    event.preventDefault(); setSaving(true); try { const result = await startPhotoGoogleOAuth(label || "Google account"); window.location.assign(result.url); } catch (e) { toast.error(e?.response?.data?.error || "Google OAuth is not configured yet."); setSaving(false); }
  };
  const refreshIndex = async () => {
    const startedAt = Date.now();
    setSyncStartedAt(startedAt);
    setSyncElapsed(0);
    try {
      const current = await getPhotoCloudDashboard();
      const connected = (current.connections || []).filter((account) => account.oauthMode === "connected");
      if (connected.length) await Promise.all(connected.map((account) => syncPhotoGoogleAccount(account.id)));
      await load();
      toast.success(connected.length ? "Google Drive indexes refreshed." : "Photo Cloud index refreshed.");
    } catch { toast.error("Could not refresh the Google Drive index."); }
    finally { setSyncElapsed(Math.floor((Date.now() - startedAt) / 1000)); setSyncStartedAt(null); }
  };
  useEffect(() => {
    if (!syncStartedAt) return undefined;
    const timer = window.setInterval(() => setSyncElapsed(Math.floor((Date.now() - syncStartedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [syncStartedAt]);
  const syncAccount = async (id) => { const startedAt = Date.now(); setSyncingId(id); setSyncStartedAt(startedAt); setSyncElapsed(0); try { await syncPhotoGoogleAccount(id); await load(); toast.success("Account index refreshed."); } catch { toast.error("Could not refresh this account."); } finally { setSyncingId(""); setSyncElapsed(Math.floor((Date.now() - startedAt) / 1000)); setSyncStartedAt(null); } };
  const toggleEligible = async (account) => { try { await updatePhotoConnection(account.id, { eligible: !account.eligible }); await load(); toast.success(account.eligible ? "Account removed from new-upload routing." : "Account enabled for new uploads."); } catch { toast.error("Could not update account routing."); } };
  const disconnectAccount = async (account) => { if (!window.confirm(`Disconnect ${account.label}? Cloud files will not be deleted, but indexed items will become unavailable.`)) return; try { await disconnectPhotoConnection(account.id); await load(); toast.success("Account disconnected. Cloud files were not deleted."); } catch { toast.error("Could not disconnect this account."); } };
  const downloadManifest = async () => { try { const manifest = await exportPhotoManifest(); const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `stashr-photo-manifest-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); toast.success("Manifest exported."); } catch { toast.error("Could not export the photo manifest."); } };
  const savePolicy = async () => { try { const next = await savePhotoRoutingPolicy(policy); setPolicy(next.settings); toast.success("Backup routing saved."); } catch { toast.error("Could not save routing policy."); } };
  const importOld = async () => { setImporting(true); try { const r = await importExistingPhotos(); await load(); toast.success(`${r.found} photos and videos found in Drive, ${r.added} new.`); } catch (e) { toast.error(e?.response?.data?.error || "Could not scan Drive."); } finally { setImporting(false); } };
  const addFolder = async (event) => { event.preventDefault(); try { await createPhotoFolder(folderName.trim(), null); setFolderName(""); await load(); toast.success("Folder created."); } catch (e) { toast.error(e?.response?.data?.error || "Could not create the folder."); } };
  const submitFolderShare = async (event) => { event.preventDefault(); try { await createFolderShare({ folderId: shareTarget.id, email: shareEmail.trim(), allowDownload: shareDownload }); toast.success(`Shared with ${shareEmail.trim()}.`); setShareTarget(null); setShareEmail(""); setShareDownload(false); await load(); } catch (e) { toast.error(e?.response?.data?.error || "Could not share the folder."); } };
  const stopFolderShare = async (share) => { try { await revokeFolderShare(share.id); await load(); toast.success("Sharing stopped."); } catch { toast.error("Could not stop sharing."); } };
  const removeFolder = async (folder) => { if (!window.confirm(`Remove "${folder.name}" from Stashr? Files and Drive folders are not deleted.`)) return; try { await deletePhotoFolder(folder.id); await load(); } catch { toast.error("Could not remove the folder."); } };
  const shareLibrary = async () => { try { const result = await createPhotoShare({ mediaIds: media.map((item) => item.id), title: "Shared from Photo Cloud", expiresInDays: 7, allowDownload: false }); const link = `${window.location.origin}/share/photos/${result.token}`; setShareLink(link); await navigator.clipboard?.writeText(link); toast.success("Share link copied. It expires in 7 days."); } catch { toast.error("Could not create the share link."); } };
  const revokeShare = async (id) => { try { await revokePhotoShare(id); setShares((list) => list.filter((share) => share.id !== id)); toast.success("Share link revoked."); } catch { toast.error("Could not revoke that link."); } };
  const removeMedia = async (item) => {
    if (!window.confirm(`Remove "${item.filename || item.name || "this item"}" from Stashr Photo Cloud? The original in Google Drive will remain untouched.`)) return;
    setDeletingMediaId(item.id);
    try {
      await removePhotoMedia(item.id);
      setPreviewMedia(null);
      await load();
      toast.success("Removed from Photo Cloud. Original file was not deleted.");
    } catch (e) {
      toast.error(e?.response?.data?.error || "Could not remove this item.");
    } finally { setDeletingMediaId(""); }
  };

  return <main className="photo page"><div className="shell">
    {previewMedia && <div className="photo-modal__scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setPreviewMedia(null); }}><section className="photo-modal photo-preview" role="dialog" aria-modal="true" aria-label={previewMedia.filename || "Media preview"}><div className="photo-preview__head"><h2>{previewMedia.filename || "Preview"}</h2><span><button className="text-button" onClick={() => stepPreview(-1)} aria-label="Previous photo">‹ Prev</button> <button className="text-button" onClick={() => stepPreview(1)} aria-label="Next photo">Next ›</button> <button className="text-button" onClick={() => setPreviewMedia(null)}>Close ✕</button></span></div>{String(previewMedia.mimeType || "").startsWith("image/") ? <AuthImage id={previewMedia.id} size="large" className="photo-preview__image" alt={previewMedia.filename || "Preview"} /> : <p>Preview is not available. Open the original in Google Drive.</p>}{<div className="photo-modal__actions"><button className="btn btn--ghost" onClick={() => void toggleFavorite(previewMedia)}>{previewMedia.favorite ? "★ Unfavorite" : "☆ Favorite"}</button>{previewMedia.webViewUrl ? <button className="btn btn--primary" onClick={() => window.open(previewMedia.webViewUrl, "_blank", "noopener,noreferrer")}>Open original in Drive</button> : null}<button className="btn btn--ghost" disabled={deletingMediaId === previewMedia.id} onClick={() => void removeMedia(previewMedia)}>{deletingMediaId === previewMedia.id ? "Removing…" : "Remove from library"}</button></div>}<small className="photo-modal__note">Remove only hides this item from Stashr; the original stays in Google Drive.</small></section></div>}

    <header className="photo__head"><div><p className="eyebrow">Personal AI Photo Cloud</p><h1>One library. Every account.</h1><p className="photo__lede">Browse your connected storage as one calm, searchable timeline. Originals stay in Google Drive; Photo Cloud manages the index, albums and backup decisions.</p></div><div className="photo__head-actions"><button className="btn btn--ghost" onClick={() => void refreshIndex()}><Refresh size={15} /> Refresh index</button>{profile?.features?.photoImport ? <Link className="btn btn--ghost" to="/photos/import">Import from Google Photos</Link> : null}<button className="btn btn--ghost" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}>{selecting ? "Done" : "Select"}</button><button className="btn btn--ghost" onClick={() => void shareLibrary()}>Share this view</button><button className="btn btn--primary" onClick={() => setShowConnect(true)}><Plus size={15} /> Connect Google</button></div></header>
    <section className="photo__stats"><div className="photo-stat"><span>Indexed library</span><strong>{media.length}</strong><small>items across connected accounts</small></div><div className="photo-stat"><span>Connected storage</span><strong>{gb(storage)} <em>/ {gb(capacity)}</em></strong><div className="photo-meter"><i style={{ width: `${capacity ? Math.min(100, storage / capacity * 100) : 0}%` }} /></div><small>{accounts.length} Google account{accounts.length === 1 ? "" : "s"} · {gb(data?.totals?.freeGb)} free{data?.totals?.unknownLimit ? ` (${data.totals.unknownLimit} limit unknown)` : ""}</small></div><div className="photo-stat"><span>Backup status</span><strong className={failedJobs ? "" : "is-good"}>{(data?.jobs || []).length ? `${doneJobs} backed up${failedJobs ? `, ${failedJobs} need attention` : ""}` : "No uploads yet"}</strong><small>Uploads start from the Android app and are verified before they count</small></div></section>
    <div className="photo__layout"><section className="photo__main"><div className="photo__toolbar"><div className="photo__tabs">{[["photos","Photos"],["videos","Videos"],["drive","Drive files"],["all","All media"],["sync","Sync monitor"]].map(([id,title]) => <button key={id} className={viewTab === id ? "is-active" : ""} onClick={() => setViewTab(id)}>{title}</button>)}</div><div className="photo__search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, account or type" /></div><div className="photo__filters">{[["all", "All items"], ["screenshot", "Screenshots"], ["favorites", "Favorites"]].map(([id, text]) => <button key={id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{text}</button>)}<select aria-label="Sort media" value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="largest">Largest first</option></select><select aria-label="Source filter" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="all">All sources</option><option value="drive">Google Drive</option></select></div></div>{viewTab === "sync" ? <section className="sync-monitor"><p className="eyebrow">Live sync monitor · browser-only timer</p><h2>{syncStartedAt ? "Sync in progress" : "Latest sync"}</h2><strong>{Math.floor(syncElapsed / 60)}m {syncElapsed % 60}s</strong><p>{syncStartedAt ? "Elapsed time since you started a sync in this tab." : "Timer runs only while a sync is active; history is not stored in the database."}</p><div className="sync-monitor__stats"><span>Indexed items <b>{data?.media?.length || 0}</b></span><span>Connected accounts <b>{accounts.length}</b></span><span>Last scanned <b>{fmt(accounts.reduce((latest, a) => !latest || new Date(a.lastScan || 0) > new Date(latest) ? a.lastScan : latest, null))}</b></span></div><button className="btn btn--primary" onClick={() => void refreshIndex()} disabled={Boolean(syncStartedAt)}>{syncStartedAt ? "Syncing…" : "Start sync"}</button></section> : <>{selecting ? <div className="photo-bulk" role="toolbar" aria-label="Bulk actions"><strong>{picked.size} selected</strong><button className="btn btn--quiet btn--sm" onClick={() => setPicked(new Set(visibleMedia.map((m) => m.id)))}>Select shown ({visibleMedia.length})</button><button className="btn btn--quiet btn--sm" disabled={bulkBusy || !picked.size} onClick={() => void bulkFavorite()}>☆ Favourite</button><button className="btn btn--quiet btn--sm" disabled={bulkBusy || !picked.size} onClick={() => void bulkShare()}>Share link</button><button className="btn btn--quiet btn--sm" disabled={bulkBusy || !picked.size} onClick={() => void bulkRemove()}>Remove</button></div> : null}<div className="photo__grid">{visibleMedia.map((item) => <article className={`media-card ${picked.has(item.id) ? "is-picked" : ""}`} key={item.id}>{selecting ? <input className="media-card__pick" type="checkbox" checked={picked.has(item.id)} onChange={() => togglePick(item.id)} aria-label={`Select ${item.filename || "item"}`} /> : null}<div role="button" tabIndex={0} className={`media-card__visual media-card__visual--${item.type} media-card__open`} onClick={() => (selecting ? togglePick(item.id) : setPreviewMedia(item))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (selecting) togglePick(item.id); else setPreviewMedia(item); } }} aria-label={`Preview ${item.filename || "media"}`}>{String(item.mimeType || "").startsWith("image/") || String(item.mimeType || "").startsWith("video/") ? <AuthImage id={item.id} size="thumb" alt={item.filename} onFail={() => {}} /> : null}<span>{String(item.mimeType || "").startsWith("video/") ? "VIDEO" : String(item.mimeType || "").startsWith("image/") ? "PHOTO" : "DRIVE FILE"}</span>{item.favorite ? <HeartLine size={17} /> : null}</div><div className="media-card__body"><strong>{item.filename}</strong><span>{fmt(item.takenAt)} · {gb(item.size)}</span><small><i style={{ background: item.accountColor }} />{item.account}</small><button className="text-button" aria-pressed={Boolean(item.favorite)} onClick={() => void toggleFavorite(item)}>{item.favorite ? "★ Favorite" : "☆ Favorite"}</button>{item.webViewUrl ? <button className="text-button" onClick={() => window.open(item.webViewUrl, "_blank", "noopener,noreferrer")}>Open in Drive ↗</button> : null}</div></article>)}</div>{media.length > pageSize && <div className="photo-modal__actions"><button className="btn btn--ghost" onClick={() => setPageSize((n) => n + 60)}>Show more ({media.length - pageSize} left)</button></div>}{!media.length && <div className="photo-empty"><Search size={24} /><h3>No matching media</h3><p>Try a broader search or refresh the account index.</p></div>}</>}</section>
      <aside className="photo__side"><section className="photo-panel"><div className="panel-title"><div><p className="eyebrow">Storage manager</p><h2>Where new photos go</h2></div><Folder size={20} /></div><p className="panel-copy">Choose eligible Google accounts. New uploads use priority and available capacity; existing originals never move silently.</p>{accounts.map((account) => <div className="account-row" key={account.id}><span className="account-row__avatar" style={{ background: account.accountColor || "var(--accent)" }}>{(account.email || "G")[0].toUpperCase()}</span><div><strong>{account.label}</strong><small>{account.email}</small><div className="account-row__bar"><i style={{ width: `${account.limitGb ? Math.min(100, account.usedGb / account.limitGb * 100) : 0}%` }} /></div><small>{gb(account.usedGb)} used · {gb(Math.max(0, account.limitGb - account.usedGb))} free · {account.status || "connected"}</small><div className="account-row__actions">{account.oauthMode === "connected" && <button className="text-button" onClick={() => void syncAccount(account.id)} disabled={syncingId === account.id}>{syncingId === account.id ? "Syncing…" : "Sync"}</button>}{account.oauthMode === "connected" && <button className="text-button" onClick={() => void toggleEligible(account)}>{account.eligible ? "Pause routing" : "Enable routing"}</button>}{account.oauthMode === "connected" && <button className="text-button text-button--danger" onClick={() => void disconnectAccount(account)}>Disconnect</button>}</div></div><button className={`account-priority ${policy.defaultConnectionId === account.id ? "is-selected" : ""}`} title="Use as default destination" onClick={() => setPolicy({ ...policy, defaultConnectionId: account.id })}>{policy.defaultConnectionId === account.id ? <Check size={14} /> : account.priority}</button></div>)}<button className="btn btn--ghost btn--full" onClick={() => setShowConnect(true)}><Plus size={14} /> Add another account</button>{data?.suggestion ? <p className="panel-copy">{data.suggestion.none ? data.suggestion.reason : `Next uploads go to ${data.suggestion.label}. ${data.suggestion.reason}`}</p> : null}{data?.suggestion && !data.suggestion.none && data.suggestion.accountId !== policy.defaultConnectionId ? <button className="btn btn--ghost btn--full" onClick={() => setPolicy({ ...policy, defaultConnectionId: data.suggestion.accountId })}>Use {data.suggestion.label} as default</button> : null}<button className="btn btn--ghost btn--full" disabled={importing} onClick={() => void importOld()}>{importing ? "Scanning Drive…" : "Scan Drive for existing photos"}</button><div className="policy-row"><label><input type="checkbox" checked={policy.wifiOnly !== false} onChange={(e) => setPolicy({ ...policy, wifiOnly: e.target.checked })} /> Wi-Fi only</label><label><input type="checkbox" checked={Boolean(policy.chargingOnly)} onChange={(e) => setPolicy({ ...policy, chargingOnly: e.target.checked })} /> Charging only</label></div><button className="btn btn--primary btn--full" onClick={() => void savePolicy()}>Save routing policy</button><button className="btn btn--ghost btn--full" onClick={() => void downloadManifest()}>Export library manifest</button></section>
        <section className="photo-panel photo-panel--accent"><div className="panel-title"><div><p className="eyebrow">Backup queue</p><h2>Android handoff</h2></div><Upload size={20} /></div><div className="queue-state"><span className="queue-state__icon"><Clock size={18} /></span><div><strong>{(data?.jobs || []).length ? `${data.jobs.length} job${data.jobs.length === 1 ? "" : "s"} tracked` : "Ready for your camera roll"}</strong><small>Uploads are queued, retried and verified before they count.</small></div></div></section>
        <section className="photo-panel"><div className="panel-title"><div><p className="eyebrow">Folders</p><h2>Drive folders</h2></div><Folder size={20} /></div><p className="panel-copy">Each folder is a real folder inside "Stashr Photos" in Google Drive. Folders from the phone (Camera, Screenshots) appear here after the first backup.</p>{(data?.folders || []).map((folder) => <div className="share-row" key={folder.id}><div><strong>{folder.name}</strong><small>{folder.count} item{folder.count === 1 ? "" : "s"}</small></div><span><button className="btn btn--ghost btn--sm" onClick={() => setShareTarget(folder)}>Share</button> <button className="btn btn--ghost btn--sm" onClick={() => void removeFolder(folder)}>Remove</button></span></div>)}{(data?.driveFolders || []).length ? <div><p className="panel-copy">Folders from connected Google Drive</p>{data.driveFolders.map((folder) => <a className="share-row drive-folder-row" key={folder.connectionId + ":" + folder.id} href={folder.webViewUrl || "#"} target="_blank" rel="noreferrer" onClick={(e) => { if (!folder.webViewUrl) e.preventDefault(); }}><div><strong><Folder size={14} /> {folder.name}</strong><small>{folder.account}</small></div><span className="text-button">Open in Drive ↗</span></a>)}</div> : null}{folderShares.length ? <div><p className="panel-copy">Shared by you</p>{folderShares.map((share) => <div className="share-row" key={share.id}><div><strong>{share.folderName}</strong><small>{share.recipientEmail}{share.allowDownload ? " · can download" : " · view only"}</small></div><button className="btn btn--ghost btn--sm" onClick={() => void stopFolderShare(share)}>Stop</button></div>)}</div> : null}<form className="policy-row" onSubmit={addFolder}><input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="New folder name" /><button className="btn btn--ghost btn--sm" disabled={!folderName.trim()}>Create</button></form></section>
        {sharedWithMe.length ? <section className="photo-panel"><div className="panel-title"><div><p className="eyebrow">Shared with you</p><h2>Folders from other people</h2></div></div>{sharedWithMe.map((share) => <Link className="share-row" key={share.id} to={`/photos/shared/${share.id}`}><div><strong>{share.folderName}</strong><small>from {share.ownerName || "someone"}{share.allowDownload ? " · can download" : " · view only"}</small></div><span className="text-button">Open</span></Link>)}</section> : null}
        <section className="photo-panel"><div className="panel-title"><div><p className="eyebrow">Sharing</p><h2>Active links</h2></div></div>{shares.length ? shares.map((share) => <div className="share-row" key={share.id}><div><strong>Shared collection</strong><small>Expires {fmt(share.expiresAt)}</small></div><button className="btn btn--ghost btn--sm" onClick={() => void revokeShare(share.id)}>Revoke</button></div>) : <p className="panel-copy">No active links. Share a filtered collection from the top of this page.</p>}</section>
        <section className="photo-panel"><div className="panel-title"><div><p className="eyebrow">Password manager bridge</p><h2>Connected accounts</h2></div><Sparkle size={20} /></div><p className="panel-copy">These Google logins are already in your Stashr vault. Select one when connecting storage so the photo destination stays easy to recognize.</p>{linkedGoogleItems.length ? linkedGoogleItems.slice(0, 4).map((item) => <button className="linked-login" key={item.id} type="button" onClick={() => { setLabel(item.name || "Google account"); setShowConnect(true); }}><span>{(item.name || "G")[0]}</span><div><strong>{item.name}</strong><small>{item.username || item.url || "Google account"}</small></div><span className="linked-login__action">Use</span></button>) : <p className="panel-copy">Add a Google login in Passwords and it will appear here.</p>}</section>
      </aside></div>
    {showConnect && <div className="photo-modal__scrim" onMouseDown={() => setShowConnect(false)}><form className="photo-modal card" onSubmit={connect} onMouseDown={(e) => e.stopPropagation()}><p className="eyebrow">Connect storage</p><h2>Connect a Google account</h2><p>Google OAuth will open a consent screen. Choose the Google account to use for Drive access; Stashr never asks for or stores its password.</p><label>Display label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Personal Google" /></label><div className="photo-modal__actions"><button type="button" className="btn btn--ghost" onClick={() => setShowConnect(false)}>Cancel</button><button className="btn btn--primary" disabled={saving}>{saving ? "Opening Google…" : "Continue to Google"}</button></div><small className="photo-modal__note">The OAuth refresh token is encrypted inside your account record and is never returned to the website or Android app.</small></form></div>}
    {shareTarget && <div className="photo-modal__scrim" onMouseDown={() => setShareTarget(null)}><form className="photo-modal card" onSubmit={submitFolderShare} onMouseDown={(e) => e.stopPropagation()}><p className="eyebrow">Share a folder</p><h2>Share "{shareTarget.name}"</h2><p>They see this folder and the folders inside it, read-only, when they sign in to Stashr with this email address. No email is sent; tell them yourself.</p><label>Their email<input type="email" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} placeholder="name@example.com" required autoFocus /></label><label className="policy-row"><span><input type="checkbox" checked={shareDownload} onChange={(e) => setShareDownload(e.target.checked)} /> Let them download the originals</span></label><div className="photo-modal__actions"><button type="button" className="btn btn--ghost" onClick={() => setShareTarget(null)}>Cancel</button><button className="btn btn--primary" disabled={!shareEmail.trim()}>Share</button></div></form></div>}
    {shareLink && <div className="photo-modal__scrim" onMouseDown={() => setShareLink("")}><div className="photo-modal card" onMouseDown={(e) => e.stopPropagation()}><p className="eyebrow">Share link ready</p><h2>Anyone with this link can view it</h2><p>The link is read-only, expires in 7 days, and can be revoked from share management. Provider account details stay private.</p><input className="photo-share-link" readOnly value={shareLink} /><div className="photo-modal__actions"><button className="btn btn--ghost" onClick={() => setShareLink("")}>Close</button><button className="btn btn--primary" onClick={() => { navigator.clipboard?.writeText(shareLink); toast.success("Copied again."); }}>Copy link</button></div></div></div>}
  </div></main>;
}
