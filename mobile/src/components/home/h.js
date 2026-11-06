import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Card, Chip, GhostButton, GradientButton } from "../ui";
import { useToast } from "../Toast";
import { useTheme, alpha } from "../../lib/theme";

/* Small building blocks shared by the Smart home sections. */

export function Box({ title, subtitle, right, children, gap = 10 }) {
  const { theme } = useTheme();
  return (
    <Card style={{ padding: 14, gap }}>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16 }}>{title}</Text>
            {subtitle ? <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 2 }}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </Card>
  );
}

export function Sub({ children }) {
  const { theme } = useTheme();
  return <Text style={{ color: theme.textMuted, fontFamily: theme.font.bodySemi, fontSize: 11.5, letterSpacing: 0.5, marginTop: 4 }}>{String(children).toUpperCase()}</Text>;
}

export function Dim({ children, style }) {
  const { theme } = useTheme();
  return <Text style={[{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18 }, style]}>{children}</Text>;
}

export function Txt({ children, bold, style, numberOfLines, onPress }) {
  const { theme } = useTheme();
  return <Text onPress={onPress} numberOfLines={numberOfLines} style={[{ color: theme.text, fontFamily: bold ? theme.font.bodySemi : theme.font.body, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}

export function Bad({ children }) {
  const { theme } = useTheme();
  return <Text style={{ color: theme.danger, fontFamily: theme.font.bodyMedium, fontSize: 13, lineHeight: 19 }}>{children}</Text>;
}

export function Good({ children }) {
  const { theme } = useTheme();
  return <Text style={{ color: theme.ok, fontFamily: theme.font.bodyMedium, fontSize: 13, lineHeight: 19 }}>{children}</Text>;
}

export function Row({ children, gap = 8, wrap = true, style }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap, flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function Dot({ tone = "mute" }) {
  const { theme } = useTheme();
  const c = { ok: theme.ok, bad: theme.danger, warn: theme.warn, mute: theme.textFaint }[tone] || theme.textFaint;
  return <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c }} />;
}

export function Btn({ label, onPress, kind = "quiet", disabled, loading, small = true, style }) {
  const { theme } = useTheme();
  if (kind === "primary") return <GradientButton title={label} onPress={onPress} disabled={disabled} loading={loading} small={small} style={style} />;
  return <GhostButton title={label} onPress={onPress} disabled={disabled || loading} small={small} color={kind === "danger" ? theme.danger : undefined} style={style} />;
}

export function Toggle({ label, hint, value, onChange, disabled }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontFamily: theme.font.body, fontSize: 14, lineHeight: 19 }}>{label}</Text>
        {hint ? <Dim>{hint}</Dim> : null}
      </View>
      <Switch value={Boolean(value)} disabled={disabled} onValueChange={onChange} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }} thumbColor="#fff" />
    </View>
  );
}

export function Input({ value, onChangeText, placeholder, style, multiline, keyboardType, autoCapitalize = "none", maxLength, secureTextEntry, onSubmitEditing, editable = true }) {
  const { theme } = useTheme();
  return (
    <TextInput
      value={value == null ? "" : String(value)}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textFaint}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      maxLength={maxLength}
      secureTextEntry={secureTextEntry}
      onSubmitEditing={onSubmitEditing}
      editable={editable}
      style={[{ color: theme.text, fontFamily: theme.font.body, fontSize: 14.5, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: alpha(theme.accent, 0.04), flexGrow: 1, minWidth: 90 }, multiline ? { minHeight: 70, textAlignVertical: "top" } : null, style]}
    />
  );
}

/** A row of choices; the picked one is highlighted. options: [[value, label]] */
export function Pick({ options, value, onChange }) {
  return (
    <Row gap={6}>
      {options.map(([v, label]) => <Chip key={String(v)} label={label} active={value === v} onPress={() => onChange(v)} />)}
    </Row>
  );
}

/** Yes/no question as a native alert. */
export function ask(title, message, confirmLabel = "OK", danger = false) {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: danger ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** One card that fails to draw must not take the screen down. */
export class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn("Smart home card failed:", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <Dim>{this.props.name || "This card"} could not be shown. The rest still works; reopen the screen to try again.</Dim>;
  }
}

/** Runs fn now and then every `ms`, only while the screen is focused and the app is in front. */
export function usePoll(fn, ms, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let timer = null;
      const run = () => { if (AppState.currentState === "active") Promise.resolve(saved.current()).catch(() => {}); };
      const start = () => { if (timer == null) timer = setInterval(run, ms); };
      const stop = () => { if (timer != null) { clearInterval(timer); timer = null; } };
      run();
      start();
      const sub = AppState.addEventListener("change", (s) => { if (s === "active") { run(); start(); } else stop(); });
      return () => { stop(); sub.remove(); };
    }, [ms, enabled])
  );
}

/** Loads something once, keeps it in state, can be reloaded. */
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const saved = useRef(fn);
  saved.current = fn;
  const load = useCallback(async () => {
    try { setData(await saved.current()); setError(""); } catch (e) { setError(e.message || "Could not load."); }
  }, []);
  useEffect(() => { load(); }, deps);
  return { data, setData, error, reload: load };
}

/** act(promiseFn, doneText): runs it, shows a toast with the result, returns the value or undefined. */
export function useAct() {
  const toast = useToast();
  return useCallback(async (fn, done) => {
    try {
      const r = await fn();
      if (done) toast(done);
      return r === undefined ? true : r;
    } catch (e) {
      toast(e.message || "Something went wrong", "error");
      return undefined;
    }
  }, [toast]);
}
