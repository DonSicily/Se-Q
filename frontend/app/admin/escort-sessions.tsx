/**
 * admin/escort-sessions.tsx
 * Now identical to security escort display: inline GPS, duration, live status
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  RefreshControl, Platform, ActivityIndicator, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../utils/auth';
import { LocationMapModal } from '../../components/LocationMapModal';
import BACKEND_URL from '../../utils/config';

interface GpsPt {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
}

export default function AdminEscortSessions() {
  const router = useRouter();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/admin/dashboard');
      return true;
    });
    return () => sub.remove();
  }, []);

  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [locationModal, setLocationModal] = useState<{ visible: boolean; lat: number; lng: number; title: string } | null>(null);

  useFocusEffect(useCallback(() => {
    loadSessions();
  }, []));

  const loadSessions = async () => {
    try {
      const token = await getAuthToken();
      if (!token) { router.replace('/admin/login'); return; }

      const res = await axios.get(
        `${BACKEND_URL}/api/admin/escort-sessions?t=${Date.now()}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      setSessions(res.data.sessions || []);
    } catch (err: any) {
      if (err?.response?.status === 401) { await clearAuthData(); router.replace('/admin/login'); }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); loadSessions(); };

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('en-US', {
        hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric',
      });
    } catch { return ts; }
  };

  const getName = (item: any) =>
    (item.user_full_name || item.user_name || '').trim() || item.user_email || 'Unknown User';

  const renderGpsRow = (pt: GpsPt, index: number, total: number) => (
    <TouchableOpacity
      key={`${index}-${pt.timestamp}`}
      style={[gpsStyles.row, index === 0 && gpsStyles.rowLatest]}
      onPress={() => setLocationModal({ visible: true, lat: pt.latitude, lng: pt.longitude, title: `Location @ ${formatTime(pt.timestamp)}` })}
      activeOpacity={0.7}
    >
      <View style={gpsStyles.trail}>
        <View style={[gpsStyles.dot, index === 0 && gpsStyles.dotLatest]} />
        {index < total - 1 && <View style={gpsStyles.line} />}
      </View>
      <View style={gpsStyles.content}>
        <View style={gpsStyles.topRow}>
          {index === 0 && <View style={gpsStyles.latestBadge}><Text style={gpsStyles.latestBadgeText}>LATEST</Text></View>}
          <Text style={gpsStyles.coords}>
            {pt.latitude.toFixed(6)}, {pt.longitude.toFixed(6)}
          </Text>
        </View>
        <Text style={gpsStyles.time}>{formatTime(pt.timestamp)}</Text>
        {pt.accuracy != null && <Text style={gpsStyles.accuracy}>±{Math.round(pt.accuracy)}m</Text>}
      </View>
      <Ionicons name="map-outline" size={16} color="#3B82F6" />
    </TouchableOpacity>
  );

  const renderSession = ({ item }: any) => {
    const name = getName(item);
    const history: GpsPt[] = item.locations || [];
    const chrono = [...history].reverse();
    const isActive = item.is_active;

    return (
      <View style={[styles.card, { borderLeftColor: isActive ? '#10B981' : '#334155' }]}>

        <View style={styles.topRow}>
          <View style={[styles.activeBadge, { backgroundColor: isActive ? '#10B98120' : '#33415520' }]}>
            <Ionicons name={isActive ? 'walk' : 'checkmark-circle'} size={14} color={isActive ? '#10B981' : '#64748B'} />
            <Text style={[styles.activeBadgeText, { color: isActive ? '#10B981' : '#64748B' }]}>
              {isActive ? 'ACTIVE ESCORT' : 'COMPLETED'}
            </Text>
          </View>
          <Text style={styles.duration}>
            {item.started_at ? formatTime(item.started_at) : '—'}
          </Text>
        </View>

        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Ionicons name="person-circle" size={44} color="#3B82F6" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{name}</Text>
            <Text style={styles.userEmail}>{item.user_email || 'No email'}</Text>
            {item.user_phone && <Text style={styles.userPhone}>{item.user_phone}</Text>}
          </View>
        </View>

        {isActive && (
          <View style={gpsStyles.container}>
            <View style={gpsStyles.header}>
              <Ionicons name="trail-sign" size={16} color="#10B981" />
              <Text style={gpsStyles.title}>Live GPS Track</Text>
              {history.length > 0 && (
                <View style={gpsStyles.countBadge}><Text style={gpsStyles.countText}>{history.length}</Text></View>
              )}
            </View>
            {chrono.length === 0 ? (
              <View style={gpsStyles.empty}>
                <Ionicons name="time-outline" size={28} color="#334155" />
                <Text style={gpsStyles.emptyText}>No GPS updates yet</Text>
              </View>
            ) : (
              <View>{chrono.map((pt, i) => renderGpsRow(pt, i, chrono.length))}</View>
            )}
          </View>
        )}

        {item.ended_at && (
          <View style={styles.endedRow}>
            <Ionicons name="checkmark-circle" size={16} color="#10B981" />
            <Text style={styles.endedText}>Ended: {formatTime(item.ended_at)}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/admin/dashboard')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Escort Sessions ({sessions.length})</Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#10B981" /></View>
      ) : (
        <FlatList
          data={sessions}
          renderItem={renderSession}
          keyExtractor={item => item.id || item._id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10B981" />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="navigate" size={80} color="#64748B" />
              <Text style={styles.emptyText}>No escort sessions found</Text>
            </View>
          }
        />
      )}

      {locationModal && (
        <LocationMapModal
          visible={locationModal.visible}
          onClose={() => setLocationModal(null)}
          latitude={locationModal.lat}
          longitude={locationModal.lng}
          title={locationModal.title}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 16, borderLeftWidth: 4 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  activeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  activeBadgeText: { fontSize: 11, fontWeight: '800' },
  duration: { fontSize: 12, color: '#94A3B8' },
  userRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#3B82F620', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 3 },
  userEmail: { fontSize: 12, color: '#94A3B8', marginBottom: 2 },
  userPhone: { fontSize: 13, color: '#10B981', fontWeight: '600' },
  endedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  endedText: { fontSize: 13, color: '#10B981' },
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 20, color: '#64748B', marginTop: 16, fontWeight: '600' },
});

const gpsStyles = StyleSheet.create({
  container: { marginBottom: 12, backgroundColor: '#0F172A', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#10B98130' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  title: { flex: 1, fontSize: 13, fontWeight: '600', color: '#10B981' },
  countBadge: { backgroundColor: '#10B981', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E293B40', paddingHorizontal: 4 },
  rowLatest: { backgroundColor: '#3B82F608', borderRadius: 8, paddingHorizontal: 8 },
  trail: { width: 20, alignItems: 'center', marginRight: 10, paddingTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#334155' },
  dotLatest: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#10B981' },
  line: { width: 2, height: 26, backgroundColor: '#1E293B', marginTop: 2 },
  content: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  latestBadge: { backgroundColor: '#10B98130', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  latestBadgeText: { color: '#10B981', fontSize: 9, fontWeight: '700' },
  coords: { fontSize: 12, color: '#E2E8F0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  time: { fontSize: 11, color: '#64748B', marginTop: 2 },
  accuracy: { fontSize: 10, color: '#475569', marginTop: 1 },
  empty: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { color: '#475569', fontSize: 13, marginTop: 8 },
});
