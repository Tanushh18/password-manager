import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicPhotoShare } from "../../api/client";
import { Check, Download, ShieldLine } from "../../Components/Icons/Icons";
import "./PhotoShare.css";

export default function PhotoShare() {
  const { token } = useParams();
  const [share, setShare] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { getPublicPhotoShare(token).then(setShare).catch((e) => setError(e?.response?.data?.error || "This share link is unavailable.")); }, [token]);
  return <main className="share-page"><div className="share-page__inner"><div className="share-brand"><span><ShieldLine size={18} /></span> Stashr Photo Cloud</div>{error ? <section className="share-message"><h1>Link unavailable</h1><p>{error}</p><Link className="btn btn--primary" to="/">Go to Stashr</Link></section> : !share ? <section className="share-message"><h1>Opening shared photos…</h1><p>Checking the link and preparing a safe preview.</p></section> : <><header className="share-head"><p className="eyebrow">Shared photo collection</p><h1>{share.title}</h1><p>Shared by {share.ownerLabel || "a Stashr user"} · expires {new Date(share.expiresAt).toLocaleDateString()}</p><span className="share-safe"><Check size={14} /> Provider accounts and credentials are never exposed</span></header><section className="share-grid">{(share.items || []).map((item) => <article className="share-item" key={item.id}><div className={`share-item__visual share-item__visual--${item.type}`}><span>{String(item.type || "photo").toUpperCase()}</span></div><div><strong>{item.filename}</strong><small>{item.tag || "Media"} · {item.account || "Connected storage"}</small>{share.allowDownload ? <button className="share-download" type="button"><Download size={13} /> Download original</button> : null}</div></article>)}</section></>}</div></main>;
}
