import React, { useEffect, useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import { router } from "expo-router";
import { Heading, Loading, Note, Page } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card, Chip, Field, GhostButton, GradientButton } from "../components/ui";
import { api } from "../lib/api";
import { parseEnvBlock } from "../lib/projectItems";
import { useTheme } from "../lib/theme";
import { useVault } from "../lib/vault";

/* Same presets as the website's Create & deploy (build and start commands per stack). */
const RUNTIMES = {
  node: ["Node.js", "npm install", "npm start"],
  nextjs: ["Next.js", "npm install && npm run build", "npm start"],
  python: ["FastAPI", "pip install -r requirements.txt", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"],
  flask: ["Flask", "pip install -r requirements.txt", "gunicorn app:app --bind 0.0.0.0:$PORT"],
  django: ["Django", "pip install -r requirements.txt && python manage.py collectstatic --noinput", "gunicorn config.wsgi:application --bind 0.0.0.0:$PORT"],
  go: ["Go", "go build -tags netgo -ldflags '-s -w' -o app", "./app"],
  elixir: ["Elixir", "mix deps.get --only prod && mix compile", "mix phx.server"],
  docker: ["Docker", "", ""],
  vite: ["Static (Vite)", "npm install && npm run build", ""]
};
const HOSTS = [["render", "Render"], ["vercel", "Vercel"], ["netlify", "Netlify"], ["railway", "Railway"], ["cloudflare", "Cloudflare Pages"]];
const slug = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").replace(/-{2,}/g, "-").slice(0, 60);

/** Create & deploy from a repository you already have: pick the repo, branch, host and account, then deploy. */
export default function DeployNew() {
  const { theme } = useTheme();
  const toast = useToast();
  const { refresh } = useVault();
  const [github, setGithub] = useState(null);
  const [githubId, setGithubId] = useState("");
  const [repos, setRepos] = useState(null);
  const [query, setQuery] = useState("");
  const [repo, setRepo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("");
  const [host, setHost] = useState("render");
  const [renderAccounts, setRenderAccounts] = useState([]);
  const [hostAccounts, setHostAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [owners, setOwners] = useState([]);
  const [ownerId, setOwnerId] = useState("");
  const [runtime, setRuntime] = useState("node");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [envText, setEnvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.githubAccounts().then((r) => { const list = (r.accounts || []).filter((a) => a.valid !== false); setGithub(list); setGithubId((list.find((a) => a.write) || list[0])?.id || ""); }).catch((e) => { setGithub([]); setError(e.message); });
    api.renderAccounts().then((r) => setRenderAccounts(r.accounts || [])).catch(() => {});
    api.hostAccounts().then((r) => setHostAccounts(r.accounts || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!githubId) return;
    setRepos(null);
    api.githubRepos(githubId).then((r) => setRepos((r.repos || []).filter((x) => !x.archived))).catch((e) => { setRepos([]); setError(e.message); });
  }, [githubId]);
  useEffect(() => {
    if (!repo) return;
    api.githubBranches(githubId, repo.url).then((r) => { setBranches((r.branches || []).map((b) => b.name)); setBranch(r.default || r.branches?.[0]?.name || ""); }).catch((e) => setError(e.message));
    setName((n) => n || repo.name);
  }, [repo, githubId]);

  const accounts = host === "render" ? renderAccounts : hostAccounts.filter((a) => a.provider === host);
  useEffect(() => { setAccountId(accounts[0]?.id || ""); }, [host, renderAccounts, hostAccounts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setOwners([]); setOwnerId("");
    if (host !== "render" || !accountId) return;
    api.renderOwners(accountId).then((r) => { setOwners(r.owners || []); if ((r.owners || []).length === 1) setOwnerId(r.owners[0].id); }).catch(() => {});
  }, [host, accountId]);

  const shown = useMemo(() => (repos || []).filter((r) => !query.trim() || r.key.includes(query.trim().toLowerCase())).slice(0, 25), [repos, query]);
  const ready = repo && branch && name.trim() && accountId && (host !== "render" || owners.length < 2 || ownerId);

  const deploy = async () => {
    setBusy(true); setError("");
    const envVars = parseEnvBlock(envText).map((v) => ({ name: v.name, value: v.value }));
    try {
      if (host === "render") {
        const [, build, start] = RUNTIMES[runtime];
        const data = await api.renderCreateDeploy({ name: name.trim(), repoName: slug(name), description: "", template: "existing", useExistingRepo: true, existingRepoUrl: repo.url, branch, visibility: "public", githubAccountId: githubId, renderAccountId: accountId, ownerId, region: "singapore", runtime, buildCommand: build, startCommand: start, rootDir: folder.trim(), envVars });
        setResult({ host: "Render", url: data.service?.url, dashboardUrl: data.service?.dashboardUrl, projectId: data.projectId, steps: data.steps || [] });
      } else {
        const data = await api.hostCreateDeploy({ name: name.trim(), description: "", repoUrl: repo.url, branch, githubAccountId: githubId, hostAccountId: accountId, envVars, clientFolder: folder.trim() });
        setResult({ host: data.host, url: data.service?.url, dashboardUrl: data.service?.dashboardUrl, projectId: data.projectId, note: data.note, steps: [] });
      }
      refresh?.();
      toast("Deploying");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const body = { color: theme.text, fontFamily: theme.font.body, fontSize: 14 };
  if (result) {
    return (
      <Page title="Deploying" subtitle={`On ${result.host}`}>
        <Card style={{ gap: 10 }}>
          {result.steps.map((s, i) => <Text key={i} style={body}>{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "–"} {s.detail}</Text>)}
          {result.note ? <Note>{result.note}</Note> : null}
          {result.url ? <Text onPress={() => Linking.openURL(result.url)} style={{ color: theme.accent, fontFamily: theme.font.body, fontSize: 14 }}>{result.url}</Text> : null}
          <Note>The first build takes a few minutes. Open the project to see its progress and logs.</Note>
          {result.projectId ? <GradientButton title="Open the project" onPress={() => router.replace({ pathname: "/project", params: { id: result.projectId } })} /> : null}
          {result.dashboardUrl ? <GhostButton title={`Open ${result.host}`} onPress={() => Linking.openURL(result.dashboardUrl)} /> : null}
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Create & deploy" subtitle="Deploy a repository you already have">
      {error ? <Note tone="bad">{error}</Note> : null}
      <Heading>1 · GitHub repository</Heading>
      {!github ? <Loading /> : github.length === 0 ? <Note>Connect a GitHub token in Settings first.</Note> : (
        <Card style={{ gap: 10 }}>
          {github.length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{github.map((a) => <Chip key={a.id} label={a.login} active={githubId === a.id} onPress={() => setGithubId(a.id)} />)}</View> : null}
          <Field label="Search your repositories" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
          {!repos ? <Loading /> : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {shown.map((r) => <Chip key={r.key} label={`${r.owner}/${r.name}`} active={repo?.key === r.key} onPress={() => setRepo(r)} />)}
              {!shown.length ? <Text style={body}>No repository matches.</Text> : null}
            </View>
          )}
        </Card>
      )}

      {repo ? (
        <>
          <Heading>2 · Branch</Heading>
          <Card><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{branches.map((b) => <Chip key={b} label={b} active={branch === b} onPress={() => setBranch(b)} />)}</View></Card>

          <Heading>3 · Where to host it</Heading>
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{HOSTS.map(([id, label]) => <Chip key={id} label={label} active={host === id} onPress={() => setHost(id)} />)}</View>
            {accounts.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{accounts.map((a) => <Chip key={a.id} label={a.name} active={accountId === a.id} onPress={() => setAccountId(a.id)} />)}</View>
            ) : <Note>No {HOSTS.find((h) => h[0] === host)[1]} account is connected. Connect one on the website or in Settings.</Note>}
            {owners.length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{owners.map((o) => <Chip key={o.id} label={o.name} active={ownerId === o.id} onPress={() => setOwnerId(o.id)} />)}</View> : null}
            {host === "render" ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{Object.entries(RUNTIMES).map(([id, r]) => <Chip key={id} label={r[0]} active={runtime === id} onPress={() => setRuntime(id)} />)}</View> : null}
            <Field label="Name" value={name} onChangeText={setName} autoCapitalize="none" maxLength={80} />
            <Field label="Folder in the repo (optional, e.g. server or client)" value={folder} onChangeText={setFolder} autoCapitalize="none" autoCorrect={false} />
          </Card>

          <Heading>4 · Environment variables</Heading>
          <Card style={{ gap: 8 }}>
            <Field label="Paste a .env (one NAME=value per line)" value={envText} onChangeText={setEnvText} multiline numberOfLines={6} autoCapitalize="none" autoCorrect={false} />
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>{parseEnvBlock(envText).length} variable{parseEnvBlock(envText).length === 1 ? "" : "s"} found. They go straight to the host.</Text>
          </Card>

          <GradientButton title={busy ? "Deploying…" : `Deploy to ${HOSTS.find((h) => h[0] === host)[1]}`} onPress={deploy} disabled={busy || !ready} loading={busy} />
        </>
      ) : null}
    </Page>
  );
}
