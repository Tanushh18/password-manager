import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../components/Aurora";
import Icon from "../components/Icon";
import { Bounce, GhostButton } from "../components/ui";
import { useTheme } from "../lib/theme";
import { useVault } from "../lib/vault";

export default function Lock() {
  const { theme } = useTheme();
  const { unlock, logout, user } = useVault();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true })).start();
    const t = setTimeout(() => unlock().catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [pulse, unlock]);

  const ring = (delay) => ({
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5 - delay, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1 + delay] }) }],
  });

  return (
    <View style={{ flex: 1 }}>
      <Aurora />
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={styles.center}>
            <Animated.View style={[styles.ring, { borderColor: theme.accent }, ring(0)]} />
            <Animated.View style={[styles.ring, { borderColor: theme.accent2 }, ring(0.2)]} />
            <Bounce onPress={() => unlock().catch(() => {})} scaleTo={0.9}>
              <LinearGradient colors={theme.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, { shadowColor: theme.accent }]}>
                <Icon name="fingerprint" size={52} color="#fff" strokeWidth={1.6} />
              </LinearGradient>
            </Bounce>
          </View>
          <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>Vault locked</Text>
          <Text style={[styles.sub, { color: theme.textMuted, fontFamily: theme.font.body }]}>
            {user?.name ? `Hi ${user.name.split(" ")[0]} — tap` : "Tap"} the fingerprint to unlock.
          </Text>
        </View>
        <GhostButton title="Sign out instead" icon="logout" onPress={logout} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, padding: 22 },
  center: { width: 200, height: 200, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 2 },
  button: { width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center", shadowOpacity: 0.7, shadowRadius: 30, elevation: 16 },
  title: { fontSize: 30, marginTop: 24, letterSpacing: -0.8 },
  sub: { fontSize: 15, marginTop: 8, textAlign: "center" },
});
