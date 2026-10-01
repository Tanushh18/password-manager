import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../lib/theme";

/**
 * Plain page background. This used to draw an animated aurora; the flat
 * design keeps a solid colour. Props are accepted so callers stay unchanged.
 */
export default function Aurora() {
  const { theme } = useTheme();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]} />;
}
