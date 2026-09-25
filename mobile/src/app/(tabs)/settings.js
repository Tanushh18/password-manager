import React from "react";
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import StatusPill from "../../components/StatusPill";
import { useToast } from "../../components/Toast";
import { Bounce, Card, Chip, FadeIn, GhostButton, GradientText, tap } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { activeServer } from "../../lib/api";

const WEBSITE = "https://password-website.onrender.com";

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
      {right}
    </View>
  );
  return onPress ? <Bounce onPress={onPress} scaleTo={0.98}>{body}</Bounce> : body;
}

export default function Settings() {
  const { theme, preference, setPreference } = useTheme();
  const { user, passwords, biometric, biometricAvailable, setBiometric, logout } = useVault();
  const toast = useToast();

  const confirmLogout = () =>
    Alert.alert("Sign out?", "You'll need your master password to get back in.", [
      { text: "Stay", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.8} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 130, gap: 16 }}>
          <FadeIn>
            <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
              <GradientText>Settings</GradientText>
            </Text>
          </FadeIn>

          <FadeIn delay={60}>
            <Card glow style={styles.profile}>
              <LinearGradient colors={theme.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
                <Text style={{ color: "#fff", fontFamily: theme.font.displayHeavy, fontSize: 26 }}>
                  {(user?.name || "?").charAt(0).toUpperCase()}
                </Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 19 }}>{user?.name || "Your vault"}</Text>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{user?.email}</Text>
                <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi, fontSize: 12, marginTop: 4 }}>
                  {passwords.length} passwords · AES-256
                </Text>
              </View>
            </Card>
          </FadeIn>

          <FadeIn delay={120}>
            <Text style={[styles.section, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>APPEARANCE</Text>
            <Card>
              <Row icon={theme.mode === "dark" ? "moon" : "sun"} title="Theme" subtitle="Aurora dark, soft light, or follow your phone" />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                {["system", "dark", "light"].map((p) => (
                  <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} active={preference === p} onPress={() => setPreference(p)} />
                ))}
              </View>
            </Card>
          </FadeIn>

          <FadeIn delay={180}>
            <Text style={[styles.section, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>SECURITY</Text>
            <Card style={{ gap: 14 }}>
              <Row
                icon="fingerprint"
                title="Biometric unlock"
                subtitle={biometricAvailable ? "Lock the vault when you leave the app for 30s" : "Set up a fingerprint or face unlock on this phone first"}
                right={
                  <Switch
                    value={biometric}
                    disabled={!biometricAvailable}
                    onValueChange={async (v) => {
                      tap();
                      const ok = await setBiometric(v).catch(() => false);
                      if (ok) toast(v ? "Biometric unlock on" : "Biometric unlock off", "info");
                    }}
                    trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }}
                    thumbColor="#fff"
                  />
                }
              />
              <Row icon="eyeOff" title="Auto-hide" subtitle="Revealed passwords hide again after 20 seconds" color={theme.accent3} />
              <Row icon="copy" title="Clipboard clearing" subtitle="Copied passwords are wiped from the clipboard after 30s" color={theme.accent2} />
            </Card>
          </FadeIn>

          <FadeIn delay={240}>
            <Text style={[styles.section, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>SERVER</Text>
            <Card style={{ gap: 12 }}>
              <StatusPill />
              <Row icon="globe" title="Connected to" subtitle={activeServer().replace(/^https?:\/\//, "")} color={theme.ok} />
              <Row
                icon="phone"
                title="Open the website"
                subtitle="Same vault, bigger screen"
                onPress={() => Linking.openURL(WEBSITE)}
                right={<Icon name="arrow" size={16} color={theme.textFaint} />}
              />
            </Card>
          </FadeIn>

          <FadeIn delay={300} style={{ gap: 12 }}>
            <GhostButton title="Sign out" icon="logout" color={theme.danger} onPress={confirmLogout} />
            <Text style={{ textAlign: "center", color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12 }}>
              Aurelia {Constants.expoConfig?.version || "1.0.0"} · made with ✦
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
  section: { fontSize: 11, letterSpacing: 1.8, marginBottom: 8, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
