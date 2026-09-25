import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useTheme, alpha } from "../lib/theme";
import Icon from "./Icon";

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState(null);
  const y = useRef(new Animated.Value(-120)).current;
  const timer = useRef(null);

  const show = useCallback(
    (message, type = "success") => {
      clearTimeout(timer.current);
      setToast({ message, type });
      Haptics.notificationAsync(
        type === "error" ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success
      ).catch(() => {});
      Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 9 }).start();
      timer.current = setTimeout(() => {
        Animated.timing(y, { toValue: -140, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() =>
          setToast(null)
        );
      }, 2600);
    },
    [y]
  );

  const color = toast?.type === "error" ? theme.danger : toast?.type === "info" ? theme.accent3 : theme.ok;

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]}
        >
          <View style={[styles.toast, { backgroundColor: theme.surfaceSolid, borderColor: alpha(color, 0.5), shadowColor: color }]}>
            <View style={[styles.icon, { backgroundColor: alpha(color, 0.18) }]}>
              <Icon name={toast.type === "error" ? "alert" : toast.type === "info" ? "sparkle" : "check"} size={16} color={color} strokeWidth={2.2} />
            </View>
            <Text style={{ flex: 1, color: theme.text, fontFamily: theme.font.bodyMedium, fontSize: 14 }}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 100 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
