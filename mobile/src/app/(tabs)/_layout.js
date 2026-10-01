import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../../components/Icon";
import { Bounce, tap } from "../../components/ui";
import { useTheme } from "../../lib/theme";

const ICONS = { index: "vault", health: "pulse", generator: "wand", settings: "settings" };
const LABELS = { index: "Vault", health: "Health", generator: "Generate", settings: "Settings" };

/** Docked bottom tab bar with a centre "add" button. */
function VaultTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
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
        <Icon name={ICONS[route.name]} size={22} color={focused ? theme.accent : theme.textMuted} strokeWidth={focused ? 2.1 : 1.7} />
        <Text style={{ fontSize: 10, marginTop: 3, color: focused ? theme.accent : theme.textMuted, fontFamily: theme.font.bodySemi }}>
          {LABELS[route.name]}
        </Text>
      </Pressable>
    );
  });

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom, backgroundColor: theme.surfaceSolid }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: theme.surfaceSolid, borderColor: theme.line }]}>
        {tabs.slice(0, 2)}
        <View style={styles.tab}>
          <Bounce onPress={() => router.push("/editor")} style={[styles.fab, { backgroundColor: theme.accent }]}>
            <Icon name="plus" size={24} color="#fff" strokeWidth={2.4} />
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
      tabBar={(props) => <VaultTabBar {...props} />}
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
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: { flexDirection: "row", height: 64, borderTopWidth: 1, alignItems: "center" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", height: "100%" },
  fab: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
