/**
 * Thin wrapper around the native SeqPanic module.
 *
 * FIX ISSUE #1: the bridge is now timestamp-aware.  Even if every other
 * dismissal path fails, a pending flag older than PENDING_TTL_MS is
 * discarded by the native side AND the JS side simply never sees it.
 *
 * Every method resolves to false on iOS (module is Android-only) and on
 * any unexpected native error so the JS layer never crashes the app.
 */
import { NativeModules, Platform } from "react-native";

type SeqPanicNative = {
  checkAndConsumePanic: () => Promise<boolean>;
  setPanicActive: (active: boolean) => Promise<boolean>;
  startShakeService: () => Promise<boolean>;
  stopShakeService: () => Promise<boolean>;
  dismissPanic: () => Promise<boolean>;
  isIgnoringBatteryOptimizations: () => Promise<boolean>;
  requestIgnoreBatteryOptimizations: () => Promise<boolean>;
  getPermissionStatus: () => Promise<Record<string, boolean> | null>;
};

const Native: SeqPanicNative | undefined =
  (NativeModules as any).SeqPanic as SeqPanicNative | undefined;

const isAndroid = Platform.OS === "android";

/** Returns true exactly once if a pending panic flag was found and consumed.
 *  Returns false on iOS, when the module is missing, or when no flag is set. */
export async function checkAndConsumePanic(): Promise<boolean> {
  if (!isAndroid || !Native) return false;
  try { return await Native.checkAndConsumePanic(); } catch { return false; }
}

/** Tells the native service whether a panic is currently active. */
export async function setPanicActive(active: boolean): Promise<boolean> {
  if (!isAndroid || !Native) return false;
  try { return await Native.setPanicActive(active); } catch { return false; }
}

/** Starts the foreground ShakeDetectionService. */
export async function startShakeService(): Promise<boolean> {
  if (!isAndroid || !Native) return false;
  try { return await Native.startShakeService(); } catch { return false; }
}

/** Stops the foreground ShakeDetectionService. */
export async function stopShakeService(): Promise<boolean> {
  if (!isAndroid || !Native) return false;
  try { return await Native.stopShakeService(); } catch { return false; }
}

/** Explicitly cancels a pending panic (e.g. user pressed "I'm OK" in the app). */
export async function dismissPanic(): Promise<boolean> {
  if (!isAndroid || !Native) return false;
  try { return await Native.dismissPanic(); } catch { return false; }
}

/** Battery-optimisation probe (used by the onboarding checklist). */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (!isAndroid || !Native) return true;
  try { return await Native.isIgnoringBatteryOptimizations(); } catch { return false; }
}

/** Opens the system "ignore battery optimisation" dialog. */
export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (!isAndroid || !Native) return true;
  try { return await Native.requestIgnoreBatteryOptimizations(); } catch { return false; }
}

/** Returns the current OS-level permission map (Issue #7). */
export async function getPermissionStatus(): Promise<Record<string, boolean> | null> {
  if (!isAndroid || !Native) return null;
  try { return await Native.getPermissionStatus(); } catch { return null; }
}
