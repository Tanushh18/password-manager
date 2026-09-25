import React, { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import Aurora from "../components/Aurora";
import ItemAvatar from "../components/ItemAvatar";
import TotpCode from "../components/TotpCode";
import { useToast } from "../components/Toast";
import { Chip, FadeIn, Field, GhostButton, GradientButton, IconButton, StrengthMeter } from "../components/ui";
import { useTheme, alpha } from "../lib/theme";
import { useVault } from "../lib/vault";
import { emptyItem } from "../lib/items";
import { estimate, generatePassword, generatePassphrase } from "../lib/strength";
import C from "../lib/crypto";
import { onScan } from "../lib/scanBus";

const QUICK = ["Google", "Instagram", "WhatsApp", "Netflix", "Amazon", "GitHub", "Bank", "Wi-Fi"];

/** Add a new item, or edit one (?id=…). ?password=… pre-fills from the generator. */
export default function Editor() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const { items, addItem, updateItem, deleteItem, prefs } = useVault();
  const toast = useToast();
  const existing = useMemo(() => items.find((i) => i.id === params.id), [items, params.id]);

  const [form, setForm] = useState(() => ({
    ...emptyItem(),
    ...(existing || {}),
    password: existing?.password || (typeof params.password === "string" ? params.password : ""),
  }));
  const [saving, setSaving] = useState(false);
  const strength = useMemo(() => estimate(form.password), [form.password]);
  const folders = useMemo(() => [...new Set(items.map((i) => i.folder).filter(Boolean))], [items]);
  const totpValid = !form.totp || Boolean(C.parseTotp(form.totp));
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(
    () =>
      onScan((data) => {
        const cfg = C.parseTotp(data);
        setForm((f) => ({ ...f, totp: data, name: f.name || cfg?.issuer || "" }));
        toast("2FA secret added", "success");
      }),
    [toast]
  );

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const save = async () => {
    if (!form.name.trim()) return toast("Give it a name.", "error");
    if (!totpValid) return toast("That 2FA secret isn't valid.", "error");
    try {
      setSaving(true);
      if (existing) {
        await updateItem(existing.id, form);
        toast("Updated and re-encrypted 🔐");
      } else {
        await addItem(form);
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
            await deleteItem(existing.id);
            toast("Deleted from your vault.");
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
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={styles.top}>
              <IconButton name="close" onPress={close} />
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 17 }}>{existing ? "Edit item" : "New item"}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <IconButton name={form.favorite ? "starFill" : "star"} color={form.favorite ? theme.warn : undefined} onPress={() => set("favorite")(!form.favorite)} />
                {existing ? <IconButton name="trash" color={theme.danger} onPress={del} /> : null}
              </View>
            </View>

            <FadeIn style={{ alignItems: "center", marginVertical: 16 }}>
              <ItemAvatar name={form.name || "?"} url={form.url} icons={prefs.icons} size={72} />
              <Text numberOfLines={1} style={{ color: theme.heading, fontFamily: theme.font.displayHeavy, fontSize: 22, marginTop: 10 }}>
                {form.name || "Something new"}
              </Text>
              <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, marginTop: 4, fontSize: 13 }}>Encrypted on this phone before it's saved</Text>
            </FadeIn>

            {!existing ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
                {QUICK.map((q) => <Chip key={q} label={q} active={form.name === q} onPress={() => set("name")(q)} />)}
              </ScrollView>
            ) : null}

            <Field label="Name" icon="key" value={form.name} onChangeText={set("name")} placeholder="GitHub, Bank, Wi-Fi…" />
            <Field label="Website" icon="globe" value={form.url} onChangeText={set("url")} placeholder="github.com" autoCapitalize="none" keyboardType="url" />
            <Field label="Username or email" icon="user" value={form.username} onChangeText={set("username")} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
            <Field label="Password" icon="lock" secure value={form.password} onChangeText={set("password")} placeholder="The secret itself" autoCapitalize="none" />
            {form.password ? <StrengthMeter strength={strength} /> : null}
            <View style={styles.row}>
              <Chip label="✦ Strong random" onPress={() => set("password")(generatePassword({ length: 20 }))} />
              <Chip label="✦ Passphrase" onPress={() => set("password")(generatePassphrase({ words: 4 }))} />
            </View>

            <Field
              label="2FA secret (optional)"
              icon="shieldCheck"
              value={form.totp}
              onChangeText={set("totp")}
              placeholder="Setup key or otpauth:// link"
              autoCapitalize="none"
              error={totpValid ? null : "Not a valid 2FA secret"}
              right={Platform.OS !== "web" ? <IconButton name="scan" size={34} iconSize={16} onPress={() => router.push("/scan")} /> : null}
            />
            {form.totp && totpValid ? <View style={{ marginTop: -4, marginBottom: 14 }}><TotpCode secret={form.totp} /></View> : null}

            <Field label="Folder" icon="folder" value={form.folder} onChangeText={set("folder")} placeholder="Work, Personal, Finance…" />
            {folders.length ? (
              <View style={[styles.row, { marginTop: -6 }]}>
                {folders.map((f) => <Chip key={f} label={f} active={form.folder === f} onPress={() => set("folder")(form.folder === f ? "" : f)} />)}
              </View>
            ) : null}

            <Text style={[styles.label, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>NOTES</Text>
            <TextInput
              value={form.notes}
              onChangeText={set("notes")}
              placeholder="PINs, security answers, recovery info…"
              placeholderTextColor={theme.textFaint}
              multiline
              style={[styles.notes, { color: theme.text, borderColor: theme.line, backgroundColor: alpha(theme.accent, 0.06), fontFamily: theme.font.body }]}
            />

            <GradientButton title={existing ? "Save changes" : "Save to vault"} icon="lock" loading={saving} onPress={save} style={{ marginTop: 18 }} />
            <GhostButton title="Cancel" onPress={close} style={{ marginTop: 10 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  label: { fontSize: 11, letterSpacing: 1.6, marginBottom: 8 },
  notes: { minHeight: 96, borderWidth: 1.2, borderRadius: 16, padding: 14, fontSize: 15, textAlignVertical: "top" },
});
