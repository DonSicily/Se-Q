/**
 * Security "Search & Track" screen.
 *
 * FIX ISSUE #6: this is now the SAME flow as the admin "Track Users" screen,
 * just gated on the security role (which can only ping CIVIL users).
 *
 * UX:
 *  1. Type a name / email / phone.
 *  2. Tap a result card → opens the track detail.
 *  3. The detail page shows the user's current position (panic, escort,
 *     or ping-response) and offers a single big "PING" button.
 *  4. PING hits the unified /api/security/ping-user/{uid} contract and
 *     shows the response ("Ping sent — awaiting location", "offline —
 *     skipped", "no push token", etc.).
 *  5. The map auto-refreshes every 10s to pick up the ping response.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as SecureStore from "expo-secure-store";

import { dismissPanic } from "../../utils/nativePanicBridge";

const API = () => process.env.EXPO_PUBLIC_API_URL || "";
const REFRESH_MS = 10000;

type UserHit = {
  user_id:   string;
  full_name: string;
  email:     string;
  phone:     string;
  role:      string;
};

type TrackData = {
  is_active:        boolean;
  has_panic:        boolean;
  has_escort:       boolean;
  source:           string | null;
  latitude:         number | null;
  longitude:        number | null;
  last_update:      string | null;
  location_history: Array<{ latitude: number; longitude: number; timestamp?: string }>;
  user_id:          string;
  full_name:        string | null;
  email:            string | null;
  phone:            string | null;
  role:             string | null;
  profile_photo_url?: string | null;
};

async function authHeader(): Promise<Record<string, string>> {
  const t = await SecureStore.getItemAsync("auth_token");
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export default function SecurityTrackScreen() {
  const [query, setQuery]       = useState("");
  const [hits,   setHits]       = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<TrackData | null>(null);
  const [pinging,  setPinging]  = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Search.
  useEffect(() => {
    if (!query.trim()) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await fetch(`${API()}/api/security/search-user?query=${encodeURIComponent(query)}`, {
          headers: await authHeader(),
          signal: ctrl.signal,
        });
        if (resp.ok) {
          const data = await resp.json();
          setHits([data]);
        } else {
          setHits([]);
        }
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 300);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [query]);

  // Auto-refresh track detail.
  useEffect(() => {
    if (!selected) return;
    timerRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${API()}/api/security/track-user/${selected.user_id}`, { headers: await authHeader() });
        if (resp.ok) {
          const data: TrackData = await resp.json();
          setSelected((prev) => ({ ...(prev as TrackData), ...data }));
        }
      } catch { /* ignore */ }
    }, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [selected?.user_id]);

  async function loadTrack(uid: string) {
    try {
      const resp = await fetch(`${API()}/api/security/track-user/${uid}`, { headers: await authHeader() });
      if (!resp.ok) { Alert.alert("Not found"); return; }
      const data: TrackData = await resp.json();
      setSelected(data);
    } catch (e: any) { Alert.alert("Error", e?.message || "Network error"); }
  }

  async function ping() {
    if (!selected) return;
    setPinging(true);
    try {
      // FIX ISSUE #5: explicit ping contract.  Backend returns
      //   {ok, reason, type, target_id, target_role, ping_id}
      const resp = await fetch(`${API()}/api/security/ping-user/${selected.user_id}`, {
        method: "POST", headers: await authHeader(),
      });
      const data = await resp.json();
      if (!data.ok) {
        const reasons: Record<string, string> = {
          offline:       "This user is offline — pinging would expose their location without consent.",
          no_push_token: "This user hasn't registered for push notifications yet.",
          push_failed:   "Push delivery failed. Please try again in a moment.",
          forbidden:     "You don't have permission to ping this user.",
          not_found:     "User not found.",
        };
        Alert.alert("Ping skipped", reasons[data.reason] || data.reason || "Unknown reason");
      } else {
        Alert.alert("Ping sent", `Awaiting location update from ${selected.full_name || "user"}…`);
      }
    } catch (e: any) {
      Alert.alert("Ping failed", e?.message || "Network error");
    } finally {
      setPinging(false);
    }
  }

  if (selected) {
    const history = (selected.location_history || []).filter(p => p.latitude != null && p.longitude != null);
    return (
      <View style={styles.root}>
        <MapView
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={
            selected.latitude && selected.longitude
              ? { latitude: selected.latitude, longitude: selected.longitude,
                  latitudeDelta: 0.05, longitudeDelta: 0.05 }
              : undefined
          }
        >
          {selected.latitude != null && selected.longitude != null && (
            <Marker
              coordinate={{ latitude: selected.latitude, longitude: selected.longitude }}
              title={selected.full_name || "User"}
              description={`source: ${selected.source || "—"} • ${selected.last_update || ""}`}
              pinColor={selected.has_panic ? "#dc2626" : selected.has_escort ? "#16a34a" : "#2563eb"}
            />
          )}
          {history.length > 1 && (
            <Polyline
              coordinates={history.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
              strokeColor="#7dd3fc"
              strokeWidth={3}
            />
          )}
        </MapView>

        <View style={styles.detailCard}>
          <Pressable onPress={() => setSelected(null)} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back to search</Text>
          </Pressable>

          <Text style={styles.detailName}>{selected.full_name || "Unknown user"}</Text>
          <Text style={styles.detailMeta}>
            {selected.role} • source: {selected.source || "—"} • is_active: {String(selected.is_active)}
          </Text>
          {selected.email ? <Text style={styles.detailMeta}>{selected.email}</Text> : null}
          {selected.phone ? <Text style={styles.detailMeta}>{selected.phone}</Text> : null}
          {selected.last_update ? (
            <Text style={styles.detailMeta}>Last fix: {selected.last_update}</Text>
          ) : (
            <Text style={[styles.detailMeta, { color: "#f97316" }]}>No location fix yet</Text>
          )}

          <Pressable
            onPress={ping}
            disabled={pinging}
            style={[styles.pingBtn, pinging && { opacity: 0.6 }]}
          >
            {pinging ? <ActivityIndicator color="#fff" /> : <Text style={styles.pingBtnText}>📡 PING LOCATION</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, email, or phone…"
          placeholderTextColor="#94a3b8"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searching && <ActivityIndicator color="#7dd3fc" style={{ marginLeft: 8 }} />}
      </View>

      <FlatList
        data={hits}
        keyExtractor={(u) => u.user_id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {query ? "No matching user. Try a different query." : "Type a name, email, or phone to find a user to track."}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => loadTrack(item.user_id)}
            style={({ pressed }) => [styles.hit, pressed && { opacity: 0.8 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.hitName}>{item.full_name || item.email}</Text>
              <Text style={styles.hitMeta}>{item.email}{item.phone ? `  •  ${item.phone}` : ""}</Text>
            </View>
            <Text style={styles.hitRole}>{item.role}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },

  searchBar:   { flexDirection: "row", alignItems: "center", margin: 16,
                 backgroundColor: "#1e293b", borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: "#fff", paddingVertical: 12, fontSize: 15 },

  empty:       { color: "#94a3b8", textAlign: "center", marginTop: 32 },

  hit:         { flexDirection: "row", alignItems: "center", backgroundColor: "#1e293b",
                 padding: 14, borderRadius: 12, gap: 10 },
  hitName:     { color: "#fff", fontSize: 15, fontWeight: "600" },
  hitMeta:     { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  hitRole:     { color: "#7dd3fc", fontSize: 11, fontWeight: "700" },

  detailCard:  { position: "absolute", left: 12, right: 12, bottom: 12,
                 backgroundColor: "rgba(15, 23, 42, 0.95)",
                 borderRadius: 16, padding: 16, gap: 6,
                 borderWidth: 1, borderColor: "#1e293b" },
  backBtn:     { alignSelf: "flex-start", marginBottom: 4 },
  backBtnText: { color: "#7dd3fc", fontSize: 13, fontWeight: "600" },
  detailName:  { color: "#fff", fontSize: 18, fontWeight: "700" },
  detailMeta:  { color: "#cbd5e1", fontSize: 12 },

  pingBtn:     { marginTop: 12, backgroundColor: "#2563eb", paddingVertical: 14,
                 borderRadius: 12, alignItems: "center" },
  pingBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
});
