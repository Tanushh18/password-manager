import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import HealthRing from "../../components/HealthRing";
import PasswordCard from "../../components/PasswordCard";
import StatusPill from "../../components/StatusPill";
import { useToast } from "../../components/Toast";
import { Bounce, Card, Chip, FadeIn, GradientButton, GradientText, IconButton } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useInsightMap, useVault } from "../../lib/vault";

const SORTS = [
  { key: "recent", label: "Recent" },
  { key: "az", label: "A → Z" },
  { key: "weakest", label: "Weakest" },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default function Vault() {
  const { theme } = useTheme();
  const { user, passwords, insights, syncing, refresh } = useVault();
  const infoMap = useInsightMap();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return passwords
      .filter((p) => !q || (p.platform || "").toLowerCase().includes(q) || (p.platEmail || "").toLowerCase().includes(q))
      .filter((p) => {
        if (filter === "all") return true;
        const i = infoMap[p._id];
        if (!i) return false;
        if (filter === "weak") return i.score <= 1;
        if (filter === "reused") return i.reused;
        if (filter === "old") return i.old;
        return true;
      })
      .sort((a, b) => {
        if (sort === "az") return (a.platform || "").localeCompare(b.platform || "");
        if (sort === "weakest") return (infoMap[a._id]?.score ?? 5) - (infoMap[b._id]?.score ?? 5);
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      });
  }, [passwords, query, filter, sort, infoMap]);

  const onRefresh = () => refresh().catch((e) => toast(e.message, "error"));
  const firstName = (user?.name || "").split(" ")[0] || "there";
  const nextSort = () => setSort((s) => SORTS[(SORTS.findIndex((x) => x.key === s) + 1) % SORTS.length].key);

  const header = (
    <View>
      <FadeIn style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.bodyMedium, fontSize: 14 }}>{greeting()},</Text>
          <Text style={{ color: theme.heading, fontFamily: theme.font.displayHeavy, fontSize: 30, letterSpacing: -0.8 }}>
            <GradientText>{firstName}</GradientText> ✦
          </Text>
        </View>
        <Bounce onPress={() => router.navigate("/settings")}>
          <LinearGradient colors={theme.brand} style={styles.me}>
            <Text style={{ color: "#fff", fontFamily: theme.font.display, fontSize: 18 }}>{firstName.charAt(0).toUpperCase()}</Text>
          </LinearGradient>
        </Bounce>
      </FadeIn>

      <FadeIn delay={80}>
        <Bounce onPress={() => router.navigate("/health")} scaleTo={0.98}>
          <Card glow style={styles.summary}>
            <HealthRing score={insights?.score ?? 0} loading={!insights} size={104} stroke={10} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi, fontSize: 11, letterSpacing: 1.6 }}>VAULT HEALTH · LIVE</Text>
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 18 }}>
                {passwords.length} password{passwords.length === 1 ? "" : "s"} secured
              </Text>
              <View style={{ flexDirection: "row", gap: 14 }}>
                <Stat n={insights?.weak} label="weak" color={theme.danger} />
                <Stat n={insights?.reused} label="reused" color={theme.warn} />
                <Stat n={insights?.strong} label="strong" color={theme.ok} />
              </View>
            </View>
            <Icon name="arrow" size={18} color={theme.textFaint} />
          </Card>
        </Bounce>
      </FadeIn>

      <FadeIn delay={140} style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Icon name="search" size={18} color={theme.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search platforms or emails"
          placeholderTextColor={theme.textFaint}
          style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 15, height: "100%" }}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={theme.accent}
        />
        {query ? <IconButton name="close" size={30} iconSize={14} onPress={() => setQuery("")} /> : null}
      </FadeIn>

      <FadeIn delay={180}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" active={filter === "all"} onPress={() => setFilter("all")} count={passwords.length} />
          <Chip label="Weak" active={filter === "weak"} onPress={() => setFilter("weak")} count={insights?.weak ?? 0} color={theme.danger} />
          <Chip label="Reused" active={filter === "reused"} onPress={() => setFilter("reused")} count={insights?.reused ?? 0} color={theme.warn} />
          <Chip label="Old" active={filter === "old"} onPress={() => setFilter("old")} count={insights?.old ?? 0} color={theme.accent3} />
          <Chip label={`Sort: ${SORTS.find((s) => s.key === sort).label}`} onPress={nextSort} />
        </ScrollView>
      </FadeIn>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.8} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <FlatList
          data={list}
          keyExtractor={(item) => item._id}
          renderItem={({ item, index }) => (
            <PasswordCard entry={item} info={infoMap[item._id]} index={index} onEdit={(e) => router.push({ pathname: "/editor", params: { id: e._id } })} />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <FadeIn delay={200}>
              <Card style={{ alignItems: "center", paddingVertical: 34, gap: 10 }}>
                <View style={[styles.emptyIcon, { backgroundColor: alpha(theme.accent, 0.15) }]}>
                  <Icon name={passwords.length ? "search" : "key"} size={28} color={theme.accentSoft} />
                </View>
                <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 19, textAlign: "center" }}>
                  {passwords.length ? "Nothing matches" : "Your vault is empty"}
                </Text>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, textAlign: "center", marginBottom: 8 }}>
                  {passwords.length
                    ? "Try another search or clear the filter."
                    : "Add your first password — it's encrypted the moment you save it."}
                </Text>
                {passwords.length ? (
                  <Chip label="Show everything" active onPress={() => { setQuery(""); setFilter("all"); }} />
                ) : (
                  <GradientButton title="Add a password" icon="plus" small onPress={() => router.push("/editor")} />
                )}
              </Card>
            </FadeIn>
          }
          ListFooterComponent={
            <View style={{ alignItems: "center", marginTop: 8 }}>
              <StatusPill style={{ alignSelf: "center" }} />
            </View>
          }
          contentContainerStyle={{ padding: 18, paddingBottom: 130 }}
          refreshControl={<RefreshControl refreshing={syncing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent, theme.accent2]} progressBackgroundColor={theme.surfaceSolid} />}
          keyboardShouldPersistTaps="handled"
        />
      </SafeAreaView>
    </View>
  );
}

function Stat({ n, label, color }) {
  const { theme } = useTheme();
  return (
    <View>
      <Text style={{ color, fontFamily: theme.font.displayHeavy, fontSize: 18 }}>{n ?? "–"}</Text>
      <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", marginBottom: 18, marginTop: 6 },
  me: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, marginBottom: 16 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 52, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, marginBottom: 12 },
  chips: { gap: 8, paddingBottom: 16 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
});
