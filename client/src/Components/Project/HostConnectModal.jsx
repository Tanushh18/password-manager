import React, { useEffect, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import Field from "../Field/Field";
import { Check, Trash, ShieldCheck } from "../Icons/Icons";
import { connectHostAccount, deleteHostAccount, getHostAccounts } from "../../api/client";
import { HOSTS, hostById } from "../../lib/hostGuides";
import { useDialogs } from "../../Components/UI/Dialogs";

/** Connect Vercel / Netlify / Railway / Cloudflare Pages with an API token. The token is sent once, validated, stored encrypted and never returned. */
export default function HostConnectModal({ open, onClose, onChange, initial = "vercel" }) {
  const { confirm } = useDialogs();
  const [accounts, setAccounts] = useState([]);
  const [provider, setProvider] = useState(initial);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guide = hostById(provider) || HOSTS[0];

  const load = async () => {
    try { const r = await getHostAccounts(); setAccounts(r.accounts || []); onChange?.(r.accounts || []); }
    catch (e) { setError(e?.response?.data?.error || "Could not load hosting connections."); }
  };
  useEffect(() => { if (open) { setError(""); setProvider(initial); void load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (event) => {
    event.preventDefault();
    if (!token.trim()) return;
    setBusy(true); setError("");
    try {
      const r = await connectHostAccount({ provider, name: name.trim(), token: token.trim(), teamId: teamId.trim() });
      setToken(""); setName(""); setTeamId("");
      toast.success("Connected " + guide.label + " as " + r.account.label);
      await load();
    } catch (e) { setError(e?.response?.data?.error || "Could not connect this token."); }
    finally { setBusy(false); }
  };

  const remove = async (account) => {
    if (!(await confirm({ title: `Disconnect ${account.name}?`, message: "Its saved token is deleted from your Stashr account. Sites already deployed keep running.", confirmLabel: "Disconnect", tone: "danger" }))) return;
    try { await deleteHostAccount(account.id); toast.success("Connection removed."); await load(); }
    catch (e) { toast.error(e?.response?.data?.error || "Could not remove this connection."); }
  };

  return (
    <Modal open={open} onClose={onClose} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <span className="card__ribbon" />
        <div className="sheet__head">
          <span className="sheet__seal"><ShieldCheck size={22} /></span>
          <h2 className="sheet__title">Connect a hosting provider</h2>
          <p className="sheet__sub">Add an API token and you can deploy any project's GitHub repo and branch to that host. Render is connected from the Render page.</p>
        </div>

        <div className="dp-templates" role="group" aria-label="Hosting provider">
          {HOSTS.map((h) => <button key={h.id} type="button" className="dp-template" aria-pressed={provider === h.id} onClick={() => { setProvider(h.id); setError(""); }}><strong>{h.label}</strong><small>{h.best}</small></button>)}
        </div>

        {accounts.length ? (
          <ul className="gh-accounts" aria-label="Connected hosting accounts">
            {accounts.map((a) => (
              <li key={a.id}>
                <span className="gh-accounts__dot"><Check size={13} /></span>
                <div><strong>{hostById(a.provider)?.label || a.provider}: {a.name}</strong><small>connected {a.connectedAt ? new Date(a.connectedAt).toLocaleDateString() : ""}</small></div>
                <button type="button" className="icon-btn icon-btn--quiet" onClick={() => void remove(a)} aria-label={"Disconnect " + a.name}><Trash size={15} /></button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="notice" role="note">
          <strong>How to connect {guide.label}</strong>
          <ol>{guide.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <a href={guide.tokenUrl} target="_blank" rel="noreferrer noopener">Open the {guide.label} token page ↗</a>
        </div>

        <form onSubmit={connect} className="gh-form">
          <Field id="host-name" label="Name (optional)" placeholder="e.g. Personal" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
          <Field id="host-token" label={guide.label + " token"} secret value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck="false" hint={guide.tokenHint + " Stored encrypted with your account key and never shown again."} />
          {guide.extra?.teamId ? <Field id="host-team" label={guide.extra.teamId} value={teamId} onChange={(e) => setTeamId(e.target.value)} autoComplete="off" spellCheck="false" /> : null}
          {error ? <p className="field__hint" role="alert">{error}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy || !token.trim()}>{busy ? "Checking…" : "Connect " + guide.label}</button>
        </form>
      </div>
    </Modal>
  );
}
