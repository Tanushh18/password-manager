import React, { useState } from "react";
import { Linking, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Screen from "../../components/Screen";
import Icon from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { Card, FadeIn, Field, GhostButton, GradientButton } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { api } from "../../lib/api";

function RecoveryCodes({ codes, onDone }) {
  const { theme } = useTheme();
  const text = codes.join("\n");
  return (
    <Card glow style={{ gap: 14 }}>
      <Text style={{ color: theme.ok, fontFamily: theme.font.bodySemi }}>✓ Save these one-time recovery codes somewhere safe.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {codes.map((c) => (
          <Text key={c} style={{ width: "48%", textAlign: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: alpha(theme.accent, 0.12), color: theme.heading, fontFamily: theme.font.mono, fontSize: 14, letterSpacing: 1 }}>
            {c}
          </Text>
        ))}
      </View>
      <GhostButton title="Share / save" icon="download" small onPress={() => Share.share({ message: `Aurelia recovery codes\n\n${text}` })} />
      <GradientButton title="I've saved them" icon="check" onPress={onDone} />
    </Card>
  );
}

export default function TwoFactor() {
  const { theme } = useTheme();
  const { profile, refreshProfile, withoutAutoLock } = useVault();
  const toast = useToast();
  const enabled = profile?.twoFactorEnabled;
  const [step, setStep] = useState("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    try {
      setBusy(true);
      await fn();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSetup(null);
  };

  return (
    <Screen title="Two-factor login" subtitle="Even if someone learns your master password, they can't sign in without your authenticator.">
      {step === "codes" ? (
        <RecoveryCodes codes={codes} onDone={() => { reset(); refreshProfile(); }} />
      ) : enabled ? (
        <FadeIn>
          <Card style={{ gap: 14 }}>
            <Text style={{ color: theme.ok, fontFamily: theme.font.bodySemi, fontSize: 15 }}>
              ✓ On · {profile.recoveryCodesLeft} recovery code{profile.recoveryCodesLeft === 1 ? "" : "s"} left
            </Text>
            {step === "disable" || step === "regen" ? (
              <>
                <Field label="Master password" icon="lock" secure value={password} onChangeText={setPassword} autoCapitalize="none" />
                <Field label="Authenticator or recovery code" icon="shieldCheck" value={code} onChangeText={setCode} autoCapitalize="none" />
                <GradientButton
                  title={step === "disable" ? "Turn off two-factor" : "New recovery codes"}
                  loading={busy}
                  colors={step === "disable" ? [theme.danger, theme.danger] : undefined}
                  onPress={() =>
                    run(async () => {
                      if (step === "disable") {
                        await api.twoFactorDisable({ password, code });
                        toast("Two-factor login is off", "info");
                        reset();
                        refreshProfile();
                      } else {
                        const res = await api.twoFactorRecoveryCodes({ password, code });
                        setCodes(res.recoveryCodes);
                        setStep("codes");
                      }
                    })
                  }
                />
                <GhostButton title="Cancel" small onPress={reset} />
              </>
            ) : (
              <>
                <GhostButton title="New recovery codes" icon="refresh" small onPress={() => setStep("regen")} />
                <GhostButton title="Turn off" icon="close" small color={theme.danger} onPress={() => setStep("disable")} />
              </>
            )}
          </Card>
        </FadeIn>
      ) : step === "idle" || step === "password" ? (
        <FadeIn>
          <Card style={{ gap: 12 }}>
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, lineHeight: 21 }}>
              Works with Google Authenticator, Aegis, Authy, 1Password and others.
            </Text>
            <Field label="Confirm master password" icon="lock" secure value={password} onChangeText={setPassword} autoCapitalize="none" />
            <GradientButton
              title="Continue"
              icon="shieldCheck"
              loading={busy}
              disabled={!password}
              onPress={() =>
                run(async () => {
                  setSetup(await api.twoFactorSetup(password));
                  setStep("scan");
                })
              }
            />
          </Card>
        </FadeIn>
      ) : (
        <FadeIn>
          <Card glow style={{ gap: 14 }}>
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi }}>1. Add Aurelia to your authenticator</Text>
            <GradientButton
              title="Open authenticator app"
              icon="phone"
              small
              onPress={() => withoutAutoLock(() => Linking.openURL(setup.otpauthUrl)).catch(() => toast("No authenticator app found — copy the key instead.", "error"))}
            />
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>…or enter this setup key manually:</Text>
            <Text selectable style={{ color: theme.heading, fontFamily: theme.font.mono, fontSize: 16, letterSpacing: 1, padding: 12, borderRadius: 12, backgroundColor: alpha(theme.accent, 0.12) }}>
              {setup?.secret?.match(/.{1,4}/g)?.join(" ")}
            </Text>
            <GhostButton title="Copy key" icon="copy" small onPress={() => Clipboard.setStringAsync(setup.secret).then(() => toast("Key copied", "info"))} />
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi }}>2. Enter the 6-digit code it shows</Text>
            <Field label="Code" icon="shieldCheck" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={7} />
            <GradientButton
              title="Verify and turn on"
              icon="check"
              loading={busy}
              disabled={code.replace(/\s/g, "").length !== 6}
              onPress={() =>
                run(async () => {
                  const res = await api.twoFactorEnable(code);
                  setCodes(res.recoveryCodes);
                  setStep("codes");
                  toast("Two-factor login is on 🔐");
                })
              }
            />
            <GhostButton title="Cancel" small onPress={reset} />
          </Card>
        </FadeIn>
      )}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 4 }}>
        <Icon name="alert" size={14} color={theme.textFaint} />
        <Text style={{ flex: 1, color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12 }}>
          Two-factor protects your account sign-in. Your vault is still encrypted with your master password.
        </Text>
      </View>
    </Screen>
  );
}
