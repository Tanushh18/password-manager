import React, { useEffect, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import Field from "../Field/Field";
import { Check, Trash, ShieldCheck } from "../Icons/Icons";
import { connectGithubAccount, deleteGithubAccount, getGithubAccounts } from "../../api/client";

/** Add / remove GitHub tokens. The token is sent once to the server, validated, stored encrypted, and never returned. */
export default function GithubConnectModal({ open, onClose, onChange }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try { const r = await getGithubAccounts(); setAccounts(r.accounts || []); onChange?.(r.accounts || []); }
    catch (e) { setError(e?.response?.data?.error || "Could not load GitHub connections."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (open) { setError(""); void load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (event) => {
    event.preventDefault();
    if (!token.trim()) return;
    setBusy(true); setError("");
    try {
      const r = await connectGithubAccount({ name: name.trim(), token: token.trim() });
      setToken(""); setName("");
      toast.success("Connected GitHub as " + r.account.login);
      await load();
    } catch (e) { setError(e?.response?.data?.error || "Could not connect this token."); }
    finally { setBusy(false); }
  };

  const remove = async (account) => {
    if (!window.confirm("Disconnect " + account.login + "? Its saved token will be deleted from your Stashr account.")) return;
    try { await deleteGithubAccount(account.id); toast.success("GitHub connection removed."); await load(); }
    catch (e) { toast.error(e?.response?.data?.error || "Could not remove this connection."); }
  };

  return (
    <Modal open={open} onClose={onClose} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <span className="card__ribbon" />
        <div className="sheet__head">
          <span className="sheet__seal"><ShieldCheck size={22} /></span>
          <h2 className="sheet__title">Connect GitHub</h2>
          <p className="sheet__sub">Paste a GitHub token and every project with a GitHub “Repo URL” can show its commits, open pull requests and CI status.</p>
        </div>

        {accounts.length ? (
          <ul className="gh-accounts" aria-label="Connected GitHub accounts">
            {accounts.map((a) => (
              <li key={a.id}>
                <span className="gh-accounts__dot"><Check size={13} /></span>
                <div><strong>{a.login}</strong><small>{a.name !== a.login ? a.name + " · " : ""}connected {a.connectedAt ? new Date(a.connectedAt).toLocaleDateString() : ""}</small></div>
                <button type="button" className="icon-btn icon-btn--quiet" onClick={() => void remove(a)} aria-label={"Disconnect " + a.login}><Trash size={15} /></button>
              </li>
            ))}
          </ul>
        ) : loading ? <p className="field__note">Loading…</p> : null}

        <form onSubmit={connect} className="gh-form">
          <Field id="gh-name" label="Name (optional)" placeholder="e.g. Personal" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
          <Field id="gh-token" label="GitHub token" secret placeholder="github_pat_… or ghp_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck="false"
            hint="Stored encrypted with your account key and never shown again." />
          {error ? <div className="notice notice--err" role="alert">{error}</div> : null}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy || !token.trim()}>
            {busy ? <span className="spinner" /> : <Check size={15} />} {busy ? "Validating…" : "Validate & connect"}
          </button>
        </form>

        <details className="gh-help">
          <summary>How do I create a token?</summary>
          <ol>
            <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener">GitHub → Settings → Fine-grained tokens → Generate</a>.</li>
            <li>Under <em>Repository access</em> choose the repos you track here (or all).</li>
            <li>Set <em>read-only</em> permissions: <strong>Metadata</strong>, <strong>Contents</strong>, <strong>Pull requests</strong> and <strong>Actions</strong>.</li>
            <li>Generate, copy the token, paste it above. Stashr only ever reads — it never writes to GitHub.</li>
          </ol>
          <p className="field__note">A classic token with the <code>repo</code> scope also works, but fine-grained read-only is safer.</p>
        </details>
      </div>
    </Modal>
  );
}
