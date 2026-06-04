/**
 * Admin "Search & Export" screen.
 *
 * FIX ISSUE #8: a real download centre.  Pick a dataset, set the date
 * range / role / status filters, then download as CSV or JSON.  The
 * browser (or in-app WebView if you wire one) saves the file via the
 * Content-Disposition: attachment header that the backend sets.
 *
 * Datasets:
 *   users, panics, escorts, reports, messages, ping_events, audit
 */
import { useState } from "react";
import {
  Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as SecureStore from "expo-secure-store";

const API = () => process.env.EXPO_PUBLIC_API_URL || "";

const DATASETS = [
  { key: "users",       label: "Users" },
  { key: "panics",      label: "Panic events" },
  { key: "escorts",     label: "Escort sessions" },
  { key: "reports",     label: "Civil reports" },
  { key: "messages",    label: "Chat messages" },
  { key: "ping_events", label: "Ping events" },
  { key: "audit",       label: "Audit log" },
];

async function authHeader(): Promise<Record<string, string>> {
  const t = await SecureStore.getItemAsync("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function AdminExport() {
  const [dataset, setDataset] = useState("users");
  const [format,  setFormat]  = useState<"csv" | "json">("csv");
  const [role,    setRole]    = useState<"" | "civil" | "security" | "admin">("");
  const [status,  setStatus]  = useState<"" | "active" | "completed">("");
  const [since,   setSince]   = useState("");
  const [until,   setUntil]   = useState("");

  const download = async () => {
    const params = new URLSearchParams();
    params.set("dataset", dataset);
    params.set("format",  format);
    if (role)   params.set("role",   role);
    if (status) params.set("status", status);
    if (since)  params.set("since",  new Date(since).toISOString());
    if (until)  params.set("until",  new Date(until).toISOString());
    const url = `${API()}/api/admin/export?${params}`;
    const t = await SecureStore.getItemAsync("auth_token");
    // The backend requires the bearer header.  Linking.openURL does NOT send
    // custom headers, so we use fetch() to download to memory, then either
    // share / save via expo-sharing or, in dev, fall back to opening a
    // signed URL in the browser.
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
      if (!resp.ok) {
        alert(`Download failed: ${resp.status}`);
        return;
      }
      const blob = await resp.blob();
      // Best-effort: write the file to the document directory and hand it to
      // the system share sheet so the admin can save it locally.
      try {
        const FileSystem = await import("expo-file-system");
        const Sharing    = await import("expo-sharing");
        const fileUri = `${FileSystem.cacheDirectory}seq_export_${Date.now()}.${format}`;
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
          reader.onload  = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const base64 = dataUrl.split(",", 2)[1];
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, { mimeType: format === "csv" ? "text/csv" : "application/json" });
        } else {
          await Linking.openURL(fileUri);
        }
      } catch (inner) {
        console.warn("Save-to-disk fallback failed, opening URL:", inner);
        await Linking.openURL(url);
      }
    } catch (e: any) {
      alert(`Download failed: ${e?.message || "Network error"}`);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={styles.title}>Search &amp; Export</Text>
      <Text style={styles.subtitle}>
        Download a real file (CSV or JSON) of any platform dataset. The
        download is logged in the audit trail so you can prove exactly what
        was extracted, by whom, and when.
      </Text>

      <Text style={styles.label}>Dataset</Text>
      <View style={styles.row}>
        {DATASETS.map((d) => (
          <Pressable
            key={d.key}
            onPress={() => setDataset(d.key)}
            style={[styles.chip, dataset === d.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, dataset === d.key && { color: "#fff" }]}>{d.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Format</Text>
      <View style={styles.row}>
        {(["csv", "json"] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFormat(f)}
            style={[styles.chip, format === f && styles.chipActive]}
          >
            <Text style={[styles.chipText, format === f && { color: "#fff" }]}>{f.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Role (optional)</Text>
      <View style={styles.row}>
        {(["", "civil", "security", "admin"] as const).map((r) => (
          <Pressable
            key={r || "any"}
            onPress={() => setRole(r)}
            style={[styles.chip, role === r && styles.chipActive]}
          >
            <Text style={[styles.chipText, role === r && { color: "#fff" }]}>{r || "any"}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Status (panics / escorts)</Text>
      <View style={styles.row}>
        {(["", "active", "completed"] as const).map((s) => (
          <Pressable
            key={s || "any"}
            onPress={() => setStatus(s)}
            style={[styles.chip, status === s && styles.chipActive]}
          >
            <Text style={[styles.chipText, status === s && { color: "#fff" }]}>{s || "any"}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Date range</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Since (YYYY-MM-DD)"
          placeholderTextColor="#94a3b8"
          value={since}
          onChangeText={setSince}
        />
        <TextInput
          style={styles.input}
          placeholder="Until (YYYY-MM-DD)"
          placeholderTextColor="#94a3b8"
          value={until}
          onChangeText={setUntil}
        />
      </View>

      <Pressable
        onPress={download}
        style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.downloadText}>⬇  Download {format.toUpperCase()}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },
  title:       { color: "#fff", fontSize: 24, fontWeight: "700", marginTop: 24 },
  subtitle:    { color: "#94a3b8", fontSize: 14, lineHeight: 20 },
  label:       { color: "#cbd5e1", fontSize: 13, fontWeight: "600", marginTop: 8 },

  row:         { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:        { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999,
                 backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#374151" },
  chipActive:  { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText:    { color: "#cbd5e1", fontSize: 13, fontWeight: "600" },

  input:       { flex: 1, minWidth: 140, backgroundColor: "#1e293b", color: "#fff",
                 borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },

  downloadBtn: { marginTop: 16, backgroundColor: "#0ea5e9", paddingVertical: 16,
                 borderRadius: 14, alignItems: "center" },
  downloadText:{ color: "#fff", fontSize: 16, fontWeight: "700" },
});
