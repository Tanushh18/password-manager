import React, { useState } from "react";
import { toast } from "react-toastify";
import { getSecretExposure } from "../../api/client";

/* Names of env vars that look like secrets but are shipped to every visitor by their prefix (REACT_APP_, VITE_, ...).
   Scanned on demand (it reads every service's env vars from Render). Values are never shown, only masked previews. */
export default function SecretExposureCard() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const scan = () => {
    setBusy(true);
    getSecretExposure()
      .then((res) => setResult(res))
      .catch(() => toast.error("Could not scan the env vars."))
      .finally(() => setBusy(false));
  };

  return (
    <section className="sv-secrets" aria-label="Secrets exposed to the browser">
      <header>
        <h2>Secrets in the browser</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={scan} disabled={busy}>
          {busy ? "Scanning…" : result ? "Scan again" : "Scan now"}
        </button>
      </header>
      {!result && <small>Finds keys that are published to every visitor because of their name prefix.</small>}
      {result && result.findings.length === 0 && (
        <small>No exposed secrets in {result.scanned} service{result.scanned === 1 ? "" : "s"}{result.complete ? "." : " (some accounts could not be read)."}</small>
      )}
      {result && result.findings.length > 0 && (
        <ul className="sv-secrets__list">
          {result.findings.map((f) => (
            <li key={f.serviceId + f.name} className={"is-" + f.severity}>
              <b>{f.name}</b> <span>in {f.service}</span>
              <small>{f.reason}. Value: {f.preview}. Move it to the server and rotate it.</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
