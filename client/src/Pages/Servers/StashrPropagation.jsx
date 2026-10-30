import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import * as api from "../../api/client";
import { useDialogs } from "../../Components/UI/Dialogs";

/* Admin: keep other apps pointed at Stashr's main server. Pick the apps (your GitHub projects); when the main server
   changes, Stashr writes its address into those apps' Render env and deploys them again; mobile apps with an OTA workflow get the OTA instead. One test on a single app
   comes first; after it works, Automatic can be switched on. */
// "created 1, updated 2" over every variable written in a run.
function whatChanged(run) {
  const counts = { created: 0, updated: 0, set: 0 };
  for (const service of (run && run.services) || []) for (const action of Object.values(service.actions || {})) if (action in counts) counts[action] += 1;
  return ["created", "updated", "set"].filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`).join(", ");
}

// One clear line per step for an app, from its entry in the last run: Render env, Render deploy, OTA to phones.
function steps(run) {
  if (!run) return [];
  if (run.envSkipped) return [{ label: "Server env", ok: true, text: "skipped (this app uses OTA)", neutral: true }, { label: "App OTA", ok: run.ota.ok, text: run.ota.ok ? "started" : run.ota.message || "failed" }];
  const list = run.services || [];
  const deployed = list.filter((x) => x.ok && x.deployed).length;
  const out = [
    { label: "Server env", ok: run.ok, text: run.ok ? "updated" : run.error || "failed" },
    { label: "Server deploy", ok: list.length > 0 && deployed === list.length, text: `${deployed}/${list.length} deployed` }
  ];
  if (run.ota) out.push({ label: "App OTA", ok: run.ota.ok, text: run.ota.ok ? "started" : run.ota.message || "failed" });
  return out;
}

export default function StashrPropagation() {
  const { confirm } = useDialogs();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    api.getStashrPropagation()
      .then((res) => { setData(res); setSelected(res.projectIds || []); })
      .catch(() => setData({ error: true }));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data || data.error) return null;

  const save = async (patch) => {
    try { await api.saveStashrPropagation(patch); load(); return true; }
    catch (err) { toast.error(api.errorMessage(err, "Could not save.")); return false; }
  };

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    save({ projectIds: next });
  };

  const test = async (project) => {
    const ok = await confirm({ title: `Test on “${project.name}”?`, message: `This writes ${data.envName} to its Render service(s) and deploys it again now.`, confirmLabel: "Write and deploy" });
    if (!ok) return;
    setBusy("test:" + project.id);
    try {
      const res = await api.testStashrPropagation(project.id);
      const run = (res.runs || [])[0];
      if (res.skipped) toast.info(res.skipped);
      else if (run && run.ok) toast.success(`${project.name}: ${whatChanged(run) || "done"}. You can switch Automatic on.`);
      else toast.error(run ? `${project.name}: ${run.error || "a service refused the update."}` : "Nothing was updated.");
      load();
    } catch (err) { toast.error(api.errorMessage(err, "The test failed.")); }
    finally { setBusy(""); }
  };

  const runAll = async () => {
    setBusy("all");
    try {
      const res = await api.runStashrPropagation();
      if (res.skipped) {
        toast.info(res.skipped);
      } else {
        const ok = (res.runs || []).filter((r) => r.ok).length;
        toast[res.upToDate ? "info" : ok === (res.runs || []).length ? "success" : "error"](res.upToDate ? "All selected apps are up to date." : `${ok} of ${(res.runs || []).length} apps updated.`);
      }
      load();
    } catch (err) { toast.error(api.errorMessage(err, "Could not update.")); }
    finally { setBusy(""); }
  };

  const lastRun = Object.fromEntries((data.lastRun || []).map((r) => [r.projectId, r]));
  const fe = data.frontend;
  return (
    <section className="card servers__card">
      <header className="servers__head">
        <h2>Apps that follow Stashr's main server</h2>
        <span className="servers__hint">Main now: <code>{data.mainUrl || "none"}</code> · variable <code>{data.envName}</code></span>
      </header>

      <small className="servers__hint">
        Stashr frontend: {fe ? `${fe.ok ? "✅ updated" : "❌ failed"} ${fe.at ? new Date(fe.at).toLocaleString() : ""}${fe.message ? " · " + fe.message : ""}` : "no update recorded yet"}
      </small>

      <ul className="servers__list">
        {data.projects.map((p) => {
          const checked = selected.includes(p.id);
          const upToDate = data.applied && data.applied[p.id] === data.mainUrl;
          return (
            <li key={p.id} className="servers__row">
              <label>
                <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} /> <b>{p.name}</b>
              </label>
              <code className="servers__url">{p.repo}</code>
              <span className="servers__ms">{p.services} service{p.services === 1 ? "" : "s"}</span>
              {checked && upToDate ? <span className="servers__main">UP TO DATE</span> : null}
              {checked && lastRun[p.id] ? (
                <span className="servers__steps" style={{ flexBasis: "100%", display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                  {steps(lastRun[p.id]).map((st) => (
                    <span key={st.label} title={st.text}>{st.neutral ? "➖" : st.ok ? "✅" : "❌"} {st.label}: {st.text}</span>
                  ))}
                  {!lastRun[p.id].ota && lastRun[p.id].ok ? <span>➖ App OTA: not configured for this app</span> : null}
                </span>
              ) : null}
              <span className="servers__tools">
                {checked ? (
                  <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => test(p)}>
                    {busy === "test:" + p.id ? "Updating…" : "Test on this app"}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
        {data.projects.length === 0 && <li className="servers__row">No GitHub projects yet.</li>}
      </ul>

      <label className="servers__auto">
        <input
          type="checkbox"
          checked={Boolean(data.enabled)}
          disabled={!data.testedAt}
          onChange={(e) => save({ enabled: e.target.checked })}
        /> Automatic: when the main server changes, update these apps' env and deploy them again
        {!data.testedAt ? <small> (run the test on one app first)</small> : null}
      </label>
      <div className="servers__tools">
        <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy) || selected.length === 0} onClick={runAll}>
          {busy === "all" ? "Updating…" : "Update selected apps now"}
        </button>
      </div>
      {data.lastRunAt ? <small className="servers__hint">Last run {new Date(data.lastRunAt).toLocaleString()}: {(data.lastRun || []).map((r) => `${r.name || "app"} ${r.ok ? (whatChanged(r) || "ok") : "failed"}`).join(", ") || "nothing to update"}</small> : null}
    </section>
  );
}
