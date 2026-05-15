/**
 * utils/nativePanicBridge.ts
 *
 * JS wrapper around the native SeqPanicModule (Android only).
 *
 * ShakeDetectionService writes SharedPreferences flags when shake events
 * fire. This module provides two functions:
 *
 *   checkAndConsumePanic()
 *     Reads + clears PREFS_KEY_PENDING. Returns true once per shake event.
 *     Used in _layout.tsx to navigate to the panic screen.
 *
 *   setNativePanicActive(active)
 *     Writes PREFS_KEY_PANIC_ACTIVE so the native service knows whether a
 *     panic is already running. When true, ShakeDetectionService will skip
 *     accidental re-triggers. Call with true on activation, false on resolve.
 *
 * iOS: both functions return safely without doing anything (module is
 * Android-only).
 */

import { NativeModules, Platform } from 'react-native';

const { SeqPanic } = NativeModules;

export async function checkAndConsumePanic(): Promise<boolean> {
  if (Platform.OS !== 'android' || !SeqPanic) return false;
  try {
    const result = await SeqPanic.checkAndConsumePanic();
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Inform the native ShakeDetectionService whether a panic is currently active.
 * Call setNativePanicActive(true)  immediately after panic/activate succeeds.
 * Call setNativePanicActive(false) when the user marks themselves safe.
 */
export async function setNativePanicActive(active: boolean): Promise<void> {
  if (Platform.OS !== 'android' || !SeqPanic?.setPanicActive) return;
  try {
    await SeqPanic.setPanicActive(active);
  } catch {
    // Non-fatal — swallow silently
  }
}
