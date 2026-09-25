import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Aurora design tokens — the same palette as the website
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
    bg: "#07061A",
    bgSoft: "#0D0B26",
    surface: "rgba(28, 23, 66, 0.78)",
    surfaceSolid: "#15123A",
    surfaceRaised: "#1D1850",
    line: "rgba(167, 139, 250, 0.18)",
    lineStrong: "rgba(167, 139, 250, 0.36)",
    text: "#EDE9FE",
    textMuted: "rgba(237, 233, 254, 0.68)",
    textFaint: "rgba(237, 233, 254, 0.42)",
    heading: "#FFFFFF",
    accent: "#8B5CF6",
    accentSoft: "#A78BFA",
    accent2: "#EC4899",
    accent3: "#22D3EE",
    ok: "#34D399",
    warn: "#FBBF24",
    danger: "#F43F5E",
    brand: ["#8B5CF6", "#EC4899", "#F59E0B"],
    cool: ["#22D3EE", "#8B5CF6"],
    glows: ["rgba(139, 92, 246, 0.55)", "rgba(236, 72, 153, 0.40)", "rgba(34, 211, 238, 0.32)"],
    statusBar: "light",
    shadow: "#000000",
  },
  light: {
    ...shared,
    mode: "light",
    bg: "#F6F4FF",
    bgSoft: "#EFEBFF",
    surface: "rgba(255, 255, 255, 0.86)",
    surfaceSolid: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    line: "rgba(124, 58, 237, 0.14)",
    lineStrong: "rgba(124, 58, 237, 0.30)",
    text: "#1E1B4B",
    textMuted: "rgba(30, 27, 75, 0.68)",
    textFaint: "rgba(30, 27, 75, 0.45)",
    heading: "#1E1B4B",
    accent: "#7C3AED",
    accentSoft: "#8B5CF6",
    accent2: "#DB2777",
    accent3: "#0891B2",
    ok: "#10B981",
    warn: "#D97706",
    danger: "#E11D48",
    brand: ["#7C3AED", "#DB2777", "#F59E0B"],
    cool: ["#0891B2", "#7C3AED"],
    glows: ["rgba(124, 58, 237, 0.30)", "rgba(219, 39, 119, 0.22)", "rgba(8, 145, 178, 0.20)"],
    statusBar: "dark",
    shadow: "#2E1065",
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
