import React, { useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import StatusPill from "../../components/StatusPill";
import { useToast } from "../../components/Toast";
import { Bounce, Card, Chip, FadeIn, GhostButton, GradientText, tap } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { api, activeServer } from "../../lib/api";

const WEBSITE = "https://password-website.onrender.com";
const LOCK_OPTIONS = [
  { v: 0.5, label: "30s" },
  { v: 1, label: "1 min" },
  { v: 5, label: "5 min" },
  { v: 15, label: "15 min" },
  { v: -1, label: "Never" },
];

function Row({ icon, title, subtitle, right, onPress, color }) {
  const { theme } = useTheme();
  const body = (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: alpha(color || theme.accent, 0.16) }]}>
        <Icon name={icon} size={18} color={color || theme.accentSoft} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>{title}</Text>
        {subtitle ? <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right !== undefined ? right : onPress ? <Icon name="arrow" size={16} color={theme.textFaint} /> : null}
    </View>
  );
  return onPress ? <Bounce onPress={onPress} scaleTo={0.98}>{body}</Bounce> : body;
}

function Section({ title, children, delay }) {
  const { theme } = useTheme();
  return (
    <FadeIn delay={delay}>
      <Text style={[styles.section, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>{title}</Text>
      <Card style={{ gap: 16 }}>{children}</Card>
    </FadeIn>
  );
}

export default function Settings() {
  const { theme, preference, setPreference } = useTheme();
  const { profile, items, biometric, biometricAvailable, setBiometric, logout, lock, prefs, setPrefs, setProfileName, refreshProfile } = useVault();
  const toast = useToast();
  const [name, setName] = useState(profile?.name || "");

  const saveName = async () => {
    try {
      await api.updateProfile(name.trim());
      setProfileName(name.trim());
      toast("Name updated");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const signOutOthers = async () => {
    try {
      await api.logoutAll();
      await refreshProfile();
      toast("Signed out of every other device", "info");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const checkUpdates = async () => {
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) return toast("You're on the latest version ✨", "info");
      await Updates.fetchUpdateAsync();
      Alert.alert("Update ready", "Restart Aurelia to use the new version?", [
        { text: "Later", style: "cancel" },
        { text: "Restart", onPress: () => Updates.reloadAsync() },
      ]);
    } catch (e) {
      toast("Updates are available in release builds.", "info");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.8} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 130, gap: 16 }} keyboardShouldPersistTaps="handled">
          <FadeIn>
            <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
              <GradientText>Settings</GradientText>
            </Text>
          </FadeIn>

          <FadeIn delay={60}>
            <Card glow style={{ gap: 14 }}>
              <View style={styles.profile}>
                <LinearGradient colors={theme.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
                  <Text style={{ color: "#fff", fontFamily: theme.font.displayHeavy, fontSize: 26 }}>{(profile?.name || "?").charAt(0).toUpperCase()}</Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 19 }}>{profile?.name || "Your vault"}</Text>
                  <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{profile?.email}</Text>
                  <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi, fontSize: 12, marginTop: 4 }}>
                    {items.length} items · zero-knowledge AES-256-GCM
                  </Text>
                </View>
              </View>
              <View style={[styles.nameRow, { borderColor: theme.line }]}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={theme.textFaint}
                  style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 15 }}
                />
                {name.trim() && name.trim() !== profile?.name ? <Chip label="Save" active onPress={saveName} /> : null}
              </View>
            </Card>
          </FadeIn>

          <Section title="SECURITY" delay={100}>
            <Row
              icon="fingerprint"
              title="Biometric unlock"
              subtitle={biometricAvailable ? "Your vault key is kept in the Android Keystore, released by your fingerprint" : "Set up a fingerprint or face unlock on this phone first"}
              right={
                <Switch
                  value={biometric}
                  disabled={!biometricAvailable}
                  onValueChange={async (v) => {
                    tap();
                    try {
                      await setBiometric(v);
                      toast(v ? "Biometric unlock on" : "Biometric unlock off", "info");
                    } catch (e) {
                      if (!/cancel/i.test(e.message || "")) toast(e.message, "error");
                    }
                  }}
                  trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }}
                  thumbColor="#fff"
                />
              }
            />
            <View>
              <Row icon="timer" title="Auto-lock" subtitle="Lock the vault after the app has been in the background" color={theme.accent3} right={null} />
              <View style={styles.chips}>
                {LOCK_OPTIONS.map((o) => <Chip key={o.v} label={o.label} active={prefs.autoLock === o.v} onPress={() => setPrefs({ autoLock: o.v })} />)}
              </View>
            </View>
            <Row icon="shieldCheck" title="Two-factor login" subtitle={profile?.twoFactorEnabled ? `On · ${profile.recoveryCodesLeft} recovery codes left` : "Off — add a second step to sign in"} color={profile?.twoFactorEnabled ? theme.ok : theme.warn} onPress={() => router.push("/account/twofactor")} />
            <Row icon="key" title="Change master password" subtitle="Re-encrypts every item with a new key" onPress={() => router.push("/account/password")} />
            <Row icon="lock" title="Lock now" onPress={lock} color={theme.accent2} />
            <Row icon="logout" title="Sign out other devices" subtitle={`${Math.max(0, (profile?.sessions || 1) - 1)} other session(s)`} onPress={signOutOthers} color={theme.accent2} />
          </Section>

          <Section title="APPEARANCE" delay={140}>
            <View>
              <Row icon={theme.mode === "dark" ? "moon" : "sun"} title="Theme" subtitle="Aurora dark, soft light, or follow your phone" right={null} />
              <View style={styles.chips}>
                {["system", "dark", "light"].map((p) => <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} active={preference === p} onPress={() => setPreference(p)} />)}
              </View>
            </View>
            <Row
              icon="globe"
              title="Website icons"
              subtitle="Fetched from DuckDuckGo, which can see which sites you've saved"
              right={<Switch value={prefs.icons} onValueChange={(v) => setPrefs({ icons: v })} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }} thumbColor="#fff" />}
            />
          </Section>

          <Section title="YOUR DATA" delay={180}>
            <Row icon="download" title="Export & import" subtitle="Encrypted backups, CSV, and imports from other managers" onPress={() => router.push("/account/data")} />
            <Row icon="note" title="Privacy policy" onPress={() => Linking.openURL(`${WEBSITE}/privacy`)} />
          </Section>

          <Section title="APP" delay={220}>
            <StatusPill />
            <Row icon="globe" title="Server" subtitle={activeServer().replace(/^https?:\/\//, "")} color={theme.ok} right={null} />
            <Row icon="refresh" title="Check for updates" subtitle={`Version ${Constants.expoConfig?.version || "1.0.0"}`} onPress={checkUpdates} />
            <Row icon="phone" title="Open the website" subtitle="Same vault, bigger screen" onPress={() => Linking.openURL(WEBSITE)} />
          </Section>

          <FadeIn delay={260} style={{ gap: 10 }}>
            <GhostButton
              title="Sign out"
              icon="logout"
              color={theme.danger}
              onPress={() =>
                Alert.alert("Sign out?", "You'll need your master password to get back in.", [
                  { text: "Stay", style: "cancel" },
                  { text: "Sign out", style: "destructive", onPress: logout },
                ])
              }
            />
            <GhostButton title="Delete account" icon="trash" color={theme.textFaint} small onPress={() => router.push("/account/delete")} />
            <Text style={{ textAlign: "center", color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12 }}>
              Aurelia {Constants.expoConfig?.version || "1.0.0"} · your keys, your vault
            </Text>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, letterSpacing: -0.8, marginTop: 6 },
  profile: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatar: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 12 },
  section: { fontSize: 11, letterSpacing: 1.8, marginBottom: 8, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginLeft: 50 },
});
