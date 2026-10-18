import React, { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Empty, Heading, Loading, Page } from "../components/kit";
import { useToast } from "../components/Toast";
import { GhostButton, GradientButton } from "../components/ui";
import { api, mediaSource } from "../lib/api";
import { patchAlbum, setViewerList, usePhotoData } from "../lib/photoData";
import { useTheme } from "../lib/theme";

export default function Albums() {
  const { theme } = useTheme();
  const toast = useToast();
  const { data, loading, reload } = usePhotoData();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const media = new Map((data?.media || []).map((m) => [m.id, m]));
  const albums = data?.albums || [];

  const create = async () => {
    try { const r = await api.albumCreate(name.trim()); patchAlbum(r.album); setName(""); } catch (e) { toast(e.message, "error"); }
  };
  const rename = async (album) => {
    try { const r = await api.albumRename(album.id, editing.name.trim()); patchAlbum({ ...album, ...r.album }); setEditing(null); } catch (e) { toast(e.message, "error"); }
  };
  const remove = (album) => Alert.alert(`Delete "${album.name}"?`, "Only the album is deleted. The photos stay where they are.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete album", style: "destructive", onPress: async () => { try { await api.albumDelete(album.id); patchAlbum({ id: album.id, deleted: true }); } catch (e) { toast(e.message, "error"); } } },
  ]);
  const open = (album) => {
    const ids = (album.mediaIds || []).filter((id) => media.has(id));
    if (!ids.length) return toast("This album is empty. Select photos in the Photos tab and choose Album.", "info");
    setViewerList(ids);
    router.push({ pathname: "/photo-viewer", params: { id: ids[0] } });
  };

  return (
    <Page title="Albums" subtitle="Collections of photos from any of your accounts" onRefresh={reload} refreshing={loading}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput value={name} onChangeText={setName} placeholder="New album name" placeholderTextColor={theme.textFaint} style={{ flex: 1, color: theme.text, borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 10, paddingHorizontal: 12, height: 44, fontFamily: theme.font.body }} />
        <GradientButton title="Create" small disabled={!name.trim()} onPress={create} />
      </View>
      {!data ? <Loading /> : albums.length === 0 ? <Empty title="No albums yet">Albums are lists of references. Adding a photo to one never copies or moves the original.</Empty> : (
        <>
          <Heading>{albums.length} album{albums.length === 1 ? "" : "s"}</Heading>
          {albums.map((a) => {
            const cover = (a.mediaIds || []).map((id) => media.get(id)).find((m) => m && m.hasThumbnail && m.availabilityState === "available");
            return (
              <View key={a.id} style={{ borderWidth: 1, borderColor: theme.line, borderRadius: 12, backgroundColor: theme.surface, overflow: "hidden" }}>
                <Pressable onPress={() => open(a)} style={{ flexDirection: "row", gap: 12, padding: 12, alignItems: "center" }}>
                  <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: theme.surfaceRaised, overflow: "hidden" }}>
                    {cover ? <Image source={mediaSource(cover.id)} contentFit="cover" style={{ width: 56, height: 56 }} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    {editing?.id === a.id ? (
                      <TextInput autoFocus value={editing.name} onChangeText={(v) => setEditing({ id: a.id, name: v })} onSubmitEditing={() => rename(a)} style={{ color: theme.text, borderBottomWidth: 1, borderColor: theme.accent, fontSize: 16, paddingVertical: 2 }} />
                    ) : <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16 }}>{a.name}</Text>}
                    <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, marginTop: 2 }}>{(a.mediaIds || []).length} item{(a.mediaIds || []).length === 1 ? "" : "s"}</Text>
                  </View>
                </Pressable>
                <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
                  {editing?.id === a.id ? <GhostButton small title="Save name" onPress={() => rename(a)} /> : <GhostButton small title="Rename" onPress={() => setEditing({ id: a.id, name: a.name })} />}
                  <GhostButton small title="Delete" color={theme.danger} onPress={() => remove(a)} />
                </View>
              </View>
            );
          })}
        </>
      )}
    </Page>
  );
}
