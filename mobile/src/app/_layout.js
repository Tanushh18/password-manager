import React, { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold } from "@expo-google-fonts/sora";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { ThemeProvider, useTheme } from "../lib/theme";
import { VaultProvider, useVault } from "../lib/vault";
import { ToastProvider } from "../components/Toast";

SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 450, fade: true });

function RootStack({ fontsReady }) {
  const { theme } = useTheme();
  const { status } = useVault();
  const booted = fontsReady && status !== "booting";

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});
  }, [theme.bg]);

  useEffect(() => {
    if (booted) SplashScreen.hideAsync().catch(() => {});
  }, [booted]);

  if (!booted) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <>
      <StatusBar style={theme.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
          animation: "fade_from_bottom",
        }}
      >
        <Stack.Protected guard={status === "signedOut"}>
          <Stack.Screen name="auth" />
        </Stack.Protected>
        <Stack.Protected guard={status === "locked"}>
          <Stack.Screen name="lock" options={{ animation: "fade" }} />
        </Stack.Protected>
        <Stack.Protected guard={status === "ready"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="editor" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <VaultProvider>
          <ToastProvider>
            <RootStack fontsReady={fontsReady || !!fontError} />
          </ToastProvider>
        </VaultProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
