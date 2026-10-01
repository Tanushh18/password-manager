import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useTheme, alpha } from "../lib/theme";
import { strengthColor } from "../lib/strength";
import Icon from "./Icon";

export const tap = () => Haptics.selectionAsync().catch(() => {});

/* ── Card ── */
export function Card({ style, children, glow = false }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: glow ? theme.lineStrong : theme.line,
          padding: 16,
          shadowColor: theme.shadow,
          shadowOpacity: theme.mode === "dark" ? 0.25 : 0.06,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: theme.mode === "dark" ? 0 : 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ── Springy press wrapper ── */
export function Bounce({ onPress, style, outerStyle, children, disabled, haptic = true, scaleTo = 0.98, ...rest }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  return (
    <Pressable
      style={outerStyle}
      disabled={disabled}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      onPress={(e) => {
        if (haptic) tap();
        onPress?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ── Primary button (solid; `colors[0]` picks the fill) ── */
export function GradientButton({ title, onPress, loading, disabled, icon, colors, style, small }) {
  const { theme } = useTheme();
  return (
    <Bounce onPress={onPress} disabled={disabled || loading} outerStyle={style} style={{ opacity: disabled ? 0.6 : 1 }}>
      <LinearGradient
        colors={[(colors || theme.brand)[0], (colors || theme.brand)[0]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.btn, small && styles.btnSmall]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            {icon ? <Icon name={icon} size={small ? 16 : 18} color="#fff" strokeWidth={2} /> : null}
            <Text style={[styles.btnText, small && { fontSize: 14 }, { fontFamily: theme.font.bodySemi }]}>{title}</Text>
          </>
        )}
      </LinearGradient>
    </Bounce>
  );
}

export function GhostButton({ title, onPress, icon, color, style, small, disabled }) {
  const { theme } = useTheme();
  const c = color || theme.text;
  return (
    <Bounce onPress={onPress} disabled={disabled} style={[styles.ghost, small && styles.btnSmall, { borderColor: theme.lineStrong, backgroundColor: "transparent", opacity: disabled ? 0.5 : 1 }, style]}>
      {icon ? <Icon name={icon} size={small ? 16 : 18} color={c} /> : null}
      <Text style={{ color: c, fontFamily: theme.font.bodySemi, fontSize: small ? 14 : 15 }}>{title}</Text>
    </Bounce>
  );
}

export function IconButton({ name, onPress, color, bg, size = 40, iconSize = 18, active }) {
  const { theme } = useTheme();
  return (
    <Bounce
      onPress={onPress}
      scaleTo={0.88}
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg || (active ? alpha(theme.accent, 0.15) : theme.surface),
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.line,
      }}
    >
      <Icon name={name} size={iconSize} color={color || (active ? theme.accent : theme.text)} />
    </Bounce>
  );
}

/* ── Text field with animated focus ring ── */
export function Field({ label, icon, secure, value, onChangeText, error, right, style, ...rest }) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secure);
  const f = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(f, { toValue: focused ? 1 : 0, duration: 220, useNativeDriver: false }).start();
  }, [focused, f]);
  const borderColor = error
    ? theme.danger
    : f.interpolate({ inputRange: [0, 1], outputRange: [theme.line, theme.accent] });

  return (
    <View style={[{ marginBottom: 14 }, style]}>
      {label ? <Text style={[styles.label, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>{label}</Text> : null}
      <Animated.View style={[styles.field, { borderColor, backgroundColor: theme.surface }]}>
        {icon ? <Icon name={icon} size={18} color={focused ? theme.accentSoft : theme.textFaint} /> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          placeholderTextColor={theme.textFaint}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, { color: theme.text, fontFamily: secure && !hidden ? theme.font.mono : theme.font.body }]}
          selectionColor={theme.accent}
          autoCorrect={false}
          {...rest}
        />
        {right}
        {secure ? (
          <Pressable hitSlop={10} onPress={() => setHidden((h) => !h)}>
            <Icon name={hidden ? "eye" : "eyeOff"} size={18} color={theme.textFaint} />
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? <Text style={{ color: theme.danger, fontSize: 12, marginTop: 6, fontFamily: theme.font.bodyMedium }}>{error}</Text> : null}
    </View>
  );
}

/* ── Four-bar strength meter ── */
export function StrengthMeter({ strength }) {
  const { theme } = useTheme();
  const color = strengthColor(theme, strength.score);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: -4, marginBottom: 12 }}>
      <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
        {[1, 2, 3, 4].map((n) => (
          <View
            key={n}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              backgroundColor: strength.score >= n ? color : theme.line,
            }}
          />
        ))}
      </View>
      <Text style={{ color, fontSize: 12, fontFamily: theme.font.bodySemi }}>
        {strength.label}
        {strength.bits ? ` · ${strength.bits} bits` : ""}
      </Text>
    </View>
  );
}

/* ── Small rounded label ── */
export function Badge({ text, color, icon }) {
  const { theme } = useTheme();
  const c = color || theme.accent;
  return (
    <View style={[styles.badge, { backgroundColor: alpha(c, 0.15), borderColor: alpha(c, 0.4) }]}>
      {icon ? <Icon name={icon} size={11} color={c} strokeWidth={2.2} /> : null}
      <Text style={{ color: c, fontSize: 11, fontFamily: theme.font.bodySemi }}>{text}</Text>
    </View>
  );
}

export function Chip({ label, active, onPress, count, color }) {
  const { theme } = useTheme();
  const c = color || theme.accent;
  return (
    <Bounce
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? c : theme.line,
          backgroundColor: active ? alpha(c, 0.12) : theme.surface,
        },
      ]}
    >
      <Text style={{ color: active ? theme.heading : theme.textMuted, fontFamily: theme.font.bodySemi, fontSize: 13 }}>{label}</Text>
      {count !== undefined ? (
        <View style={[styles.chipCount, { backgroundColor: active ? c : theme.line }]}>
          <Text style={{ color: active ? "#fff" : theme.textMuted, fontSize: 11, fontFamily: theme.font.bodyBold }}>{count}</Text>
        </View>
      ) : null}
    </Bounce>
  );
}

/* ── Accent-coloured heading text ── */
export function GradientText({ children, style }) {
  const { theme } = useTheme();
  return <Text style={[{ color: theme.accent }, style]}>{children}</Text>;
}

/* ── Fade + rise on mount ── */
export function FadeIn({ delay = 0, children, style, from = 6 }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 220, delay: Math.min(delay, 120), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  btn: {
    height: 50,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
    paddingHorizontal: 20,
  },
  btnSmall: { height: 40, borderRadius: 8, paddingHorizontal: 14 },
  btnText: { color: "#fff", fontSize: 15 },
  ghost: {
    height: 50,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  label: { fontSize: 13, marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
  },
  input: { flex: 1, fontSize: 15, height: "100%" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipCount: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
});
