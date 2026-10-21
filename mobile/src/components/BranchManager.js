import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Heading, Loading, Note } from "./kit";
import { useToast } from "./Toast";
import { Badge, Card, Chip, GhostButton } from "./ui";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

/** The repository's branches, with where each one is deployed, and multi-select delete. The default branch is never deleted. */
export default function BranchManager({ project }) {
  const { theme } = useTheme();
  const toast = useToast();
  const [account, setAccount] = useState(null);
  const [branches, setBranches] = useState(null);
  const [targets, setTargets] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const accounts = (await api.githubAccounts()).accounts || [];
      const usable = accounts.find((a) => a.valid !== false && a.write) || accounts.find((a) => a.valid !== false);
      if (!usable) { setBranches({ list: [], none: true }); return; }
      setAccount(usable);
      const [r, t] = await Promise.all([api.githubBranches(usable.id, project.repoUrl), api.deployTargets(project.id).catch(() => ({ targets: [] }))]);
      setBranches({ list: r.branches || [], def: r.default, canDelete: r.canDelete });
      setTargets(t.targets || []);
    } catch (e) { setError(e.message); setBranches((b) => b || { list: [] }); }
  }, [project.id, project.repoUrl]);
  useEffect(() => { load(); }, [load]);

  if (!branches) return <Loading />;
  if (branches.none) return <Note>Connect a GitHub token in Settings to see this repository’s branches.</Note>;
  const where = (name) => targets.filter((t) => t.branch === name);
  const rows = [...branches.list].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || where(b.name).length - where(a.name).length || a.name.localeCompare(b.name));
  const toggle = (n) => setPicked((o) => { const s = new Set(o); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  const remove = () => {
    const names = [...picked];
    const live = names.filter((n) => where(n).length);
    Alert.alert(`Delete ${names.length} branch${names.length === 1 ? "" : "es"}?`, `${names.join(", ")}${live.length ? `\n\n${live.join(", ")} run a live server; it keeps its last build but stops updating.` : ""}\n\nThe default branch is never deleted.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setBusy(true);
        try {
          const r = await api.githubDeleteBranches({ githubAccountId: account.id, url: project.repoUrl, branches: names, live });
          const ok = r.results.filter((x) => x.ok).length;
          if (ok) toast(`Deleted ${ok} branch${ok === 1 ? "" : "es"}`);
          r.results.filter((x) => !x.ok).forEach((x) => toast(`${x.name}: ${x.error}`, "error"));
          setPicked(new Set()); await load();
        } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
      } }
    ]);
  };

  return (
    <View style={{ gap: 10 }}>
      <Heading action={branches.canDelete && picked.size ? <GhostButton small title={busy ? "Deleting…" : `Delete ${picked.size}`} onPress={remove} disabled={busy} /> : null}>Branches · {rows.length}</Heading>
      {error ? <Note tone="bad">{error}</Note> : null}
      {branches.canDelete === false ? <Note>This GitHub token cannot delete branches. Use a classic token with the repo scope.</Note> : null}
      <Card style={{ gap: 10 }}>
        {rows.map((b) => {
          const here = where(b.name);
          const deletable = branches.canDelete && !b.isDefault && !b.protected;
          return (
            <View key={b.name} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {deletable ? <Chip label={b.name} active={picked.has(b.name)} onPress={() => toggle(b.name)} /> : <Text style={{ color: theme.heading, fontFamily: theme.font.mono, fontSize: 13 }}>⎇ {b.name}</Text>}
                {b.isDefault ? <Badge text="default" color={theme.textMuted} /> : null}
                {b.protected ? <Badge text="protected" color={theme.textMuted} /> : null}
              </View>
              <Text style={{ color: here.length ? theme.ok : theme.textFaint, fontFamily: theme.font.body, fontSize: 12 }}>
                {here.length ? here.map((t) => `${t.name} (${t.label})`).join(" · ") : "not deployed"}
              </Text>
            </View>
          );
        })}
      </Card>
    </View>
  );
}
