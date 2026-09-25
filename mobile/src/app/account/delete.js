import React, { useState } from "react";
import { Text } from "react-native";
import Screen from "../../components/Screen";
import { useToast } from "../../components/Toast";
import { Card, FadeIn, Field, GradientButton } from "../../components/ui";
import { useTheme } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { api } from "../../lib/api";

export default function DeleteAccount() {
  const { theme } = useTheme();
  const { profile, wipeLocal } = useVault();
  const toast = useToast();
  const [form, setForm] = useState({ password: "", code: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    try {
      setBusy(true);
      await api.deleteAccount({ password: form.password, code: form.code || undefined });
      toast("Your account and vault were deleted.");
      await wipeLocal();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Delete account" subtitle="This permanently deletes your account and every item in your vault, on every device. It can't be undone.">
      <FadeIn>
        <Card style={{ gap: 4 }}>
          <Field label="Master password" icon="lock" secure value={form.password} onChangeText={set("password")} autoCapitalize="none" />
          {profile?.twoFactorEnabled ? <Field label="Authenticator code" icon="shieldCheck" value={form.code} onChangeText={set("code")} autoCapitalize="none" /> : null}
          <Field label='Type "DELETE" to confirm' icon="alert" value={form.confirm} onChangeText={set("confirm")} autoCapitalize="characters" />
          <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12, marginBottom: 12 }}>
            Tip: export an encrypted backup first (Settings → Export & import).
          </Text>
          <GradientButton
            title="Delete forever"
            icon="trash"
            colors={[theme.danger, "#9F1239"]}
            loading={busy}
            disabled={form.confirm !== "DELETE" || !form.password}
            onPress={submit}
          />
        </Card>
      </FadeIn>
    </Screen>
  );
}
