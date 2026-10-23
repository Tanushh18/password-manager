import React, { useCallback, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Sharing from "expo-sharing";
import { router, useLocalSearchParams } from "expo-router";
import Icon from "../components/Icon";
import { useToast } from "../components/Toast";
import { GhostButton, IconButton } from "../components/ui";
import { api, mediaSource } from "../lib/api";
import { WEBSITE } from "../lib/config";
import { dropMedia, getViewerList, patchMedia, usePhotoData } from "../lib/photoData";
import { localMap } from "../lib/localMedia";
import { useTheme } from "../lib/theme";

const srcOf = (item, size = "full") => (item.local ? { uri: item.localUri } : mediaSource(item.id, size));

function VideoPage({ item, width, height }) {
  const source = useMemo(() => srcOf(item), [item.id]);
  const player = useVideoPlayer(source, (p) => { p.loop = false; });
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width, height }} />;
}

/** One photo. Double-tap zooms in; when zoomed, drag to look around. */
function PhotoPage({ item, width, height }) {
  const [zoom, setZoom] = useState(false);
  const last = useRef(0);
  const tap = () => { const now = Date.now(); if (now - last.current < 300) setZoom((z) => !z); last.current = now; };
  const img = <Image source={srcOf(item)} contentFit="contain" cachePolicy="memory-disk" transition={150} style={zoom ? { width: width * 2.5, height: height * 2.5 } : { width, height }} />;
  if (!zoom) return <Pressable onPress={tap} style={{ width, height }}>{img}</Pressable>;
  return (
    <ScrollView style={{ width, height }} contentContainerStyle={{}} nestedScrollEnabled>
      <ScrollView horizontal nestedScrollEnabled><Pressable onPress={tap}>{img}</Pressable></ScrollView>
    </ScrollView>
  );
}

export default function PhotoViewer() {
  const { theme } = useTheme();
  const toast = useToast();
  const { width, height } = useWindowDimensions();
  const { id } = useLocalSearchParams();
  const { data } = usePhotoData();
  const ids = useMemo(() => { const l = getViewerList(); return l.length ? l : [String(id)]; }, [id]);
  const media = useMemo(() => new Map([...localMap(), ...(data?.media || []).map((m) => [m.id, m])]), [data]);
  const start = Math.max(0, ids.indexOf(String(id)));
  const [current, setCurrent] = useState(String(id));
  const [info, setInfo] = useState(false);
  const item = media.get(current);
  const onView = useRef(({ viewableItems }) => { if (viewableItems[0]) setCurrent(viewableItems[0].item); }).current;

  const favourite = async () => {
    const next = !item.favorite;
    patchMedia(item.id, { favorite: next });
    try { await api.photoMediaUpdate(item.id, { favorite: next }); } catch (e) { patchMedia(item.id, { favorite: !next }); toast(e.message, "error"); }
  };
  const download = async () => {
    try {
      const { File, Paths } = require("expo-file-system");
      const target = new File(Paths.cache, item.filename.replace(/[^\w. -]/g, "_"));
      if (target.exists) target.delete();
      const src = mediaSource(item.id, "full", "&download=1");
      const done = await File.createDownloadTask(src.uri, target, { headers: src.headers }).downloadAsync();
      if (!done) throw new Error("The download did not finish.");
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(done.uri, { dialogTitle: "Save or share the original" });
      else toast("Downloaded to the app cache.");
    } catch (e) { toast(e.message || "Could not download the original.", "error"); }
  };
  const link = async () => {
    try {
      const res = await api.photoShare({ mediaIds: [item.id], title: item.filename, expiresInDays: 7, allowDownload: false });
      await Share.share({ message: `${WEBSITE}/share/photos/${res.token}` });
    } catch (e) { toast(e.message, "error"); }
  };
  const remove = () => Alert.alert("Remove this item?", "Nothing is permanently deleted from Google Drive here.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove from Stashr only", onPress: () => run("index") },
    { text: "Move to Drive trash", style: "destructive", onPress: () => run("cloud") },
  ]);
  const run = async (scope) => {
    try { await api.photoMediaRemove(item.id, scope); dropMedia([item.id]); toast(scope === "cloud" ? "Moved to the Drive trash" : "Removed from Stashr"); router.back(); }
    catch (e) { toast(e.message, "error"); }
  };

  const render = useCallback(({ item: mid }) => {
    const m = media.get(mid);
    if (!m) return <View style={{ width, height }} />;
    if (m.availabilityState !== "available") return <View style={{ width, height, alignItems: "center", justifyContent: "center", padding: 30 }}><Text style={{ color: "#bbb", textAlign: "center", fontSize: 15 }}>This file's Google account is disconnected, so it can't be shown. The file itself is still in Drive.</Text></View>;
    return m.type === "video" ? <VideoPage item={m} width={width} height={height} /> : <PhotoPage item={m} width={width} height={height} />;
  }, [media, width, height]);

  const row = (label, value) => value ? <View style={styles.infoRow}><Text style={{ color: "#999", fontSize: 13 }}>{label}</Text><Text style={{ color: "#eee", fontSize: 13, flex: 1, textAlign: "right" }} numberOfLines={2}>{value}</Text></View> : null;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlatList data={ids} keyExtractor={(x) => x} horizontal pagingEnabled showsHorizontalScrollIndicator={false} initialScrollIndex={start} getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} onViewableItemsChanged={onView} viewabilityConfig={{ itemVisiblePercentThreshold: 60 }} renderItem={render} windowSize={3} />
      <SafeAreaView style={styles.top} edges={["top"]} pointerEvents="box-none">
        <View style={styles.topRow}>
          <IconButton name="close" onPress={() => router.back()} />
          <Text style={{ flex: 1, color: "#fff", fontSize: 14 }} numberOfLines={1}>{item?.filename}</Text>
          {item && !item.local ? <IconButton name={item.favorite ? "starFill" : "star"} active={item.favorite} onPress={favourite} /> : null}
        </View>
      </SafeAreaView>
      {item ? (
        <SafeAreaView style={styles.bottom} edges={["bottom"]}>
          {info ? (
            <View style={[styles.info, { backgroundColor: "rgba(20,22,24,.96)" }]}>
              {row("Stored in", item.account)}
              {row("Taken", item.takenAt ? new Date(item.takenAt).toLocaleString() : "")}
              {row("Size", item.size ? (item.size >= 0.1 ? `${item.size.toFixed(2)} GB` : `${(item.size * 1024).toFixed(1)} MB`) : "")}
              {row("Dimensions", item.width && item.height ? `${item.width} × ${item.height}` : "")}
              {row("Type", item.mimeType)}
              {row("Checksum", item.checksum)}
              {row("Status", item.local ? "On this phone" : item.availabilityState === "available" ? "In Google Drive" : "Source unavailable")}
            </View>
          ) : null}
          <View style={styles.actions}>
            <GhostButton small title={info ? "Hide details" : "Details"} color="#fff" onPress={() => setInfo((v) => !v)} />
            {item.local ? null : <GhostButton small title="Download" color="#fff" onPress={download} />}
            {item.local ? null : <GhostButton small title="Link" color="#fff" onPress={link} />}
            {item.local ? null : <GhostButton small title="Remove" color={theme.danger} onPress={remove} />}
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0, right: 0 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: "rgba(0,0,0,.35)" },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, justifyContent: "center", backgroundColor: "rgba(0,0,0,.45)" },
  info: { padding: 14, gap: 8 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
});
