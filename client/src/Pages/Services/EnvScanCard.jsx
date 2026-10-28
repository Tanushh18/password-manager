import React, { useState } from "react";
import { toast } from "react-toastify";
import { getEnvScan } from "../../api/client";

/* Env scan, on demand (it reads every running service's env vars from Render). Shows names, hosts and masked previews only.
   - Secrets published to every visitor by a browser/app prefix (REACT_APP_, VITE_, ...).
   - Backend addresses that point at a Render service with no live service behind them (registry drift). */
export default function EnvScanCard() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const scan = () => {
    setBusy(true);
    getEnvScan()
      .then((res) => setResult(res))
      .catch(() => toast.error("Could not scan the env vars."))
      .finally(() => setBusy(false));
  };

  const clean = result && result.findings.length === 0 && result.staleAddresses.length === 0;

  return (
    <section className="sv-secrets" aria-label="Env scan">
      <header>
        <h2>Env scan</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={scan} disabled={busy}>
          {busy ? "Scanning…" : result ? "Scan again" : "Scan now"}
        </button>
      </header>
      {!result && <small>Finds keys published to every visitor, and backend addresses pointing at a Render service that is gone.</small>}
      {clean && <small>Nothing found in {result.scanned} service{result.scanned === 1 ? "" : "s"}{result.complete ? "." : " (some accounts could not be read)."}</small>}

      {result && result.findings.length > 0 && (
        <>
          <h3 className="sv-secrets__sub">Secrets published to the browser</h3>
          <ul className="sv-secrets__list">
            {result.findings.map((f) => (
              <li key={f.serviceId + f.name} className={"is-" + f.severity}>
                <b>{f.name}</b> <span>in {f.service}</span>
                <small>{f.reason}. Value: {f.preview}. Move it to the server and rotate it.</small>
              </li>
            ))}
          </ul>
        </>
      )}

      {result && result.staleAddresses.length > 0 && (
        <>
          <h3 className="sv-secrets__sub">Addresses with no live service</h3>
          <ul className="sv-secrets__list">
            {result.staleAddresses.map((f) => (
              <li key={f.serviceId + f.name} className={"is-" + f.severity}>
                <b>{f.name}</b> <span>in {f.service}</span>
                <small>
                  Points at {f.host}, which is {f.status === "suspended" ? "suspended" : "not a service of yours any more"}.
                  Update it to the live address.
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
