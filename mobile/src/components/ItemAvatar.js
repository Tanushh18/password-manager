import React, { useState } from "react";
import { Image, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../lib/theme";
import { faviconUrl } from "../lib/items";

const WASHES = [
  ["#8B5CF6", "#EC4899"],
  ["#22D3EE", "#8B5CF6"],
  ["#F472B6", "#F59E0B"],
  ["#34D399", "#0891B2"],
  ["#6366F1", "#22D3EE"],
  ["#A855F7", "#6366F1"],
];
export const washFor = (name) => WASHES[((name || "?").charCodeAt(0) || 0) % WASHES.length];

/** Website icon (opt-in) with a gradient-letter fallback. */
export default function ItemAvatar({ name, url, icons, size = 46 }) {
  const { theme } = useTheme();
  const [failed, setFailed] = useState(false);
  const src = icons && !failed ? faviconUrl(url) : "";
  const letter = (name || "•").trim().charAt(0).toUpperCase() || "•";
  const shape = { width: size, height: size, borderRadius: size * 0.3, alignItems: "center", justifyContent: "center" };

  if (src) {
    return (
      <LinearGradient colors={[theme.surfaceRaised, theme.surfaceSolid]} style={[shape, { borderWidth: 1, borderColor: theme.line }]}>
        <Image source={{ uri: src }} style={{ width: size * 0.56, height: size * 0.56 }} onError={() => setFailed(true)} />
      </LinearGradient>
    );
  }
  return (
    <LinearGradient colors={washFor(name)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={shape}>
      <Text style={{ color: "#fff", fontFamily: theme.font.display, fontSize: size * 0.42 }}>{letter}</Text>
    </LinearGradient>
  );
}
