import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import HealthRing from "../../components/HealthRing";
import ItemCard from "../../components/ItemCard";
import StatusPill from "../../components/StatusPill";
import { useToast } from "../../components/Toast";
import { Bounce, Card, Chip, FadeIn, GradientButton, GradientText, IconButton } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { domainOf } from "../../lib/items";

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
  const { profile, items, broken, health, offline, syncing, refresh, lock, toggleFavorite, prefs } = useVault();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [folder, setFolder] = useState("__all");
  const [sort, setSort] = useState("recent");

  const folders = useMemo(() => [...new Set(items.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => folder === "__all" || (folder === "__fav" ? i.favorite : i.folder === folder))
      .filter((i) => !q || [i.name, i.username, i.url, i.folder, i.notes].some((v) => (v || "").toLowerCase().includes(q)) || domainOf(i.url).includes(q))
      .filter((i) => {
        if (filter === "all") return true;
        const h = health.info[i.id];
        if (!h) return false;
        if (filter === "weak") return h.score <= 1;
        if (filter === "reused") return h.reused;
        if (filter === "old") return h.old;
        if (filter === "breached") return h.breached > 0;
        return true;
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite && sort !== "az") return a.favorite ? -1 : 1;
        if (sort === "az") return (a.name || "").localeCompare(b.name || "");
        if (sort === "weakest") return (health.info[a.id]?.score ?? 5) - (health.info[b.id]?.score ?? 5);
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      });
  }, [items, query, filter, folder, sort, health]);

  const firstName = (profile?.name || "").split(" ")[0] || "there";
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
        <IconButton name="lock" onPress={lock} />
        <View style={{ width: 10 }} />
        <Bounce onPress={() => router.navigate("/settings")}>
          <LinearGradient colors={theme.brand} style={styles.me}>
            <Text style={{ color: "#fff", fontFamily: theme.font.display, fontSize: 18 }}>{firstName.charAt(0).toUpperCase()}</Text>
          </LinearGradient>
        </Bounce>
      </FadeIn>

      {offline ? (
        <View style={[styles.banner, { backgroundColor: alpha(theme.warn, 0.12), borderColor: alpha(theme.warn, 0.4) }]}>
          <Icon name="globe" size={16} color={theme.warn} />
          <Text style={{ flex: 1, color: theme.warn, fontFamily: theme.font.bodyMedium, fontSize: 13 }}>
            Offline — showing your last synced vault. Editing is paused.
          </Text>
        </View>
      ) : null}
      {broken ? (
        <View style={[styles.banner, { backgroundColor: alpha(theme.danger, 0.1), borderColor: alpha(theme.danger, 0.4) }]}>
          <Icon name="alert" size={16} color={theme.danger} />
          <Text style={{ flex: 1, color: theme.danger, fontFamily: theme.font.bodyMedium, fontSize: 13 }}>
            {broken} item{broken === 1 ? "" : "s"} couldn't be decrypted and {broken === 1 ? "is" : "are"} hidden.
          </Text>
        </View>
      ) : null}

      <FadeIn delay={80}>
        <Bounce onPress={() => router.navigate("/health")} scaleTo={0.98}>
          <Card glow style={styles.summary}>
            <HealthRing score={health.score} size={104} stroke={10} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi, fontSize: 11, letterSpacing: 1.6 }}>VAULT HEALTH · LIVE</Text>
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 18 }}>
                {items.length} item{items.length === 1 ? "" : "s"} · end-to-end encrypted
              </Text>
              <View style={{ flexDirection: "row", gap: 14 }}>
                <Stat n={health.weak} label="weak" color={theme.danger} />
                <Stat n={health.reused} label="reused" color={theme.warn} />
                <Stat n={health.strong} label="strong" color={theme.ok} />
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
          placeholder="Search names, usernames, websites"
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
          <Chip label="All" active={folder === "__all"} onPress={() => setFolder("__all")} count={items.length} />
          <Chip label="★ Favourites" active={folder === "__fav"} onPress={() => setFolder("__fav")} count={items.filter((i) => i.favorite).length} color={theme.warn} />
          {folders.map((f) => (
            <Chip key={f} label={f} active={folder === f} onPress={() => setFolder(f)} count={items.filter((i) => i.folder === f).length} color={theme.accent3} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Any health" active={filter === "all"} onPress={() => setFilter("all")} />
          <Chip label="Weak" active={filter === "weak"} onPress={() => setFilter("weak")} count={health.weak} color={theme.danger} />
          <Chip label="Reused" active={filter === "reused"} onPress={() => setFilter("reused")} count={health.reused} color={theme.warn} />
          <Chip label="Breached" active={filter === "breached"} onPress={() => setFilter("breached")} count={health.breached} color={theme.danger} />
          <Chip label="Old" active={filter === "old"} onPress={() => setFilter("old")} count={health.old} color={theme.accent3} />
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
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <ItemCard
              item={item}
              info={health.info[item.id]}
              icons={prefs.icons}
              index={index}
              onEdit={() => router.push({ pathname: "/editor", params: { id: item.id } })}
              onFavorite={() => toggleFavorite(item.id).catch((e) => toast(e.message, "error"))}
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <FadeIn delay={200}>
              <Card style={{ alignItems: "center", paddingVertical: 34, gap: 10 }}>
                <View style={[styles.emptyIcon, { backgroundColor: alpha(theme.accent, 0.15) }]}>
                  <Icon name={items.length ? "search" : "key"} size={28} color={theme.accentSoft} />
                </View>
                <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 19, textAlign: "center" }}>
                  {items.length ? "Nothing here" : "Your vault is empty"}
                </Text>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, textAlign: "center", marginBottom: 8 }}>
                  {items.length ? "Try another search or clear the filters." : "Add your first login — it's encrypted on this phone before it's saved."}
                </Text>
                {items.length ? (
                  <Chip label="Show everything" active onPress={() => { setQuery(""); setFilter("all"); setFolder("__all"); }} />
                ) : (
                  <GradientButton title="Add an item" icon="plus" small onPress={() => router.push("/editor")} />
                )}
              </Card>
            </FadeIn>
          }
          ListFooterComponent={<View style={{ alignItems: "center", marginTop: 8 }}><StatusPill style={{ alignSelf: "center" }} /></View>}
          contentContainerStyle={{ padding: 18, paddingBottom: 130 }}
          refreshControl={
            <RefreshControl
              refreshing={syncing}
              onRefresh={() => refresh().catch((e) => toast(e.message, "error"))}
              tintColor={theme.accent}
              colors={[theme.accent, theme.accent2]}
              progressBackgroundColor={theme.surfaceSolid}
            />
          }
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
  me: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  summary: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, marginBottom: 16 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 52, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, marginBottom: 12 },
  chips: { gap: 8, paddingBottom: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
});
