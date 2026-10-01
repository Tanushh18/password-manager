import React from "react";
import { Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import Screen from "../components/Screen";
import { Badge, Card, GhostButton } from "../components/ui";
import { useTheme } from "../lib/theme";
import { useVault } from "../lib/vault";
import { STATUS_LABEL } from "../lib/projectItems";
import ProjectTree, { statusColors } from "../components/ProjectTree";

/** One project with its whole structure expanded. */
export default function ProjectDetail() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams();
  const { projects } = useVault();
  const project = projects.find((p) => String(p.id) === String(id));
  if (!project) return <Redirect href="/projects" />;

  return (
    <Screen title={project.name || "Untitled project"} subtitle={project.description || undefined}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Badge text={STATUS_LABEL[project.status] || project.status} color={statusColors(theme)[project.status]} />
        {project.hostingProvider ? <Badge text={project.hostingProvider} color={theme.textMuted} icon="globe" /> : null}
        <View style={{ flex: 1 }} />
        <GhostButton title="Edit" icon="pencil" small onPress={() => router.push({ pathname: "/project-editor", params: { id: project.id } })} />
      </View>
      <Card>
        <ProjectTree key={project.id} project={project} expanded />
      </Card>
      <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12, textAlign: "center" }}>
        Tap a section to fold it. Copied values clear from the clipboard after 30s.
      </Text>
    </Screen>
  );
}
