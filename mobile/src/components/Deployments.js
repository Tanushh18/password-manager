import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { router } from "expo-router";
import { Empty, Heading, Loading, Note, Status, ago } from "./kit";
import { useToast } from "./Toast";
import { Badge, Card, Chip, GhostButton, GradientButton } from "./ui";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

const TONE = (status) => (/fail|error|cancel/.test(status) ? "bad" : /live|ready|success/.test(status) ? "ok" : "warn");
const LABEL = { live: "Live", ready: "Live", success: "Live", build_in_progress: "Building", update_in_progress: "Deploying", created: "Queued", queued: "Queued", build_failed: "Build failed", update_failed: "Deploy failed", failed: "Failed", canceled: "Canceled" };
const labelOf = (s) => LABEL[String(s || "").toLowerCase()] || String(s || "Running").replace(/_/g, " ");

/** Deploy history and logs of one server, fetched when opened. */
function Logs({ projectId, target }) {
  const { theme } = useTheme();
  const [state, setState] = useState({ loading: true, deploys: [], lines: null, logError: "", error: "" });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const h = await api.deployHistory(projectId, target.ref);
        const deploys = (h.deploys || []).slice(0, 5);
        let lines = null; let logError = "";
        try { lines = (await api.deployLogs(projectId, target.ref, deploys[0]?.id || "")).lines || []; } catch (e) { logError = e.message; }
        if (live) setState({ loading: false, deploys, lines, logError, error: "" });
      } catch (e) { if (live) setState((s) => ({ ...s, loading: false, error: e.message })); }
    })();
    return () => { live = false; };
  }, [projectId, target.ref]);
  if (state.loading) return <Loading />;
  if (state.error) return <Note tone="bad">{state.error}</Note>;
  return (
    <View style={{ gap: 8 }}>
      {state.deploys.map((d) => (
        <View key={d.id || d.at} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Status text={labelOf(d.status)} tone={TONE(String(d.status).toLowerCase())} />
          <Text style={{ flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }} numberOfLines={1}>{d.commit || "Deploy"} · {ago(d.at)}</Text>
        </View>
      ))}
      {state.logError ? <Note>{state.logError}</Note> : null}
      {state.lines ? (
        <View style={{ backgroundColor: theme.surface2 || theme.card, borderRadius: 10, padding: 10, maxHeight: 220 }}>
          <Text selectable style={{ color: theme.text, fontFamily: theme.font.mono, fontSize: 11 }}>{state.lines.length ? state.lines.slice(-60).map((l) => l.text).join("\n") : "No log lines yet."}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Pick another branch for one server (read from GitHub) and deploy it. */
function Branch({ projectId, project, target, onDone }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const open = async () => {
    setBusy(true);
    try {
      const accounts = (await api.githubAccounts()).accounts || [];
      const usable = accounts.find((a) => a.valid !== false && a.write) || accounts.find((a) => a.valid !== false);
      if (!usable) { toast("Connect GitHub in Settings first.", "error"); return; }
      const r = await api.githubBranches(usable.id, project.repoUrl);
      setInfo({ branches: (r.branches || []).map((b) => b.name), def: r.default });
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const pick = (name) => Alert.alert(`Deploy "${name}" on ${target.name}?`, name === target.branch ? "Deploys the latest commit again." : `Switches from "${target.branch || "its branch"}" and deploys.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Deploy", onPress: async () => { setBusy(true); try { const r = await api.deployBranch(projectId, target.ref, name, true); toast(r.deployed ? `Deploying ${r.branch}` : r.note || `Branch set to ${r.branch}`); setInfo(null); onDone(); } catch (e) { toast(e.message, "error"); } finally { setBusy(false); } } }
  ]);
  if (!info) return <GhostButton small title={busy ? "Reading…" : "Change branch"} onPress={open} disabled={busy} />;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {info.branches.map((b) => <Chip key={b} label={b === info.def ? `${b} (default)` : b} active={b === target.branch} onPress={() => pick(b)} />)}
      <GhostButton small title="Cancel" onPress={() => setInfo(null)} />
    </View>
  );
}

/** Every server of a project on every hosting provider: status, URL, branch, logs, redeploy, env sync and move. */
export default function Deployments({ project }) {
  const { theme } = useTheme();
  const toast = useToast();
  const [targets, setTargets] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { setTargets((await api.deployTargets(project.id)).targets || []); setError(""); }
    catch (e) { setError(e.message); setTargets((t) => t || []); }
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const redeploy = (t) => Alert.alert(`Deploy ${t.name}?`, `Builds and deploys the latest commit on ${t.label}.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Deploy", onPress: async () => { setBusy(t.ref); try { await api.deployRedeploy(project.id, t.ref); toast(`Deploy started on ${t.label}`); load(); } catch (e) { toast(e.message, "error"); } finally { setBusy(""); } } }
  ]);

  if (!targets) return <Loading />;
  if (!targets.length) return error ? <Note tone="bad">{error}</Note> : null;
  const main = targets.find((t) => t.main) || targets[0];

  return (
    <View style={{ gap: 10 }}>
      <Heading action={targets.length > 1 ? <GhostButton small title="Sync env" onPress={() => router.push({ pathname: "/sync-env", params: { projectId: project.id, source: main.ref } })} /> : null}>Deployments · {targets.length}</Heading>
      {error ? <Note tone="bad">{error}</Note> : null}
      {targets.map((t) => {
        const raw = String(t.latestDeploy?.status || "").toLowerCase();
        return (
          <Card key={t.ref} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15, flexShrink: 1 }}>{t.name}</Text>
              <Badge text={t.label + (t.main ? " · main" : "")} color={theme.textMuted} />
              <Status text={t.suspended ? "Suspended" : t.error && !t.url ? "Unreadable" : labelOf(raw)} tone={t.suspended ? "warn" : t.error && !t.url ? "mute" : TONE(raw)} />
            </View>
            {t.url ? <Text onPress={() => Linking.openURL(t.url)} style={{ color: theme.accent, fontFamily: theme.font.body, fontSize: 13 }}>{t.url.replace(/^https?:\/\//, "")}</Text> : null}
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>
              {[t.branch && `branch ${t.branch}`, t.accountName, t.latestDeploy?.at && `deployed ${ago(t.latestDeploy.at)}`].filter(Boolean).join(" · ")}
            </Text>
            {t.error ? <Note tone="bad">{t.error}</Note> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <GradientButton small title="Redeploy" loading={busy === t.ref} onPress={() => redeploy(t)} disabled={t.suspended} />
              <GhostButton small title={open[t.ref] ? "Hide logs" : "Logs"} onPress={() => setOpen((o) => ({ ...o, [t.ref]: !o[t.ref] }))} />
              {t.dashboardUrl ? <GhostButton small title={`Open ${t.label}`} onPress={() => Linking.openURL(t.dashboardUrl)} /> : null}
              {t.provider === "render" ? <GhostButton small title="Move account" onPress={() => router.push({ pathname: "/move-server", params: { projectId: project.id, ref: t.ref } })} /> : null}
            </View>
            {project.repoUrl ? <Branch projectId={project.id} project={project} target={t} onDone={load} /> : null}
            {open[t.ref] ? <Logs projectId={project.id} target={t} /> : null}
          </Card>
        );
      })}
    </View>
  );
}
