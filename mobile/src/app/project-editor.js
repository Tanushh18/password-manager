import React, { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import Aurora from "../components/Aurora";
import Icon from "../components/Icon";
import { useToast } from "../components/Toast";
import { Chip, FadeIn, Field, GhostButton, GradientButton, IconButton } from "../components/ui";
import { useTheme, alpha } from "../lib/theme";
import { useVault } from "../lib/vault";
import { emptyProject, emptyDatabase, emptyEnvVar, parseEnvBlock, STATUSES, PRIORITIES, STATUS_LABEL } from "../lib/projectItems";

const Section = ({ title, children }) => {
  const { theme } = useTheme();
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={[styles.sectionTitle, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>{title}</Text>
      {children}
    </View>
  );
};

const RepeatRow = ({ children, onRemove }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.repeatRow, { borderColor: theme.line, backgroundColor: alpha(theme.accent, 0.04) }]}>
      <View style={{ flex: 1 }}>{children}</View>
      <IconButton name="trash" size={34} iconSize={15} color={theme.danger} onPress={onRemove} />
    </View>
  );
};

const MiniInput = ({ value, onChangeText, placeholder, style }) => {
  const { theme } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textFaint}
      autoCapitalize="none"
      autoCorrect={false}
      style={[
        { color: theme.text, fontFamily: theme.font.body, fontSize: 14, borderWidth: 1, borderColor: theme.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
        style,
      ]}
    />
  );
};

/** Add a new project, or edit one (?id=…). */
export default function ProjectEditor() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const { projects, addProject, updateProject, deleteProject } = useVault();
  const toast = useToast();
  const existing = useMemo(() => projects.find((p) => p.id === params.id), [projects, params.id]);

  const [form, setForm] = useState(() => ({ ...emptyProject(), ...(existing || {}) }));
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (key, i, patch) => setForm((f) => ({ ...f, [key]: f[key].map((row, idx) => (idx === i ? { ...row, ...patch } : row)) }));
  const addRow = (key, empty) => setForm((f) => ({ ...f, [key]: [...f[key], empty()] }));
  const removeRow = (key, i) => setForm((f) => ({ ...f, [key]: f[key].filter((_, idx) => idx !== i) }));

  const close = () => (router.canGoBack() ? router.back() : router.replace("/projects"));

  const applyPaste = () => {
    const parsed = parseEnvBlock(pasteText);
    if (!parsed.length) return toast("Couldn't find any KEY=VALUE lines in that.", "error");
    setForm((f) => ({ ...f, envVars: [...f.envVars, ...parsed.map((p) => ({ ...emptyEnvVar(), ...p }))] }));
    setPasteText("");
    setPasteOpen(false);
    toast(`${parsed.length} variable${parsed.length === 1 ? "" : "s"} added — encrypted once you save.`);
  };

  const save = async () => {
    if (!form.name.trim()) return toast("Give it a name.", "error");
    try {
      setSaving(true);
      if (existing) {
        await updateProject(existing.id, form);
        toast("Updated and re-encrypted 🔐");
      } else {
        await addProject(form);
        toast("Encrypted and saved ✨");
      }
      close();
    } catch (e) {
      toast(e.message || "Couldn't save that.", "error");
    } finally {
      setSaving(false);
    }
  };

  const del = () =>
    Alert.alert(`Delete ${existing.name}?`, "It's removed from every device.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteProject(existing.id);
            toast("Deleted.");
            close();
          } catch (e) {
            toast(e.message, "error");
          }
        },
      },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.7} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <View style={styles.top}>
              <IconButton name="close" onPress={close} />
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 17 }}>{existing ? "Edit project" : "New project"}</Text>
              {existing ? <IconButton name="trash" color={theme.danger} onPress={del} /> : <View style={{ width: 40 }} />}
            </View>

            <FadeIn style={{ alignItems: "center", marginVertical: 16 }}>
              <View style={[styles.avatar, { backgroundColor: alpha(theme.accent, 0.18) }]}>
                <Icon name="globe" size={30} color={theme.accentSoft} />
              </View>
              <Text numberOfLines={1} style={{ color: theme.heading, fontFamily: theme.font.displayHeavy, fontSize: 21, marginTop: 10 }}>
                {form.name || "Something new"}
              </Text>
              <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, marginTop: 4, fontSize: 13 }}>Encrypted on this phone before it's saved</Text>
            </FadeIn>

            <Section title="BASICS">
              <Field label="Name" icon="key" value={form.name} onChangeText={set("name")} placeholder="WeCode, VexForge…" />
              <View style={styles.row}>
                {STATUSES.map((s) => (
                  <Chip key={s} label={STATUS_LABEL[s]} active={form.status === s} onPress={() => set("status")(s)} />
                ))}
              </View>
              <View style={[styles.row, { marginTop: 4 }]}>
                {PRIORITIES.map((p) => (
                  <Chip key={p} label={p} active={form.priority === p} onPress={() => set("priority")(p)} />
                ))}
              </View>
              <Field label="Category" value={form.category} onChangeText={set("category")} placeholder="web app, bot, API…" />
              <Field label="Tech stack" value={form.techStack} onChangeText={set("techStack")} placeholder="React, Node, MongoDB…" />
              <Field label="Tags" value={form.tags} onChangeText={set("tags")} placeholder="comma, separated" />
              <Text style={[styles.label, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>DESCRIPTION</Text>
              <TextInput
                value={form.description}
                onChangeText={set("description")}
                placeholder="What does it do?"
                placeholderTextColor={theme.textFaint}
                multiline
                style={[styles.notes, { color: theme.text, borderColor: theme.line, backgroundColor: alpha(theme.accent, 0.06), fontFamily: theme.font.body }]}
              />
            </Section>

            <Section title="REPO & LIVE URL">
              <Field label="Repo URL" icon="globe" value={form.repoUrl} onChangeText={set("repoUrl")} autoCapitalize="none" keyboardType="url" />
              <Field label="Repo account" value={form.repoAccount} onChangeText={set("repoAccount")} autoCapitalize="none" />
              <Field label="Live URL" icon="globe" value={form.liveUrl} onChangeText={set("liveUrl")} autoCapitalize="none" keyboardType="url" />
              <Field label="Custom domain" value={form.customDomain} onChangeText={set("customDomain")} autoCapitalize="none" />
            </Section>

            <Section title="HOSTING">
              <Field label="Provider" value={form.hostingProvider} onChangeText={set("hostingProvider")} placeholder="Render, Vercel…" />
              <Field label="Account email" value={form.hostingAccountEmail} onChangeText={set("hostingAccountEmail")} autoCapitalize="none" keyboardType="email-address" />
              <Field label="Account label" value={form.hostingAccountLabel} onChangeText={set("hostingAccountLabel")} placeholder="personal, work…" />
              <Field label="Service name" value={form.hostingServiceName} onChangeText={set("hostingServiceName")} />
              <Field label="Plan" value={form.hostingPlan} onChangeText={set("hostingPlan")} />
              <Field label="Region" value={form.hostingRegion} onChangeText={set("hostingRegion")} />
              <Field label="Auto-deploy branch" value={form.autoDeployBranch} onChangeText={set("autoDeployBranch")} placeholder="main" autoCapitalize="none" />
            </Section>

            <Section title="DATABASES">
              {form.databases.map((row, i) => (
                <RepeatRow key={i} onRemove={() => removeRow("databases", i)}>
                  <MiniInput value={row.label} onChangeText={(v) => setRow("databases", i, { label: v })} placeholder="Label" />
                  <MiniInput value={row.provider} onChangeText={(v) => setRow("databases", i, { provider: v })} placeholder="Provider" />
                  <MiniInput value={row.type} onChangeText={(v) => setRow("databases", i, { type: v })} placeholder="Type" />
                  <MiniInput value={row.accountEmail} onChangeText={(v) => setRow("databases", i, { accountEmail: v })} placeholder="Account email" />
                  <MiniInput value={row.notes} onChangeText={(v) => setRow("databases", i, { notes: v })} placeholder="Notes" style={{ marginBottom: 0 }} />
                </RepeatRow>
              ))}
              <GhostButton title="Add database" icon="plus" small onPress={() => addRow("databases", emptyDatabase)} />
            </Section>

            <Section title="FIREBASE / GOOGLE CLOUD">
              <Field label="Firebase project ID" value={form.firebaseProjectId} onChangeText={set("firebaseProjectId")} autoCapitalize="none" />
              <Field label="Firebase account email" value={form.firebaseAccountEmail} onChangeText={set("firebaseAccountEmail")} autoCapitalize="none" keyboardType="email-address" />
              <Field label="Google Cloud project ID" value={form.googleCloudProjectId} onChangeText={set("googleCloudProjectId")} autoCapitalize="none" />
              <Field label="Google Cloud account email" value={form.googleCloudAccountEmail} onChangeText={set("googleCloudAccountEmail")} autoCapitalize="none" keyboardType="email-address" />
            </Section>

            <Section title="PLAY STORE">
              <Field label="Package name" value={form.playStorePackageName} onChangeText={set("playStorePackageName")} autoCapitalize="none" />
              <Field label="Play Console account email" value={form.playStoreAccountEmail} onChangeText={set("playStoreAccountEmail")} autoCapitalize="none" keyboardType="email-address" />
              <Field label="Play Store URL" value={form.playStoreUrl} onChangeText={set("playStoreUrl")} autoCapitalize="none" keyboardType="url" />
              <Field label="Status" value={form.playStoreStatus} onChangeText={set("playStoreStatus")} placeholder="internal testing, live…" />
            </Section>

            <Section title="DNS & MONITORING">
              <Field label="DNS provider" value={form.dnsProvider} onChangeText={set("dnsProvider")} />
              <Field label="DNS account email" value={form.dnsAccountEmail} onChangeText={set("dnsAccountEmail")} autoCapitalize="none" keyboardType="email-address" />
              <Field label="Monitoring provider" value={form.monitoringProvider} onChangeText={set("monitoringProvider")} />
              <Field label="Monitoring account email" value={form.monitoringAccountEmail} onChangeText={set("monitoringAccountEmail")} autoCapitalize="none" keyboardType="email-address" />
            </Section>

            <Section title="ENVIRONMENT VARIABLES & SECRETS">
              <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12, marginTop: -6, marginBottom: 10, lineHeight: 17 }}>
                Real values welcome — a Mongo URI, a Cloudinary key, whatever. Encrypted the same way as a password.
              </Text>

              {!pasteOpen ? (
                <GhostButton title="Paste from Render" icon="plus" small onPress={() => setPasteOpen(true)} style={{ marginBottom: 12 }} />
              ) : (
                <View style={[styles.pasteBox, { borderColor: theme.lineStrong, backgroundColor: alpha(theme.accent, 0.05) }]}>
                  <TextInput
                    value={pasteText}
                    onChangeText={setPasteText}
                    placeholder={"MONGO_URI=mongodb+srv://...\nPaste the whole block, one KEY=VALUE per line."}
                    placeholderTextColor={theme.textFaint}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ color: theme.text, fontFamily: theme.font.mono, fontSize: 12, minHeight: 100, textAlignVertical: "top" }}
                  />
                  <Text style={{ color: theme.textFaint, fontSize: 11, fontFamily: theme.font.body, marginTop: 8, marginBottom: 10 }}>
                    Parsed on this phone only — nothing is sent anywhere until you save.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <GradientButton title="Parse & add" small onPress={applyPaste} disabled={!pasteText.trim()} />
                    <GhostButton title="Cancel" small onPress={() => { setPasteOpen(false); setPasteText(""); }} />
                  </View>
                </View>
              )}

              {form.envVars.map((row, i) => (
                <RepeatRow key={i} onRemove={() => removeRow("envVars", i)}>
                  <MiniInput value={row.name} onChangeText={(v) => setRow("envVars", i, { name: v })} placeholder="Variable name" />
                  <MiniInput value={row.value} onChangeText={(v) => setRow("envVars", i, { value: v })} placeholder="Value" />
                  <MiniInput value={row.purpose} onChangeText={(v) => setRow("envVars", i, { purpose: v })} placeholder="Purpose / service" style={{ marginBottom: 0 }} />
                </RepeatRow>
              ))}
              <GhostButton title="Add variable" icon="plus" small onPress={() => addRow("envVars", emptyEnvVar)} />
            </Section>

            <Section title="NOTES">
              <TextInput
                value={form.notes}
                onChangeText={set("notes")}
                placeholder="Anything else worth remembering…"
                placeholderTextColor={theme.textFaint}
                multiline
                style={[styles.notes, { color: theme.text, borderColor: theme.line, backgroundColor: alpha(theme.accent, 0.06), fontFamily: theme.font.body }]}
              />
            </Section>

            <GradientButton title={existing ? "Save changes" : "Save project"} icon="lock" loading={saving} onPress={save} style={{ marginTop: 22 }} />
            <GhostButton title="Cancel" onPress={close} style={{ marginTop: 10 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { fontSize: 12, letterSpacing: 0.4, marginBottom: 8, marginTop: 4 },
  notes: { minHeight: 80, borderWidth: 1.2, borderRadius: 16, padding: 14, fontSize: 15, textAlignVertical: "top", marginBottom: 4 },
  sectionTitle: { fontSize: 12, letterSpacing: 0.4, marginBottom: 12 },
  avatar: { width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  repeatRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 10 },
  pasteBox: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
});
