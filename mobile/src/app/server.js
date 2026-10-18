import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Empty, Group, Heading, Line, Loading, Note, Page, Status, ago } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card, GhostButton, GradientButton } from "../components/ui";
import { api } from "../lib/api";
import { unwrap, useServers } from "../lib/servers";
import { useTheme } from "../lib/theme";

const DEPLOY_TONE = { live: "ok", build_in_progress: "warn", update_in_progress: "warn", created: "warn", queued: "warn", build_failed: "bad", update_failed: "bad", pre_deploy_failed: "bad", canceled: "mute", deactivated: "mute" };

export default function Server() {
  const { theme } = useTheme();
  const toast = useToast();
  const { account, id } = useLocalSearchParams();
  const { data, reload: reloadList } = useServers();
  const service = data?.services.find((s) => s.accountId === account && s.id === id);
  const [deploys, setDeploys] = useState(null);
  const [env, setEnv] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, e] = await Promise.all([api.renderDeploys(account, id).catch(() => null), api.renderEnvVars(account, id).catch(() => null)]);
    setDeploys(d ? unwrap(d, "deploy") : []);
    setEnv(e ? unwrap(e.envVars, "envVar") : []);
    setLoading(false);
  }, [account, id]);
  useEffect(() => { load(); }, [load]);

  const confirm = (title, message, label, fn, destructive) => Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: label, style: destructive ? "destructive" : "default", onPress: async () => { setBusy(label); try { await fn(); toast(`${label} requested`); await Promise.all([load(), reloadList()]); } catch (e) { toast(e.message, "error"); } finally { setBusy(""); } } },
  ]);
  const checkHealth = async () => { setBusy("health"); try { setHealth(await api.renderHealth(account, id)); } catch (e) { toast(e.message, "error"); } finally { setBusy(""); } };

  if (!data) return <Page title="Server"><Loading /></Page>;
  if (!service) return <Page title="Server"><Empty title="Not found">This service is no longer in the connected account.</Empty></Page>;

  return (
    <Page title={service.name} subtitle={`${service.accountName} · ${service.type.replace(/_/g, " ")}`} onRefresh={load} refreshing={loading}>
      <Card style={{ gap: 10 }}>
        <Status text={service.suspended ? "Suspended" : "Running"} tone={service.suspended ? "warn" : "ok"} />
        {service.url ? <Text onPress={() => Linking.openURL(service.url)} style={{ color: theme.accent, fontFamily: theme.font.body, fontSize: 14 }}>{service.url.replace(/^https?:\/\//, "")}</Text> : null}
        <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{[service.plan, service.region, service.repo && service.repo.replace("https://github.com/", ""), service.branch].filter(Boolean).join(" · ")}</Text>
        {health ? <Note tone={health.state === "healthy" ? "ok" : "bad"}>{health.message}{health.latencyMs ? ` (${health.latencyMs} ms)` : ""}</Note> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <GhostButton small title={busy === "health" ? "Checking…" : "Check health"} onPress={checkHealth} disabled={service.suspended} />
          {service.dashboardUrl ? <GhostButton small title="Open in Render" onPress={() => Linking.openURL(service.dashboardUrl)} /> : null}
        </View>
      </Card>

      <Heading>Actions</Heading>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {!service.suspended ? <GradientButton small title="Deploy latest" loading={busy === "Deploy"} onPress={() => confirm(`Deploy ${service.name}?`, "Builds and deploys the latest commit.", "Deploy", () => api.renderDeploy(account, id))} /> : null}
        {!service.suspended ? <GhostButton small title="Restart" onPress={() => confirm(`Restart ${service.name}?`, "The service is briefly unavailable.", "Restart", () => api.renderRestart(account, id))} /> : null}
        {service.suspended ? <GradientButton small title="Resume" onPress={() => confirm(`Resume ${service.name}?`, "Starts the service again.", "Resume", () => api.renderResume(account, id))} /> : <GhostButton small title="Suspend" color={theme.danger} onPress={() => confirm(`Suspend ${service.name}?`, "The service goes offline until you resume it.", "Suspend", () => api.renderSuspend(account, id), true)} />}
      </View>

      <Heading>Recent deploys</Heading>
      {!deploys ? <Loading /> : deploys.length === 0 ? <Text style={{ color: theme.textMuted, fontSize: 13 }}>No deploys found.</Text> : (
        <Group>{deploys.slice(0, 8).map((d) => <Line key={d.id} title={(d.commit?.message || "Deploy").split("\n")[0]} subtitle={`${(d.commit?.id || "").slice(0, 7)} ${ago(d.finishedAt || d.createdAt)}`.trim()} right={<Status text={String(d.status || "").replace(/_/g, " ")} tone={DEPLOY_TONE[d.status] || "mute"} />} />)}</Group>
      )}

      <Heading>Environment variables · {env ? env.length : "…"}</Heading>
      {!env ? <Loading /> : env.length === 0 ? <Text style={{ color: theme.textMuted, fontSize: 13 }}>No variables set on this service.</Text> : (
        <Card style={{ gap: 6 }}>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>Names only. Values stay hidden on the phone.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{env.map((v) => <Text key={v.key} style={{ color: theme.text, fontFamily: theme.font.mono, fontSize: 12, backgroundColor: theme.surfaceRaised, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>{v.key}</Text>)}</View>
        </Card>
      )}
    </Page>
  );
}
