import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Heading, Loading, Note, Page, Status } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card, Chip, Field, GhostButton, GradientButton } from "../components/ui";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

const STEPS = [["plan", "Check the plan"], ["create", "Create the new server"], ["live", "Wait until it is live"], ["frontends", "Point the frontends at it"], ["verify", "Check it yourself"], ["relink", "Move the project link"], ["delete", "Delete the old server"]];

/** Moves a Render server to another connected account, one step per button. The old server is deleted last, by typing its name. */
export default function MoveServer() {
  const { theme } = useTheme();
  const toast = useToast();
  const { projectId, ref } = useLocalSearchParams();
  const serviceId = String(ref || "").replace(/^render:/, "");
  const [accounts, setAccounts] = useState(null);
  const [fromAccount, setFromAccount] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [plan, setPlan] = useState(null);
  const [ownerId, setOwnerId] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState("plan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [live, setLive] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [redeployFront, setRedeployFront] = useState(true);
  const [verified, setVerified] = useState(false);
  const [typed, setTyped] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [acc, targets] = await Promise.all([api.renderAccounts(), api.deployTargets(projectId)]);
        const me = (targets.targets || []).find((t) => t.ref === ref);
        setFromAccount(me?.accountId || "");
        setAccounts((acc.accounts || []).filter((a) => a.id !== me?.accountId));
      } catch (e) { setError(e.message); setAccounts([]); }
    })();
  }, [projectId, ref]);

  const run = async (fn) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const doPlan = () => run(async () => {
    const p = await api.movePlan(projectId, { serviceId, targetAccountId, ownerId });
    setPlan(p); setOwnerId(p.target.ownerId); setName(p.source.name);
    setPicked(new Set(p.frontends.map((f) => `${f.serviceId}:${f.key}`)));
  });
  const doCreate = () => run(async () => { setCreated(await api.moveCreate(projectId, { serviceId, targetAccountId, ownerId, name })); setStep("live"); });

  useEffect(() => {
    if (step !== "live" || !created) return undefined;
    const poll = async () => {
      try {
        const s = await api.moveStatus(projectId, created.accountId, created.serviceId);
        setLive(s);
        if (s.ready) setStep((cur) => (cur === "live" ? "frontends" : cur));
        else if (/fail|cancel/.test(s.deploy?.status || "")) setError("The new server’s deploy failed. Check it in Render; the old server is untouched.");
      } catch (e) { setError(e.message); }
    };
    poll();
    timer.current = setInterval(poll, 8000);
    return () => clearInterval(timer.current);
  }, [step, created, projectId]);

  const newUrl = live?.url || created?.url || "";
  const doFrontends = () => run(async () => {
    const targets = plan.frontends.filter((f) => picked.has(`${f.serviceId}:${f.key}`)).map((f) => ({ accountId: f.accountId, serviceId: f.serviceId, key: f.key }));
    if (targets.length) await api.moveFrontends(projectId, { fromUrl: plan.source.url, toUrl: newUrl, targets, deploy: redeployFront });
    setStep("verify");
  });
  const doRelink = () => run(async () => { await api.moveRelink(projectId, { oldServiceId: serviceId, newAccountId: created.accountId, newServiceId: created.serviceId, newName: live?.name || created.name, newUrl }); setStep("delete"); });
  const doDelete = () => Alert.alert("Delete the old server?", `${plan.source.name} will be deleted from ${plan.source.accountName}. This cannot be undone.`, [
    { text: "Keep it", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => run(async () => { await api.moveDeleteOld(projectId, { serviceId, accountId: fromAccount, confirmName: typed }); toast("Moved. The old server is deleted."); setStep("done"); }) }
  ]);

  const order = STEPS.map((s) => s[0]);
  const state = (id) => (step === "done" || order.indexOf(id) < order.indexOf(step) ? "done" : id === step ? "active" : "todo");
  const body = { color: theme.text, fontFamily: theme.font.body, fontSize: 14 };

  return (
    <Page title="Move to another account" subtitle="The new server is built first. The old one is deleted last.">
      <Card style={{ gap: 6 }}>
        {STEPS.map(([id, label]) => <Status key={id} text={label} tone={state(id) === "done" ? "ok" : state(id) === "active" ? "warn" : "mute"} />)}
      </Card>
      {error ? <Note tone="bad">{error}</Note> : null}

      {step === "plan" ? (
        <Card style={{ gap: 10 }}>
          <Heading>Move to this account</Heading>
          {!accounts ? <Loading /> : accounts.length === 0 ? <Note>Connect a second Render account first.</Note> : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{accounts.map((a) => <Chip key={a.id} label={a.name} active={targetAccountId === a.id} onPress={() => { setTargetAccountId(a.id); setPlan(null); }} />)}</View>
          )}
          {!plan ? <GradientButton title={busy ? "Checking…" : "Check the plan"} onPress={doPlan} disabled={busy || !targetAccountId} loading={busy} /> : (
            <>
              <Text style={body}>{plan.source.name} · {plan.source.accountName}{"\n"}{plan.source.url || "no address yet"}{"\n"}{[plan.source.branch, plan.source.plan, plan.source.region].filter(Boolean).join(" · ")}{"\n"}{plan.source.envCount} variables copied · {plan.frontends.length} frontend variable{plan.frontends.length === 1 ? "" : "s"} to update</Text>
              {plan.warnings.map((w) => <Note key={w}>{w}</Note>)}
              {plan.target.owners.length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{plan.target.owners.map((o) => <Chip key={o.id} label={o.name} active={ownerId === o.id} onPress={() => setOwnerId(o.id)} />)}</View> : null}
              <Field label="Name of the new server" value={name} onChangeText={setName} maxLength={60} autoCapitalize="none" />
              <GradientButton title="Continue" onPress={() => setStep("create")} disabled={!ownerId || !name.trim()} />
            </>
          )}
        </Card>
      ) : null}

      {step === "create" ? (
        <Card style={{ gap: 10 }}>
          <Text style={body}>This creates {name} in {plan?.target.accountName} from the same repository and branch, with all {plan?.source.envCount} variables. The old server keeps running.</Text>
          <GradientButton title={busy ? "Creating…" : "Create the new server"} onPress={doCreate} disabled={busy} loading={busy} />
        </Card>
      ) : null}

      {step === "live" ? (
        <Card style={{ gap: 8 }}>
          <Text style={body}>Building {created?.name}… {live?.deploy ? live.deploy.status.replace(/_/g, " ") : "starting"}</Text>
          <Loading />
          <Note>Checks every few seconds and moves on by itself when the server is live.</Note>
        </Card>
      ) : null}

      {step === "frontends" ? (
        <Card style={{ gap: 10 }}>
          <Text onPress={() => newUrl && Linking.openURL(newUrl)} style={{ color: theme.accent, fontFamily: theme.font.body, fontSize: 14 }}>{newUrl || "No address yet"}</Text>
          {plan.frontends.length ? (
            <>
              <Note>These variables still hold the old address. Tap to leave one out.</Note>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {plan.frontends.map((f) => { const k = `${f.serviceId}:${f.key}`; return <Chip key={k} label={`${f.serviceName} · ${f.key}`} active={picked.has(k)} onPress={() => setPicked((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />; })}
              </View>
              <Chip label="Redeploy these frontends" active={redeployFront} onPress={() => setRedeployFront((v) => !v)} />
            </>
          ) : <Note>No other service holds the old address, so there is nothing to change.</Note>}
          <GradientButton title={busy ? "Updating…" : plan.frontends.length ? "Update the frontends" : "Continue"} onPress={doFrontends} disabled={busy || !newUrl} loading={busy} />
        </Card>
      ) : null}

      {step === "verify" ? (
        <Card style={{ gap: 10 }}>
          <Text style={body}>Open the new address and a frontend, and use one feature that calls the server.</Text>
          <GhostButton title="Open the new address" onPress={() => newUrl && Linking.openURL(newUrl)} />
          <Chip label="I checked it and the new server answers" active={verified} onPress={() => setVerified((v) => !v)} />
          <GradientButton title="Continue" onPress={() => setStep("relink")} disabled={!verified} />
        </Card>
      ) : null}

      {step === "relink" ? (
        <Card style={{ gap: 10 }}>
          <Text style={body}>The project will point at {live?.name || created?.name} instead of the old server. Nothing is deleted yet.</Text>
          <GradientButton title={busy ? "Saving…" : "Move the project link"} onPress={doRelink} disabled={busy} loading={busy} />
        </Card>
      ) : null}

      {step === "delete" ? (
        <Card style={{ gap: 10 }}>
          <Text style={body}>The last step. Type {plan?.source.name} to delete it from {plan?.source.accountName}. Its variables are all on the new server.</Text>
          <Field label="Server name" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} />
          <GradientButton title={busy ? "Deleting…" : "Delete the old server"} onPress={doDelete} disabled={busy || typed !== plan?.source.name} loading={busy} />
          <GhostButton title="Keep it for now" onPress={() => router.back()} />
        </Card>
      ) : null}

      {step === "done" ? (
        <Card style={{ gap: 10 }}>
          <Text style={body}>Done. {created?.name} is the project’s server in {plan?.target.accountName}.</Text>
          <GradientButton title="Close" onPress={() => router.back()} />
        </Card>
      ) : null}
    </Page>
  );
}
