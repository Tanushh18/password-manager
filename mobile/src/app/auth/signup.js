import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Aurora from "../../components/Aurora";
import { useToast } from "../../components/Toast";
import { Card, FadeIn, Field, GradientButton, GradientText, IconButton, StrengthMeter } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import Icon from "../../components/Icon";
import { useVault } from "../../lib/vault";
import { estimate } from "../../lib/strength";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  const { theme } = useTheme();
  const { register, login } = useVault();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", cpassword: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [agree, setAgree] = useState(false);
  const strength = useMemo(() => estimate(form.password), [form.password]);

  const set = (k) => (v) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: null }));
  };

  const submit = async () => {
    const found = {};
    if (form.name.trim().length < 2) found.name = "Tell us your name";
    if (!EMAIL_RE.test(form.email.trim())) found.email = "That email doesn't look right";
    if (form.password.length < 8) found.password = "At least 8 characters";
    else if (strength.score < 2) found.password = "Make it a little stronger — try a short phrase";
    if (!agree) found.agree = true;
    if (form.password !== form.cpassword) found.cpassword = "Passwords don't match";
    setErrors(found);
    if (Object.keys(found).length) return;

    try {
      setLoading(true);
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      toast("Vault created — signing you in…");
      await login(form.email, form.password);
    } catch (e) {
      toast(e.message || "We couldn't create your vault.", "error");
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
                Create your <GradientText>vault.</GradientText>
              </Text>
              <Text style={[styles.sub, { color: theme.textMuted, fontFamily: theme.font.body }]}>
                One master password encrypts everything on your phone. Choose it well.
              </Text>
            </FadeIn>

            <FadeIn delay={160}>
              <Card glow style={{ padding: 20 }}>
                <Field label="Name" icon="user" value={form.name} onChangeText={set("name")} placeholder="Your name" autoComplete="name" error={errors.name} />
                <Field
                  label="Email"
                  icon="mail"
                  value={form.email}
                  onChangeText={set("email")}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  error={errors.email}
                />
                <Field
                  label="Master password"
                  icon="lock"
                  secure
                  value={form.password}
                  onChangeText={set("password")}
                  placeholder="Make it memorable and strong"
                  autoCapitalize="none"
                  error={errors.password}
                />
                {form.password ? <StrengthMeter strength={strength} /> : null}
                <Field
                  label="Confirm password"
                  icon="shieldCheck"
                  secure
                  value={form.cpassword}
                  onChangeText={set("cpassword")}
                  placeholder="Type it once more"
                  autoCapitalize="none"
                  error={errors.cpassword}
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
                <Pressable
                  onPress={() => setAgree((v) => !v)}
                  style={[styles.consent, { borderColor: errors.agree ? theme.danger : theme.line, backgroundColor: alpha(theme.warn, 0.08) }]}
                >
                  <Icon name="alert" size={16} color={theme.warn} />
                  <Text style={{ flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 }}>
                    I understand Aurelia <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi }}>can't reset or recover</Text> my master password.
                  </Text>
                  <Switch value={agree} onValueChange={setAgree} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }} thumbColor="#fff" />
                </Pressable>
                <GradientButton title="Create my vault" icon="sparkle" loading={loading} onPress={submit} style={{ marginTop: 6 }} />
              </Card>
            </FadeIn>

            <Pressable onPress={() => router.replace("/auth/login")} style={{ alignItems: "center", marginTop: 8 }}>
              <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>
                Already have one? <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi }}>Sign in</Text>
              </Text>
            </Pressable>
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
  consent: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
});
