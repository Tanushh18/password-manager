import React, { useMemo, useState } from "react";
import { Alert, Modal, Pressable, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Empty, Heading, Loading, Note, Page } from "../components/kit";
import { useToast } from "../components/Toast";
import { GhostButton, GradientButton } from "../components/ui";
import { api } from "../lib/api";
import { usePhotoData } from "../lib/photoData";
import { useTheme } from "../lib/theme";

/** Flatten the folder tree into rows with a depth, children under their parent. */
const tree = (folders) => {
  const out = [];
  const walk = (parentId, depth) => folders.filter((f) => (f.parentId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => { out.push({ ...f, depth }); walk(f.id, depth + 1); });
  walk(null, 0);
  return out;
};

export default function PhotoFolders() {
  const { theme } = useTheme();
  const toast = useToast();
  const { data, loading, reload } = usePhotoData();
  const [name, setName] = useState("");
  const [parent, setParent] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [email, setEmail] = useState("");
  const [download, setDownload] = useState(false);
  const share = async () => {
    try { await api.folderShare(sharing.id, email.trim(), download); toast(`Shared with ${email.trim()}`); setSharing(null); setEmail(""); setDownload(false); }
    catch (e) { toast(e.message, "error"); }
  };
  const rows = useMemo(() => tree(data?.folders || []), [data]);
  const parentName = parent ? (data?.folders || []).find((f) => f.id === parent)?.name : "";

  const create = async () => {
    try { await api.folderCreate(name.trim(), parent); setName(""); setParent(null); await reload(); toast("Folder created. It appears in Google Drive when the first photo is added."); }
    catch (e) { toast(e.message, "error"); }
  };
  const rename = async (f) => { try { await api.folderRename(f.id, editing.name.trim()); setEditing(null); await reload(); } catch (e) { toast(e.message, "error"); } };
  const remove = (f) => Alert.alert(`Remove "${f.name}"?`, "Only the folder in Stashr is removed, along with any folders inside it. Your files and the folders in Google Drive stay where they are.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove folder", style: "destructive", onPress: async () => { try { await api.folderDelete(f.id); await reload(); } catch (e) { toast(e.message, "error"); } } },
  ]);
  const open = (f) => router.navigate({ pathname: "/(tabs)/photos", params: { folder: f.id } });

  return (
    <Page title="Folders" subtitle="Each folder is a real folder in Google Drive" onRefresh={reload} refreshing={loading}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={name} onChangeText={setName} placeholder={parent ? `New folder inside ${parentName}` : "New folder name"} placeholderTextColor={theme.textFaint} style={{ flex: 1, color: theme.text, borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 10, paddingHorizontal: 12, height: 44, fontFamily: theme.font.body }} />
          <GradientButton title="Create" small disabled={!name.trim()} onPress={create} />
        </View>
        {parent ? <Text onPress={() => setParent(null)} style={{ color: theme.accent, fontSize: 13 }}>Creating inside {parentName}. Tap to create at the top level instead.</Text> : null}
      </View>
      <Note>Folders you back up from the phone (Camera, Screenshots and so on) are created here automatically, with the same names.</Note>
      {!data ? <Loading /> : rows.length === 0 ? <Empty title="No folders yet">Create one above, or turn on backup and the phone's folders appear here.</Empty> : (
        <>
          <Heading>{rows.length} folder{rows.length === 1 ? "" : "s"}</Heading>
          {rows.map((f) => (
            <View key={f.id} style={{ marginLeft: f.depth * 16, borderWidth: 1, borderColor: theme.line, borderRadius: 12, backgroundColor: theme.surface }}>
              <Pressable onPress={() => open(f)} style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  {editing?.id === f.id ? <TextInput autoFocus value={editing.name} onChangeText={(v) => setEditing({ id: f.id, name: v })} onSubmitEditing={() => rename(f)} style={{ color: theme.text, borderBottomWidth: 1, borderColor: theme.accent, fontSize: 16, paddingVertical: 2 }} /> : <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16 }}>{f.name}</Text>}
                  <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, marginTop: 2 }}>{f.count} item{f.count === 1 ? "" : "s"}</Text>
                </View>
              </Pressable>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
                <GhostButton small title="Open" onPress={() => open(f)} />
                <GhostButton small title="Share" onPress={() => setSharing(f)} />
                <GhostButton small title="New inside" onPress={() => setParent(f.id)} />
                {editing?.id === f.id ? <GhostButton small title="Save name" onPress={() => rename(f)} /> : <GhostButton small title="Rename" onPress={() => setEditing({ id: f.id, name: f.name })} />}
                <GhostButton small title="Remove" color={theme.danger} onPress={() => remove(f)} />
              </View>
            </View>
          ))}
        </>
      )}
      <Modal visible={Boolean(sharing)} transparent animationType="fade" onRequestClose={() => setSharing(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,.5)", justifyContent: "flex-end" }} onPress={() => setSharing(null)}>
          <Pressable style={{ backgroundColor: theme.surfaceSolid, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 18, paddingBottom: 30, gap: 12 }} onPress={() => {}}>
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16 }}>Share "{sharing?.name}"</Text>
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>They see this folder and the folders inside it, read-only, when they sign in to Stashr with this email. No email is sent.</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor={theme.textFaint} autoCapitalize="none" keyboardType="email-address" style={{ color: theme.text, borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 10, paddingHorizontal: 12, height: 44, fontFamily: theme.font.body }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Switch value={download} onValueChange={setDownload} /><Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>Let them download the originals</Text></View>
            <GradientButton title="Share" disabled={!email.trim()} onPress={share} />
          </Pressable>
        </Pressable>
      </Modal>
    </Page>
  );
}
