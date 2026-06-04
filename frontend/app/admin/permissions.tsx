/**
 * Admin "Permissions Health" screen.
 *
 * FIX ISSUE #7: shows which users are missing which required permissions.
 * Data source: GET /api/admin/permissions-compliance.
 *
 * Each row is colour-coded by the number of missing required permissions:
 *   0 → green (all good)
 *   1 → amber
 *   2+ → red
 *
 * "Stale" rows (last checkup > 7 days ago) are flagged so the admin can
 * ask the user to re-open the app.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import * as SecureStore from "expo-secure-store";

const API = () => process.env.EXPO_PUBLIC_API_URL || "";

type Row = {
  user_id:          string;
  role:             string;
  missing_required: string[];
  checked_at:       string | null;
};

type ComplianceData = {
  rows:              Row[];
  summary:           Record<string, Record<string, number>>;
  total_by_role:     Record<string, number>;
  stale_by_role:     Record<string, number>;
  permission_labels: Record<string, string>;
};

const PERM_LABELS: Record<string, string> = {
  location_fine:            "Precise location",
  location_background:      "Background location",
  microphone:               "Microphone",
  camera:                   "Camera",
  notifications:            "Push notifications",
  battery_optimization_off: "Battery optimisation",
  sms:                      "SMS",
};

async function authHeader(): Promise<Record<string, string>> {
  const t = await SecureStore.getItemAsync("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function AdminPermissionsScreen() {
  const [data,    setData]    = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [role,    setRole]    = useState<"" | "civil" | "security" | "admin">("");

  const load = async () => {
    setRefreshing(true);
    try {
      const url = role ? `${API()}/api/admin/permissions-compliance?role=${role}` : `${API()}/api/admin/permissions-compliance`;
      const resp = await fetch(url, { headers: await authHeader() });
      if (resp.ok) setData(await resp.json());
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, [role]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#7dd3fc" /></View>;
  }
  if (!data) {
    return <View style={styles.center}><Text style={styles.error}>Failed to load.</Text></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Permissions Health</Text>
        <Text style={styles.subtitle}>
          How many users are missing the permissions required to do their job.
        </Text>

        <View style={styles.chipRow}>
          {(["", "civil", "security", "admin"] as const).map((r) => (
            <Pressable
              key={r || "all"}
              onPress={() => setRole(r)}
              style={[styles.chip, role === r && styles.chipActive]}
            >
              <Text style={[styles.chipText, role === r && { color: "#fff" }]}>{r || "all roles"}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.statRow}>
          {(["civil", "security", "admin"] as const).map((r) => (
            <View key={r} style={styles.statBox}>
              <Text style={styles.statLabel}>{r}</Text>
              <Text style={styles.statValue}>{data.total_by_role?.[r] || 0}</Text>
              <Text style={styles.statSub}>
                {(data.stale_by_role?.[r] || 0)} stale
              </Text>
            </View>
          ))}
        </View>

        {Object.keys(data.summary).length > 0 && (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>Top missing permissions</Text>
            {Object.entries(data.summary).map(([role, perms]) => (
              <View key={role} style={{ marginTop: 4 }}>
                <Text style={styles.summaryRole}>{role.toUpperCase()}</Text>
                {Object.entries(perms)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([key, count]) => (
                    <Text key={key} style={styles.summaryLine}>
                      • {PERM_LABELS[key] || key} — <Text style={{ color: "#fca5a5" }}>{count} users</Text>
                    </Text>
                  ))}
              </View>
            ))}
          </View>
        )}
      </View>

      <FlatList
        data={data.rows}
        keyExtractor={(r) => r.user_id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#7dd3fc" />}
        ListEmptyComponent={<Text style={styles.empty}>No permission reports yet.</Text>}
        renderItem={({ item }) => {
          const missing = item.missing_required?.length || 0;
          const color   = missing === 0 ? "#16a34a" : missing === 1 ? "#f59e0b" : "#dc2626";
          const checkedAgeDays = item.checked_at
            ? Math.floor((Date.now() - new Date(item.checked_at).getTime()) / (1000 * 60 * 60 * 24))
            : null;
          return (
            <View style={[styles.row, { borderLeftColor: color, borderLeftWidth: 4 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.role}  •  {item.user_id.slice(-6)}</Text>
                <Text style={styles.rowMeta}>
                  {missing === 0
                    ? "All required permissions granted"
                    : `Missing: ${item.missing_required.map(k => PERM_LABELS[k] || k).join(", ")}`}
                </Text>
                {checkedAgeDays !== null && checkedAgeDays > 7 && (
                  <Text style={styles.stale}>Stale — last checkup {checkedAgeDays} days ago</Text>
                )}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },
  center:      { flex: 1, backgroundColor: "#0b1220", alignItems: "center", justifyContent: "center" },
  error:       { color: "#fca5a5" },

  header:      { padding: 16, paddingTop: 56, gap: 10, backgroundColor: "#0f172a",
                 borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  title:       { color: "#fff", fontSize: 22, fontWeight: "700" },
  subtitle:    { color: "#94a3b8", fontSize: 13 },

  chipRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  chip:        { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
                 backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#374151" },
  chipActive:  { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText:    { color: "#cbd5e1", fontSize: 12, fontWeight: "600" },

  statRow:     { flexDirection: "row", gap: 8, marginTop: 6 },
  statBox:     { flex: 1, backgroundColor: "#1e293b", borderRadius: 10, padding: 10, alignItems: "center" },
  statLabel:   { color: "#94a3b8", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  statValue:   { color: "#fff", fontSize: 20, fontWeight: "800" },
  statSub:     { color: "#94a3b8", fontSize: 11 },

  summaryBox:  { backgroundColor: "#1e293b", borderRadius: 10, padding: 10, marginTop: 6 },
  summaryTitle:{ color: "#fff", fontSize: 13, fontWeight: "700" },
  summaryRole: { color: "#7dd3fc", fontSize: 11, fontWeight: "700", marginTop: 4 },
  summaryLine: { color: "#cbd5e1", fontSize: 12 },

  empty:       { color: "#94a3b8", textAlign: "center", marginTop: 24 },

  row:         { flexDirection: "row", backgroundColor: "#0f172a", borderRadius: 12,
                 padding: 12, borderWidth: 1, borderColor: "#1e293b" },
  rowTitle:    { color: "#fff", fontSize: 13, fontWeight: "700" },
  rowMeta:     { color: "#cbd5e1", fontSize: 12, marginTop: 4 },
  stale:       { color: "#f59e0b", fontSize: 11, marginTop: 4, fontStyle: "italic" },
});
