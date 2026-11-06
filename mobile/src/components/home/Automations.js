import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useToast } from "../Toast";
import { home } from "../../lib/homeApi";
import { STEP_CHOICES, daysLabel, fmtMinutes, parseCoords, stepLabel } from "../../lib/smartHome";
import { Boundary, Box, Btn, Dim, Input, Pick, Row, Sub, Toggle, Txt, useAct, useLoad } from "./h";
import { HomePreview, TvTimeChart } from "./Charts";

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clone = (o) => JSON.parse(JSON.stringify(o));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function StepPicker({ steps, setSteps }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {steps.map((st, i) => <Row key={i} wrap={false} style={{ justifyContent: "space-between" }}><Txt style={{ flexShrink: 1 }}>{i + 1}. {stepLabel(st)}</Txt><Btn label="✕" onPress={() => setSteps(steps.filter((_, j) => j !== i))} /></Row>)}
      {!steps.length ? <Dim>No steps yet.</Dim> : null}
      <Btn label={open ? "Close the list" : "Add a step"} disabled={steps.length >= 10 && !open} onPress={() => setOpen(!open)} />
      {open ? <Row gap={6}>{STEP_CHOICES.map((c) => <Btn key={c.label} label={c.label} onPress={() => { setSteps([...steps, c.step]); }} />)}</Row> : null}
    </View>
  );
}

function ScenesCard({ ctx }) {
  const { settings: s, setSettings } = ctx;
  const act = useAct();
  const toast = useToast();
  const [draft, setDraft] = useState(null);
  if (!s) return null;
  const run = async (sc) => { const r = await act(() => home.runScene(sc.id)); if (r && r !== true) toast(r.sent ? `${sc.name}: sent ${r.sent} command${r.sent > 1 ? "s" : ""}.` : `${sc.name}: no device is ready for it.`, r.sent ? "success" : "info"); };
  const store = async (scenes) => { const r = await act(() => home.saveScenes(scenes), "Scenes saved."); if (r && r.scenes) { setSettings({ ...s, scenes: r.scenes }); setDraft(null); } };
  return (
    <Box title="Scenes" subtitle="One tap (or say its name to Ask Stashr or the tablet) runs several commands.">
      <Row>{s.scenes.map((sc) => <Btn key={sc.id} label={sc.name} kind="primary" onPress={() => run(sc)} />)}</Row>
      {s.scenes.map((sc) => <Dim key={sc.id}>{sc.name}: {sc.steps.map(stepLabel).join(" → ")}</Dim>)}
      {draft ? (
        <View style={{ gap: 8 }}>
          <Input value={draft.scene.name} onChangeText={(v) => setDraft({ ...draft, scene: { ...draft.scene, name: v } })} placeholder="Scene name, e.g. Movie night" maxLength={40} autoCapitalize="words" />
          <StepPicker steps={draft.scene.steps} setSteps={(steps) => setDraft({ ...draft, scene: { ...draft.scene, steps } })} />
          <Row>
            <Btn label="Save scene" kind="primary" disabled={!draft.scene.name.trim() || !draft.scene.steps.length} onPress={() => store(draft.index === -1 ? [...s.scenes, draft.scene] : s.scenes.map((x, i) => (i === draft.index ? draft.scene : x)))} />
            {draft.index >= 0 ? <Btn label="Delete" kind="danger" onPress={() => store(s.scenes.filter((_, i) => i !== draft.index))} /> : null}
            <Btn label="Cancel" onPress={() => setDraft(null)} />
          </Row>
        </View>
      ) : (
        <Row>
          {s.scenes.map((sc, i) => <Btn key={sc.id} label={`Edit ${sc.name}`} onPress={() => setDraft({ index: i, scene: clone(sc) })} />)}
          <Btn label="New scene" disabled={s.scenes.length >= 12} onPress={() => setDraft({ index: -1, scene: { name: "", steps: [] } })} />
        </Row>
      )}
    </Box>
  );
}

function SchedulesCard({ ctx }) {
  const { settings: s, setSettings } = ctx;
  const act = useAct();
  const [draft, setDraft] = useState(null);
  if (!s) return null;
  const store = async (schedules) => { const r = await act(() => home.saveSchedules(schedules), "Schedules saved."); if (r && r.schedules) { setSettings({ ...s, schedules: r.schedules }); setDraft(null); } };
  const blank = { name: "", time: "23:00", days: [], steps: [STEP_CHOICES[0].step, STEP_CHOICES[1].step], enabled: true };
  return (
    <Box title="Schedules" subtitle={`Commands at a time of day, in ${s.timezone}. E.g. 23:00 pause the TV, 07:30 open the news.`}>
      {s.schedules.length ? s.schedules.map((sc, i) => (
        <View key={sc.id} style={{ gap: 4 }}>
          <Toggle label={`${sc.time} · ${sc.name}`} hint={`${daysLabel(sc.days)} · ${sc.steps.map(stepLabel).join(" → ")}`} value={sc.enabled !== false} onChange={(v) => store(s.schedules.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} />
          <Btn label="Edit" onPress={() => setDraft({ index: i, sc: clone(sc) })} />
        </View>
      )) : <Dim>No schedules yet.</Dim>}
      {draft ? (
        <View style={{ gap: 8 }}>
          <Row><Input value={draft.sc.time} onChangeText={(v) => setDraft({ ...draft, sc: { ...draft.sc, time: v } })} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} style={{ width: 90, flexGrow: 0 }} /><Input value={draft.sc.name} onChangeText={(v) => setDraft({ ...draft, sc: { ...draft.sc, name: v } })} placeholder="Name, e.g. Bedtime" maxLength={60} autoCapitalize="words" style={{ flex: 1 }} /></Row>
          <Row gap={6}>{WEEK.map((d, i) => <Btn key={d} label={(draft.sc.days.includes(i) ? "✓ " : "") + d} onPress={() => setDraft({ ...draft, sc: { ...draft.sc, days: draft.sc.days.includes(i) ? draft.sc.days.filter((x) => x !== i) : [...draft.sc.days, i] } })} />)}</Row>
          <Dim>{daysLabel(draft.sc.days)}</Dim>
          <StepPicker steps={draft.sc.steps} setSteps={(steps) => setDraft({ ...draft, sc: { ...draft.sc, steps } })} />
          <Row>
            <Btn label="Save schedule" kind="primary" disabled={!draft.sc.steps.length || !TIME.test(draft.sc.time)} onPress={() => store(draft.index === -1 ? [...s.schedules, draft.sc] : s.schedules.map((x, i) => (i === draft.index ? draft.sc : x)))} />
            {draft.index >= 0 ? <Btn label="Delete" kind="danger" onPress={() => store(s.schedules.filter((_, i) => i !== draft.index))} /> : null}
            <Btn label="Cancel" onPress={() => setDraft(null)} />
          </Row>
        </View>
      ) : <Btn label="New schedule" disabled={s.schedules.length >= 20} onPress={() => setDraft({ index: -1, sc: clone(blank) })} />}
    </Box>
  );
}

/** Where home is: one place that every phone and device uses. */
function HomeLocation({ ctx }) {
  const { settings: s, save } = ctx;
  const act = useAct();
  const spot = s?.homeSpot, eta = s?.eta || {};
  const [lat, setLat] = useState(spot ? String(spot.lat) : "");
  const [lon, setLon] = useState(spot ? String(spot.lon) : "");
  const [radius, setRadius] = useState(spot?.radius || 200);
  const [paste, setPaste] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (spot) { setLat(String(spot.lat)); setLon(String(spot.lon)); setRadius(spot.radius || 200); } }, [spot?.lat, spot?.lon]);
  if (!s) return null;
  const pasteIt = (t) => { setPaste(t); const p = parseCoords(t); if (p) { setLat(String(p.lat)); setLon(String(p.lon)); } };
  const search = async () => { setBusy(true); const r = await act(() => home.geocode(query.trim())); setBusy(false); if (r && r.results) setFound(r.results); };
  return (
    <Box title="Home location · arrival time" subtitle="With a home location, the tablet and the TV show “Papa 10 minute mein aa rahe hain” for family phones that share their location and are heading home.">
      <HomePreview lat={Number(lat)} lon={Number(lon)} radius={radius} />
      <Sub>Find your home</Sub>
      <Row wrap={false}><Input value={query} onChangeText={setQuery} placeholder="Search an address or a place" autoCapitalize="words" style={{ flex: 1 }} /><Btn label={busy ? "…" : "Find"} disabled={busy || query.trim().length < 3} onPress={search} /></Row>
      {found.map((r) => <Row key={`${r.lat},${r.lon}`} wrap={false}><Txt style={{ flex: 1 }} numberOfLines={2}>{r.name}</Txt><Btn label="Use this" onPress={() => { setLat(String(r.lat)); setLon(String(r.lon)); setFound([]); }} /></Row>)}
      <Input value={paste} onChangeText={pasteIt} placeholder="…or paste coordinates or a Google Maps link" />
      <Row><Input value={lat} onChangeText={setLat} placeholder="Latitude" keyboardType="numbers-and-punctuation" style={{ flex: 1 }} /><Input value={lon} onChangeText={setLon} placeholder="Longitude" keyboardType="numbers-and-punctuation" style={{ flex: 1 }} /></Row>
      <Sub>“At home” circle: {radius} m</Sub>
      <Pick options={[100, 150, 200, 300, 500].map((n) => [n, `${n} m`])} value={radius} onChange={setRadius} />
      <Btn label="Save home" kind="primary" disabled={!lat || !lon} onPress={() => save({ homeSpot: { lat, lon, radius } }, "Home location saved.")} />
      <Toggle label="Show who is on the way home" value={eta.enabled !== false} onChange={(v) => save({ eta: { enabled: v } })} />
      <Toggle label="Use real roads for the arrival time" hint="Asks the free OpenStreetMap routing service (or live traffic, if set on the server) for the driving time and sends it only two points: the phone’s position and your home. Off, it uses a straight-line estimate." value={eta.routing !== false} onChange={(v) => save({ eta: { routing: v } }, v ? "Arrival times now follow real roads." : "Arrival times use the straight line.")} />
      <Dim>Tell me (Telegram) when someone is within:</Dim>
      <Pick options={[5, 10, 15, 20, 30].map((n) => [n, `${n} min`])} value={eta.notifyMinutes || 15} onChange={(v) => save({ eta: { notifyMinutes: v } })} />
    </Box>
  );
}

function PlacesCard({ ctx }) {
  const { settings: s, setSettings, devices } = ctx;
  const act = useAct();
  const [draft, setDraft] = useState(null);
  const phones = devices.filter((d) => d.kind === "phone");
  if (!s) return null;
  const places = s.places || [];
  const store = async (list) => { const r = await act(() => home.savePlaces(list), "Places saved."); if (r && r.places) { setSettings({ ...s, places: r.places }); setDraft(null); } };
  const blank = { name: "Office", lat: "", lon: "", radius: 150, phone: phones[0]?.id || "", group: "", arriveText: "Reached office", leaveText: "Leaving office", arriveFrom: "", arriveTo: "", leaveFrom: "", leaveTo: "", enabled: true };
  const set = (patch) => setDraft({ ...draft, p: { ...draft.p, ...patch } });
  const phoneName = (id) => phones.find((p) => p.id === id)?.name || "phone";
  return (
    <Box title="Places and WhatsApp messages" subtitle="When a family phone reaches or leaves a place (and the time fits), the tablet opens WhatsApp and sends your message to a group.">
      {!phones.length ? <Dim>Link a family phone first (Devices → Family locations).</Dim> : null}
      {places.length ? places.map((pl, i) => (
        <View key={pl.id} style={{ gap: 4 }}>
          <Toggle label={`${pl.name} · ${phoneName(pl.phone)}`} hint={`${pl.group || "no group"} · “${pl.arriveText || "—"}” on arrive${pl.arriveFrom ? ` ${pl.arriveFrom}–${pl.arriveTo}` : ""} · “${pl.leaveText || "—"}” on leave${pl.leaveFrom ? ` ${pl.leaveFrom}–${pl.leaveTo}` : ""} · ${pl.radius} m · now ${pl.state === "in" ? "there" : pl.state === "out" ? "away" : "unknown"}`} value={pl.enabled !== false} onChange={(v) => store(places.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} />
          <Row><Btn label="Send test" disabled={!pl.group} onPress={() => act(() => home.testPlace(pl.id, pl.arriveText), "Sent to the tablet: WhatsApp should open and send.")} /><Btn label="Edit" onPress={() => setDraft({ index: i, p: clone(pl) })} /></Row>
        </View>
      )) : <Dim>No places yet.</Dim>}
      {draft ? (
        <View style={{ gap: 8 }}>
          <Input value={draft.p.name} onChangeText={(v) => set({ name: v })} placeholder="Place, e.g. Office" maxLength={40} autoCapitalize="words" />
          <Dim>Whose phone</Dim>
          <Pick options={phones.map((p) => [p.id, p.name])} value={draft.p.phone} onChange={(v) => set({ phone: v })} />
          <Input value={draft.p.lat} onChangeText={(v) => set({ lat: v })} placeholder="Latitude" keyboardType="numbers-and-punctuation" />
          <Input value={draft.p.lon} onChangeText={(v) => set({ lon: v })} placeholder="Longitude" keyboardType="numbers-and-punctuation" />
          <Input value="" onChangeText={(t) => { const p = parseCoords(t); if (p) set({ lat: String(p.lat), lon: String(p.lon) }); }} placeholder="…or paste coordinates or a Google Maps link" />
          <Dim>Circle radius: {draft.p.radius} m</Dim>
          <Pick options={[50, 100, 150, 250, 500, 1000].map((n) => [n, `${n} m`])} value={draft.p.radius} onChange={(v) => set({ radius: v })} />
          <Input value={draft.p.group} onChangeText={(v) => set({ group: v })} placeholder="WhatsApp group name, exactly as in WhatsApp" maxLength={80} autoCapitalize="words" />
          <Input value={draft.p.arriveText} onChangeText={(v) => set({ arriveText: v })} placeholder="Message on arriving" maxLength={500} autoCapitalize="sentences" />
          <Row><Dim>only between</Dim><Input value={draft.p.arriveFrom} onChangeText={(v) => set({ arriveFrom: v })} placeholder="HH:MM" maxLength={5} style={{ width: 80, flexGrow: 0 }} /><Input value={draft.p.arriveTo} onChangeText={(v) => set({ arriveTo: v })} placeholder="HH:MM" maxLength={5} style={{ width: 80, flexGrow: 0 }} /></Row>
          <Input value={draft.p.leaveText} onChangeText={(v) => set({ leaveText: v })} placeholder="Message on leaving" maxLength={500} autoCapitalize="sentences" />
          <Row><Dim>only between</Dim><Input value={draft.p.leaveFrom} onChangeText={(v) => set({ leaveFrom: v })} placeholder="HH:MM" maxLength={5} style={{ width: 80, flexGrow: 0 }} /><Input value={draft.p.leaveTo} onChangeText={(v) => set({ leaveTo: v })} placeholder="HH:MM" maxLength={5} style={{ width: 80, flexGrow: 0 }} /></Row>
          <Dim>Leave the times empty to send at any time. Leave a message empty to send nothing for that event.</Dim>
          <Row>
            <Btn label="Save place" kind="primary" onPress={() => store(draft.index === -1 ? [...places, draft.p] : places.map((x, i) => (i === draft.index ? draft.p : x)))} />
            {draft.index >= 0 ? <Btn label="Delete" kind="danger" onPress={() => store(places.filter((_, i) => i !== draft.index))} /> : null}
            <Btn label="Cancel" onPress={() => setDraft(null)} />
          </Row>
        </View>
      ) : <Btn label="New place" disabled={!phones.length || places.length >= 10} onPress={() => setDraft({ index: -1, p: clone(blank) })} />}
    </Box>
  );
}

function TvTimeCard({ ctx }) {
  const { settings: s, save } = ctx;
  const { data, reload } = useLoad(() => home.usage(14), []);
  const [mins, setMins] = useState("");
  useEffect(() => { if (s) setMins(String(s.tvLimit.minutes || "")); }, [s]);
  if (!data || !s) return null;
  const today = data.days[data.days.length - 1] || { minutes: 0 };
  const week = data.days.slice(-7).reduce((a, d) => a + d.minutes, 0);
  return (
    <Box title="TV time and daily limit" subtitle={`Today ${fmtMinutes(today.minutes)} · this week ${fmtMinutes(week)} (${fmtMinutes(week / 7)} a day)`}>
      <TvTimeChart days={data.days} limit={s.tvLimit.minutes} />
      <Row wrap={false}>
        <Input value={mins} onChangeText={setMins} placeholder="Daily limit in minutes, 0 = none" keyboardType="number-pad" style={{ flex: 1 }} />
        <Btn label="Save" kind="primary" onPress={async () => { if (await save({ tvLimit: { minutes: Number(mins) || 0 } }, Number(mins) ? "Daily TV limit saved." : "No TV limit.")) reload(); }} />
      </Row>
      <Pick options={[["home", "Pause and go home"], ["pause", "Pause"], ["notify", "Just tell me"]]} value={s.tvLimit.action} onChange={(v) => save({ tvLimit: { action: v } })} />
      <Toggle label="Tell me when the TV is still on between 1 and 5 at night" value={s.tvLimit.lateNight} onChange={(v) => save({ tvLimit: { lateNight: v } })} />
      <Dim>The TV app cannot switch the TV off by itself yet, so the limit pauses it and sends it home, again every 15 minutes, and tells you.</Dim>
    </Box>
  );
}

export default function Automations({ ctx }) {
  return (
    <>
      <Boundary name="Scenes"><ScenesCard ctx={ctx} /></Boundary>
      <Boundary name="Schedules"><SchedulesCard ctx={ctx} /></Boundary>
      <Boundary name="Home location"><HomeLocation ctx={ctx} /></Boundary>
      <Boundary name="Places"><PlacesCard ctx={ctx} /></Boundary>
      <Boundary name="TV time"><TvTimeCard ctx={ctx} /></Boundary>
    </>
  );
}
