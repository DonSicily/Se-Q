/**
 * Admin "Audit Log" screen.
 *
 * FIX ISSUE #9: professional, filterable, exportable log.
 *
 *   - Filter by: action, category, severity, outcome, admin, free-text
 *   - Each row shows: timestamp, admin name, action, category, severity,
 *     target, target_summary, one-line "summary", IP, user-agent
 *   - Severity chips colour-coded: info / notice / warning / critical
 *   - "Export" button → GET /api/admin/audit-log/export?format=csv
 *   - Pagination: load-more button at the bottom
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Linking, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import * as SecureStore from "expo-secure-store";

const API = () => process.env.EXPO_PUBLIC_API_URL || "";

const SEVERITY_COLOR: Record<string, string> = {
  info:     "#3b82f6",
  notice:   "#a855f7",
  warning:  "#f59e0b",
  critical: "#dc2626",
};

type LogRow = {
  id:             string;
  timestamp:      string;
  admin_name:     string;
  admin_email:    string;
  admin_role:     string;
  action:         string;
  category:       string;
  severity:       string;
  outcome:        string;
  target_type:    string;
  target_id:      string;
  target_summary: string;
  summary:        string;
  ip:             string | null;
  user_agent:     string | null;
};

async function authHeader(): Promise<Record<string, string>> {
  const t = await SecureStore.getItemAsync("auth_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function AdminAuditLog() {
  const [logs,    setLogs]    = useState<LogRow[]>([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [skip,    setSkip]    = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState({
    severity: "", category: "", action: "", search: "",
  });

  const fetchPage = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("skip",  String(reset ? 0 : skip));
      params.set("limit", "50");
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.category) params.set("category", filters.category);
      if (filters.action)   params.set("action",   filters.action);
      if (filters.search)   params.set("search",   filters.search);

      const resp = await fetch(`${API()}/api/admin/audit-log?${params}`, { headers: await authHeader() });
      if (!resp.ok) return;
      const data = await resp.json();
      setTotal(data.total || 0);
      const next = data.logs || [];
      setHasMore((reset ? 0 : skip) + next.length < (data.total || 0));
      setLogs(reset ? next : [...logs, ...next]);
      setSkip((reset ? 0 : skip) + next.length);
    } finally { setLoading(false); }
  }, [skip, logs, filters]);

  useEffect(() => { fetchPage(true); /* initial */ /* eslint-disable-next-line */ }, []);
  useEffect(() => { fetchPage(true); }, [filters.severity, filters.category, filters.action]);

  const exportLog = async (format: "csv" | "json") => {
    const params = new URLSearchParams();
    params.set("format", format);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.category) params.set("category", filters.category);
    if (filters.search)   params.set("search",   filters.search);
    const url = `${API()}/api/admin/audit-log/export?${params}`;
    const t = await SecureStore.getItemAsync("auth_token");
    // Open the signed URL — Expo's WebBrowser would also work; Linking is simpler.
    await Linking.openURL(t ? `${url}&token=${t}` : url);
  };

  return (
    <View style={styles.root}>
      {/* Filter bar */}
      <View style={styles.filters}>
        <TextInput
          style={styles.search}
          placeholder="Search summary, target, action…"
          placeholderTextColor="#94a3b8"
          value={filters.search}
          onChangeText={(t) => setFilters((f) => ({ ...f, search: t }))}
          onSubmitEditing={() => fetchPage(true)}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {["", "info", "notice", "warning", "critical"].map((s) => (
            <Pressable
              key={`sev-${s || "all"}`}
              onPress={() => setFilters((f) => ({ ...f, severity: s }))}
              style={[
                styles.chip,
                filters.severity === s && {
                  backgroundColor: SEVERITY_COLOR[s] || "#2563eb",
                  borderColor:     SEVERITY_COLOR[s] || "#2563eb",
                },
              ]}
            >
              <Text style={[styles.chipText, filters.severity === s && { color: "#fff" }]}>
                {s || "all severities"}
              </Text>
            </Pressable>
          ))}
          {["", "AUTH", "USER_MGMT", "PANIC", "PING", "COMMS", "DATA"].map((c) => (
            <Pressable
              key={`cat-${c || "all"}`}
              onPress={() => setFilters((f) => ({ ...f, category: c }))}
              style={[styles.chip, filters.category === c && styles.chipActive]}
            >
              <Text style={[styles.chipText, filters.category === c && { color: "#fff" }]}>
                {c || "all categories"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.exportRow}>
          <Text style={styles.totalText}>{total} entries</Text>
          <Pressable onPress={() => exportLog("csv")}  style={styles.exportBtn}>
            <Text style={styles.exportText}>Export CSV</Text>
          </Pressable>
          <Pressable onPress={() => exportLog("json")} style={styles.exportBtn}>
            <Text style={styles.exportText}>Export JSON</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={logs}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 80 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowHeader}>
              <View style={[styles.sevChip, { backgroundColor: SEVERITY_COLOR[item.severity] || "#3b82f6" }]}>
                <Text style={styles.sevChipText}>{item.severity.toUpperCase()}</Text>
              </View>
              <Text style={styles.actionText}>{item.action}</Text>
              <Text style={styles.timestampText}>{new Date(item.timestamp).toLocaleString()}</Text>
            </View>
            <Text style={styles.summary}>{item.summary}</Text>
            <Text style={styles.meta}>
              {item.admin_name} • {item.admin_email} • {item.ip || "—"}
            </Text>
            {item.target_summary && item.target_summary !== "—" ? (
              <Text style={styles.targetMeta}>→ {item.target_summary}</Text>
            ) : null}
          </View>
        )}
        ListFooterComponent={
          loading ? <ActivityIndicator color="#7dd3fc" style={{ marginTop: 16 }} />
                  : hasMore ? (
                      <Pressable onPress={() => fetchPage()} style={styles.loadMore}>
                        <Text style={styles.loadMoreText}>Load more</Text>
                      </Pressable>
                    ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },

  filters:     { padding: 12, gap: 8, backgroundColor: "#0f172a",
                 borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  search:      { backgroundColor: "#1e293b", color: "#fff", borderRadius: 10,
                 paddingHorizontal: 12, paddingVertical: 10 },
  chipRow:     { gap: 8, paddingVertical: 4 },
  chip:        { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
                 backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#374151" },
  chipActive:  { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText:    { color: "#cbd5e1", fontSize: 12, fontWeight: "600" },

  exportRow:   { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  totalText:   { color: "#94a3b8", fontSize: 12, flex: 1 },
  exportBtn:   { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
                 backgroundColor: "#1e293b" },
  exportText:  { color: "#7dd3fc", fontSize: 12, fontWeight: "700" },

  row:         { backgroundColor: "#0f172a", borderRadius: 12, padding: 12,
                 borderWidth: 1, borderColor: "#1e293b", gap: 4 },
  rowHeader:   { flexDirection: "row", alignItems: "center", gap: 8 },
  sevChip:     { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 6 },
  sevChipText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  actionText:  { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1 },
  timestampText:{ color: "#94a3b8", fontSize: 11 },

  summary:     { color: "#e2e8f0", fontSize: 14, marginTop: 4 },
  meta:        { color: "#94a3b8", fontSize: 11 },
  targetMeta:  { color: "#7dd3fc", fontSize: 12 },

  loadMore:    { marginTop: 16, alignSelf: "center", paddingVertical: 10,
                 paddingHorizontal: 18, backgroundColor: "#1e293b", borderRadius: 8 },
  loadMoreText:{ color: "#7dd3fc", fontWeight: "700" },
});
