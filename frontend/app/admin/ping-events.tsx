/**
 * Admin "Ping Events" screen.
 *
 * FIX ISSUE #5 + #6: shows the full ping contract end-to-end.  Each
 * dispatched ping is a row; columns include:
 *
 *   - dispatched_at / responded_at / latency_ms
 *   - requester (admin/security)
 *   - target (civil/security) and target_name
 *   - status (dispatched / responded / no_push_token / push_failed)
 *   - reason
 *
 * The "responded" badge turns green; "no_push_token" / "push_failed" turns
 * red; "dispatched" (still waiting on the device) turns amber.
 *
 * Pull-to-refresh.  Filter chips for status.
 */
import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import * as SecureStore from "expo-secure-store";

const API = () => process.env.EXPO_PUBLIC_API_URL || "";

const STATUS_COLOR: Record<string, string> = {
  responded:         "#16a34a",
  dispatched:        "#f59e0b",
  no_push_token:     "#dc2626",
  push_failed:       "#dc2626",
  "responded (fallback)": "#10b981",
};

type Event = {
  id:                string;
  target_user_id:    string;
  target_name:       string;
  target_role:       string;
  requester_name:    string;
  requester_kind:    string;
  notif_type:        string;
  status:            string;
  dispatched_at:     string;
  responded_at:      string | null;
  latency_ms:        number | null;
};

async function authHeader(): Promise<Record<string, string>> {
  const t = await SecureStore.getItemAsync("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function AdminPingEvents() {
  const [events,   setEvents]   = useState<Event[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (statusFilter) params.set("status", statusFilter);
      const resp = await fetch(`${API()}/api/admin/ping-events?${params}`, { headers: await authHeader() });
      if (resp.ok) {
        const data = await resp.json();
        setEvents(data.events || []);
        setTotal(data.total || 0);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#7dd3fc" /></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Ping Events</Text>
        <Text style={styles.subtitle}>
          {total} total dispatches. "dispatched" means the silent push left
          the server; "responded" means the recipient's device POSTed back a
          fresh GPS fix.
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {["", "dispatched", "responded", "no_push_token", "push_failed"].map((s) => (
            <Pressable
              key={s || "all"}
              onPress={() => setStatusFilter(s)}
              style={[styles.chip, statusFilter === s && { backgroundColor: STATUS_COLOR[s] || "#2563eb", borderColor: STATUS_COLOR[s] || "#2563eb" }]}
            >
              <Text style={[styles.chipText, statusFilter === s && { color: "#fff" }]}>{s || "all"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#7dd3fc" />}
        ListEmptyComponent={<Text style={styles.empty}>No events yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowHeader}>
              <View style={[styles.statusChip, { backgroundColor: STATUS_COLOR[item.status] || "#3b82f6" }]}>
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
              <Text style={styles.timestamp}>{new Date(item.dispatched_at).toLocaleString()}</Text>
            </View>

            <Text style={styles.line}>
              <Text style={styles.muted}>From:</Text> {item.requester_name} ({item.requester_kind})
            </Text>
            <Text style={styles.line}>
              <Text style={styles.muted}>To:</Text> {item.target_name || "—"} ({item.target_role})
            </Text>
            <Text style={styles.line}>
              <Text style={styles.muted}>Type:</Text> {item.notif_type}
            </Text>
            {item.responded_at && (
              <Text style={styles.line}>
                <Text style={styles.muted}>Latency:</Text>{" "}
                <Text style={{ color: "#10b981" }}>{item.latency_ms} ms</Text>
              </Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },
  center:      { flex: 1, backgroundColor: "#0b1220", alignItems: "center", justifyContent: "center" },

  header:      { padding: 16, paddingTop: 56, gap: 8, backgroundColor: "#0f172a",
                 borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  title:       { color: "#fff", fontSize: 22, fontWeight: "700" },
  subtitle:    { color: "#94a3b8", fontSize: 12, lineHeight: 18 },

  chipRow:     { gap: 8, paddingTop: 6 },
  chip:        { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
                 backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#374151" },
  chipText:    { color: "#cbd5e1", fontSize: 12, fontWeight: "600" },

  empty:       { color: "#94a3b8", textAlign: "center", marginTop: 24 },

  row:         { backgroundColor: "#0f172a", borderRadius: 12, padding: 12,
                 borderWidth: 1, borderColor: "#1e293b", gap: 4 },
  rowHeader:   { flexDirection: "row", alignItems: "center", gap: 8 },
  statusChip:  { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 6 },
  statusText:  { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  timestamp:   { color: "#94a3b8", fontSize: 11, flex: 1, textAlign: "right" },

  line:        { color: "#e2e8f0", fontSize: 13 },
  muted:       { color: "#94a3b8" },
});
