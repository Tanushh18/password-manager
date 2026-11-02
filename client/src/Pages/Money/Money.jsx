import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  getExpenseSettings, saveExpenseSheet, setExpenseStart, postExpenseSms, getExpenses, setExpenseCategory, reviewExpense, uploadStatement
} from "../../api/client";
import { Section, Skeleton, useConfirm } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { inr, monthLabel, shiftMonth, dayLabel, groupByDay, withShares, startDateChip, STATUS_LABEL, statusTone } from "../../lib/money";
import "../Render/RenderDashboard.css";
import "./Money.css";

/** A card that fails to draw shows a short note instead of blanking the page. */
class CardBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("Money card failed:", error); } // eslint-disable-line no-console
  render() {
    if (!this.state.failed) return this.props.children;
    return <p className="mn-bad" role="alert">One card on this page could not be shown. The rest still works; reloading usually fixes it.</p>;
  }
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const monthNow = () => today().slice(0, 7);

/* ───────── 1. connect the Google Sheet ───────── */

function SetupCard({ settings, onSaved }) {
  const [url, setUrl] = useState(settings.sheetUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const email = settings.serviceAccountEmail || "";
  const copy = async () => { try { await navigator.clipboard.writeText(email); toast.success("Email copied."); } catch { toast.error("Could not copy. Select the email and copy it."); } };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { const next = await saveExpenseSheet(url.trim()); toast.success("Sheet connected."); setChanging(false); onSaved(next); }
    catch (err) { setError(errorMessage(err, "Could not use that sheet.")); }
    finally { setBusy(false); }
  };
  if (settings.configured && !changing) {
    return (
      <p className="mn-line">Sheet: <a href={settings.sheetUrl} target="_blank" rel="noreferrer">Open ↗</a> · <button type="button" className="mn-link" onClick={() => setChanging(true)}>Change sheet</button></p>
    );
  }
  return (
    <Section title="Connect your Google Sheet" subtitle="Your transactions are kept only in your own sheet, never in Stashr's database.">
      {!settings.ready ? <p className="mn-bad" role="alert">The server has no Google credentials yet: add <code>GOOGLE_SHEETS_SA_JSON</code> to its environment (a service-account key), then reload.</p> : null}
      <ol className="mn-steps">
        <li>Create a Google Sheet (any name).</li>
        <li>Click <b>Share</b>, add <span className="mn-email"><code>{email || "the service account email"}</code>{email ? <button type="button" className="rd-btn rd-btn--quiet" onClick={copy}>Copy</button> : null}</span> as an <b>Editor</b>.</li>
        <li>Paste the sheet's link below and save.</li>
      </ol>
      <form className="mn-row" onSubmit={save}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Google Sheet link" required />
        <button className="rd-btn rd-btn--primary" type="submit" disabled={busy || !settings.ready || !url.trim()}>{busy ? "Checking…" : "Save"}</button>
        {changing ? <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setChanging(false)}>Cancel</button> : null}
      </form>
      {error ? <p className="mn-bad" role="alert">{error}</p> : null}
    </Section>
  );
}

/* ───────── 2. the one-time start date ───────── */

function StartDateCard({ onDone }) {
  const [date, setDate] = useState(startDateChip("3m"));
  const [busy, setBusy] = useState(false);
  const chips = [["This month", "month"], ["3 months ago", "3m"], ["6 months ago", "6m"], ["1 year ago", "1y"]];
  const go = async () => {
    setBusy(true);
    try { const r = await setExpenseStart(date); toast.success("Done. Reading messages from " + (r.startDate || date) + "."); onDone(); }
    catch (err) { toast.error(errorMessage(err, "Could not save the date.")); }
    finally { setBusy(false); }
  };
  return (
    <Section title="How far back should I read your bank SMS?" subtitle="You choose this once. Nothing before this date is ever read.">
      <div className="mn-chips" role="group" aria-label="Quick dates">
        {chips.map(([label, kind]) => <button key={kind} type="button" className={"mn-chip" + (date === startDateChip(kind) ? " is-on" : "")} onClick={() => setDate(startDateChip(kind))}>{label}</button>)}
      </div>
      <div className="mn-row">
        <label className="mn-field">Pick a date <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="rd-btn rd-btn--primary" onClick={go} disabled={busy || !date}>{busy ? "Saving…" : "Confirm"}</button>
      </div>
      <p className="mn-dim">After this, new messages are read automatically and sorted month by month; this question never comes back. The active list keeps the last 4 months; older entries move to the sheet's Archive tab (nothing is deleted).</p>
    </Section>
  );
}

/* ───────── 3. month, totals, categories ───────── */

function MonthBar({ month, months, onChange, onRefresh, busy }) {
  const list = months && months.length ? months : [month];
  return (
    <div className="mn-monthbar">
      <button type="button" className="rd-btn rd-btn--quiet" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
      <select value={month} onChange={(e) => onChange(e.target.value)} aria-label="Month">
        {(list.includes(month) ? list : [month, ...list]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      <button type="button" className="rd-btn rd-btn--quiet" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month" disabled={month >= monthNow()}>›</button>
      <button type="button" className="rd-btn rd-btn--quiet" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
    </div>
  );
}

function Tiles({ totals, flagged }) {
  const t = totals || {};
  const tile = (label, value, tone) => <div className={"mn-tile" + (tone ? " is-" + tone : "")}><span>{label}</span><b>{value}</b></div>;
  return (
    <div className="mn-tiles">
      {tile("Spent", inr(t.debit || 0))}
      {tile("Received", inr(t.credit || 0), "ok")}
      {tile("Net", inr(t.net || 0, { sign: true }), (t.net || 0) < 0 ? "bad" : "ok")}
      {tile("Needs checking", String(flagged), flagged ? "bad" : "")}
    </div>
  );
}

function CategoryBars({ totals, selected, onSelect }) {
  const [table, setTable] = useState(false);
  const cats = useMemo(() => withShares((totals && totals.byCategory) || []), [totals]);
  if (!cats.length) return <Section title="Where the money went"><p className="mn-dim">Nothing spent this month yet.</p></Section>;
  const max = Math.max(...cats.map((c) => c.amount), 1);
  return (
    <Section title="Where the money went" subtitle="Tap a category to see only its payments." actions={<button type="button" className="rd-btn rd-btn--quiet" onClick={() => setTable(!table)}>{table ? "Show bars" : "Show as a table"}</button>}>
      {table ? (
        <table className="mn-table"><thead><tr><th>Category</th><th>Payments</th><th>Share</th><th className="r">Amount</th></tr></thead>
          <tbody>{cats.map((c) => <tr key={c.category}><td>{c.category}</td><td>{c.count}</td><td>{c.share}%</td><td className="r">{inr(c.amount)}</td></tr>)}</tbody></table>
      ) : (
        <ul className="mn-bars">{cats.map((c) => (
          <li key={c.category}>
            <button type="button" className={"mn-bar" + (selected === c.category ? " is-on" : "")} onClick={() => onSelect(selected === c.category ? "" : c.category)} aria-pressed={selected === c.category}>
              <span className="mn-bar__name">{c.category}</span>
              <span className="mn-bar__track" aria-hidden="true"><i style={{ width: Math.max(2, (c.amount / max) * 100) + "%" }} /></span>
              <span className="mn-bar__val"><b>{inr(c.amount)}</b> <em>{c.share}% · {c.count}</em></span>
            </button>
          </li>
        ))}</ul>
      )}
    </Section>
  );
}

/* ───────── 4. doubtful entries ───────── */

function FlaggedCard({ rows, onChanged }) {
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState(null);
  if (!rows.length) return null;
  const act = async (r, action) => {
    if (action === "delete" && !(await ask({ title: "Delete this entry?", message: `${inr(r.amount)} to ${r.merchant || "unknown"} on ${r.date} will be removed from your sheet.`, confirmLabel: "Delete (fake)", danger: true }))) return;
    setBusy(r.index);
    try { await reviewExpense(r.index, action); toast.success(action === "delete" ? "Removed from the sheet." : "Marked as genuine."); onChanged(); }
    catch (err) { toast.error(errorMessage(err, "Could not do that.")); }
    finally { setBusy(null); }
  };
  return (
    <Section title={`Needs checking (${rows.length})`} subtitle="These look doubtful, so they are not counted in your totals. Upload your bank statement to check them automatically, or decide yourself.">
      {dialog}
      <ul className="mn-flag">{rows.map((r) => (
        <li key={r.index}>
          <div className="mn-flag__top"><b>{inr(r.amount)}</b> <span>{r.type === "Credit" ? "from" : "to"} {r.merchant || "unknown"}</span> <em>{dayLabel(r.date)}{r.time ? " · " + r.time : ""}</em></div>
          <ul className="mn-reasons">{(r.flags && r.flags.length ? r.flags : ["Something about this message looked wrong"]).map((f, i) => <li key={i}>{f}</li>)}</ul>
          <div className="mn-row">
            <button className="rd-btn rd-btn--quiet" disabled={busy === r.index} onClick={() => act(r, "genuine")}>This is genuine</button>
            <button className="rd-btn rd-btn--danger-quiet" disabled={busy === r.index} onClick={() => act(r, "delete")}>Delete (fake)</button>
          </div>
        </li>
      ))}</ul>
    </Section>
  );
}

/* ───────── 5. the month's payments ───────── */

function CategoryEditor({ tx, categories, onClose, onSaved }) {
  const [value, setValue] = useState(tx.category);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => [...new Set([...(categories || []), tx.category])].filter(Boolean), [categories, tx.category]);
  const choose = (v) => {
    if (v !== "__new") { setValue(v); return; }
    const name = (window.prompt("Name of the new category") || "").trim().slice(0, 30);
    if (name) setValue(name);
  };
  const save = async () => {
    setBusy(true);
    try { await setExpenseCategory(tx.index, value, remember); toast.success("Category saved."); onSaved(); }
    catch (err) { toast.error(errorMessage(err, "Could not save.")); setBusy(false); }
  };
  return (
    <div className="mn-edit">
      <select value={options.includes(value) ? value : "__new"} onChange={(e) => choose(e.target.value)} aria-label="Category">
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
        {!options.includes(value) ? <option value="__new">{value}</option> : null}
        <option value="__new">New category…</option>
      </select>
      <label className="mn-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember for {tx.merchant || "this merchant"}</label>
      <button className="rd-btn rd-btn--primary" onClick={save} disabled={busy || value === tx.category && !remember}>Save</button>
      <button className="rd-btn rd-btn--quiet" onClick={onClose}>Cancel</button>
    </div>
  );
}

function TxRow({ tx, categories, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const uncategorized = tx.category === "Uncategorized";
  return (
    <li className={"mn-tx" + (uncategorized ? " is-uncat" : "") + (tx.status === "Flagged" ? " is-flagged" : "")}>
      <div className="mn-tx__main">
        <button type="button" className="mn-tx__name" onClick={() => setOpen(!open)} aria-expanded={open}>
          <b>{tx.merchant || "Unknown"}</b>
          <span>{tx.time || ""}{tx.method ? <i className="mn-method">{tx.method}</i> : null}</span>
        </button>
        <button type="button" className={"mn-cat" + (uncategorized ? " is-uncat" : "")} onClick={() => setEditing(!editing)} aria-label={`Category ${tx.category}. Change`}>{tx.category}</button>
        <span className={"mn-amt " + (tx.type === "Credit" ? "is-credit" : "")}>{tx.type === "Credit" ? "+" : ""}{inr(tx.amount)}</span>
        <span className={"mn-badge is-" + statusTone(tx.status)}>{STATUS_LABEL[tx.status] || tx.status || "Unverified"}</span>
      </div>
      {editing ? <CategoryEditor tx={tx} categories={categories} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} /> : null}
      {open ? (
        <dl className="mn-detail">
          <div><dt>Reference</dt><dd>{tx.ref || "—"}</dd></div>
          <div><dt>Account</dt><dd>{tx.account || "—"}</dd></div>
          <div><dt>Balance after</dt><dd>{tx.balance == null ? "—" : inr(tx.balance)}</dd></div>
          <div><dt>Source</dt><dd>{tx.source || "—"}</dd></div>
          {tx.note ? <div><dt>Note</dt><dd>{tx.note}</dd></div> : null}
        </dl>
      ) : null}
    </li>
  );
}

function TxList({ rows, categories, filter, onClear, onChanged, uncategorized }) {
  const shown = filter ? rows.filter((r) => r.category === filter) : rows;
  const days = useMemo(() => groupByDay(shown), [shown]);
  return (
    <Section title={filter ? `${filter} payments` : "Payments"} subtitle={`${shown.length} ${shown.length === 1 ? "entry" : "entries"}`}
      actions={filter ? <button type="button" className="rd-btn rd-btn--quiet" onClick={onClear}>Show all</button> : null}>
      {uncategorized > 0 ? <p className="mn-banner">{uncategorized} {uncategorized === 1 ? "payment is" : "payments are"} not sorted yet. Tap its category to choose one; Stashr remembers it for that merchant.</p> : null}
      {!days.length ? <p className="mn-dim">No payments here.</p> : days.map((d) => (
        <div key={d.date} className="mn-day">
          <h4><span>{dayLabel(d.date)}</span><em>{d.debit ? "Spent " + inr(d.debit) : ""}{d.debit && d.credit ? " · " : ""}{d.credit ? "Received " + inr(d.credit) : ""}</em></h4>
          <ul>{d.rows.map((r) => <TxRow key={r.index} tx={r} categories={categories} onChanged={onChanged} />)}</ul>
        </div>
      ))}
    </Section>
  );
}

/* ───────── 6. bank statement ───────── */

function StatementCard({ settings, onDone }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const input = useRef(null);
  const last = settings.lastStatement;
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("That file is bigger than 8 MB."); return; }
    setBusy(true); setError(""); setReport(null);
    try { const r = await uploadStatement(file); setReport(r.report || r); toast.success("Statement checked."); onDone(); }
    catch (err) { setError(errorMessage(err, "Could not read that statement.")); }
    finally { setBusy(false); }
  };
  const r = report || last;
  return (
    <Section title="Check against a bank statement" subtitle="Download your Federal Bank statement from net banking as Excel or CSV and upload it. Every line is matched with your sheet.">
      <div className="mn-row">
        <input ref={input} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={pick} hidden />
        <button className="rd-btn rd-btn--primary" onClick={() => input.current && input.current.click()} disabled={busy}>{busy ? "Checking…" : "Choose a statement (.csv or .xlsx)"}</button>
      </div>
      {error ? <p className="mn-bad" role="alert">{error}</p> : null}
      {r ? (
        <div className="mn-report">
          <p className="mn-dim">{report ? "Result" : "Last check"}{r.from ? `: ${r.from} to ${r.to}` : ""} · {r.lines} lines</p>
          <div className="mn-tiles">
            <div className="mn-tile is-ok"><span>Verified</span><b>{r.verified}</b></div>
            <div className={"mn-tile" + (r.mismatched ? " is-bad" : "")}><span>Mismatched</span><b>{r.mismatched}</b></div>
            <div className="mn-tile"><span>Added from statement</span><b>{r.added}</b></div>
            <div className={"mn-tile" + (r.notInStatement ? " is-warn" : "")}><span>Not in statement</span><b>{r.notInStatement}</b></div>
          </div>
          {(r.balanceBreakCount || 0) > 0 ? (
            <div className="mn-warn"><b>{r.balanceBreakCount} balance {r.balanceBreakCount === 1 ? "break" : "breaks"}</b> in the statement itself: the running balance does not follow the amounts.
              {r.balanceBreaks && r.balanceBreaks.length ? <ul>{r.balanceBreaks.slice(0, 5).map((b, i) => <li key={i}>{b.date} · {b.desc} · expected {inr(b.expected)}, got {inr(b.got)}</li>)}</ul> : null}
            </div>
          ) : report ? <p className="mn-ok">The statement's balances add up.</p> : null}
        </div>
      ) : null}
    </Section>
  );
}

/* ───────── 7. add one message by hand ───────── */

function PasteCard({ onDone }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const send = async () => {
    setBusy(true); setResult("");
    try {
      const r = await postExpenseSms([{ address: "MANUAL", body: text, date: Date.now() }]);
      if (r.needsStartDate) setResult("Choose the start date first.");
      else if (r.flagged) setResult("Added, but marked “Needs checking”: a message pasted by hand cannot be proven to come from the bank. Upload your statement to confirm it.");
      else if (r.added) setResult("Added to your sheet.");
      else if (r.duplicates) setResult("That payment is already in your sheet.");
      else setResult("I did not understand that message" + (r.unparsed && r.unparsed.length ? ": it does not look like a Federal Bank debit or credit SMS." : "."));
      if (r.added || r.flagged) { setText(""); onDone(); }
    } catch (err) { setResult(errorMessage(err, "Could not add it.")); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Paste an SMS" subtitle="Add a single bank message by hand, for example one the phone could not read.">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to … Ref …" aria-label="Bank SMS text" />
      <div className="mn-row"><button className="rd-btn rd-btn--primary" onClick={send} disabled={busy || text.trim().length < 20}>{busy ? "Adding…" : "Add"}</button></div>
      {result ? <p className="mn-line" role="status">{result}</p> : null}
    </Section>
  );
}

/* ───────── the page ───────── */

export default function Money() {
  const [settings, setSettings] = useState(null);
  const [month, setMonth] = useState(monthNow());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const loadSettings = useCallback(async () => {
    try { setSettings(await getExpenseSettings()); setError(""); }
    catch (e) { setError(errorMessage(e, "Could not load Money.")); }
  }, []);
  const loadData = useCallback(async (m) => {
    setBusy(true);
    try { setData(await getExpenses(m)); setError(""); }
    catch (e) { setError(errorMessage(e, "Could not read your sheet.")); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  const ready = Boolean(settings && settings.configured && !settings.needsStartDate);
  useEffect(() => { if (ready) loadData(month); }, [ready, month, loadData]);
  // Come back to the tab: look again (nothing polls on its own).
  useEffect(() => {
    if (!ready) return undefined;
    const onVisible = () => { if (!document.hidden) loadData(month); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, month, loadData]);

  const reload = useCallback(() => { loadSettings(); if (ready) loadData(month); }, [ready, month, loadData, loadSettings]);
  const categories = (settings && settings.categories) || (data && data.totals && data.totals.byCategory.map((c) => c.category)) || [];

  return (
    <main className="mn-page">
      <header className="mn-head">
        <div><h1>Money</h1><p className="mn-dim">Your UPI and bank payments, sorted by category and checked against your bank statement.</p></div>
      </header>
      {error ? <p className="mn-bad" role="alert">{error}</p> : null}
      {!settings ? <Skeleton lines={4} /> : (
        <>
          <CardBoundary><SetupCard settings={settings} onSaved={(s) => { setSettings(s); }} /></CardBoundary>
          {settings.configured && settings.needsStartDate ? <CardBoundary><StartDateCard onDone={loadSettings} /></CardBoundary> : null}
          {settings.configured && !settings.needsStartDate ? (
            <>
              <p className="mn-dim">Reading messages from {settings.startDate || "the start date"}{settings.lastSyncAt ? ` · last message handled ${new Date(settings.lastSyncAt).toLocaleString()}` : ""}.</p>
              <MonthBar month={month} months={data && data.months} onChange={(m) => { setMonth(m); setFilter(""); }} onRefresh={reload} busy={busy} />
              {!data ? <Skeleton lines={5} /> : (
                <>
                  <CardBoundary><Tiles totals={data.totals} flagged={(data.flagged || []).length} /></CardBoundary>
                  <CardBoundary><FlaggedCard rows={data.flagged || []} onChanged={reload} /></CardBoundary>
                  <CardBoundary><CategoryBars totals={data.totals} selected={filter} onSelect={setFilter} /></CardBoundary>
                  <CardBoundary><TxList rows={data.rows || []} categories={categories} filter={filter} onClear={() => setFilter("")} onChanged={reload} uncategorized={data.uncategorized || 0} /></CardBoundary>
                </>
              )}
              <CardBoundary><StatementCard settings={settings} onDone={reload} /></CardBoundary>
              <CardBoundary><PasteCard onDone={reload} /></CardBoundary>
            </>
          ) : null}
          <p className="mn-dim mn-note">Messages are read by the Stashr Android app (Settings → Money) and sent here; nothing is kept in Stashr's database, only in your sheet.</p>
        </>
      )}
    </main>
  );
}
