import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Empty, Group, Heading, Line, Loading, Note, Page } from "../components/kit";
import { api, sharedSource } from "../lib/api";
import { useTheme } from "../lib/theme";

/** Folders other people shared with you: read-only previews. */
export default function Shared() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [shares, setShares] = useState(null);
  const [open, setOpen] = useState(null);
  const [view, setView] = useState(null);
  const [folder, setFolder] = useState(null);
  const [error, setError] = useState("");
  const cell = (width - 36 - 6) / 3;

  useEffect(() => { api.sharedWithMe().then((r) => setShares(r.shares || [])).catch((e) => { setError(e.message); setShares([]); }); }, []);
  const load = async (s) => {
    setOpen(s); setView(null); setError("");
    try { const d = await api.sharedMedia(s.id); setView(d); setFolder(d.folders.find((f) => !f.parentId)?.id || null); } catch (e) { setError(e.message); }
  };
  const here = useMemo(() => (view?.media || []).filter((m) => m.folderId === folder), [view, folder]);
  const subs = useMemo(() => (view?.folders || []).filter((f) => f.parentId === folder), [view, folder]);

  if (open) return (
    <Page title={open.folderName} subtitle={`From ${open.ownerName || "someone"} · view only`}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {!view ? <Loading /> : (
        <>
          {folder !== view.folders.find((f) => !f.parentId)?.id ? <Text onPress={() => setFolder(view.folders.find((f) => f.id === folder)?.parentId || null)} style={{ color: theme.accent }}>← Up one folder</Text> : null}
          {subs.map((f) => <Text key={f.id} onPress={() => setFolder(f.id)} style={{ color: theme.heading, fontFamily: theme.font.bodySemi, paddingVertical: 6 }}>{f.name} →</Text>)}
          {here.length === 0 ? <Empty title="No photos in this folder" /> : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
              {here.map((m) => <View key={m.id} style={{ width: cell, height: cell, backgroundColor: theme.surfaceRaised, borderRadius: 4, overflow: "hidden" }}><Image source={sharedSource(open.id, m.id, "thumb")} recyclingKey={m.id} contentFit="cover" cachePolicy="memory-disk" style={{ width: cell, height: cell }} /></View>)}
            </View>
          )}
        </>
      )}
      <Text onPress={() => { setOpen(null); setView(null); }} style={{ color: theme.accent, marginTop: 10 }}>← All shared folders</Text>
    </Page>
  );
  return (
    <Page title="Shared with me" subtitle="Folders other people shared with your email">
      {error ? <Note tone="bad">{error}</Note> : null}
      {!shares ? <Loading /> : shares.length === 0 ? <Empty title="Nothing shared yet">When someone shares a photo folder with your email address, it shows up here.</Empty> : (
        <Group>{shares.map((s) => <Line key={s.id} title={s.folderName} subtitle={`From ${s.ownerName || "someone"} · ${s.allowDownload ? "can download" : "view only"}`} onPress={() => load(s)} />)}</Group>
      )}
    </Page>
  );
}
