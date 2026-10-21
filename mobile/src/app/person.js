import React, { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import FaceCrop from "../components/FaceCrop";
import { Empty, Heading, Note, Page } from "../components/kit";
import { useToast } from "../components/Toast";
import { GhostButton, GradientButton } from "../components/ui";
import { mediaSource } from "../lib/api";
import { cosine } from "../lib/faceCluster";
import { deletePerson, facesOf, getStore, loadStore, mergePeople, notThisPerson, peopleList, photosOf, renamePerson, subscribeFaces } from "../lib/faceScan";
import { setViewerList, usePhotoData } from "../lib/photoData";
import { useTheme } from "../lib/theme";

export default function Person() {
  const { theme } = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const { data } = usePhotoData();
  const [version, tick] = useState(0);
  const [name, setName] = useState(null);
  const [merging, setMerging] = useState(false);
  useEffect(() => { loadStore().then(() => tick((n) => n + 1)); return subscribeFaces(() => tick((n) => n + 1)); }, []);

  const store = getStore();
  const person = store?.clusters.find((c) => c.id === id);
  const faces = useMemo(() => (person ? facesOf(id) : []), [person, id, version]);
  const media = useMemo(() => new Map((data?.media || []).map((m) => [m.id, m])), [data]);
  const cell = (width - 36 - 6) / 3;

  if (!person) return <Page title="Person"><Empty title="This group no longer exists">It may have been merged or deleted.</Empty></Page>;
  const shown = [...new Set(photosOf(id))].map((m) => media.get(m)).filter(Boolean).sort((a, b) => new Date(b.takenAt || 0) - new Date(a.takenAt || 0));
  const others = peopleList().filter((p) => p.id !== id);
  const open = (m) => { setViewerList(shown.map((x) => x.id)); router.push({ pathname: "/photo-viewer", params: { id: m.id } }); };
  const wrong = (m) => {
    // If a photo holds several faces of this group, pick the one that fits the group least.
    const inPhoto = faces.filter((f) => f.mediaId === m.id);
    const face = inPhoto.sort((a, b) => cosine(a.emb, person.centroid) - cosine(b.emb, person.centroid))[0];
    if (!face) return;
    Alert.alert("Not this person?", "This face moves into a group of its own. Nothing else changes.", [
      { text: "Cancel", style: "cancel" },
      { text: "Not this person", onPress: () => { if (!notThisPerson(face.id)) toast("This is the only face in the group.", "info"); } },
    ]);
  };
  const remove = () => Alert.alert("Delete this group?", "The group and its face fingerprints are deleted from this phone. The photos are not touched.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete group", style: "destructive", onPress: () => { deletePerson(id); router.back(); } },
  ]);

  return (
    <Page title={person.name || "Unnamed"} subtitle={`${shown.length} photo${shown.length === 1 ? "" : "s"}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <FaceCrop face={store.faces[person.coverFaceId]} size={64} />
        <TextInput value={name ?? person.name} onChangeText={setName} onEndEditing={() => { if (name !== null) renamePerson(id, name); setName(null); }} placeholder="Add a name" placeholderTextColor={theme.textFaint} style={{ flex: 1, color: theme.text, borderBottomWidth: 1, borderColor: theme.lineStrong, fontSize: 18, paddingVertical: 4, fontFamily: theme.font.body }} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {others.length ? <GhostButton small title="Same person as…" onPress={() => setMerging(true)} /> : null}
        <GhostButton small title="Delete group" color={theme.danger} onPress={remove} />
      </View>
      <Note>Press and hold a photo if it is the wrong person.</Note>
      <Heading>Photos</Heading>
      {shown.length === 0 ? <Empty title="No photos">The photos in this group are not available right now.</Empty> : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
          {shown.map((m) => (
            <Pressable key={m.id} onPress={() => open(m)} onLongPress={() => wrong(m)} style={{ width: cell, height: cell, backgroundColor: theme.surfaceRaised, borderRadius: 4, overflow: "hidden" }}>
              <Image source={mediaSource(m.id)} recyclingKey={m.id} contentFit="cover" cachePolicy="memory-disk" style={{ width: cell, height: cell }} />
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={merging} transparent animationType="fade" onRequestClose={() => setMerging(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,.5)", justifyContent: "flex-end" }} onPress={() => setMerging(false)}>
          <Pressable style={{ backgroundColor: theme.surfaceSolid, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 18, paddingBottom: 30, maxHeight: "70%" }} onPress={() => {}}>
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16, marginBottom: 10 }}>Which group is the same person?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
              {others.map((p) => (
                <Pressable key={p.id} style={{ width: 80, alignItems: "center", gap: 4 }} onPress={() => { mergePeople(id, p.id); setMerging(false); toast("Groups merged"); }}>
                  <FaceCrop face={p.cover} size={64} />
                  <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12 }}>{p.name || "Unnamed"}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Page>
  );
}
