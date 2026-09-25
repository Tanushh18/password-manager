import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import StatusPill from "../../components/StatusPill";
import { FadeIn, GhostButton, GradientButton, GradientText } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";

const FEATURES = [
  { icon: "lock", title: "AES-256 sealed", body: "Encrypted before it touches the database." },
  { icon: "pulse", title: "Live health score", body: "Spot weak and reused passwords instantly." },
  { icon: "fingerprint", title: "Biometric unlock", body: "Open your vault with a touch." },
];

/** Floating shield logo with an orbiting ring. */
function HeroMark() {
  const { theme } = useTheme();
  const float = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: true })).start();
  }, [float, spin]);
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.markWrap}>
      <Animated.View style={[styles.orbit, { borderColor: alpha(theme.accent, 0.35), transform: [{ rotate }] }]}>
        <View style={[styles.orbitDot, { backgroundColor: theme.accent3, shadowColor: theme.accent3 }]} />
        <View style={[styles.orbitDot, styles.orbitDot2, { backgroundColor: theme.accent2, shadowColor: theme.accent2 }]} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <LinearGradient colors={theme.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.mark, { shadowColor: theme.accent }]}>
          <Icon name="shieldCheck" size={54} color="#fff" strokeWidth={1.6} />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

export default function Welcome() {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Aurora />
      <SafeAreaView style={styles.safe}>
        <FadeIn style={{ alignItems: "center" }}>
          <HeroMark />
        </FadeIn>

        <FadeIn delay={120}>
          <Text style={[styles.eyebrow, { color: theme.accentSoft, fontFamily: theme.font.bodySemi }]}>AURELIA · AURORA VAULT</Text>
          <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
            Every password,{"\n"}
            <GradientText>glowing and safe.</GradientText>
          </Text>
          <Text style={[styles.body, { color: theme.textMuted, fontFamily: theme.font.body }]}>
            Your vault from the website, now in your pocket. Same account, same server, same encryption.
          </Text>
        </FadeIn>

        <View style={{ gap: 10, marginTop: 22 }}>
          {FEATURES.map((f, i) => (
            <FadeIn key={f.title} delay={220 + i * 90}>
              <View style={[styles.feature, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                <LinearGradient colors={theme.cool} style={styles.featureIcon}>
                  <Icon name={f.icon} size={18} color="#fff" />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>{f.title}</Text>
                  <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{f.body}</Text>
                </View>
              </View>
            </FadeIn>
          ))}
        </View>

        <View style={{ flex: 1 }} />

        <FadeIn delay={520} style={{ gap: 12 }}>
          <GradientButton title="Create your vault" icon="sparkle" onPress={() => router.push("/auth/signup")} />
          <GhostButton title="I already have an account" onPress={() => router.push("/auth/login")} />
          <View style={{ alignItems: "center", marginTop: 6 }}>
            <StatusPill compact style={{ alignSelf: "center" }} />
          </View>
        </FadeIn>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 22, paddingBottom: 16 },
  markWrap: { width: 170, height: 170, alignItems: "center", justifyContent: "center", marginTop: 12, marginBottom: 8 },
  orbit: { position: "absolute", width: 170, height: 170, borderRadius: 85, borderWidth: 1, borderStyle: "dashed" },
  orbitDot: { position: "absolute", top: -5, left: 80, width: 10, height: 10, borderRadius: 5, shadowOpacity: 1, shadowRadius: 8, elevation: 6 },
  orbitDot2: { top: 160, left: 80 },
  mark: { width: 108, height: 108, borderRadius: 34, alignItems: "center", justifyContent: "center", shadowOpacity: 0.7, shadowRadius: 30, shadowOffset: { width: 0, height: 14 }, elevation: 16 },
  eyebrow: { fontSize: 11, letterSpacing: 2.4, marginTop: 8 },
  title: { fontSize: 36, lineHeight: 42, letterSpacing: -1, marginTop: 10 },
  body: { fontSize: 15, lineHeight: 23, marginTop: 12 },
  feature: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, borderWidth: 1 },
  featureIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
