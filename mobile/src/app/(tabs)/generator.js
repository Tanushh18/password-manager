import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { Card, Chip, FadeIn, GhostButton, GradientButton, GradientText, IconButton, StrengthMeter, tap } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { estimate, generatePassphrase, generatePassword, strengthColor } from "../../lib/strength";

const MIN = 8;
const MAX = 48;

/** Minimal custom slider (no extra native dependency). */
function LengthSlider({ value, onChange }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const pct = (value - MIN) / (MAX - MIN);

  const fromX = useCallback((x) => {
    const w = widthRef.current || 1;
    const p = Math.min(1, Math.max(0, x / w));
    return Math.round(MIN + p * (MAX - MIN));
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => onChange(fromX(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onChange(fromX(e.nativeEvent.locationX)),
      }),
    [fromX, onChange]
  );

  return (
    <View
      style={{ height: 36, justifyContent: "center" }}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: alpha(theme.accent, 0.18) }]}>
        <LinearGradient colors={[theme.accent3, theme.accent, theme.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 4 }} />
      </View>
      {width ? (
        <View pointerEvents="none" style={[styles.thumb, { left: pct * width - 13, borderColor: theme.accent, shadowColor: theme.accent }]} />
      ) : null}
    </View>
  );
}

export default function Generator() {
  const { theme } = useTheme();
  const toast = useToast();
  const [mode, setMode] = useState("password");
  const [length, setLength] = useState(20);
  const [opts, setOpts] = useState({ upper: true, digits: true, symbols: true });
  const [words, setWords] = useState(4);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState([]);
  const pop = useRef(new Animated.Value(1)).current;

  const make = useCallback(() => {
    const next = mode === "password" ? generatePassword({ length, ...opts }) : generatePassphrase({ words });
    setValue(next);
    pop.setValue(0.94);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 12 }).start();
    return next;
  }, [mode, length, opts, words, pop]);

  useEffect(() => {
    make();
  }, [make]);

  const strength = useMemo(() => estimate(value), [value]);

  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setHistory((h) => [value, ...h.filter((x) => x !== value)].slice(0, 5));
    toast("Copied to clipboard", "info");
  };

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.9} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 130 }}>
          <FadeIn>
            <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
              Password <GradientText>generator</GradientText>
            </Text>
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, marginBottom: 18 }}>
              Cryptographically random, generated on your device.
            </Text>
          </FadeIn>

          <FadeIn delay={80}>
            <Card glow style={{ padding: 20 }}>
              <Animated.View style={{ transform: [{ scale: pop }] }}>
                <Text selectable style={[styles.value, { color: theme.heading, fontFamily: theme.font.mono, borderColor: alpha(strengthColor(theme, strength.score), 0.45), backgroundColor: alpha(theme.accent, 0.08) }]}>
                  {value}
                </Text>
              </Animated.View>
              <View style={{ marginTop: 14 }}>
                <StrengthMeter strength={strength} />
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <GradientButton title="Copy" icon="copy" onPress={copy} style={{ flex: 1 }} />
                <IconButton name="refresh" size={56} iconSize={22} onPress={() => { tap(); make(); }} />
              </View>
              <GhostButton
                title="Save to vault"
                icon="plus"
                small
                style={{ marginTop: 10 }}
                onPress={() => router.push({ pathname: "/editor", params: { password: value } })}
              />
            </Card>
          </FadeIn>

          <FadeIn delay={160} style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
            <Chip label="Random" active={mode === "password"} onPress={() => setMode("password")} />
            <Chip label="Passphrase" active={mode === "passphrase"} onPress={() => setMode("passphrase")} />
          </FadeIn>

          <FadeIn delay={220}>
            <Card style={{ marginTop: 12 }}>
              {mode === "password" ? (
                <>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.optLabel, { color: theme.text, fontFamily: theme.font.bodySemi }]}>Length</Text>
                    <Text style={{ color: theme.accentSoft, fontFamily: theme.font.displayHeavy, fontSize: 20 }}>{length}</Text>
                  </View>
                  <LengthSlider value={length} onChange={setLength} />
                  {[
                    { key: "upper", label: "Uppercase (A–Z)" },
                    { key: "digits", label: "Numbers (2–9)" },
                    { key: "symbols", label: "Symbols (!@#…)" },
                  ].map((o) => (
                    <View key={o.key} style={[styles.rowBetween, { marginTop: 12 }]}>
                      <Text style={[styles.optLabel, { color: theme.text, fontFamily: theme.font.bodyMedium }]}>{o.label}</Text>
                      <Switch
                        value={opts[o.key]}
                        onValueChange={(v) => { tap(); setOpts((p) => ({ ...p, [o.key]: v })); }}
                        trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }}
                        thumbColor="#fff"
                      />
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.optLabel, { color: theme.text, fontFamily: theme.font.bodySemi }]}>Words</Text>
                    <Text style={{ color: theme.accentSoft, fontFamily: theme.font.displayHeavy, fontSize: 20 }}>{words}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    {[3, 4, 5, 6].map((n) => (
                      <Chip key={n} label={`${n}`} active={words === n} onPress={() => setWords(n)} />
                    ))}
                  </View>
                  <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12, marginTop: 12 }}>
                    Easy to type on a phone, hard to guess.
                  </Text>
                </>
              )}
            </Card>
          </FadeIn>

          {history.length ? (
            <FadeIn delay={40} style={{ marginTop: 18 }}>
              <Text style={{ color: theme.textFaint, fontFamily: theme.font.bodySemi, fontSize: 11, letterSpacing: 1.6, marginBottom: 8 }}>
                RECENTLY COPIED (THIS SESSION)
              </Text>
              <Card style={{ padding: 8 }}>
                {history.map((h, i) => (
                  <View key={h} style={[styles.hist, i > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
                    <Icon name="key" size={14} color={theme.textFaint} />
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.textMuted, fontFamily: theme.font.mono, fontSize: 13 }}>
                      {h}
                    </Text>
                  </View>
                ))}
              </Card>
            </FadeIn>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, letterSpacing: -0.8, marginTop: 6, marginBottom: 4 },
  value: { fontSize: 20, lineHeight: 30, textAlign: "center", padding: 16, borderRadius: 18, borderWidth: 1, letterSpacing: 0.5 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optLabel: { fontSize: 15 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  thumb: { position: "absolute", top: 5, width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", borderWidth: 4, shadowOpacity: 0.8, shadowRadius: 10, elevation: 6 },
  hist: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
});
