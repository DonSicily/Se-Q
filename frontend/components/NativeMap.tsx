import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet, Platform, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Error Boundary ────────────────────────────────────────────────────────────
// FIX (Mapbox crash): @rnmapbox/maps throws a native ExceptionInInitializerError
// when the Mapbox common .so symbols can't be resolved. Wrapping in an Error Boundary
// means the crash is caught at the React layer and a graceful fallback is shown
// instead of the whole app closing. Once the native build is clean (build.gradle fix),
// this boundary will never trigger in production — but it prevents catastrophic
// failure on mis-matched builds.

interface BoundaryProps { children: ReactNode; lat: number; lng: number; }
interface BoundaryState { hasError: boolean; error: string | null; }

class MapErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[NativeMap] Error boundary caught:', error.message, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      const { lat, lng } = this.props;
      return (
        <View style={styles.errorFallback}>
          <Ionicons name="map-outline" size={48} color="#3B82F6" />
          <Text style={styles.errorTitle}>Map unavailable</Text>
          <Text style={styles.errorCoords}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
          <Text style={styles.errorHint}>
            If this persists, rebuild the app — a native library version mismatch was detected.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ── Lazy-load Mapbox so the import error is caught by the boundary, not at module level ──
let Mapbox: any = null;
let MapView: any = null;
let Camera: any = null;
let ShapeSource: any = null;
let CircleLayer: any = null;
let MarkerView: any = null;
let mapboxLoaded = false;
let mapboxLoadError: string | null = null;

try {
  const rnmapbox = require('@rnmapbox/maps');
  Mapbox      = rnmapbox.default;
  MapView     = rnmapbox.MapView;
  Camera      = rnmapbox.Camera;
  ShapeSource = rnmapbox.ShapeSource;
  CircleLayer = rnmapbox.CircleLayer;
  MarkerView  = rnmapbox.MarkerView;
  mapboxLoaded = true;
} catch (e: any) {
  mapboxLoadError = e?.message ?? 'Failed to load Mapbox';
  console.error('[NativeMap] Mapbox require failed:', mapboxLoadError);
}

import { MAPBOX_TOKEN } from '../config/mapbox';

if (Mapbox && MAPBOX_TOKEN) {
  try { Mapbox.setAccessToken(MAPBOX_TOKEN); } catch (_) {}
}

// ── Types ─────────────────────────────────────────────────────────────────────

type MapStyleType = 'satellite' | 'streets';

interface NativeMapProps {
  region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  markerCoords?: { latitude: number; longitude: number };
  markers?: Array<{
    id: string;
    latitude: number;
    longitude: number;
    title?: string;
    description?: string;
    pinColor?: string;
  }>;
  radiusKm?: number;
  onPress?: (coords: { latitude: number; longitude: number }) => void;
  onMarkerChange?: (coords: { latitude: number; longitude: number }) => void;
  style?: any;
}

// ── Inner map (only rendered when Mapbox loaded successfully) ─────────────────

function MapboxMap({ region, markerCoords, markers, radiusKm, onPress, style }: NativeMapProps) {
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyleType>('satellite');
  const mapRef = useRef<any>(null);

  const lat = markerCoords?.latitude ?? region.latitude;
  const lng = markerCoords?.longitude ?? region.longitude;

  const allMarkers = markers
    ? markers
    : (markerCoords ? [{ id: 'main', latitude: lat, longitude: lng, title: 'Selected Location', pinColor: '#EF4444' }] : []);

  const radiusMeters = radiusKm ? radiusKm * 1000 : 0;

  const getStyleUrl = (): string => {
    return mapStyle === 'satellite' ? Mapbox.StyleURL.Satellite : Mapbox.StyleURL.Streets;
  };

  const toggleMapStyle = () => setMapStyle(prev => prev === 'satellite' ? 'streets' : 'satellite');

  const circleFeature = radiusMeters > 0 && allMarkers.length > 0
    ? { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] }, properties: {} }
    : null;

  const handleMapPress = (feature: any) => {
    if (feature?.geometry && onPress) {
      const [pLng, pLat] = feature.geometry.coordinates;
      onPress({ latitude: pLat, longitude: pLng });
    }
  };

  const handleMarkerDrag = (marker: any, longitude: number, latitude: number) => {
    if (onPress) onPress({ latitude, longitude });
  };

  return (
    <View style={[styles.container, style]}>
      {!mapLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>
            Loading {mapStyle === 'satellite' ? 'satellite' : 'map'} view...
          </Text>
        </View>
      )}

      <MapView
        ref={mapRef}
        style={styles.map}
        styleURL={getStyleUrl()}
        surfaceView={true}
        onStyleLoad={() => setMapLoaded(true)}
        onPress={handleMapPress}
        rotateEnabled={true}
        pitchEnabled={true}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <Camera
          defaultSettings={{ centerCoordinate: [lng, lat], zoomLevel: 14, pitch: 0, bearing: 0 }}
        />

        {circleFeature && (
          <ShapeSource id="radius" shape={circleFeature}>
            <CircleLayer
              id="radius-circle"
              style={{
                circleRadius: radiusMeters / 10,
                circleColor: '#3B82F6',
                circleOpacity: 0.2,
                circleStrokeWidth: 2,
                circleStrokeColor: '#3B82F6',
              }}
            />
          </ShapeSource>
        )}

        {allMarkers.map((marker) => (
          <MarkerView
            key={marker.id}
            coordinate={[marker.longitude, marker.latitude]}
            draggable
            onDrag={(e: any) => {
              const coords = e.geometry.coordinates;
              handleMarkerDrag(marker, coords[0], coords[1]);
            }}
          >
            <View style={[styles.markerContainer, marker.pinColor ? { backgroundColor: marker.pinColor } : null]}>
              {marker.pinColor === '#22C55E' ? (
                <Ionicons name="checkmark-circle" size={28} color="white" />
              ) : marker.pinColor === '#EF4444' ? (
                <Ionicons name="location" size={28} color="white" />
              ) : (
                <Ionicons name="pin" size={28} color="white" />
              )}
              {marker.title && (
                <View style={styles.markerLabel}>
                  <Text style={styles.markerLabelText} numberOfLines={1}>{marker.title}</Text>
                </View>
              )}
            </View>
          </MarkerView>
        ))}
      </MapView>

      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.controlButton} onPress={toggleMapStyle}>
          <Ionicons name={mapStyle === 'satellite' ? 'satellite' : 'map'} size={16} color="#3B82F6" />
          <Text style={styles.controlText}>{mapStyle === 'satellite' ? 'Satellite' : 'Streets'}</Text>
        </TouchableOpacity>
      </View>

      {!MAPBOX_TOKEN && mapLoaded && (
        <View style={styles.warningBanner}>
          <Ionicons name="warning" size={16} color="#F59E0B" />
          <Text style={styles.warningText}>Add Mapbox token in config/mapbox.ts</Text>
        </View>
      )}
    </View>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function NativeMap(props: NativeMapProps) {
  const lat = props.markerCoords?.latitude ?? props.region.latitude;
  const lng = props.markerCoords?.longitude ?? props.region.longitude;

  // Web: always show coordinate fallback (no native libs on web)
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, props.style]}>
        <View style={styles.webFallback}>
          <Ionicons name="map" size={60} color="#3B82F6" />
          <Text style={styles.coordsText}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
          {props.radiusKm ? <Text style={styles.radiusText}>Radius: {props.radiusKm} km</Text> : null}
        </View>
      </View>
    );
  }

  // Native: if Mapbox failed to load at module level, show static fallback immediately
  if (!mapboxLoaded) {
    return (
      <View style={[styles.errorFallback, props.style]}>
        <Ionicons name="map-outline" size={48} color="#3B82F6" />
        <Text style={styles.errorTitle}>Map unavailable</Text>
        <Text style={styles.errorCoords}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
        <Text style={styles.errorHint}>Native map library could not be loaded.</Text>
      </View>
    );
  }

  // Wrap in boundary to catch any runtime init exceptions from Mapbox
  return (
    <MapErrorBoundary lat={lat} lng={lng}>
      <MapboxMap {...props} />
    </MapErrorBoundary>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0F172A' },
  map:             { flex: 1 },
  loadingOverlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  loadingText:     { color: '#94A3B8', marginTop: 12, fontSize: 14 },
  webFallback:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  coordsText:      { color: '#94A3B8', fontSize: 14, marginTop: 12 },
  radiusText:      { color: '#3B82F6', fontSize: 14, marginTop: 8, fontWeight: '500' },
  errorFallback:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0F172A' },
  errorTitle:      { color: '#F59E0B', fontSize: 16, fontWeight: '700', marginTop: 12 },
  errorCoords:     { color: '#94A3B8', fontSize: 13, marginTop: 6 },
  errorHint:       { color: '#475569', fontSize: 12, marginTop: 8, textAlign: 'center', lineHeight: 18 },
  markerContainer: { alignItems: 'center', backgroundColor: '#EF4444', borderRadius: 20, padding: 6, borderWidth: 3, borderColor: 'white', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 },
  markerLabel:     { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4, maxWidth: 120 },
  markerLabelText: { color: 'white', fontSize: 10, fontWeight: '600' },
  controlsContainer: { position: 'absolute', top: 10, right: 10, zIndex: 1 },
  controlButton:   { backgroundColor: 'rgba(15, 23, 42, 0.9)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#3B82F6', flexDirection: 'row', alignItems: 'center', gap: 6 },
  controlText:     { color: '#3B82F6', fontSize: 12, fontWeight: '600' },
  warningBanner:   { position: 'absolute', bottom: 20, left: 20, right: 20, backgroundColor: 'rgba(245, 158, 11, 0.2)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#F59E0B', flexDirection: 'row', alignItems: 'center', gap: 8 },
  warningText:     { color: '#F59E0B', fontSize: 12 },
});
