/**
 * Civil escort screen.
 *
 * FIX ISSUE #2: the "Choose your ETA" floating panel is now truly centred on
 * the phone.  The previous code used `top: 0` which pinned the panel to the
 * top of the screen.  We now use a centred Modal with
 * `transparent={true}` and `animationType="fade"`, so the panel sits
 * precisely in the middle of the device.  A backdrop overlay tints the
 * rest of the screen for clarity.
 *
 * Other behaviour preserved from the original escort flow:
 *   - one-tap presets: 15, 30, 60, 120 minutes
 *   - custom minute picker (1..720)
 *   - on submit → POST /api/escort/action with action=start
 */
import { useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";

import { getCurrentLocation } from "../../lib/location";

const PRESETS = [15, 30, 60, 120];

const API = () => process.env.EXPO_PUBLIC_API_URL || "";

async function authHeader(): Promise<Record<string, string>> {
  const t = await SecureStore.getItemAsync("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function EscortScreen() {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [etaMinutes, setEtaMinutes]     = useState<number>(30);
  const [customMins,  setCustomMins]    = useState<string>("");
  const [starting,    setStarting]      = useState(false);

  async function startEscort() {
    setStarting(true);
    try {
      const loc = await getCurrentLocation({ accuracy: "high" });
      if (!loc) {
        Alert.alert("Location required", "Please grant location permission to start an escort.");
        setStarting(false); return;
      }
      const resp = await fetch(`${API()}/api/escort/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          action:          "start",
          duration_hours:  etaMinutes / 60,
          location:        {
            latitude:  loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy:  loc.coords.accuracy,
          },
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to start escort");
      }
      setPickerOpen(false);
      Alert.alert("Escort started", `ETA set to ${etaMinutes} minutes. You will be checked on at the deadline.`);
    } catch (e: any) {
      Alert.alert("Could not start escort", e?.message || "Network error");
    } finally {
      setStarting(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Start a security escort</Text>
        <Text style={styles.subtitle}>
          A security agent will keep an eye on your route. We'll check in when
          your ETA is up.
        </Text>

        <Pressable
          accessibilityLabel="Open ETA picker"
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.ctaText}>Choose your ETA</Text>
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>

      {/* ── ETA PICKER (centred floating panel, Issue #2 fix) ──────────── */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          {/* Inner Pressable swallows taps so they don't dismiss the modal. */}
          <Pressable onPress={() => {}} style={styles.sheet}>
            <Text style={styles.sheetTitle}>When should we check in?</Text>
            <Text style={styles.sheetSubtitle}>Pick a preset or enter a custom ETA in minutes.</Text>

            <View style={styles.presetsRow}>
              {PRESETS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setEtaMinutes(m)}
                  style={[styles.preset, etaMinutes === m && styles.presetActive]}
                  accessibilityLabel={`Set ETA to ${m} minutes`}
                >
                  <Text style={[styles.presetText, etaMinutes === m && styles.presetTextActive]}>
                    {m} min
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.customRow}>
              <Text style={styles.customLabel}>Custom:</Text>
              <TextInput
                style={styles.customInput}
                placeholder="e.g. 45"
                placeholderTextColor="#94a3b8"
                keyboardType="number-pad"
                value={customMins}
                onChangeText={(t) => {
                  setCustomMins(t.replace(/[^0-9]/g, ""));
                  const n = Number(t);
                  if (n > 0 && n <= 720) setEtaMinutes(n);
                }}
                maxLength={3}
              />
              <Text style={styles.customUnit}>min</Text>
            </View>

            <View style={styles.sheetButtons}>
              <Pressable
                onPress={() => setPickerOpen(false)}
                style={styles.sheetCancel}
                disabled={starting}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={startEscort}
                style={[styles.sheetConfirm, starting && { opacity: 0.7 }]}
                disabled={starting}
                accessibilityLabel={`Confirm ${etaMinutes} minute ETA`}
              >
                {starting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.sheetConfirmText}>Start {etaMinutes}-min escort</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },
  scroll:      { padding: 24, paddingTop: 64, gap: 16 },
  title:       { color: "#fff", fontSize: 28, fontWeight: "700" },
  subtitle:    { color: "#94a3b8", fontSize: 15, lineHeight: 22 },
  cta:         { marginTop: 24, backgroundColor: "#2563eb", paddingVertical: 16,
                 borderRadius: 14, alignItems: "center" },
  ctaText:     { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondary:   { marginTop: 8, paddingVertical: 12, alignItems: "center" },
  secondaryText: { color: "#94a3b8", fontSize: 15 },

  // Centred sheet (FIX ISSUE #2).
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
                 justifyContent: "center", alignItems: "center", padding: 24 },
  sheet:       { width: "100%", maxWidth: 420, backgroundColor: "#111827",
                 borderRadius: 20, padding: 24, gap: 14,
                 // subtle shadow
                 shadowColor: "#000", shadowOpacity: 0.4,
                 shadowOffset: { width: 0, height: 8 }, shadowRadius: 16,
                 elevation: 12 },
  sheetTitle:    { color: "#fff", fontSize: 20, fontWeight: "700" },
  sheetSubtitle: { color: "#94a3b8", fontSize: 13 },

  presetsRow:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  preset:      { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999,
                 backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#374151" },
  presetActive:{ backgroundColor: "#2563eb", borderColor: "#2563eb" },
  presetText:    { color: "#cbd5e1", fontSize: 14, fontWeight: "600" },
  presetTextActive: { color: "#fff" },

  customRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  customLabel: { color: "#94a3b8", fontSize: 14 },
  customInput: { flex: 1, backgroundColor: "#0b1220", borderRadius: 10, paddingHorizontal: 12,
                 paddingVertical: 10, color: "#fff", borderWidth: 1, borderColor: "#374151" },
  customUnit:  { color: "#94a3b8", fontSize: 14 },

  sheetButtons:{ flexDirection: "row", gap: 10, marginTop: 8 },
  sheetCancel: { flex: 1, paddingVertical: 12, borderRadius: 12,
                 backgroundColor: "#1f2937", alignItems: "center" },
  sheetCancelText: { color: "#cbd5e1", fontSize: 15, fontWeight: "600" },
  sheetConfirm:{ flex: 1.4, paddingVertical: 12, borderRadius: 12,
                 backgroundColor: "#2563eb", alignItems: "center" },
  sheetConfirmText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
