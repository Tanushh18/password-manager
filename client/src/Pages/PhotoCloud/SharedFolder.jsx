import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AuthImage from "../../Components/AuthImage";
import { errorMessage, getBlob, getSharedMedia } from "../../api/client";
import "./SharedFolder.css";

const month = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "Undated" : d.toLocaleDateString(undefined, { month: "long", year: "numeric" }); };

/* A folder someone shared with you: read-only, previews only unless they allowed downloads. */
export default function SharedFolder() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => { getSharedMedia(id).then((d) => { setData(d); setFolder(d.folders.find((f) => !f.parentId)?.id || null); }).catch((e) => setError(errorMessage(e, "This folder is not available."))); }, [id]);

  const children = useMemo(() => (data?.folders || []).filter((f) => f.parentId === folder), [data, folder]);
  const here = useMemo(() => (data?.media || []).filter((m) => m.folderId === folder).sort((a, b) => new Date(b.takenAt || 0) - new Date(a.takenAt || 0)), [data, folder]);
  const crumbs = useMemo(() => { const out = []; let cur = data?.folders.find((f) => f.id === folder); while (cur) { out.unshift(cur); cur = data.folders.find((f) => f.id === cur.parentId); } return out; }, [data, folder]);
  const groups = useMemo(() => { const m = new Map(); here.forEach((i) => m.set(month(i.takenAt), [...(m.get(month(i.takenAt)) || []), i])); return [...m]; }, [here]);

  const path = (item, sz) => `/photo-cloud/shared/${encodeURIComponent(id)}/content?id=${encodeURIComponent(item.id)}&size=${sz}&format=link`;
  const download = async (item) => {
    try {
      const blob = await getBlob(`/photo-cloud/shared/${encodeURIComponent(id)}/content?id=${encodeURIComponent(item.id)}&size=full&download=1`);
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = item.filename; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(errorMessage(e, "Could not download.")); }
  };

  if (error && !data) return <main className="sf page"><div className="shell"><Link to="/photos" className="proj-back">← Photos</Link><p className="sf__error">{error}</p></div></main>;
  if (!data) return <main className="sf page"><div className="shell"><p className="sf__muted">Loading…</p></div></main>;

  return (
    <main className="sf page"><div className="shell">
      <Link to="/photos" className="proj-back">← Photos</Link>
      <header className="sf__head">
        <p className="eyebrow">Shared with you by {data.share.ownerName || "someone"}</p>
        <h1>{data.share.folderName}</h1>
        <p className="sf__muted">{data.total} item{data.total === 1 ? "" : "s"} · view only{data.share.allowDownload ? ", downloads allowed" : ""}{data.truncated ? " · showing the first 2,000" : ""}</p>
      </header>
      <nav className="sf__crumbs" aria-label="Folder path">{crumbs.map((c, i) => <button key={c.id} type="button" onClick={() => setFolder(c.id)} disabled={i === crumbs.length - 1}>{c.name}</button>)}</nav>
      {children.length ? <div className="sf__folders">{children.map((c) => <button key={c.id} type="button" className="sf__folder" onClick={() => setFolder(c.id)}>{c.name}</button>)}</div> : null}
      {groups.length === 0 ? <p className="sf__muted">No photos in this folder.</p> : groups.map(([title, items]) => (
        <section key={title}>
          <h2>{title}</h2>
          <div className="sf__grid">{items.map((m) => <AuthImage key={m.id} path={path(m, "thumb")} alt={m.filename} className="sf__tile" onClick={() => setOpen(m)} />)}</div>
        </section>
      ))}
      {open ? (
        <div className="sf__view" onClick={() => setOpen(null)}>
          <div className="sf__viewbox" onClick={(e) => e.stopPropagation()}>
            {open.type === "video" ? <p className="sf__muted">Videos open from the owner's Drive; a preview image is shown here.</p> : null}
            <AuthImage path={path(open, "large")} alt={open.filename} className="sf__big" />
            <div className="sf__bar"><span>{open.filename}</span>{data.share.allowDownload ? <button className="btn btn--ghost btn--sm" onClick={() => void download(open)}>Download original</button> : null}<button className="btn btn--ghost btn--sm" onClick={() => setOpen(null)}>Close</button></div>
          </div>
        </div>
      ) : null}
    </div></main>
  );
}
