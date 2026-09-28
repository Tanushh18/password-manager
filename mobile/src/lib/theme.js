import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Stashr design tokens — the same palette as the website
 * (client/src/styles/theme.css), tuned for native.
 */
const shared = {
  radius: { sm: 12, md: 16, lg: 20, xl: 26, pill: 999 },
  font: {
    display: "Sora_700Bold",
    displayHeavy: "Sora_800ExtraBold",
    displayMedium: "Sora_600SemiBold",
    body: "Inter_400Regular",
    bodyMedium: "Inter_500Medium",
    bodySemi: "Inter_600SemiBold",
    bodyBold: "Inter_700Bold",
    mono: "monospace",
  },
};

export const themes = {
  dark: {
    ...shared,
    mode: "dark",
    bg: "#0D0303",
    bgSoft: "#130505",
    surface: "rgba(30, 10, 10, 0.78)",
    surfaceSolid: "#170808",
    surfaceRaised: "#201010",
    line: "rgba(49, 170, 169, 0.18)",
    lineStrong: "rgba(49, 170, 169, 0.36)",
    text: "#F0E4CC",
    textMuted: "rgba(240, 228, 204, 0.68)",
    textFaint: "rgba(240, 228, 204, 0.42)",
    heading: "#FFF8EC",
    accent: "#31AAA9",
    accentSoft: "#6BC2C1",
    accent2: "#A82020",
    accent3: "#F8E0A4",
    ok: "#2FA36B",
    warn: "#F8E0A4",
    danger: "#A82020",
    brand: ["#31AAA9", "#A82020", "#F8E0A4"],
    cool: ["#F8E0A4", "#31AAA9"],
    glows: ["rgba(49, 170, 169, 0.55)", "rgba(168, 32, 32, 0.40)", "rgba(248, 224, 164, 0.32)"],
    statusBar: "light",
    shadow: "#000000",
  },
  light: {
    ...shared,
    mode: "light",
    bg: "#FCF1D6",
    bgSoft: "#FAEBC4",
    surface: "rgba(255, 255, 255, 0.86)",
    surfaceSolid: "#FFFAF0",
    surfaceRaised: "#FFFFFF",
    line: "rgba(35, 122, 122, 0.14)",
    lineStrong: "rgba(35, 122, 122, 0.30)",
    text: "#3A1010",
    textMuted: "rgba(58, 16, 16, 0.68)",
    textFaint: "rgba(58, 16, 16, 0.45)",
    heading: "#2A0B0B",
    accent: "#237A7A",
    accentSoft: "#31AAA9",
    accent2: "#A82020",
    accent3: "#887B5A",
    ok: "#1F7A4C",
    warn: "#AD8A2E",
    danger: "#A82020",
    brand: ["#237A7A", "#A82020", "#F8E0A4"],
    cool: ["#6C1A1A", "#237A7A"],
    glows: ["rgba(35, 122, 122, 0.30)", "rgba(168, 32, 32, 0.22)", "rgba(248, 224, 164, 0.25)"],
    statusBar: "dark",
    shadow: "#3A1010",
  },
};

const KEY = "aurelia_theme";
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState("system"); // system | dark | light

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => {
        if (v === "dark" || v === "light" || v === "system") setPreference(v);
      })
      .catch(() => {});
  }, []);

  const value = useMemo(() => {
    const mode = preference === "system" ? (system === "light" ? "light" : "dark") : preference;
    return {
      theme: themes[mode],
      preference,
      setPreference: (p) => {
        setPreference(p);
        SecureStore.setItemAsync(KEY, p).catch(() => {});
      },
    };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Adds alpha to a #RRGGBB colour. */
export const alpha = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
