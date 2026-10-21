import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Empty, Heading, Loading, Note, Page } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card, Chip, GradientButton } from "../components/ui";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

const names = (list) => (list?.length ? list.slice(0, 6).join(", ") + (list.length > 6 ? ` +${list.length - 6}` : "") : "—");

/** Copy one server's variables onto the others, on any hosting provider. Names and counts only; values never show. */
export default function SyncEnv() {
  const { theme } = useTheme();
  const toast = useToast();
  const { projectId, source } = useLocalSearchParams();
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [deploy, setDeploy] = useState(true);
  const [across, setAcross] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async (acrossProjects) => {
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await api.deploySync(projectId, { apply: false, sourceRef: source, allTargets: true, acrossProjects });
      setPreview(r);
      setPicked(new Set(r.targets.filter((t) => !t.error && t.branch && t.branch === r.source.branch).map((t) => t.ref)));
    } catch (e) { setPreview(null); setError(e.message); } finally { setBusy(false); }
  }, [projectId, source]);
  useEffect(() => { load(false); }, [load]);

  const toggle = (ref) => setPicked((old) => { const n = new Set(old); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; });
  const chosen = (preview?.targets || []).filter((t) => picked.has(t.ref));
  const willWrite = chosen.reduce((n, t) => n + t.create.length + (overwrite ? t.update.length : 0), 0);

  const apply = () => Alert.alert("Sync variables?", `${willWrite} variable${willWrite === 1 ? "" : "s"} will be written to ${chosen.length} server${chosen.length === 1 ? "" : "s"}.${deploy ? " Each changed server then deploys its latest commit." : ""}`, [
    { text: "Cancel", style: "cancel" },
    { text: "Sync now", onPress: async () => {
      setBusy(true); setError("");
      try {
        const r = await api.deploySync(projectId, { apply: true, overwrite, deploy, sourceRef: source, targetRefs: [...picked], acrossProjects: across });
        setResult(r);
        const written = r.results.reduce((n, x) => n + x.written, 0);
        toast(written ? `Wrote ${written} variable${written === 1 ? "" : "s"}` : "Nothing needed changing");
      } catch (e) { setError(e.message); } finally { setBusy(false); }
    } }
  ]);

  return (
    <Page title="Sync variables" subtitle="Copy one server’s variables onto the others" onRefresh={() => load(across)} refreshing={busy}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {!preview && !error ? <Loading /> : null}
      {preview ? (
        <>
          <Note>From <Text style={{ fontFamily: theme.font.bodySemi }}>{preview.source.name}</Text>{preview.source.branch ? ` · branch ${preview.source.branch}` : ""}. Servers on the same branch are selected; tap others to include them. Hidden values (secrets) are never overwritten.</Note>
          {preview.targets.length === 0 ? <Empty title="No other server">Link a second server to this project to sync.</Empty> : null}
          {preview.targets.map((t) => (
            <Card key={t.ref} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Chip label={`${t.name} · ${t.label}`} active={picked.has(t.ref)} onPress={() => !t.error && toggle(t.ref)} />
              </View>
              {t.error ? <Note tone="bad">{t.error}</Note> : (
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>
                  branch {t.branch || "—"} · +{t.create.length} new · ~{t.update.length} different · {t.same} same{"\n"}
                  new: {names(t.create)}{t.update.length ? `\ndifferent: ${names(t.update)}` : ""}{t.unreadable.length ? `\nhidden by ${t.label}: ${names(t.unreadable)}` : ""}
                </Text>
              )}
            </Card>
          ))}
          <Heading>Options</Heading>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Chip label="Replace values that differ" active={overwrite} onPress={() => setOverwrite((v) => !v)} />
            <Chip label="Redeploy changed servers" active={deploy} onPress={() => setDeploy((v) => !v)} />
            <Chip label="Other projects, same repo" active={across} onPress={() => { setAcross(!across); load(!across); }} />
          </View>
          {result ? (
            <Card style={{ gap: 4 }}>
              {result.results.map((r) => <Text key={r.ref} style={{ color: r.error || r.failed.length ? theme.danger : theme.text, fontFamily: theme.font.body, fontSize: 13 }}>{r.name}: wrote {r.written}{r.deployed ? ", redeploying" : ""}{r.failed.length ? `, failed ${r.failed.join(", ")}` : ""}{r.error ? ` · ${r.error}` : ""}</Text>)}
            </Card>
          ) : null}
          <GradientButton title={busy ? "Working…" : willWrite || deploy ? "Sync now" : "Nothing to sync"} onPress={apply} disabled={busy || !chosen.length || (willWrite === 0 && !deploy)} loading={busy} />
        </>
      ) : null}
    </Page>
  );
}
