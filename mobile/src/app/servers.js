import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Empty, Group, Heading, Line, Loading, Note, Page, Status, ago } from "../components/kit";
import { useToast } from "../components/Toast";
import { GhostButton } from "../components/ui";
import { api } from "../lib/api";
import { useServers } from "../lib/servers";
import { useTheme } from "../lib/theme";

export default function Servers() {
  const { theme } = useTheme();
  const toast = useToast();
  const { data, loading, error, reload } = useServers();
  const [pings, setPings] = useState({});
  const [checking, setChecking] = useState(false);
  useEffect(() => { api.pings().then((r) => setPings(r.results || {})).catch(() => {}); }, []);

  const check = async () => {
    setChecking(true);
    try { const r = await api.runPings(); setPings(r.results || {}); toast("Health check finished"); }
    catch (e) { toast(e.message, "error"); }
    finally { setChecking(false); }
  };

  const services = data?.services || [];
  const active = services.filter((s) => !s.suspended).length;
  return (
    <Page title="Servers" subtitle={data ? `${active} running, ${services.length - active} suspended` : "Your Render services"} onRefresh={reload} refreshing={loading}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {data?.failed ? <Note tone="warn">{data.failed} Render account(s) could not be read just now. Pull down to try again.</Note> : null}
      {!data ? <Loading /> : data.accounts.length === 0 ? (
        <Empty title="No Render account connected">Connect one on the website's Servers page (it needs a Render API key), then it shows up here.</Empty>
      ) : (
        <>
          <GhostButton title={checking ? "Checking…" : "Run health check on all"} disabled={checking} onPress={check} />
          {data.accounts.map((a) => {
            const list = services.filter((s) => s.accountId === a.id);
            return (
              <React.Fragment key={a.id}>
                <Heading>{a.name} · {list.length}</Heading>
                {list.length === 0 ? <Text style={{ color: theme.textMuted, fontSize: 13 }}>No services in this account.</Text> : (
                  <Group>
                    {list.map((s) => {
                      const p = pings[s.key];
                      return (
                        <Line
                          key={s.key}
                          title={s.name}
                          subtitle={[s.type.replace(/_/g, " "), s.plan, s.region, p ? (p.ok ? `answered in ${p.ms} ms ${ago(p.at)}` : `no answer ${ago(p.at)}`) : ""].filter(Boolean).join(" · ")}
                          right={<Status text={s.suspended ? "Suspended" : p && !p.ok ? "Not answering" : "Running"} tone={s.suspended ? "warn" : p && !p.ok ? "bad" : "ok"} />}
                          onPress={() => router.push({ pathname: "/server", params: { account: s.accountId, id: s.id } })}
                        />
                      );
                    })}
                  </Group>
                )}
              </React.Fragment>
            );
          })}
        </>
      )}
    </Page>
  );
}
