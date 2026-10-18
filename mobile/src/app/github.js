import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Text, TextInput } from "react-native";
import { Empty, Group, Heading, Line, Loading, Note, Page, Status, ago } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card, GhostButton, GradientButton } from "../components/ui";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

export default function GitHub() {
  const { theme } = useTheme();
  const toast = useToast();
  const [accounts, setAccounts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAccounts((await api.githubAccounts()).accounts || []); } catch (e) { toast(e.message, "error"); setAccounts([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setAdding(true);
    try { await api.githubConnect(token.trim()); setToken(""); await load(); toast("GitHub connected"); }
    catch (e) { toast(e.message, "error"); }
    finally { setAdding(false); }
  };
  const remove = (a) => Alert.alert(`Disconnect ${a.login}?`, "Projects linked to its repositories stop reading from GitHub. Nothing on GitHub changes.", [
    { text: "Cancel", style: "cancel" },
    { text: "Disconnect", style: "destructive", onPress: async () => { try { await api.githubDisconnect(a.id); await load(); } catch (e) { toast(e.message, "error"); } } },
  ]);

  return (
    <Page title="GitHub" subtitle="Accounts used to read your repositories" onRefresh={load} refreshing={loading}>
      {!accounts ? <Loading /> : accounts.length === 0 ? <Empty title="No GitHub account yet">Add a personal access token below. It is stored encrypted and never shown again.</Empty> : (
        <Group>
          {accounts.map((a) => (
            <Line key={a.id} title={a.login} subtitle={[a.valid ? (a.write ? "Can write" : "Read only") : "Token no longer works", a.workflow ? "Workflows" : "", a.connectedAt ? `connected ${ago(a.connectedAt)}` : ""].filter(Boolean).join(" · ")} right={<Status text={a.valid ? "Connected" : "Expired"} tone={a.valid ? "ok" : "bad"} />} onPress={() => remove(a)} />
          ))}
        </Group>
      )}
      {accounts?.some((a) => a.risky) ? <Note tone="warn">One of these tokens has more access than Stashr needs. Replace it with a fine-grained, read-only token when you can.</Note> : null}
      {accounts?.length ? <Text style={{ color: theme.textFaint, fontSize: 12 }}>Tap an account to disconnect it.</Text> : null}

      <Heading>Add an account</Heading>
      <Card style={{ gap: 10 }}>
        <TextInput value={token} onChangeText={setToken} placeholder="Personal access token" placeholderTextColor={theme.textFaint} secureTextEntry autoCapitalize="none" autoCorrect={false} style={{ color: theme.text, borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 10, paddingHorizontal: 12, height: 44, fontFamily: theme.font.body }} />
        <GradientButton title="Connect" small loading={adding} disabled={token.trim().length < 20} onPress={connect} />
        <Text onPress={() => Linking.openURL("https://github.com/settings/personal-access-tokens/new")} style={{ color: theme.accent, fontFamily: theme.font.body, fontSize: 13 }}>Create a token on GitHub</Text>
      </Card>
    </Page>
  );
}
