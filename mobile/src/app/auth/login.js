import React, { useEffect, useRef, useState } from "react";
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import StatusPill from "../../components/StatusPill";
import { useToast } from "../../components/Toast";
import { Card, FadeIn, Field, GradientButton, GradientText, IconButton } from "../../components/ui";
import { useTheme } from "../../lib/theme";
import { useVault } from "../../lib/vault";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAGES = ["Waking the vault…", "Checking it's really you…", "Deriving your key on this phone…", "Decrypting your vault…"];

/** Shake animation for a failed attempt. */
function useShake() {
  const x = useRef(new Animated.Value(0)).current;
  const shake = () =>
    Animated.sequence(
      [10, -10, 7, -7, 3, 0].map((v) => Animated.timing(x, { toValue: v, duration: 55, useNativeDriver: true }))
    ).start();
  return [x, shake];
}

export default function Login() {
  const { theme } = useTheme();
  const { login } = useVault();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [x, shake] = useShake();

  useEffect(() => {
    if (!loading) return undefined;
    setStage(0);
    const id = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1500);
    return () => clearInterval(id);
  }, [loading]);

  const submit = async () => {
    const found = {};
    if (!EMAIL_RE.test(email.trim())) found.email = "That email doesn't look right";
    if (!password) found.password = "Enter your master password";
    if (needCode && !code.trim()) found.code = "Enter the 6-digit code or a recovery code";
    setErrors(found);
    if (Object.keys(found).length) return shake();

    try {
      setLoading(true);
      const res = await login(email, password, needCode ? code.trim() : undefined);
      if (res?.twoFactorRequired) {
        setNeedCode(true);
        if (res.error) setErrors({ code: res.error });
        return;
      }
      toast("Welcome back ✨");
    } catch (e) {
      shake();
      toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Aurora />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <IconButton name="back" onPress={() => router.back()} />

            <FadeIn delay={60}>
              <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
                Welcome <GradientText>back.</GradientText>
              </Text>
              <Text style={[styles.sub, { color: theme.textMuted, fontFamily: theme.font.body }]}>
                {needCode
                  ? "Two-factor login is on. Enter the code from your authenticator app."
                  : "Your master password unlocks the vault on this phone. It never leaves it."}
              </Text>
            </FadeIn>

            <FadeIn delay={160}>
              <Animated.View style={{ transform: [{ translateX: x }] }}>
                <Card glow style={{ padding: 20 }}>
                  <Field
                    label="Email"
                    icon="mail"
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      if (errors.email) setErrors((p) => ({ ...p, email: null }));
                    }}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    error={errors.email}
                    editable={!loading}
                  />
                  <Field
                    label="Password"
                    icon="lock"
                    secure
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      if (errors.password) setErrors((p) => ({ ...p, password: null }));
                    }}
                    placeholder="Your master password"
                    autoCapitalize="none"
                    autoComplete="password"
                    error={errors.password}
                    editable={!loading && !needCode}
                    returnKeyType="go"
                    onSubmitEditing={submit}
                  />
                  {needCode ? (
                    <Field
                      label="Authenticator code"
                      icon="shieldCheck"
                      value={code}
                      onChangeText={(t) => {
                        setCode(t);
                        if (errors.code) setErrors((p) => ({ ...p, code: null }));
                      }}
                      placeholder="123 456 or a recovery code"
                      autoCapitalize="none"
                      autoFocus
                      error={errors.code}
                      editable={!loading}
                      returnKeyType="go"
                      onSubmitEditing={submit}
                    />
                  ) : null}
                  <GradientButton title={needCode ? "Verify and unlock" : "Unlock my vault"} icon="arrow" loading={loading} onPress={submit} style={{ marginTop: 6 }} />
                  {loading ? (
                    <Text style={[styles.stage, { color: theme.accentSoft, fontFamily: theme.font.bodyMedium }]}>{STAGES[stage]}</Text>
                  ) : null}
                </Card>
              </Animated.View>
            </FadeIn>

            <FadeIn delay={260} style={{ alignItems: "center", gap: 14, marginTop: 22 }}>
              <Pressable onPress={() => router.replace("/auth/signup")}>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>
                  New here? <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi }}>Create your vault</Text>
                </Text>
              </Pressable>
              <StatusPill style={{ alignSelf: "center" }} />
              <View style={styles.note}>
                <Icon name="lock" size={13} color={theme.textFaint} />
                <Text style={{ color: theme.textFaint, fontSize: 12, fontFamily: theme.font.body }}>
                  Same account as the Aurelia website
                </Text>
              </View>
            </FadeIn>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 22, paddingBottom: 40, gap: 18 },
  title: { fontSize: 34, letterSpacing: -1, marginTop: 8 },
  sub: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  stage: { textAlign: "center", marginTop: 14, fontSize: 13 },
  note: { flexDirection: "row", alignItems: "center", gap: 6 },
});
