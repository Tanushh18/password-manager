import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Empty, Group, Heading, Line, Loading, Note, Page, Status, ago } from "../components/kit";
import { useToast } from "../components/Toast";
import { GhostButton } from "../components/ui";
import { api } from "../lib/api";
import { useServers } from "../lib/servers";
import { useTheme } from "../lib/theme";

/** Raw events -> what is open right now (the newest event per service and kind decides). */
const openIncidents = (events) => {
  const latest = new Map();
  [...events].sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0)).forEach((e) => latest.set(`${e.serviceKey}|${e.type}`, e));
  return [...latest.values()].filter((e) => e.state === "open").sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
};

export default function Monitoring() {
  const { theme } = useTheme();
  const toast = useToast();
  const { data: servers, reload: reloadServers } = useServers();
  const [ops, setOps] = useState(null);
  const [events, setEvents] = useState(null);
  const [pings, setPings] = useState({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [o, i, p] = await Promise.all([api.opsStatus().catch(() => null), api.opsIncidents().catch(() => null), api.pings().catch(() => null)]);
    setOps(o || {}); setEvents(i?.incidents || []); setPings(p?.results || {});
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const names = useMemo(() => new Map((servers?.services || []).map((s) => [s.key, s])), [servers]);
  const open = useMemo(() => openIncidents(events || []), [events]);
  const recent = useMemo(() => [...(events || [])].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0)).slice(0, 15), [events]);
  const pingRows = Object.entries(pings).map(([key, p]) => ({ key, p, s: names.get(key) })).sort((a, b) => Number(a.p.ok) - Number(b.p.ok));
  const tick = ops?.lastTick;

  const run = async () => { setBusy(true); try { const r = await api.runPings(); setPings(r.results || {}); toast("Checked every server"); } catch (e) { toast(e.message, "error"); } finally { setBusy(false); } };
  const resolveAll = async () => { try { await api.opsResolve({ all: true }); await load(); toast("Marked as resolved"); } catch (e) { toast(e.message, "error"); } };

  return (
    <Page title="Monitoring" subtitle="Health checks and incidents for your servers" onRefresh={() => { load(); reloadServers(); }} refreshing={loading}>
      {!ops ? <Loading /> : (
        <>
          <Note tone={ops.schedulerEnabled === false ? "warn" : "ok"}>
            {ops.schedulerEnabled === false ? "Background monitoring is switched off on the server." : `Background checks run about every ${ops.schedulerIntervalMinutes || 5} minutes.`}
            {tick?.completedAt ? ` Last run ${ago(tick.completedAt)}.` : " No run recorded yet."}
          </Note>

          <Heading action={open.length ? <Text onPress={resolveAll} style={{ color: theme.accent, fontFamily: theme.font.bodySemi, fontSize: 13 }}>Resolve all</Text> : null}>Open incidents · {open.length}</Heading>
          {open.length === 0 ? <Empty title="Nothing is wrong">No open incidents right now.</Empty> : (
            <Group>{open.map((e) => <Line key={e.id} title={e.serviceName || "Service"} subtitle={`${e.message || e.type} · ${ago(e.at)}`} right={<Status text={e.severity || "warning"} tone={e.severity === "critical" ? "bad" : "warn"} />} onPress={() => { const s = names.get(e.serviceKey); if (s) router.push({ pathname: "/server", params: { account: s.accountId, id: s.id } }); }} />)}</Group>
          )}

          <Heading action={<Text onPress={busy ? undefined : run} style={{ color: theme.accent, fontFamily: theme.font.bodySemi, fontSize: 13 }}>{busy ? "Checking…" : "Check now"}</Text>}>Health checks</Heading>
          {pingRows.length === 0 ? <Text style={{ color: theme.textMuted, fontSize: 13 }}>No results yet. Tap Check now.</Text> : (
            <Group>{pingRows.map(({ key, p, s }) => <Line key={key} title={s?.name || key.split(":")[1]} subtitle={`${p.ok ? `${p.ms} ms` : p.error || `HTTP ${p.status || "–"}`} · ${ago(p.at)}`} right={<Status text={p.ok ? "Answering" : "Not answering"} tone={p.ok ? "ok" : "bad"} />} />)}</Group>
          )}

          {recent.length ? (
            <>
              <Heading>History</Heading>
              <Group>{recent.map((e) => <Line key={e.id} title={e.serviceName || "Service"} subtitle={`${e.message || e.type} · ${ago(e.at)}`} right={<Status text={e.state} tone={e.state === "open" ? "bad" : "ok"} />} />)}</Group>
            </>
          ) : null}
          <GhostButton title="Open the Servers list" onPress={() => router.push("/servers")} />
        </>
      )}
    </Page>
  );
}
