import React from "react";
import * as Clipboard from "expo-clipboard";
import { View } from "react-native";
import { healthItems, healthReport } from "../../lib/smartHome";
import { useToast } from "../Toast";
import { Bad, Boundary, Box, Btn, Dim, Good, Sub, Txt } from "./h";

const DOT = { ok: "🟢", bad: "🔴", warn: "🟡", unknown: "⚪" };

function HealthCard({ devices }) {
  const toast = useToast();
  const list = devices.filter((d) => d.kind === "tv" || d.kind === "hub" || d.kind === "phone");
  let bad = 0, warn = 0;
  for (const d of list) for (const i of healthItems(d)) { if (i.state === "bad") bad++; else if (i.state === "warn") warn++; }
  const copy = async () => { try { await Clipboard.setStringAsync(healthReport(list)); toast("Report copied. Paste it in the chat."); } catch { toast("Could not copy.", "error"); } };
  const summary = bad ? `${bad} thing${bad > 1 ? "s" : ""} need${bad > 1 ? "" : "s"} fixing${warn ? `, ${warn} could be better` : ""}.` : warn ? `Nothing is broken; ${warn} thing${warn > 1 ? "s" : ""} could be better.` : list.length ? "Everything looks fine." : "No devices yet.";
  return (
    <Box title="Health check" subtitle="Every device tells Stashr what it is allowed to do and its last error. Red stops a feature, yellow works but worse, grey means the app is too old to say.">
      {bad ? <Bad>{summary}</Bad> : <Good>{summary}</Good>}
      <Btn label="Copy a report (to paste in the chat)" disabled={!list.length} onPress={copy} />
      {list.map((d) => {
        const h = (d.status || {}).health || {};
        return (
          <View key={d.id} style={{ gap: 6 }}>
            <Sub>{d.kind === "tv" ? "📺" : d.kind === "hub" ? "🧩" : "📱"} {d.name}</Sub>
            <Dim>{h.appVersion ? `app ${h.appVersion}` : "app version unknown"}{h.sdk ? ` · Android API ${h.sdk}` : ""}{h.model ? ` · ${h.model}` : ""}</Dim>
            {healthItems(d).map((i) => (
              <View key={i.id} style={{ gap: 2 }}>
                <Txt bold>{DOT[i.state]} {i.label}</Txt>
                {i.state !== "ok" && i.fix ? <Dim>{i.fix}</Dim> : null}
              </View>
            ))}
          </View>
        );
      })}
    </Box>
  );
}

export default function Health({ ctx }) {
  return <Boundary name="Health check"><HealthCard devices={ctx.devices} /></Boundary>;
}
