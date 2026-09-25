import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { useTheme, alpha } from "../lib/theme";
import { useVault } from "../lib/vault";
import { strengthColor } from "../lib/strength";
import { useToast } from "./Toast";
import { Badge, Card, IconButton, tap } from "./ui";
import Icon from "./Icon";

const WASHES = [
  ["#8B5CF6", "#EC4899"],
  ["#22D3EE", "#8B5CF6"],
  ["#F472B6", "#F59E0B"],
  ["#34D399", "#0891B2"],
  ["#6366F1", "#22D3EE"],
  ["#A855F7", "#6366F1"],
];
const AUTO_HIDE_MS = 20000;
const CLIPBOARD_CLEAR_MS = 30000;

export const washFor = (name) => WASHES[((name || "?").charCodeAt(0) || 0) % WASHES.length];

export const timeAgo = (date) => {
  if (!date) return "";
  const s = Math.max(1, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo ago`;
  return `${Math.floor(s / 31536000)}y ago`;
};

export function Avatar({ name, size = 46 }) {
  const { theme } = useTheme();
  const letter = !name || name === "NA" ? "•" : name.trim().charAt(0).toUpperCase();
  return (
    <LinearGradient colors={washFor(name)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontFamily: theme.font.display, fontSize: size * 0.42 }}>{letter}</Text>
    </LinearGradient>
  );
}

export default function PasswordCard({ entry, info, onEdit, index = 0 }) {
  const { theme } = useTheme();
  const { reveal, remove } = useVault();
  const toast = useToast();
  const [value, setValue] = useState(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(appear, { toValue: 1, delay: Math.min(index, 10) * 55, useNativeDriver: true, speed: 12, bounciness: 6 }).start();
  }, [appear, index]);

  useEffect(() => {
    if (!shown) return undefined;
    const t = setTimeout(() => setShown(false), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [shown]);

  useEffect(() => {
    setValue(null);
    setShown(false);
  }, [entry.password, entry.iv]);

  const get = async () => {
    if (value !== null) return value;
    const v = await reveal(entry);
    setValue(v);
    return v;
  };

  const toggle = async () => {
    tap();
    if (shown) return setShown(false);
    try {
      setBusy(true);
      await get();
      setShown(true);
    } catch (e) {
      toast(e.message || "Couldn't unseal that one.", "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      setBusy(true);
      const v = await get();
      await Clipboard.setStringAsync(v);
      setCopied(true);
      toast(`${entry.platform} password copied · clears in 30s`, "info");
      setTimeout(() => setCopied(false), 1600);
      setTimeout(async () => {
        try {
          if ((await Clipboard.getStringAsync()) === v) await Clipboard.setStringAsync("");
        } catch (e) {
          /* ignore */
        }
      }, CLIPBOARD_CLEAR_MS);
    } catch (e) {
      toast(e.message || "Couldn't copy that one.", "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(`Delete ${entry.platform}?`, "This password will be removed from your vault on every device.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await remove(entry._id);
            toast("Removed from your vault.");
          } catch (e) {
            toast(e.message || "Couldn't delete that one.", "error");
          }
        },
      },
    ]);
  };

  const scale = appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  const translateY = appear.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  const email = entry.platEmail && entry.platEmail !== "NA" ? entry.platEmail : "No username";

  return (
    <Animated.View style={{ opacity: appear, transform: [{ translateY }, { scale }], marginBottom: 14 }}>
      <Card style={{ padding: 16 }}>
        <View style={styles.head}>
          <Avatar name={entry.platform} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 17 }}>
              {entry.platform}
            </Text>
            <Text numberOfLines={1} style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, marginTop: 2 }}>
              {email}
            </Text>
          </View>
          <IconButton name="pencil" size={36} iconSize={16} onPress={() => onEdit?.(entry)} />
        </View>

        <View style={styles.badges}>
          {info ? (
            <>
              <Badge text={info.label} color={strengthColor(theme, info.score)} icon={info.score >= 3 ? "shieldCheck" : "alert"} />
              {info.reused ? <Badge text="Reused" color={theme.warn} icon="repeat" /> : null}
              {info.old ? <Badge text="Old" color={theme.accent3} icon="clock" /> : null}
            </>
          ) : (
            <Badge text="Scanning…" color={theme.textFaint} />
          )}
          <Text style={{ marginLeft: "auto", color: theme.textFaint, fontSize: 11, fontFamily: theme.font.body }}>
            {timeAgo(entry.updatedAt || entry.createdAt)}
          </Text>
        </View>

        <View style={[styles.secret, { backgroundColor: alpha(theme.accent, 0.08), borderColor: shown ? alpha(theme.ok, 0.5) : theme.line }]}>
          <Pressable style={{ flex: 1 }} onPress={toggle}>
            {busy && !shown ? (
              <ActivityIndicator color={theme.accentSoft} style={{ alignSelf: "flex-start" }} />
            ) : (
              <Text
                numberOfLines={1}
                selectable={shown}
                style={{
                  color: shown ? theme.heading : theme.textMuted,
                  fontFamily: theme.font.mono,
                  fontSize: shown ? 15 : 18,
                  letterSpacing: shown ? 0.5 : 3,
                }}
              >
                {shown ? value : "••••••••••"}
              </Text>
            )}
          </Pressable>
          <IconButton name={shown ? "eyeOff" : "eye"} size={34} iconSize={16} onPress={toggle} active={shown} />
          <IconButton name={copied ? "check" : "copy"} size={34} iconSize={16} onPress={copy} color={copied ? theme.ok : undefined} />
          <IconButton name="trash" size={34} iconSize={16} onPress={confirmDelete} color={theme.danger} />
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  badges: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 12, marginBottom: 12 },
  secret: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, minHeight: 48 },
});
