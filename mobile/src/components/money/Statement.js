import React, { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Box, Btn, Dim, Good, Bad, Txt } from "../home/h";
import { money } from "../../lib/moneyApi";
import { inr, dayLabel } from "../../lib/moneyFmt";

/** Check the sheet against a bank statement (Excel or CSV downloaded from net banking). */
export default function Statement({ settings, onChecked }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const last = settings.lastStatement;
  const pick = async () => {
    setError(""); setReport(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"], copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      const name = a.name || "statement";
      if (!/\.(csv|xlsx)$/i.test(name)) { setError("Choose the statement as an Excel (.xlsx) or CSV file. In net banking, download it as Excel or CSV, not PDF."); return; }
      setBusy(true);
      const { File } = require("expo-file-system");
      const bytes = new Uint8Array(await new File(a.uri).arrayBuffer());
      const r = await money.statement(name, bytes);
      setReport(r.report || r);
      onChecked();
    } catch (e) { setError(e.message || "Could not check the statement."); } finally { setBusy(false); }
  };
  const r = report;
  return (
    <Box title="Check against a bank statement" subtitle="Send your Federal Bank statement (Excel or CSV) any time, in the middle of the month or at the end. Every entry is matched with it.">
      <Btn kind="primary" label={busy ? "Checking…" : "Choose statement file"} onPress={pick} loading={busy} />
      {error ? <Bad>{error}</Bad> : null}
      {r ? (
        <View style={{ gap: 3 }}>
          <Txt bold>{dayLabel(r.from)} → {dayLabel(r.to)} · {r.lines} lines</Txt>
          <Good>{r.verified} matched and verified</Good>
          {r.mismatched ? <Bad>{r.mismatched} did not match (different amount)</Bad> : null}
          {r.added ? <Dim>{r.added} were in the statement but not in your sheet: added</Dim> : null}
          {r.notInStatement ? <Dim>{r.notInStatement} in your sheet are not in the statement</Dim> : null}
          {r.balanceBreakCount ? <Bad>{r.balanceBreakCount} places where the statement's own balance does not add up</Bad> : null}
          {(r.balanceBreaks || []).slice(0, 3).map((b, i) => <Dim key={i}>• {dayLabel(b.date)} {b.desc}: expected {inr(b.expected)}, got {inr(b.got)}</Dim>)}
        </View>
      ) : last ? <Dim>Last check: {dayLabel(last.from)} → {dayLabel(last.to)}: {last.verified} verified, {last.mismatched} mismatched, {last.added} added.</Dim> : null}
    </Box>
  );
}
