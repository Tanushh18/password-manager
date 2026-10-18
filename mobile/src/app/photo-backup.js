import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Switch, Text, View } from "react-native";
import * as Sharing from "expo-sharing";
import { Empty, Group, Heading, Line, Loading, Note, Page, Status, ago, gb } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card, Chip, GhostButton, GradientButton } from "../components/ui";
import { api } from "../lib/api";
import { setBackgroundBackup } from "../lib/photoBackground";
import { usePhotoData } from "../lib/photoData";
import { QUALITIES, counts, deviceFolders, getState, loadState, permission, processQueue, retry, retryAllFailed, scan, setSettings, skip, subscribe } from "../lib/photoSync";
import { alpha, useTheme } from "../lib/theme";

const mask = (email = "") => email.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
const TONE = { done: "ok", queued: "mute", uploading: "warn", verifying: "warn", failed: "bad", skipped: "mute", completed: "ok", blocked: "bad", cancelled: "mute" };
const QUALITY_LABEL = { original: "Original", high: "High", balanced: "Balanced", small: "Small" };
const QUALITY_HINT = { original: "Upload exactly what the camera saved.", high: "Longest side 3072 px. Looks identical on a phone.", balanced: "Longest side 2048 px. Much smaller, still sharp on screen.", small: "Longest side 1280 px. Smallest and fastest." };
const RANGES = [["From now on", "now"], ["Last 30 days", 30], ["Last year", 365], ["Everything", 0]];

const useSync = () => {
  const [s, setS] = useState(getState());
  useEffect(() => { loadState().then(setS); return subscribe((n) => setS({ ...n })); }, []);
  return s;
};

export default function PhotoBackup() {
  const { theme } = useTheme();
  const toast = useToast();
  const { data, loading, reload } = usePhotoData();
  const sync = useSync();
  const [busy, setBusy] = useState("");
  const [shares, setShares] = useState([]);
  const [devFolders, setDevFolders] = useState(null);
  const [workers, setWorkers] = useState(null);
  const [importing, setImporting] = useState(false);
  const c = counts(sync);
  const settings = data?.settings || {};
  const accounts = data?.connections || [];

  const loadShares = useCallback(() => api.photoShares().then((r) => setShares(r.shares || [])).catch(() => {}), []);
  useEffect(() => { loadShares(); api.photoWorkers().then(setWorkers).catch(() => {}); }, [loadShares]);

  const chooseFolders = async () => {
    try { if (await permission(true)) setDevFolders(await deviceFolders()); else toast("Allow photo access to see this phone's folders.", "error"); }
    catch (e) { toast("Could not read the phone's folders.", "error"); }
  };
  const toggleFolder = (id) => setSettings({ folders: sync.folders.includes(id) ? sync.folders.filter((x) => x !== id) : [...sync.folders, id] });
  const importOld = async () => {
    setImporting(true);
    try { const r = await api.photoImportExisting(); await reload(); toast(`${r.found} photo${r.found === 1 ? "" : "s"} and videos found in Drive, ${r.added} new`); }
    catch (e) { toast(e.message, "error"); }
    finally { setImporting(false); }
  };

  const savePolicy = (patch) => {
    const next = { ...settings, ...patch };
    setSettings({ wifiOnly: next.wifiOnly, chargingOnly: next.chargingOnly });
    api.photoPolicy(next).then(reload).catch((e) => toast(e.message, "error"));
  };

  const run = async () => {
    setBusy("run");
    try {
      await scan();
      const r = await processQueue();
      await reload();
      toast(r.waiting ? r.waiting : `${r.done} uploaded${r.failed ? `, ${r.failed} failed` : ""}`, r.failed ? "error" : "ok");
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(""); }
  };

  const enable = async (range) => {
    if (!accounts.some((a) => a.status === "connected")) return toast("Connect a Google account first.", "info");
    if (!(await permission(true))) return toast("Allow photo access in Android settings to back up this phone.", "error");
    const since = range === "now" ? Date.now() : range === 0 ? 0 : Date.now() - range * 86400000;
    await setSettings({ enabled: true, since, wifiOnly: settings.wifiOnly !== false, chargingOnly: Boolean(settings.chargingOnly) });
    try { await setBackgroundBackup(true); } catch (e) { /* foreground backup still works */ }
    const n = await scan();
    toast(n ? `${n} item${n === 1 ? "" : "s"} queued` : "Backup is on. New photos are picked up automatically.");
    run();
  };
  const disable = async () => {
    await setSettings({ enabled: false });
    try { await setBackgroundBackup(false); } catch (e) { /* ignore */ }
    toast("Backup is off. Nothing already uploaded was changed.", "info");
  };

  const connect = async () => {
    try { const r = await api.photoGoogleStart("Google account"); await Linking.openURL(r.url); }
    catch (e) { toast(e.message || "Google sign-in is not set up on the server yet.", "error"); }
  };
  const act = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); await reload(); if (ok) toast(ok); } catch (e) { toast(e.message, "error"); } finally { setBusy(""); }
  };
  const disconnect = (a) => Alert.alert(`Disconnect ${a.label}?`, "Files in Google Drive are not deleted. Their photos here will show as unavailable until you reconnect.", [
    { text: "Cancel", style: "cancel" },
    { text: "Disconnect", style: "destructive", onPress: () => act("d" + a.id, () => api.photoDisconnect(a.id), "Account disconnected") },
  ]);
  const exportManifest = async () => {
    try {
      const manifest = await api.photoExport();
      const { File, Paths } = require("expo-file-system");
      const f = new File(Paths.cache, `stashr-photo-manifest-${new Date().toISOString().slice(0, 10)}.json`);
      if (f.exists) f.delete();
      f.create();
      f.write(JSON.stringify(manifest, null, 2));
      await Sharing.shareAsync(f.uri, { mimeType: "application/json" });
    } catch (e) { toast(e.message || "Could not export.", "error"); }
  };

  const items = Object.entries(sync.items).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 25);
  const jobs = (data?.jobs || []).slice(0, 15);
  const switchProps = { trackColor: { false: alpha(theme.accent, 0.2), true: theme.accent }, thumbColor: "#fff" };
  const small = { fontFamily: theme.font.body, fontSize: 13 };

  return (
    <Page title="Backup and storage" subtitle="Where photos are stored and how this phone uploads" onRefresh={reload} refreshing={loading}>
      <Heading>Storage across all accounts</Heading>
      {!data ? <Loading /> : (
        <Card style={{ gap: 8 }}>
          {data.totals?.accounts ? (
            <>
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 22 }}>{gb(data.totals.usedGb)} <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 15 }}>of {gb(data.totals.limitGb)}</Text></Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.line }}><View style={{ width: `${data.totals.limitGb ? Math.min(100, (data.totals.usedGb / data.totals.limitGb) * 100) : 0}%`, height: 6, borderRadius: 3, backgroundColor: theme.accent }} /></View>
              <Text style={{ color: theme.textMuted, ...small }}>{gb(data.totals.freeGb)} free in {data.totals.accounts} account{data.totals.accounts === 1 ? "" : "s"}{data.totals.unknownLimit ? ` (${data.totals.unknownLimit} did not report its limit)` : ""}. Google counts Drive, Photos and Gmail together, so this is each account's whole quota.</Text>
            </>
          ) : <Text style={{ color: theme.textMuted, ...small }}>No account connected yet.</Text>}
          {data.suggestion ? <Note tone={data.suggestion.none ? "warn" : "ok"}>{data.suggestion.none ? data.suggestion.reason : `Next uploads: ${data.suggestion.label}. ${data.suggestion.reason}`}</Note> : null}
          {data.suggestion && !data.suggestion.none && data.suggestion.accountId !== settings.defaultConnectionId ? <GhostButton small title={`Use ${data.suggestion.label} as default`} onPress={() => savePolicy({ defaultConnectionId: data.suggestion.accountId })} /> : null}
          {workers?.enabled ? <Text style={{ color: theme.textMuted, ...small }}>Processing servers: {workers.workers.filter((w) => w.online).length} of {workers.workers.length} online</Text> : null}
        </Card>
      )}

      <Heading>Upload size</Heading>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{Object.keys(QUALITIES).map((q) => <Chip key={q} label={QUALITY_LABEL[q]} active={sync.quality === q} onPress={() => setSettings({ quality: q })} />)}</View>
        <Text style={{ color: theme.textMuted, ...small }}>{QUALITY_HINT[sync.quality] || QUALITY_HINT.balanced} Videos are always sent as they are.</Text>
        {sync.savedBytes > 0 ? <Text style={{ color: theme.text, ...small }}>Saved {(sync.savedBytes / 1048576).toFixed(0)} MB of uploads so far.</Text> : null}
        {sync.quality !== "original" ? <Note>The copy in Drive is the reduced one; the original stays on this phone.</Note> : null}
      </Card>

      <Heading>This phone</Heading>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>Back up camera roll</Text>
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, marginTop: 2 }}>{sync.enabled ? "On. Android runs it in the background when conditions allow." : "Off"}</Text>
          </View>
          {sync.enabled ? <Switch value onValueChange={disable} {...switchProps} /> : null}
        </View>
        {!sync.enabled ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.textMuted, ...small }}>Which photos should be uploaded?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{RANGES.map(([label, v]) => <GhostButton key={label} small title={label} onPress={() => enable(v)} />)}</View>
          </View>
        ) : (
          <>
            <Line title="Wi-Fi only" right={<Switch value={settings.wifiOnly !== false} onValueChange={(v) => savePolicy({ wifiOnly: v })} {...switchProps} />} />
            <Line title="Only while charging" right={<Switch value={Boolean(settings.chargingOnly)} onValueChange={(v) => savePolicy({ chargingOnly: v })} {...switchProps} />} last />
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 14 }}>Folders to back up</Text>
              <Text style={{ color: theme.textMuted, ...small }}>{sync.folders.length ? `${sync.folders.length} chosen.` : "All folders."} Each one becomes a folder in Drive with the same name.</Text>
              {devFolders ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{devFolders.map((f) => <Chip key={f.id} label={f.title} count={f.count} active={sync.folders.includes(f.id)} onPress={() => toggleFolder(f.id)} />)}</View> : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <GhostButton small title={devFolders ? "Refresh list" : "Choose folders"} onPress={chooseFolders} />
                {sync.folders.length ? <GhostButton small title="Back up all" onPress={() => setSettings({ folders: [] })} /> : null}
              </View>
            </View>
            <Text style={{ color: theme.text, ...small }}>{c.done} uploaded · {c.queued + c.uploading} waiting · {c.failed} failed</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <GradientButton title="Upload now" small loading={busy === "run"} onPress={run} style={{ flex: 1 }} />
              {c.failed ? <GhostButton small title="Retry failed" onPress={() => { retryAllFailed(); run(); }} /> : null}
            </View>
          </>
        )}
        <Note>Originals stay on this phone; Stashr never deletes local photos. Each upload is checked against its size and checksum before it counts as done.</Note>
      </Card>

      {items.length ? (
        <>
          <Heading>Recent uploads</Heading>
          <Group>
            {items.map(([id, it]) => (
              <Line
                key={id}
                title={it.filename}
                subtitle={it.error || (it.destination ? `To ${it.destination}` : it.status)}
                right={(
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Status text={it.status} tone={TONE[it.status]} />
                    {it.status === "failed" ? <Text onPress={() => { retry(id); run(); }} style={{ color: theme.accent, fontSize: 12, fontFamily: theme.font.bodySemi }}>Retry</Text> : null}
                    {it.status === "queued" || it.status === "failed" ? <Text onPress={() => skip(id)} style={{ color: theme.textMuted, fontSize: 12 }}>Skip</Text> : null}
                  </View>
                )}
              />
            ))}
          </Group>
        </>
      ) : null}

      <Heading action={<Text onPress={connect} style={{ color: theme.accent, fontFamily: theme.font.bodySemi, fontSize: 13 }}>Add account</Text>}>Google accounts</Heading>
      {!data ? <Loading /> : accounts.length === 0 ? <Empty title="No accounts connected">Connect a Google account to store and see your photos.</Empty> : accounts.map((a) => {
        const pct = a.limitGb ? Math.min(100, (Number(a.usedGb || 0) / a.limitGb) * 100) : 0;
        const ok = a.status === "connected";
        return (
          <Card key={a.id} style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>{a.label}</Text>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>{mask(a.email)}</Text>
              </View>
              <Status text={a.status === "reauthorize" ? "Reconnect needed" : a.status} tone={ok ? "ok" : "bad"} />
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.line }}><View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: pct > 90 ? theme.danger : theme.accent }} /></View>
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>{gb(a.usedGb)} used of {a.limitGb ? gb(a.limitGb) : "an unknown amount"}{a.lastScan ? ` · scanned ${ago(a.lastScan)}` : " · not scanned yet"}</Text>
            {a.lastError ? <Note tone="warn">{a.lastError}</Note> : null}
            {a.oauthMode === "connected" ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {ok ? <GhostButton small title={busy === "s" + a.id ? "Scanning…" : "Rescan"} onPress={() => act("s" + a.id, () => api.photoSync(a.id), "Index refreshed")} /> : <GhostButton small title="Reconnect" onPress={connect} />}
                {ok ? <GhostButton small title={a.eligible ? "Pause uploads" : "Allow uploads"} onPress={() => act("e" + a.id, () => api.photoUpdateAccount(a.id, { eligible: !a.eligible }))} /> : null}
                {ok && settings.defaultConnectionId !== a.id ? <GhostButton small title="Make default" onPress={() => savePolicy({ defaultConnectionId: a.id })} /> : null}
                {ok && settings.defaultConnectionId === a.id ? <Status text="Default for new uploads" tone="ok" /> : null}
                {ok ? <GhostButton small title="Disconnect" color={theme.danger} onPress={() => disconnect(a)} /> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      {accounts.length > 0 ? <Note>New uploads go to the default account first, then the others by priority, keeping {settings.safetyBufferGb ?? 2} GB free in each. Photos that are already stored never move on their own.</Note> : null}

      {(data?.duplicateGroups || []).length ? <Note tone="warn">{data.duplicateGroups.length} group{data.duplicateGroups.length === 1 ? "" : "s"} of identical files found (same checksum). Nothing is deleted automatically.</Note> : null}

      {jobs.length ? (
        <>
          <Heading>Backup history</Heading>
          <Group>{jobs.map((j) => <Line key={j.id} title={j.filename} subtitle={[j.destinationLabel && `To ${j.destinationLabel}`, j.error, ago(j.updatedAt || j.createdAt)].filter(Boolean).join(" · ")} right={<Status text={j.status} tone={TONE[j.status]} />} />)}</Group>
        </>
      ) : null}

      <Heading>Bring old photos</Heading>
      <Card style={{ gap: 10 }}>
        <Text style={{ color: theme.text, ...small }}>Photos and videos already in your connected Google Drive accounts can be listed here to view. Nothing is copied or changed.</Text>
        <GradientButton title="Scan my Drive for existing photos" small loading={importing} onPress={importOld} />
        <Note>Google no longer lets any app read a Google Photos library directly. To see old Google Photos pictures here, put them in Drive first: in the Google Photos app select them, tap Share, then Save to Drive. For a whole library, export it at takeout.google.com, unzip it on a computer, and upload the folders to Drive. Then scan again.</Note>
      </Card>

      <Heading>Share links</Heading>
      {shares.length === 0 ? <Text style={{ color: theme.textMuted, ...small }}>No active links. Select photos in the Photos tab and choose Link.</Text> : (
        <Group>{shares.map((s) => <Line key={s.id} title="Read-only link" subtitle={`Expires ${new Date(s.expiresAt).toLocaleDateString()}`} right={<Text onPress={() => api.photoRevokeShare(s.id).then(loadShares).then(() => toast("Link revoked"))} style={{ color: theme.danger, fontFamily: theme.font.bodySemi, fontSize: 13 }}>Revoke</Text>} />)}</Group>
      )}

      <Heading>Your data</Heading>
      <GhostButton title="Export library manifest (JSON)" onPress={exportManifest} />
    </Page>
  );
}
