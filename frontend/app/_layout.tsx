/**
 * Root layout — wires up the native panic bridge.
 *
 * FIX ISSUE #1:
 *  - Calls checkAndConsumePanic() on cold start AND every AppState "active"
 *    transition.  If the native service reports a pending panic (i.e. the
 *    user tapped the heads-up), we route to the panic-shake screen.
 *  - If the user IGNORES the heads-up (no tap), the native side clears the
 *    flag through one of three paths (Cancel action, swipe-away, timeout)
 *    AND/OR the JS bridge treats the flag as stale (>30s) and discards it.
 *    In neither case is the app pulled to the foreground on its own.
 *  - On any successful consume we explicitly call router.push() to the
 *    panic-shake screen.  We never rely on the launch intent alone.
 *  - Schedules a periodic permissions check-up (Issue #7).
 */

import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { checkAndConsumePanic, setPanicActive, startShakeService, stopShakeService } from "../utils/nativePanicBridge";
import { usePermissionsCheckup } from "../hooks/usePermissionsCheckup";
import { registerPingBackgroundTask, PING_TASK } from "../utils/pingBackground";

const PANIC_ROUTE        = "/civil/panic-shake";
const STORAGE_KEY_ROLE   = "user_role";
const STORAGE_KEY_TOKEN  = "auth_token";

TaskManager.defineTask(PING_TASK, async ({ data, error }) => {
  // Background task: a silent "ping" or "location_ping" push was received.
  // We acquire a fresh GPS fix and POST /api/location/ping-update with it.
  if (error) return;
  const notification = (data as any)?.notification;
  const payload      = notification?.request?.content?.data || data;
  const type = payload?.type;
  if (type !== "ping" && type !== "location_ping") return;

  try {
    const { getCurrentLocation } = await import("../lib/location");
    const loc = await getCurrentLocation({ accuracy: "high" });
    if (!loc) return;
    const token = await AsyncStorage.getItem(STORAGE_KEY_TOKEN);
    if (!token) return;
    await fetch(`${process.env.EXPO_PUBLIC_API_URL || ""}/api/location/ping-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy:  loc.coords.accuracy,
        ping_id:   payload?.ping_id,    // echo back so the backend can correlate
      }),
    });
  } catch (e) {
    console.warn("[PING_TASK] failed to post location", e);
  }
});

export default function RootLayout() {
  const router       = useRouter();
  const segments     = useSegments();
  const consumedOnce = useRef(false);
  const { scheduleNext } = usePermissionsCheckup();

  // 1) On mount, ask the OS for notification permission and start shake service
  //    (civil role only — security/admin have no use for shake).
  useEffect(() => {
    (async () => {
      try {
        const role = await AsyncStorage.getItem(STORAGE_KEY_ROLE);
        if (role === "civil") {
          await startShakeService();
          await setPanicActive(false);
        } else {
          await stopShakeService();
        }
      } catch (e) { console.warn(e); }

      // 2) Register background handler for silent "ping" pushes (Issue #5).
      await registerPingBackgroundTask();

      // 3) Schedule first permissions check-up (Issue #7).
      scheduleNext(0);
    })();
  }, []);

  // 4) Cold start — did we launch with a pending panic from the heads-up?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await checkAndConsumePanic();
      if (cancelled) return;
      if (!pending) return;
      const role = await AsyncStorage.getItem(STORAGE_KEY_ROLE);
      if (role !== "civil") return;                  // only civil can panic
      const current = segments.join("/");
      if (current.startsWith("civil/panic")) return;  // already there
      router.push(PANIC_ROUTE);
      consumedOnce.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // 5) Warm start — same check every time the app foregrounds.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next: AppStateStatus) => {
      if (next !== "active") return;
      const pending = await checkAndConsumePanic();
      if (!pending) return;
      const role = await AsyncStorage.getItem(STORAGE_KEY_ROLE);
      if (role !== "civil") return;
      const current = segments.join("/");
      if (current.startsWith("civil/panic")) return;
      router.push(PANIC_ROUTE);
    });
    return () => sub.remove();
  }, [segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="auth/login" />
      <Stack.Screen name="civil/home" />
      <Stack.Screen name="civil/panic-shake" options={{ gestureEnabled: false }} />
      <Stack.Screen name="civil/panic-active" options={{ gestureEnabled: false }} />
      <Stack.Screen name="civil/escort" />
      <Stack.Screen name="civil/chat/[conversationId]" />
      <Stack.Screen name="security/home" />
      <Stack.Screen name="security/track" />
      <Stack.Screen name="security/escorts" />
      <Stack.Screen name="security/chat/[conversationId]" />
      <Stack.Screen name="admin/dashboard" />
      <Stack.Screen name="admin/audit-log" />
      <Stack.Screen name="admin/permissions" />
      <Stack.Screen name="admin/ping-events" />
      <Stack.Screen name="admin/export" />
    </Stack>
  );
}
