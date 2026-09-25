import React, { useState } from "react";
import { Platform, Switch, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import Screen from "../../components/Screen";
import Icon from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { Card, FadeIn, Field, GhostButton, GradientButton } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import C from "../../lib/crypto";
import { normalizeItem, parseCSV, rowsToItems, toCSV } from "../../lib/items";

const stamp = () => new Date().toISOString().slice(0, 10);

/** Writes a temp file and opens the Android share sheet (Drive, Files, email…). */
async function shareFile(name, text, mimeType) {
  const { File, Paths } = require("expo-file-system");
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  // The shared copy isn't needed afterwards.
  setTimeout(() => {
    try {
      if (file.exists) file.delete();
    } catch (e) {
      /* ignore */
    }
  }, 60000);
}

async function readPicked(asset) {
  if (Platform.OS === "web") return (await fetch(asset.uri)).text();
  const { File } = require("expo-file-system");
  return new File(asset.uri).text();
}

export default function Data() {
  const { theme } = useTheme();
  const { items, importItems, withoutAutoLock, offline } = useVault();
  const toast = useToast();
  const [mode, setMode] = useState(null); // backup | csv
  const [pass, setPass] = useState({ a: "", b: "" });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // { text } backup awaiting password
  const [importPass, setImportPass] = useState("");

  const run = async (fn) => {
    try {
      setBusy(true);
      await fn();
    } catch (e) {
      if (!/cancel/i.test(e.message || "")) toast(e.message || "Something went wrong.", "error");
    } finally {
      setBusy(false);
    }
  };

  const clean = () => items.map(({ id, createdAt, updatedAt, ...rest }) => rest);

  const exportBackup = () =>
    run(async () => {
      if (pass.a.length < 8) throw new Error("Use at least 8 characters for the backup password.");
      if (pass.a !== pass.b) throw new Error("Passwords don't match.");
      const text = await C.exportBackup(clean(), pass.a);
      await withoutAutoLock(() => shareFile(`aurelia-backup-${stamp()}.aurelia`, text, "application/json"));
      setMode(null);
      setPass({ a: "", b: "" });
    });

  const exportCSV = () =>
    run(async () => {
      await withoutAutoLock(() => shareFile(`aurelia-export-${stamp()}.csv`, toCSV(items), "text/csv"));
      setMode(null);
      setAck(false);
    });

  const finishImport = async (list) => {
    if (!list.length) throw new Error("No items found in that file.");
    const n = await importItems(list.map(normalizeItem));
    toast(`${n} item${n === 1 ? "" : "s"} imported and encrypted ✨`);
  };

  const pick = () =>
    run(async () => {
      const res = await withoutAutoLock(() =>
        DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/json", "application/octet-stream", "*/*"], copyToCacheDirectory: true })
      );
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const text = await readPicked(asset);
      if (/^\s*\{/.test(text)) {
        setPending({ text, name: asset.name });
        return;
      }
      await finishImport(rowsToItems(parseCSV(text)));
    });

  return (
    <Screen title="Your data" subtitle="Take your vault anywhere, and bring passwords in from other apps.">
      <FadeIn>
        <Card style={{ gap: 12 }}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 17 }}>Export</Text>
          <GradientButton title="Encrypted backup" icon="download" small disabled={!items.length} onPress={() => setMode(mode === "backup" ? null : "backup")} />
          {mode === "backup" ? (
            <View>
              <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, marginBottom: 10 }}>
                The file is encrypted with its own password. You'll need it to import the backup later.
              </Text>
              <Field label="Backup password" icon="lock" secure value={pass.a} onChangeText={(t) => setPass((p) => ({ ...p, a: t }))} autoCapitalize="none" />
              <Field label="Confirm backup password" icon="lock" secure value={pass.b} onChangeText={(t) => setPass((p) => ({ ...p, b: t }))} autoCapitalize="none" />
              <GradientButton title="Create & share backup" icon="download" loading={busy} onPress={exportBackup} />
            </View>
          ) : null}
          <GhostButton title="Plain CSV" icon="download" small disabled={!items.length} onPress={() => setMode(mode === "csv" ? null : "csv")} />
          {mode === "csv" ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: alpha(theme.danger, 0.1) }}>
                <Icon name="alert" size={16} color={theme.danger} />
                <Text style={{ flex: 1, color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>
                  A CSV is <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi }}>not encrypted</Text>. Anyone with the file can read every password.
                </Text>
                <Switch value={ack} onValueChange={setAck} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.danger }} thumbColor="#fff" />
              </View>
              <GradientButton title="Share CSV" icon="download" colors={[theme.danger, "#9F1239"]} disabled={!ack} loading={busy} onPress={exportCSV} />
            </View>
          ) : null}
        </Card>
      </FadeIn>

      <FadeIn delay={80}>
        <Card style={{ gap: 12 }}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 17 }}>Import</Text>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 }}>
            Aurelia backups (.aurelia) and CSV exports from Chrome, Bitwarden, 1Password or LastPass. Files are read and encrypted on this phone.
          </Text>
          {pending ? (
            <View>
              <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, marginBottom: 8 }}>{pending.name}</Text>
              <Field label="Backup password" icon="lock" secure value={importPass} onChangeText={setImportPass} autoCapitalize="none" />
              <GradientButton
                title="Open and import"
                icon="upload"
                loading={busy}
                disabled={!importPass}
                onPress={() =>
                  run(async () => {
                    await finishImport(await C.importBackup(pending.text, importPass));
                    setPending(null);
                    setImportPass("");
                  })
                }
              />
              <GhostButton title="Cancel" small style={{ marginTop: 8 }} onPress={() => setPending(null)} />
            </View>
          ) : (
            <GradientButton title="Choose a file" icon="upload" small loading={busy} disabled={offline} onPress={pick} />
          )}
        </Card>
      </FadeIn>
    </Screen>
  );
}
