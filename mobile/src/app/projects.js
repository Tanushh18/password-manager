import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Aurora from "../components/Aurora";
import Icon from "../components/Icon";
import { useToast } from "../components/Toast";
import { Badge, Bounce, Card, Chip, FadeIn, GradientButton, IconButton } from "../components/ui";
import { useTheme, alpha } from "../lib/theme";
import { useVault } from "../lib/vault";
import { STATUS_LABEL, STATUSES } from "../lib/projectItems";

const STATUS_COLOR = (theme) => ({
  planning: theme.textFaint,
  in_progress: theme.warn,
  deployed: theme.ok,
  broken: theme.danger,
  paused: theme.textFaint,
  archived: theme.textFaint,
});

export default function Projects() {
  const { theme } = useTheme();
  const { profile, projects, projectsBroken, syncing, refresh } = useVault();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("__all");
  const colors = STATUS_COLOR(theme);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((p) => status === "__all" || p.status === status)
      .filter((p) => {
        if (!q) return true;
        const hay = [p.name, p.description, p.tags, p.category, p.techStack, p.hostingProvider, p.liveUrl].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  }, [projects, query, status]);

  const header = (
    <View>
      <FadeIn style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.bodyMedium, fontSize: 14 }}>Every project,</Text>
          <Text style={{ color: theme.heading, fontFamily: theme.font.displayHeavy, fontSize: 28, letterSpacing: -0.8 }}>
            {(profile?.name || "").split(" ")[0] || "friend"}
          </Text>
        </View>
        <IconButton name="back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </FadeIn>

      {projectsBroken ? (
        <View style={[styles.banner, { backgroundColor: alpha(theme.danger, 0.1), borderColor: alpha(theme.danger, 0.4) }]}>
          <Icon name="alert" size={16} color={theme.danger} />
          <Text style={{ flex: 1, color: theme.danger, fontFamily: theme.font.bodyMedium, fontSize: 13 }}>
            {projectsBroken} project{projectsBroken === 1 ? "" : "s"} couldn't be decrypted and {projectsBroken === 1 ? "is" : "are"} hidden.
          </Text>
        </View>
      ) : null}

      <FadeIn delay={120} style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Icon name="search" size={18} color={theme.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, hosting, database, tags…"
          placeholderTextColor={theme.textFaint}
          style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 15, height: "100%" }}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={theme.accent}
        />
        {query ? <IconButton name="close" size={30} iconSize={14} onPress={() => setQuery("")} /> : null}
      </FadeIn>

      <FadeIn delay={160}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" active={status === "__all"} onPress={() => setStatus("__all")} count={projects.length} />
          {STATUSES.map((s) => {
            const count = projects.filter((p) => p.status === s).length;
            if (!count) return null;
            return <Chip key={s} label={STATUS_LABEL[s]} active={status === s} onPress={() => setStatus(s)} count={count} color={colors[s]} />;
          })}
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
          keyExtractor={(p) => p.id}
          renderItem={({ item, index }) => (
            <FadeIn delay={Math.min(index, 8) * 40}>
              <Bounce onPress={() => router.push({ pathname: "/project-editor", params: { id: item.id } })} scaleTo={0.98}>
                <Card style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.heading, fontFamily: theme.font.displayMedium, fontSize: 17 }} numberOfLines={1}>
                        {item.name || "Untitled project"}
                      </Text>
                      {item.description ? (
                        <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, marginTop: 3 }} numberOfLines={2}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                    <Icon name="arrow" size={16} color={theme.textFaint} />
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    <Badge text={STATUS_LABEL[item.status] || item.status} color={colors[item.status]} />
                    {item.hostingProvider ? <Badge text={item.hostingProvider} color={theme.accent3} icon="globe" /> : null}
                    {item.databases?.length ? <Badge text={`${item.databases.length} DB`} color={theme.accentSoft} /> : null}
                  </View>
                </Card>
              </Bounce>
            </FadeIn>
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <FadeIn delay={200}>
              <Card style={{ alignItems: "center", paddingVertical: 34, gap: 10 }}>
                <View style={[styles.emptyIcon, { backgroundColor: alpha(theme.accent, 0.15) }]}>
                  <Icon name={projects.length ? "search" : "globe"} size={28} color={theme.accentSoft} />
                </View>
                <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 19, textAlign: "center" }}>
                  {projects.length ? "Nothing here" : "No projects yet"}
                </Text>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, textAlign: "center", marginBottom: 8 }}>
                  {projects.length ? "Try another search or clear the filters." : "Add hosting, databases and env vars for a project — encrypted the same way as a password."}
                </Text>
                {projects.length ? (
                  <Chip label="Show everything" active onPress={() => { setQuery(""); setStatus("__all"); }} />
                ) : (
                  <GradientButton title="Add a project" icon="plus" small onPress={() => router.push("/project-editor")} />
                )}
              </Card>
            </FadeIn>
          }
          contentContainerStyle={{ padding: 18, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={syncing}
              onRefresh={() => refresh().catch((e) => toast(e.message, "error"))}
              tintColor={theme.accent}
              colors={[theme.accent, theme.accent]}
              progressBackgroundColor={theme.surfaceSolid}
            />
          }
          keyboardShouldPersistTaps="handled"
        />
        {projects.length ? (
          <View style={styles.fabWrap}>
            <Bounce onPress={() => router.push("/project-editor")} scaleTo={0.9}>
              <View style={[styles.fab, { backgroundColor: theme.accent, shadowColor: theme.accent }]}>
                <Icon name="plus" size={24} color="#fff" strokeWidth={2.4} />
              </View>
            </Bounce>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", marginBottom: 16, marginTop: 6 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 52, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, marginBottom: 12 },
  chips: { gap: 8, paddingBottom: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  fabWrap: { position: "absolute", right: 20, bottom: 26 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 0,
  },
});
