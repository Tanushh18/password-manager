import { AppState, Platform } from "react-native";
import { loadSavedToken } from "./api";
import { loadState, processQueue, scan } from "./photoSync";
import { setBackgroundBackup } from "./photoBackground";
import { scanFaces } from "./faceScan";

/*
 * Keeps backup moving while the app is open or just came back: on start, when the app returns to the
 * foreground, and whenever Android reports a change in the photo library. When the app is closed the
 * system's background scheduler (see photoBackground.js) takes over, at Android's discretion (15 minutes at best).
 */
let started = false;
let last = 0;

async function pass(force) {
  if (Date.now() - last < (force ? 5000 : 60000)) return;
  last = Date.now();
  try {
    const state = await loadState();
    if (!(await loadSavedToken())) return;
    if (state.enabled) { await scan(); await processQueue({ budgetMs: 3 * 60 * 1000 }); }
    await scanFaces({ limit: 30, auto: true }); // only runs when face grouping is on, on Wi-Fi, while charging
  } catch (e) { /* the next pass tries again */ }
}

export async function startAutoBackup() {
  if (started || Platform.OS === "web") return;
  started = true;
  try {
    const state = await loadState();
    if (state.enabled) setBackgroundBackup(true).catch(() => {}); // make sure the scheduled task survived an update or restart
  } catch (e) { /* ignore */ }
  pass(true);
  AppState.addEventListener("change", (s) => { if (s === "active") pass(false); });
  try {
    const ML = require("expo-media-library/legacy");
    ML.addListener(() => pass(false));
  } catch (e) { /* library change events are a bonus */ }
}
