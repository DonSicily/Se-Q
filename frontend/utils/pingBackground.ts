/**
 * Background task for the unified ping contract (Issue #5).
 *
 * When the device receives a silent "ping" or "location_ping" push, the OS
 * wakes the registered TaskManager task.  We acquire a fresh GPS fix and
 * POST it back to /api/location/ping-update.  The backend records the
 * response against the matching ping_events row so the admin dashboard can
 * prove the silent-ping loop is actually closing.
 */
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";

export const PING_TASK = "seq-ping-location-task";

/**
 * Register the task with TaskManager.  Idempotent — Expo throws if the same
 * name is registered twice, which we swallow.
 */
export async function registerPingBackgroundTask() {
  try {
    await TaskManager.registerTaskAsync(PING_TASK);
  } catch (e: any) {
    // 'TaskManager: Task with name ... is already registered' is fine.
    if (!String(e?.message || "").includes("already registered")) {
      console.warn("[ping-bg] registerTaskAsync:", e);
    }
  }
}
