import React, { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Icon from "./Icon";
import { copySecret } from "./ItemCard";
import { useToast } from "./Toast";
import { tap } from "./ui";
import { useTheme } from "../lib/theme";
import { projectTree, countLeaves } from "../lib/projectTree";

/** Badge colour per project status. */
export const statusColors = (theme) => ({
  planning: theme.textMuted,
  in_progress: theme.warn,
  deployed: theme.ok,
  broken: theme.danger,
  paused: theme.textMuted,
  archived: theme.textMuted,
});

const href = (v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

function ToolButton({ name, onPress, label }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label} style={({ pressed }) => [styles.tool, pressed && { backgroundColor: theme.bgSoft }]}>
      <Icon name={name} size={16} color={theme.textMuted} />
    </Pressable>
  );
}

/** One field: label (and optional path / hint), value, copy / reveal / open. */
export function TreeLeaf({ node, path, reveal = false }) {
  const { theme } = useTheme();
  const toast = useToast();
  const [shown, setShown] = useState(reveal || !node.secret);
  const mono = node.mono || node.secret;
  return (
    <View style={styles.leaf}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {path ? <Text style={[styles.small, { color: theme.textFaint, fontFamily: theme.font.body }]} numberOfLines={1}>{path}</Text> : null}
        <Text style={{ color: theme.textMuted, fontFamily: node.mono ? theme.font.mono : theme.font.bodyMedium, fontSize: 12 }} numberOfLines={1}>
          {node.label}
          {node.hint ? <Text style={{ color: theme.textFaint }}>{`  ·  ${node.hint}`}</Text> : null}
        </Text>
        <Text
          selectable={shown}
          style={{ color: theme.text, fontFamily: mono ? theme.font.mono : theme.font.body, fontSize: 14, marginTop: 1 }}
          numberOfLines={shown ? 4 : 1}
        >
          {shown ? node.value : "••••••••••"}
        </Text>
      </View>
      {node.secret ? <ToolButton name={shown ? "eyeOff" : "eye"} label={shown ? "Hide value" : "Show value"} onPress={() => setShown((v) => !v)} /> : null}
      {node.link ? <ToolButton name="globe" label="Open link" onPress={() => Linking.openURL(href(node.value)).catch(() => {})} /> : null}
      <ToolButton name="copy" label={`Copy ${node.label}`} onPress={() => { tap(); copySecret(node.value, node.label, toast); }} />
    </View>
  );
}

function Branch({ node, depth, openSet, toggle }) {
  const { theme } = useTheme();
  const open = openSet.has(node.id);
  return (
    <View>
      <Pressable
        onPress={() => { tap(); toggle(node.id); }}
        style={({ pressed }) => [styles.head, { paddingLeft: depth * 14 + 2 }, pressed && { backgroundColor: theme.bgSoft }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <Icon name="arrow" size={14} color={theme.textMuted} />
        </View>
        <Text style={{ flex: 1, color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 14 }} numberOfLines={1}>{node.label}</Text>
        <View style={[styles.count, { backgroundColor: theme.bgSoft }]}>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.bodySemi, fontSize: 11 }}>{countLeaves(node)}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.children, { marginLeft: depth * 14 + 8, borderColor: theme.line }]}>
          {node.children.map((child, i) =>
            child.children ? (
              <Branch key={child.id || i} node={child} depth={depth + 1} openSet={openSet} toggle={toggle} />
            ) : (
              <TreeLeaf key={`${child.label}-${i}`} node={child} />
            )
          )}
        </View>
      ) : null}
    </View>
  );
}

const allIds = (nodes) => nodes.flatMap((n) => (n.children ? [n.id, ...allIds(n.children)] : []));

/** Collapsible structure of a project: sections → (databases →) fields. */
export default function ProjectTree({ project, expanded = false }) {
  const { theme } = useTheme();
  const tree = useMemo(() => projectTree(project), [project]);
  const ids = useMemo(() => allIds(tree), [tree]);
  const [openSet, setOpenSet] = useState(() => new Set(expanded ? ids : []));
  const toggle = (id) =>
    setOpenSet((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!tree.length) return <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>No details yet.</Text>;
  const allOpen = ids.every((id) => openSet.has(id));
  return (
    <View>
      <Pressable onPress={() => setOpenSet(new Set(allOpen ? [] : ids))} hitSlop={8} style={{ alignSelf: "flex-end", paddingVertical: 4 }}>
        <Text style={{ color: theme.accent, fontFamily: theme.font.bodySemi, fontSize: 13 }}>{allOpen ? "Collapse all" : "Expand all"}</Text>
      </Pressable>
      {tree.map((node) => (
        <Branch key={node.id} node={node} depth={0} openSet={openSet} toggle={toggle} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingRight: 4, borderRadius: 8 },
  count: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  children: { borderLeftWidth: 1, paddingLeft: 8, marginBottom: 2 },
  leaf: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 7, paddingLeft: 6 },
  tool: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  small: { fontSize: 11 },
});
