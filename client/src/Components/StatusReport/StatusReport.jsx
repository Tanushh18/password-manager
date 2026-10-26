import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { API_URL } from "../../api/client";
import { buildReport, probeServers, reportCSV, reportText } from "../../lib/statusReport";
import "./StatusReport.css";

/* Where the Stashr API servers are listed (public, the same list the apps use). Falls back to the server in use. */
async function loadApiUrls() {
  const base = API_URL();
  try {
    const res = await fetch(base + "/registry/stashr", { cache: "no-store" });
    const body = res.ok ? await res.json() : null;
    const urls = Array.isArray(body && body.urls) ? body.urls.filter((u) => /^https:\/\//.test(u)) : [];
    return [...new Set([base, ...urls])].filter(Boolean);
  } catch { return base ? [base] : []; }
}

const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};

/* One combined list of everything checked on this page: servers that answered 200 and everything that failed. */
export default function StatusReport({ pings, scan, crons, tick, onRecheck }) {
  const [api, setApi] = useState([]);
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    setBusy(true);
    try { setApi(await probeServers(await loadApiUrls())); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void probe(); }, [probe]);

  const report = useMemo(() => buildReport({ api, pings, scan: scan || [], crons, tick }), [api, pings, scan, crons, tick]);
  const s = report.summary;

  const recheck = async () => { setBusy(true); try { await Promise.all([probe(), onRecheck ? onRecheck() : null]); } finally { setBusy(false); } };
  const copy = () => navigator.clipboard.writeText(reportText(report)).then(() => toast.success("Report copied."), () => toast.error("Couldn't copy."));

  return (
    <section className="sr" aria-label="Combined status report">
      <header className="sr__head">
        <div>
          <h2>Combined status report</h2>
          <p><b className="sr__okn">{s.ok} OK</b> · <b className={s.failed ? "sr__badn" : ""}>{s.failed} failed</b>{s.unchecked ? ` · ${s.unchecked} not checked yet` : ""}</p>
        </div>
        <div className="sr__tools">
          <button type="button" className="rd-btn rd-btn--quiet" disabled={busy} onClick={() => void recheck()}>{busy ? "Checking…" : "↻ Re-check all"}</button>
          <button type="button" className="rd-btn rd-btn--quiet" onClick={copy}>Copy</button>
          <button type="button" className="rd-btn rd-btn--quiet" onClick={() => download("stashr-status-" + new Date().toISOString().slice(0, 10) + ".csv", reportCSV(report), "text/csv")}>CSV</button>
        </div>
      </header>
      <div className="sr__cols">
        <div>
          <h3 className="sr__h sr__h--ok">200 OK ({s.ok})</h3>
          <ul>{report.ok.map((r, i) => <li key={i}><span>{r.name}<small>{r.group}</small></span><em>{r.status ? r.status : "OK"}{r.ms != null ? ` · ${r.ms} ms` : ""}</em></li>)}{!s.ok && <li className="sr__none">Nothing answered OK yet.</li>}</ul>
        </div>
        <div>
          <h3 className="sr__h sr__h--bad">Failed ({s.failed})</h3>
          <ul>{report.failed.map((r, i) => <li key={i}><span>{r.name}<small>{r.group}</small></span><em>{r.status ? r.status + " · " : ""}{r.detail || "failed"}</em></li>)}{!s.failed && <li className="sr__none">No failures. 🎉</li>}</ul>
          {s.unchecked ? <><h3 className="sr__h">Not checked yet ({s.unchecked})</h3><ul>{report.unchecked.map((r, i) => <li key={i}><span>{r.name}<small>{r.group}</small></span><em>{r.detail}</em></li>)}</ul></> : null}
        </div>
      </div>
    </section>
  );
}
