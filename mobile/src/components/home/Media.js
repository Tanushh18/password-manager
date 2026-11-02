import React, { useEffect, useState } from "react";
import { home } from "../../lib/homeApi";
import { fmtBytes } from "../../lib/smartHome";
import { Bad, Boundary, Box, Btn, Dim, Input, Pick, Row, Toggle, Txt, useAct, useLoad, usePoll } from "./h";
import { SpeedChart } from "./Charts";

function SpeedCard({ devices }) {
  const act = useAct();
  const hub = devices.find((d) => d.kind === "hub" && d.status?.agent === "stashr-hub");
  const [days, setDays] = useState(7);
  const { data, reload } = useLoad(() => home.speed(days), [days]);
  usePoll(reload, 120000);
  if (!hub && !(data && data.samples.length)) return null;
  const avg = data && data.samples.length ? Math.round(data.samples.reduce((a, x) => a + x.down, 0) / data.samples.length) : null;
  return (
    <Box title="Internet speed" subtitle={avg != null ? `Average ${avg} Mbit/s down over ${days} day${days > 1 ? "s" : ""}. Useful proof when the connection is slow.` : "The tablet tests the internet every hour."}>
      <Pick options={[[1, "Today"], [7, "7 days"], [30, "30 days"], [90, "90 days"]]} value={days} onChange={setDays} />
      {hub ? <Btn label="Test now" onPress={() => act(() => home.command(hub.id, "speed_test", {}), "Speed test started. The result shows up in a minute.")} /> : null}
      {data ? <SpeedChart samples={data.samples} /> : null}
    </Box>
  );
}

/** Movies from a Google Drive folder to the TV's USB drive. */
function MoviesCard() {
  const act = useAct();
  const { data, reload } = useLoad(() => home.movies(), []);
  usePoll(reload, 20000);
  const [account, setAccount] = useState("");
  const [folder, setFolder] = useState("");
  const [del, setDel] = useState(false);
  useEffect(() => {
    if (!data) return;
    setAccount((a) => a || data.settings.connectionId || data.connections[0]?.id || "");
    setDel(data.settings.deleteAfterSync);
    setFolder((f) => f || (data.settings.folderId ? "https://drive.google.com/drive/folders/" + data.settings.folderId : ""));
  }, [data]);
  if (!data) return null;
  const chosen = data.connections.find((c) => c.id === account);
  return (
    <Box title="Movies from Google Drive" subtitle="Put a movie in the Drive folder and the TV copies it to its USB drive on its own.">
      {data.connections.length === 0 ? <Dim>Connect a Google account in Photo backup first, then come back here.</Dim> : (
        <>
          <Pick options={data.connections.map((c) => [c.id, `${c.label}${c.email ? ` · ${c.email}` : ""}`])} value={account} onChange={setAccount} />
          <Input value={folder} onChangeText={setFolder} placeholder="Paste the Drive folder link" />
          <Toggle label="Remove a movie from Drive once the TV has it on the USB drive" value={del && !(chosen && !chosen.canDelete)} disabled={chosen && !chosen.canDelete} onChange={setDel} />
          {chosen && !chosen.canDelete ? <Dim>Removing needs full Drive access. This Google account was connected read-only, so movies stay in Drive and the USB drive mirrors the folder.</Dim> : null}
          <Btn label="Save" kind="primary" disabled={!folder.trim()} onPress={async () => { if (await act(() => home.saveMovies({ connectionId: account, folder, deleteAfterSync: del }), "Saved. The TV picks up the movies within a few minutes.")) reload(); }} />
        </>
      )}
      {data.error ? <Bad>{data.error}</Bad> : null}
      {data.lastDelete?.error ? <Bad>Could not remove “{data.lastDelete.name}” from Drive: {data.lastDelete.error}</Bad> : null}
      {data.waiting ? (data.waiting.length ? data.waiting.map((m) => <Dim key={m.name}><Txt bold>{m.name}</Txt> · {fmtBytes(m.size)} · waiting in Drive for the TV</Dim>) : <Dim>The Drive folder has no movies waiting.</Dim>) : null}
    </Box>
  );
}

function SlideshowCard({ devices, settings: s, save }) {
  const act = useAct();
  const hub = devices.find((d) => d.kind === "hub" && d.status?.agent === "stashr-hub");
  const [folder, setFolder] = useState("");
  useEffect(() => { if (s) setFolder(s.slideshowFolder ? "https://drive.google.com/drive/folders/" + s.slideshowFolder : ""); }, [s]);
  if (!s || !hub) return null;
  return (
    <Box title="Photo frame (tablet slideshow)" subtitle="Photos from a Google Drive folder, through the Google account connected in Photo backup.">
      <Input value={folder} onChangeText={setFolder} placeholder="Paste the Drive folder link" />
      <Row>
        <Btn label="Save" onPress={() => save({ slideshowFolder: folder }, "Slideshow folder saved.")} />
        <Btn label="Start on the tablet" kind="primary" disabled={!s.slideshowFolder} onPress={() => act(() => home.command(hub.id, "slideshow", { action: "start" }), "Slideshow starting on the tablet.")} />
      </Row>
      <Dim>The tablet also starts the slideshow by itself after 10 idle minutes on its dashboard, when a folder is set. Leave the folder empty to keep the photo frame off.</Dim>
      <Dim>Only a Google Drive folder works. Google no longer lets apps read a whole Google Photos library, so photos that live only in Google Photos can’t be shown here: copy the ones you want into a Drive folder (Google Photos → select → Save to Drive).</Dim>
    </Box>
  );
}

export default function Media({ ctx }) {
  const { devices, settings, save } = ctx;
  return (
    <>
      <Boundary name="Internet speed"><SpeedCard devices={devices} /></Boundary>
      <Boundary name="Movies"><MoviesCard /></Boundary>
      <Boundary name="Photo frame"><SlideshowCard devices={devices} settings={settings} save={save} /></Boundary>
    </>
  );
}
