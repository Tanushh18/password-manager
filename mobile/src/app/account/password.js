import React, { useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import Screen from "../../components/Screen";
import { useToast } from "../../components/Toast";
import { Card, FadeIn, Field, GradientButton, StrengthMeter } from "../../components/ui";
import { useTheme } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { estimate } from "../../lib/strength";

export default function ChangePassword() {
  const { theme } = useTheme();
  const { changeMasterPassword, profile, items } = useVault();
  const toast = useToast();
  const [form, setForm] = useState({ current: "", next: "", confirm: "", code: "" });
  const [busy, setBusy] = useState(false);
  const strength = useMemo(() => estimate(form.next), [form.next]);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (form.next.length < 8) return toast("Use at least 8 characters.", "error");
    if (strength.score < 2) return toast("Choose a stronger master password.", "error");
    if (form.next !== form.confirm) return toast("The new passwords don't match.", "error");
    try {
      setBusy(true);
      await changeMasterPassword(form);
      toast("Master password changed. Other devices were signed out.");
      router.back();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Master password" subtitle={`All ${items.length} items are re-encrypted with a new key on this phone, then saved in one step.`}>
      <FadeIn>
        <Card style={{ gap: 4 }}>
          <Field label="Current master password" icon="lock" secure value={form.current} onChangeText={set("current")} autoCapitalize="none" />
          <Field label="New master password" icon="key" secure value={form.next} onChangeText={set("next")} autoCapitalize="none" />
          {form.next ? <StrengthMeter strength={strength} /> : null}
          <Field label="Confirm new master password" icon="shieldCheck" secure value={form.confirm} onChangeText={set("confirm")} autoCapitalize="none" />
          {profile?.twoFactorEnabled ? <Field label="Authenticator code" icon="shieldCheck" value={form.code} onChangeText={set("code")} autoCapitalize="none" /> : null}
          <Text style={{ color: theme.warn, fontFamily: theme.font.body, fontSize: 12, marginBottom: 12 }}>
            There's no way to recover a forgotten master password. Keep an encrypted backup somewhere safe.
          </Text>
          <GradientButton title={busy ? "Re-encrypting…" : "Change master password"} icon="key" loading={busy} disabled={!form.current || !form.next} onPress={submit} />
        </Card>
      </FadeIn>
    </Screen>
  );
}
