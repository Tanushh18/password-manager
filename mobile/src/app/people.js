import React, { useEffect, useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import FaceCrop from "../components/FaceCrop";
import { Empty, Heading, Note, Page } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card, GhostButton, GradientButton } from "../components/ui";
import { deleteAllFaceData, getStore, loadStore, peopleList, scanFaces, setFaceSettings, subscribeFaces } from "../lib/faceScan";
import { alpha, useTheme } from "../lib/theme";

const useStore = () => {
  const [, tick] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => { loadStore().then(() => { setReady(true); tick((n) => n + 1); }); return subscribeFaces(() => tick((n) => n + 1)); }, []);
  return ready;
};

export default function People() {
  const { theme } = useTheme();
  const toast = useToast();
  const ready = useStore();
  const [progress, setProgress] = useState(null);
  const [running, setRunning] = useState(false);
  const people = ready ? peopleList() : [];
  const named = people.filter((p) => p.name);
  const settings = (ready && getStore().settings) || {};
  const small = { fontFamily: theme.font.body, fontSize: 13 };

  const scan = async (limit) => {
    setRunning(true); setProgress(null);
    try {
      const r = await scanFaces({ limit, onProgress: setProgress });
      toast(r.busy ? "A scan is already running" : r.scanned ? `${r.scanned} photo${r.scanned === 1 ? "" : "s"} scanned${r.remaining ? `, ${r.remaining} to go` : ""}` : "Nothing new to scan", "ok");
    } catch (e) { toast(e.message || "Could not scan. This needs the installed app, not Expo Go.", "error"); }
    finally { setRunning(false); setProgress(null); }
  };
  const wipe = () => Alert.alert("Delete all face data?", "Every group, name and face fingerprint on this phone is deleted. Your photos are not touched. You can scan again later.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { await deleteAllFaceData(); toast("Face data deleted"); } },
  ]);

  return (
    <Page title="People" subtitle="Photos grouped by face, on this phone only">
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>Group photos by face</Text>
            <Text style={{ color: theme.textMuted, ...small, marginTop: 2 }}>{settings.enabled ? "On. New photos are scanned on Wi-Fi while charging." : "Off"}</Text>
          </View>
          <Switch value={Boolean(settings.enabled)} onValueChange={(v) => setFaceSettings({ enabled: v })} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }} thumbColor="#fff" />
        </View>
        <Note>Faces are found and compared on this phone. The face fingerprints are never uploaded and never leave the device. Grouping is approximate: look-alikes can be mixed together and the same person can appear in two groups. You can merge, split and delete groups.</Note>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <GradientButton small title={running ? (progress ? `Scanning ${progress.scanned} of ${progress.total}…` : "Scanning…") : "Scan photos now"} loading={running && !progress} disabled={running} onPress={() => scan(60)} />
          {people.length ? <GhostButton small title="Delete all face data" color={theme.danger} onPress={wipe} /> : null}
        </View>
      </Card>

      {!ready ? null : people.length === 0 ? (
        <Empty title="No people yet">Turn the switch on and tap Scan photos now. The first scan of a large library takes a while; it continues in batches.</Empty>
      ) : (
        <>
          <Heading>{named.length ? `${named.length} named · ` : ""}{people.length} group{people.length === 1 ? "" : "s"}</Heading>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            {people.map((p) => (
              <Pressable key={p.id} onPress={() => router.push({ pathname: "/person", params: { id: p.id } })} style={{ width: 92, alignItems: "center", gap: 6 }}>
                <FaceCrop face={p.cover} size={84} />
                <Text numberOfLines={1} style={{ color: theme.heading, fontFamily: theme.font.bodyMedium, fontSize: 13 }}>{p.name || "Unnamed"}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>{p.photos} photo{p.photos === 1 ? "" : "s"}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Page>
  );
}
