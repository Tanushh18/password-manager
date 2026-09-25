import React, { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import Aurora from "../components/Aurora";
import { Avatar } from "../components/PasswordCard";
import { useToast } from "../components/Toast";
import { Chip, FadeIn, Field, GhostButton, GradientButton, IconButton, StrengthMeter } from "../components/ui";
import { useTheme } from "../lib/theme";
import { useVault } from "../lib/vault";
import { estimate, generatePassword, generatePassphrase } from "../lib/strength";

const QUICK = ["Google", "Instagram", "WhatsApp", "Netflix", "Amazon", "GitHub", "Bank", "Wi-Fi"];

/** Add a new password, or edit an existing one (?id=…). */
export default function Editor() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const { passwords, add, update, remove, reveal } = useVault();
  const toast = useToast();
  const existing = useMemo(() => passwords.find((p) => p._id === params.id), [passwords, params.id]);

  const [platform, setPlatform] = useState(existing?.platform || "");
  const [email, setEmail] = useState(existing?.platEmail && existing.platEmail !== "NA" ? existing.platEmail : "");
  const [password, setPassword] = useState(typeof params.password === "string" ? params.password : "");
  const [saving, setSaving] = useState(false);
  const [loadingOld, setLoadingOld] = useState(false);
  const strength = useMemo(() => estimate(password), [password]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const loadCurrent = async () => {
    try {
      setLoadingOld(true);
      setPassword(await reveal(existing));
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setLoadingOld(false);
    }
  };

  const save = async () => {
    if (!platform.trim()) return toast("Give it a platform name.", "error");
    if (!existing && !password) return toast("Add the password itself.", "error");
    try {
      setSaving(true);
      if (existing) {
        await update({ id: existing._id, platform: platform.trim(), platEmail: email.trim(), userPass: password || undefined });
        toast("Updated and re-sealed 🔐");
      } else {
        await add({ platform: platform.trim(), platEmail: email.trim(), userPass: password });
        toast("Sealed with AES-256 ✨");
      }
      close();
    } catch (e) {
      toast(e.message || "Couldn't save that.", "error");
    } finally {
      setSaving(false);
    }
  };

  const del = () =>
    Alert.alert(`Delete ${existing.platform}?`, "This removes it from every device.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await remove(existing._id);
            toast("Removed from your vault.");
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
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 17 }}>
                {existing ? "Edit password" : "New password"}
              </Text>
              {existing ? <IconButton name="trash" color={theme.danger} onPress={del} /> : <View style={{ width: 40 }} />}
            </View>

            <FadeIn style={{ alignItems: "center", marginVertical: 18 }}>
              <Avatar name={platform || "?"} size={76} />
              <Text numberOfLines={1} style={{ color: theme.heading, fontFamily: theme.font.displayHeavy, fontSize: 24, marginTop: 12 }}>
                {platform || "Something new"}
              </Text>
              <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, marginTop: 4 }}>Sealed with AES-256 the moment you save it</Text>
            </FadeIn>

            {!existing ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
                {QUICK.map((q) => (
                  <Chip key={q} label={q} active={platform === q} onPress={() => setPlatform(q)} />
                ))}
              </ScrollView>
            ) : null}

            <Field label="Platform" icon="globe" value={platform} onChangeText={setPlatform} placeholder="Instagram, work email, Wi-Fi…" />
            <Field
              label="Email or username"
              icon="user"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Field
              label={existing ? "New password (leave empty to keep)" : "Password"}
              icon="key"
              secure
              value={password}
              onChangeText={setPassword}
              placeholder="The secret itself"
              autoCapitalize="none"
            />
            {password ? <StrengthMeter strength={strength} /> : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              <Chip label="✦ Strong random" onPress={() => setPassword(generatePassword({ length: 20 }))} />
              <Chip label="✦ Passphrase" onPress={() => setPassword(generatePassphrase({ words: 4 }))} />
              {existing ? <Chip label={loadingOld ? "Loading…" : "Show current"} onPress={loadCurrent} /> : null}
            </View>

            <GradientButton title={existing ? "Save changes" : "Seal it in the vault"} icon="lock" loading={saving} onPress={save} />
            <GhostButton title="Cancel" onPress={close} style={{ marginTop: 10 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
