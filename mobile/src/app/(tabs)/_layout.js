import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../../components/Icon";
import { Bounce, tap } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";

const ICONS = { index: "vault", health: "pulse", generator: "wand", settings: "settings" };
const LABELS = { index: "Vault", health: "Health", generator: "Generate", settings: "Settings" };

/** Floating glass tab bar with a sliding glow and a centre "add" button. */
function AuroraTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  // 5 slots: two tabs, the add button, two tabs
  const slot = width / 5;
  const slotFor = (i) => (i < 2 ? i : i + 1);

  useEffect(() => {
    if (!width) return;
    Animated.spring(x, { toValue: slotFor(state.index) * slot, useNativeDriver: true, speed: 16, bounciness: 8 }).start();
  }, [state.index, slot, width, x]);

  const tabs = state.routes.map((route, i) => {
    const focused = state.index === i;
    return (
      <Pressable
        key={route.key}
        style={styles.tab}
        onPress={() => {
          tap();
          const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
        }}
      >
        <Icon name={ICONS[route.name]} size={22} color={focused ? theme.heading : theme.textFaint} strokeWidth={focused ? 2.1 : 1.7} />
        <Text style={{ fontSize: 10, marginTop: 3, color: focused ? theme.heading : theme.textFaint, fontFamily: theme.font.bodySemi }}>
          {LABELS[route.name]}
        </Text>
      </Pressable>
    );
  });

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View
        style={[styles.bar, { backgroundColor: theme.surfaceSolid, borderColor: theme.lineStrong, shadowColor: theme.accent }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width ? (
          <Animated.View style={[styles.indicator, { width: slot, transform: [{ translateX: x }] }]}>
            <View style={[styles.indicatorInner, { backgroundColor: alpha(theme.accent, 0.2), borderColor: alpha(theme.accent, 0.45) }]} />
          </Animated.View>
        ) : null}
        {tabs.slice(0, 2)}
        <View style={styles.tab}>
          <Bounce onPress={() => router.push("/editor")} scaleTo={0.88}>
            <LinearGradient colors={theme.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fab, { shadowColor: theme.accent2 }]}>
              <Icon name="plus" size={26} color="#fff" strokeWidth={2.4} />
            </LinearGradient>
          </Bounce>
        </View>
        {tabs.slice(2)}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { theme } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <AuroraTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="health" />
      <Tabs.Screen name="generator" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  bar: {
    flexDirection: "row",
    height: 68,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", height: "100%" },
  indicator: { position: "absolute", left: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  indicatorInner: { width: "78%", height: 52, borderRadius: 18, borderWidth: 1 },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -26,
    shadowOpacity: 0.7,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
});
