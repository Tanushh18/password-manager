import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "../../lib/theme";

export default function AuthLayout() {
  const { theme } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        animation: "slide_from_right",
      }}
    />
  );
}
