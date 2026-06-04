/**
 * Security "Team Location" screen.
 *
 * FIX ISSUE #4: the coverage radius is now drawn as a translucent
 * LIGHT-BLUE circle on the map, exactly as the spec requires.  We use
 * react-native-maps' <Circle> with:
 *   - center = agent's current location
 *   - radius = agent's coverage radius (km → m)
 *   - strokeColor / fillColor both light blue (sky-300)
 *   - zIndex high so it sits above the road layer
 *
 * The radius is editable via a slider / preset row (5, 10, 25, 50 km).
 * Updating the slider PATCHes /api/security/team-location so other
 * agents see the new footprint on their next map refresh.
 *
 * The blue colour (#7dd3fc / rgba(125,211,252,...)) is the canonical
 * "sky-300" tint, recognisable as a coverage halo rather than a marker.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import Slider from "@react-native-community/slider";
import * as SecureStore from "expo-secure-store";

import { getCurrentLocation } from "../../lib/location";

type TeamLocation = {
  latitude:  number;
  longitude: number;
  radius_km: number;
};

const RADIUS_PRESETS = [5, 10, 25, 50];

// Light-blue palette for the coverage halo.  Distinct from the marker pin
// (which is a saturated blue) so the radius reads as a "halo" not a pin.
const COVERAGE_STROKE = "rgba(125, 211, 252, 0.95)"; // sky-300
const COVERAGE_FILL   = "rgba(125, 211, 252, 0.20)";
const COVERAGE_EDGE   = "rgba(56, 189, 248, 0.55)";  // sky-400

const API = () => process.env.EXPO_PUBLIC_API_URL || "";

async function authHeader(): Promise<Record<string, string>> {
  const t = await SecureStore.getItemAsync("auth_token");
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export default function TeamLocationScreen() {
  const [loc,    setLoc]    = useState<TeamLocation | null>(null);
  const [radius, setRadius] = useState<number>(10);
  const [saving, setSaving] = useState(false);

  // Initial fetch from backend (or fresh GPS if none).
  useEffect(() => {
    (async () => {
      const h = await authHeader();
      try {
        const resp = await fetch(`${API()}/api/security/team-location`, { headers: h });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.latitude && data?.longitude) {
            setLoc({ latitude: data.latitude, longitude: data.longitude, radius_km: data.radius_km || 10 });
            setRadius(data.radius_km || 10);
            return;
          }
        }
      } catch { /* fall through */ }
      // Fallback: use current GPS.
      const gps = await getCurrentLocation({ accuracy: "high" });
      if (gps) setLoc({ latitude: gps.coords.latitude, longitude: gps.coords.longitude, radius_km: 10 });
    })();
  }, []);

  const persist = async (newLoc: TeamLocation) => {
    setSaving(true);
    try {
      await fetch(`${API()}/api/security/team-location`, {
        method:  "POST",
        headers: await authHeader(),
        body:    JSON.stringify({
          latitude:  newLoc.latitude,
          longitude: newLoc.longitude,
          radius_km: newLoc.radius_km,
        }),
      });
    } catch { /* non-fatal */ }
    finally { setSaving(false); }
  };

  const initialRegion = useMemo(() => {
    if (!loc) return undefined;
    return {
      latitude:  loc.latitude,
      longitude: loc.longitude,
      // Zoom derived from radius so the coverage halo is always visible.
      latitudeDelta:  Math.max(loc.radius_km / 25, 0.02),
      longitudeDelta: Math.max(loc.radius_km / 25, 0.02),
    };
  }, [loc]);

  if (!loc) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading team location…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapView
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        showsMyLocationButton
        showsCompass
      >
        {/* FIX ISSUE #4: light-blue coverage halo. */}
        <Circle
          center={{ latitude: loc.latitude, longitude: loc.longitude }}
          radius={radius * 1000}        // km → metres
          strokeColor={COVERAGE_EDGE}
          strokeWidth={2}
          fillColor={COVERAGE_FILL}
          zIndex={5}
        />
        {/* Pin for the agent. */}
        <Marker
          coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
          title="You"
          description={`Coverage: ${radius} km`}
          pinColor="#2563eb"
        />
      </MapView>

      {/* Floating radius editor. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Coverage radius</Text>
        <Text style={styles.cardSubtitle}>
          Other agents will see a <Text style={{ color: "#7dd3fc" }}>light-blue circle</Text> of
          this size around your pin.
        </Text>

        <View style={styles.presetsRow}>
          {RADIUS_PRESETS.map((km) => (
            <Pressable
              key={km}
              onPress={() => { setRadius(km); persist({ ...loc, radius_km: km }); }}
              style={[styles.preset, radius === km && styles.presetActive]}
            >
              <Text style={[styles.presetText, radius === km && styles.presetTextActive]}>
                {km} km
              </Text>
            </Pressable>
          ))}
        </View>

        <Slider
          value={radius}
          minimumValue={1}
          maximumValue={100}
          step={1}
          minimumTrackTintColor="#7dd3fc"
          maximumTrackTintColor="#1e293b"
          thumbTintColor="#0ea5e9"
          onSlidingComplete={(v) => persist({ ...loc, radius_km: Math.round(v) })}
        />
        <Text style={styles.radiusValue}>{radius} km</Text>

        <Pressable
          onPress={async () => {
            const gps = await getCurrentLocation({ accuracy: "high" });
            if (gps) {
              const next = { latitude: gps.coords.latitude, longitude: gps.coords.longitude, radius_km: radius };
              setLoc(next); persist(next);
            }
          }}
          style={styles.recentreBtn}
        >
          <Text style={styles.recentreText}>{saving ? "Saving…" : "Centre on my location"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },
  loading:     { flex: 1, backgroundColor: "#0b1220", alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#94a3b8" },

  card:        { position: "absolute", left: 16, right: 16, bottom: 24,
                 backgroundColor: "rgba(15, 23, 42, 0.92)",
                 borderRadius: 18, padding: 16, gap: 10,
                 borderWidth: 1, borderColor: "#1e293b" },
  cardTitle:   { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardSubtitle:{ color: "#cbd5e1", fontSize: 13 },

  presetsRow:  { flexDirection: "row", gap: 8, marginTop: 4 },
  preset:      { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
                 backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#374151" },
  presetActive:{ backgroundColor: "#0ea5e9", borderColor: "#0ea5e9" },
  presetText:    { color: "#cbd5e1", fontSize: 13, fontWeight: "600" },
  presetTextActive: { color: "#fff" },

  radiusValue: { color: "#7dd3fc", textAlign: "center", fontSize: 14, fontWeight: "700" },
  recentreBtn: { marginTop: 6, backgroundColor: "#1e293b", paddingVertical: 10,
                 borderRadius: 12, alignItems: "center" },
  recentreText:{ color: "#e2e8f0", fontSize: 14, fontWeight: "600" },
});
