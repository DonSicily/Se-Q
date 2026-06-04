/**
 * usePermissionsCheckup — Issue #7
 *
 * Schedules a periodic permissions self-check.  The flow is:
 *
 *   on app start                 →  check now
 *   on every AppState → active   →  check now
 *   on every 24h interval        →  check now
 *   on any new permission grant  →  re-check (optional)
 *
 * "Check" means:
 *   1. Ask the native bridge for the device-level permission map.
 *   2. POST it to /api/user/permissions-check so the backend can compute
 *      "missing required permissions per role".
 *   3. Expose a checklist + a banner in the UI.
 *
 * Implementation notes:
 *   - The hook is intentionally tiny and never throws.  Permission probes
 *     can fail (e.g. user revoked while the app is in background); we
 *     just log and try again next tick.
 *   - We do NOT nag the user with native permission dialogs from this
 *     hook.  That belongs in the dedicated onboarding screen which
 *     explains each permission in turn.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getPermissionStatus } from "../utils/nativePanicBridge";

const STORAGE_KEY_NEXT_CHECK = "perm_check_next_at";
const STORAGE_KEY_LAST_CHECK = "perm_check_last_at";
const STORAGE_KEY_CHECKLIST  = "perm_checklist";
const TWENTY_FOUR_HOURS_MS   = 24 * 60 * 60 * 1000;

export type PermChecklist = Array<{
  key:      string;
  label:    string;
  granted:  boolean;
  required: boolean;
}>;

export type PermState = {
  loading:      boolean;
  checklist:     PermChecklist;
  missingRequired: string[];
  lastCheckedAt:  number | null;
  nextCheckAt:    number | null;
};

const EMPTY: PermState = {
  loading: false, checklist: [], missingRequired: [],
  lastCheckedAt: null, nextCheckAt: null,
};

export function usePermissionsCheckup() {
  const [state, setState] = useState<PermState>(EMPTY);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performCheck = useCallback(async () => {
    try {
      setState(s => ({ ...s, loading: true }));

      // 1) Native introspection (Android only).
      const perms = (await getPermissionStatus()) || {};
      // 2) Always include the platforms we know about so the checklist is
      //    consistent even on iOS where the native module returns null.
      const normalised: Record<string, boolean> = {
        location_fine:           perms.location_fine           ?? false,
        location_coarse:         perms.location_coarse         ?? false,
        location_background:     perms.location_background     ?? false,
        camera:                  perms.camera                  ?? false,
        microphone:              perms.microphone              ?? false,
        sms:                     perms.sms                     ?? false,
        notifications:           perms.notifications           ?? false,
        full_screen_intent:      perms.full_screen_intent      ?? true,
        battery_optimization_off: perms.battery_optimization_off ?? true,
      };

      // 3) POST to the backend so the admin can see compliance.
      const token = await AsyncStorage.getItem("auth_token");
      if (!token) return;
      const apiBase = process.env.EXPO_PUBLIC_API_URL || "";
      const resp = await fetch(`${apiBase}/api/user/permissions-check`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          permissions: normalised,
          platform:    Platform.OS,
          os_version:  String(Platform.Version),
        }),
      });
      const data = await resp.json();

      const now      = Date.now();
      const nextAt   = now + TWENTY_FOUR_HOURS_MS;
      await AsyncStorage.multiSet([
        [STORAGE_KEY_LAST_CHECK, String(now)],
        [STORAGE_KEY_NEXT_CHECK, String(nextAt)],
        [STORAGE_KEY_CHECKLIST,  JSON.stringify(data.checklist || [])],
      ]);

      setState({
        loading:          false,
        checklist:        data.checklist || [],
        missingRequired:  data.missing_required || [],
        lastCheckedAt:    now,
        nextCheckAt:      nextAt,
      });
    } catch (e) {
      console.warn("[usePermissionsCheckup] check failed:", e);
      setState(s => ({ ...s, loading: false }));
    }
  }, []);

  const scheduleNext = useCallback((delayMs: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      performCheck().finally(() => scheduleNext(TWENTY_FOUR_HOURS_MS));
    }, Math.max(0, delayMs));
  }, [performCheck]);

  // Kick off on mount + on every foreground transition.
  useEffect(() => {
    (async () => {
      // Restore last known state so the UI shows something immediately.
      try {
        const [last, next, list] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_LAST_CHECK),
          AsyncStorage.getItem(STORAGE_KEY_NEXT_CHECK),
          AsyncStorage.getItem(STORAGE_KEY_CHECKLIST),
        ]);
        if (list) {
          setState(s => ({
            ...s,
            checklist:     JSON.parse(list) || [],
            lastCheckedAt: last ? Number(last) : null,
            nextCheckAt:   next ? Number(next) : null,
          }));
        }
      } catch { /* non-fatal */ }

      performCheck();
      const dueIn = Math.max(0, Number(await AsyncStorage.getItem(STORAGE_KEY_NEXT_CHECK) || 0) - Date.now());
      scheduleNext(dueIn);
    })();

    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") performCheck();
    });
    return () => {
      sub.remove();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [performCheck, scheduleNext]);

  return { ...state, performCheck, scheduleNext };
}
