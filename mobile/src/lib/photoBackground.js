import { Platform } from "react-native";
import { loadSavedToken, refreshServers } from "./api";
import { loadState, scan, processQueue } from "./photoSync";

/* Periodic camera-roll backup through the system's background scheduler (WorkManager on Android). */
export const TASK = "stashr-photo-backup";

if (Platform.OS !== "web") {
  const TaskManager = require("expo-task-manager");
  const BackgroundTask = require("expo-background-task");
  TaskManager.defineTask(TASK, async () => {
    try {
      const state = await loadState();
      if (!state.enabled || !(await loadSavedToken())) return BackgroundTask.BackgroundTaskResult.Success;
      await refreshServers().catch(() => {});
      await scan();
      await processQueue({ budgetMs: 4 * 60 * 1000 });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function setBackgroundBackup(on) {
  if (Platform.OS === "web") return;
  const TaskManager = require("expo-task-manager");
  const BackgroundTask = require("expo-background-task");
  const registered = await TaskManager.isTaskRegisteredAsync(TASK);
  if (on && !registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  if (!on && registered) await BackgroundTask.unregisterTaskAsync(TASK);
}
