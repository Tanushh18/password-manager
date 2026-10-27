import React, { useEffect, useState } from "react";
import { errorMessage, getServerUsage } from "../../api/client";

const STATE = {
  stashr: ["badge--ok", "Uses Stashr", "Finds its server through the Stashr registry."],
  hardcoded: ["badge--danger", "Hardcoded", "A literal server address is in the code. Changing the server means changing the code."],
  env: ["badge--warn", "Build-time env", "The address is set in an environment variable at build time, not from Stashr."],
  none: ["badge--muted", "No server URL", "No server address was found in this part of the code."],
};

/** For one project: each deployed thing and whether it uses the Stashr address or carries its own. Reads the repo on demand. */
export default function ServerUsage({ projectId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (force) => {
    setBusy(true); setError("");
    try { setData(await getServerUsage(projectId, force)); }
    catch (err) { setError(errorMessage(err, "Could not check the code.")); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(false); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const failure = error || data?.error;
  return (
    <div className="pv2-serverlist" aria-label="Server URL source">
      {busy && !data ? <p className="field__note">Reading the repository…</p> : null}
      {failure ? <p className="field__note">{failure}</p> : null}
      {(data?.things || []).map((t) => {
        const [cls, label, hint] = STATE[t.state] || STATE.none;
        return (
          <div key={t.key} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{t.name}</strong>
              <small>{t.provider}{t.kind === "site" ? " · site" : t.kind === "server" ? " · server" : ""}{t.suspended ? " · suspended" : ""}</small>
              <span className={"badge " + cls} title={hint}>{label}</span>
            </div>
            {t.state === "stashr" && t.fallbacks && (t.fallbacks.env || t.fallbacks.hardcoded) ? (
              <small className="field__note">Fallback kept: {[t.fallbacks.env ? t.fallbacks.env + " env var" + (t.fallbacks.env === 1 ? "" : "s") : "", t.fallbacks.hardcoded ? t.fallbacks.hardcoded + " literal address" + (t.fallbacks.hardcoded === 1 ? "" : "es") : ""].filter(Boolean).join(", ")}</small>
            ) : null}
            {t.state === "hardcoded" ? <small className="field__note">{t.samples.map((h) => `${h.origin.replace(/^https:\/\//, "")} (${h.file}:${h.line})`).join(" · ")}</small> : null}
            {t.state === "env" ? <small className="field__note">Variable{t.envNames.length === 1 ? "" : "s"}: {t.envNames.join(", ")}</small> : null}
          </div>
        );
      })}
      {data && !failure ? (
        <p className="field__note">
          Checked {data.repo}{data.truncated ? " (large repo, partly read)" : ""}.{" "}
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void load(true)}>{busy ? "Checking…" : "Check again"}</button>
        </p>
      ) : null}
    </div>
  );
}
