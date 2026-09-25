import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Aurora from "./Aurora";
import { FadeIn, IconButton } from "./ui";
import { useTheme } from "../lib/theme";

/** Simple pushed screen with a back button, title and scrolling body. */
export default function Screen({ title, subtitle, children }) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.7} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }} keyboardShouldPersistTaps="handled">
            <IconButton name="back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))} />
            <FadeIn>
              <Text style={{ color: theme.heading, fontFamily: theme.font.displayHeavy, fontSize: 30, letterSpacing: -0.8 }}>{title}</Text>
              {subtitle ? <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 15, lineHeight: 22, marginTop: 6 }}>{subtitle}</Text> : null}
            </FadeIn>
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
