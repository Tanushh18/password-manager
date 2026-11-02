import { Platform } from "react-native";
import { loadSavedToken, refreshServers } from "./api";
import { hasNewSince } from "./sms";
import { lastSeenArrival, syncNow } from "./moneySync";

/* Looks for new bank SMS about every 15 minutes through the system scheduler. It only reads and uploads when a new message arrived. */
export const MONEY_TASK = "stashr-money-sms";

if (Platform.OS !== "web") {
  const TaskManager = require("expo-task-manager");
  const BackgroundTask = require("expo-background-task");
  TaskManager.defineTask(MONEY_TASK, async () => {
    try {
      if (!(await loadSavedToken())) return BackgroundTask.BackgroundTaskResult.Success;
      if (!(await hasNewSince(await lastSeenArrival()))) return BackgroundTask.BackgroundTaskResult.Success;
      await refreshServers().catch(() => {});
      const r = await syncNow();
      return r && r.error ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function setMoneyBackground(on) {
  if (Platform.OS === "web") return;
  try {
    const TaskManager = require("expo-task-manager");
    const BackgroundTask = require("expo-background-task");
    const registered = await TaskManager.isTaskRegisteredAsync(MONEY_TASK);
    if (on && !registered) await BackgroundTask.registerTaskAsync(MONEY_TASK, { minimumInterval: 15 });
    if (!on && registered) await BackgroundTask.unregisterTaskAsync(MONEY_TASK);
  } catch (e) { /* the scheduler may be unavailable; the app still syncs when opened */ }
}
