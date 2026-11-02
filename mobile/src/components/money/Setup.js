import React, { useState } from "react";
import { Linking, Platform, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Box, Btn, Dim, Input, Row, Txt, Bad, Good, Pick, useAct } from "../home/h";
import { money } from "../../lib/moneyApi";
import { requestPermission, smsAvailable } from "../../lib/sms";
import { startChoice, validYmd, dayLabel } from "../../lib/moneyFmt";
import { syncNow } from "../../lib/moneySync";
import { setMoneyBackground } from "../../lib/moneyBackground";

/** 1. Connect the Google Sheet. */
export function SheetSetup({ settings, onSaved }) {
  const act = useAct();
  const [url, setUrl] = useState(settings.sheetUrl || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const email = settings.serviceAccountEmail;
  const save = async () => {
    setBusy(true); setError("");
    try { await money.saveSheet(url.trim()); onSaved(); } catch (e) { setError(e.message || "Could not use that sheet."); } finally { setBusy(false); }
  };
  return (
    <Box title="Connect your Google Sheet" subtitle="Your payments are written to a sheet that only you own. Stashr's own database never holds them.">
      {!settings.ready ? <Bad>The server has no Google credentials yet. Ask whoever runs your Stashr server to add GOOGLE_SHEETS_SA_JSON.</Bad> : null}
      <Txt>1. Create a new Google Sheet (any name).</Txt>
      <Txt>2. Share it as <Txt bold>Editor</Txt> with:</Txt>
      {email ? (
        <Row>
          <Txt bold style={{ flexShrink: 1 }} onPress={() => act(async () => { await Clipboard.setStringAsync(email); }, "E-mail copied")}>{email}</Txt>
          <Btn label="Copy" onPress={() => act(async () => { await Clipboard.setStringAsync(email); }, "E-mail copied")} />
        </Row>
      ) : <Dim>(shown once the server is set up)</Dim>}
      <Txt>3. Paste the sheet's link here:</Txt>
      <Input value={url} onChangeText={setUrl} placeholder="https://docs.google.com/spreadsheets/d/…" />
      {error ? <Bad>{error}</Bad> : null}
      <Row>
        <Btn kind="primary" label={settings.configured ? "Save sheet" : "Connect sheet"} onPress={save} loading={busy} disabled={!url.trim() || !settings.ready} />
        {settings.configured && settings.sheetUrl ? <Btn label="Open sheet" onPress={() => Linking.openURL(settings.sheetUrl).catch(() => {})} /> : null}
      </Row>
    </Box>
  );
}

/** 2. The one-time start date. Shown only while the server says it is still needed; gone for good afterwards. */
export function StartDate({ onDone }) {
  const [kind, setKind] = useState("m3");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const date = typed.trim() || startChoice(kind);
  const ok = validYmd(date);
  const confirm = async () => {
    setBusy(true); setError("");
    try {
      await money.start(date);
      await setMoneyBackground(true);
      onDone();                       // the screen reloads, hides this card and starts the first sync
    } catch (e) { setError(e.message || "Could not save."); } finally { setBusy(false); }
  };
  return (
    <Box title="How far back should I read your bank SMS?" subtitle="You choose this once. Nothing older is ever read. Entries stay in the list for 4 months; older ones move to the sheet's Archive tab.">
      <Pick options={[["month", "This month"], ["m3", "3 months"], ["m6", "6 months"], ["y1", "1 year"]]} value={typed ? "" : kind} onChange={(k) => { setTyped(""); setKind(k); }} />
      <Input value={typed} onChangeText={setTyped} placeholder="or type a date, YYYY-MM-DD" maxLength={10} keyboardType="numbers-and-punctuation" />
      <Dim>{ok ? `I will read messages from ${dayLabel(date)}.` : "Use the form 2026-07-01."}</Dim>
      {error ? <Bad>{error}</Bad> : null}
      <Btn kind="primary" label="Confirm" onPress={confirm} loading={busy} disabled={!ok} />
    </Box>
  );
}

/** 3. SMS access and the sync button. */
export function SmsAccess({ settings, allowed, setAllowed, last, onSynced }) {
  const [busy, setBusy] = useState(false);
  const ask = async () => { const ok = await requestPermission(); setAllowed(ok); if (ok) { await setMoneyBackground(true); run(); } };
  const run = async () => { setBusy(true); try { await syncNow(); } finally { setBusy(false); onSynced(); } };
  const r = last.result;
  const when = (ms) => (ms ? new Date(ms).toLocaleString() : "never");
  return (
    <Box title="Reading your bank SMS" subtitle={settings.startDate ? `Reading messages from ${dayLabel(settings.startDate)}. New ones are sent about every 15 minutes and when you open Stashr.` : undefined}>
      {!smsAvailable() ? <Bad>This version of the app cannot read SMS. Update Stashr (Settings → Check for updates).</Bad> : null}
      {smsAvailable() && !allowed ? (
        <View style={{ gap: 8 }}>
          <Dim>Stashr reads only messages from your bank, on this phone, and sends them straight to your sheet. They are not kept anywhere else.</Dim>
          <Btn kind="primary" label="Allow SMS access" onPress={ask} />
          {Platform.OS === "android" ? <Dim>If Android blocks it (apps installed outside the Play Store): Settings → Apps → Stashr → ⋮ → Allow restricted settings, then try again.</Dim> : null}
        </View>
      ) : null}
      {allowed ? <Good>SMS access is on.</Good> : null}
      <Row>
        <Btn kind="primary" label={busy ? "Syncing…" : "Sync now"} onPress={run} loading={busy} disabled={!allowed || !settings.startDate} />
      </Row>
      <Dim>Last sync: {when(last.ran)}</Dim>
      {r ? <Dim>{`Last result: ${r.added} added, ${r.flagged} need checking, ${r.duplicates} already there, ${r.ignored} ignored${r.unparsed ? `, ${r.unparsed} not understood` : ""}.`}</Dim> : null}
      {last.error ? <Bad>Last problem: {last.error}</Bad> : null}
    </Box>
  );
}
