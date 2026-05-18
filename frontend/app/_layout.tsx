import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, AppStateStatus, View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { startQueueProcessor } from '../utils/offlineQueue';
import { useShakeDetector } from '../utils/shakeDetector';
import { checkAndConsumePanic } from '../utils/nativePanicBridge';
import BACKEND_URL from '../utils/config';
import { getAuthToken } from '../utils/auth';
import * as Location from 'expo-location';
import { getLocation } from '../utils/getLocation';

interface ShakeBannerProps { onTap: () => void; onDismiss: () => void; }

function ShakeBanner({ onTap, onDismiss }: ShakeBannerProps) {
  const translateY = useRef(new Animated.Value(-80)).current;
  useEffect(() => { Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start(); }, []);
  const handleDismiss = useCallback(() => { Animated.timing(translateY, { toValue: -80, duration: 200, useNativeDriver: true }).start(onDismiss); }, [onDismiss]);
  const handleTap = useCallback(() => { Animated.timing(translateY, { toValue: -80, duration: 150, useNativeDriver: true }).start(onTap); }, [onTap]);
  return (
    <Animated.View style={[bannerStyles.wrapper, { transform: [{ translateY }] }]} pointerEvents="box-none">
      <TouchableOpacity style={bannerStyles.banner} onPress={handleTap} activeOpacity={0.85}>
        <View style={bannerStyles.dot} /><View style={bannerStyles.textCol}>
          <Text style={bannerStyles.title}>Tap to activate</Text><Text style={bannerStyles.sub}>Swipe away or wait 3 s to cancel</Text>
        </View>
        <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={bannerStyles.x}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const bannerStyles = StyleSheet.create({
  wrapper: { position: 'absolute', top: 44, left: 16, right: 16, zIndex: 9999, elevation: 20 },
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, borderWidth: 1, borderColor: '#334155' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  textCol: { flex: 1 }, title: { fontSize: 14, fontWeight: '700', color: '#fff' }, sub: { fontSize: 11, color: '#64748B', marginTop: 1 }, x: { fontSize: 14, color: '#475569', fontWeight: '600' },
});

function AppContent() {
  const router = useRouter(); const segments = useSegments();
  const queueCleanup = useRef<(() => void) | null>(null); const initialized = useRef(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showShakeBanner = useCallback(() => { setBannerVisible(true); if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); bannerTimerRef.current = setTimeout(() => { setBannerVisible(false); }, 3000); }, []);
  const handleBannerTap = useCallback(() => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); setBannerVisible(false); try { router.push('/civil/panic-shake'); } catch (_) {} }, []);
  const handleBannerDismiss = useCallback(() => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); setBannerVisible(false); }, []);
  useEffect(() => () => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); }, []);
  useEffect(() => { SecureStore.getItemAsync('user_role').then(role => setUserRole(role)); }, [segments.join('/')]);
  const currentRoute = segments.join('/');
  const isOnPanicScreen = currentRoute.includes('panic-shake') || currentRoute.includes('panic-active');
  const shakeEnabled = userRole === 'civil' && !isOnPanicScreen;
  const handleShakeTrigger = useCallback(async () => {
    if (isOnPanicScreen) return;
    try { const panicActive = await SecureStore.getItemAsync('panic_active'); const activePanic = await SecureStore.getItemAsync('active_panic'); if (panicActive === 'true' || !!activePanic) return; } catch (_) {}
    showShakeBanner();
  }, [isOnPanicScreen, showShakeBanner]);
  useShakeDetector({ enabled: shakeEnabled, threshold: 2.2, requiredShakes: 5, windowMs: 2000, cooldownMs: 6000, onTriggered: handleShakeTrigger });
  useEffect(() => {
    let isMounted = true; let retryCount = 0; const MAX_RETRIES = 3; const RETRY_DELAY = 300;
    const navigate = async () => {
      try { const pending = await checkAndConsumePanic(); if (!pending || !isMounted) return; const role = await SecureStore.getItemAsync('user_role'); if (role !== 'civil') return; const route = segments.join('/'); if (route.includes('panic-shake') || route.includes('panic-active')) return; router.replace('/civil/panic-shake'); } catch (error) { if (retryCount < MAX_RETRIES) { retryCount++; setTimeout(navigate, RETRY_DELAY); } }
    };
    const coldStartTimer = setTimeout(navigate, 500);
    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => { if (state === 'active') navigate(); });
    return () => { isMounted = false; clearTimeout(coldStartTimer); appStateSub.remove(); };
  }, [segments]);
  useEffect(() => { if (!initialized.current) { initialized.current = true; queueCleanup.current = startQueueProcessor(); } return () => { queueCleanup.current?.(); queueCleanup.current = null; }; }, []);
  const sendPingLocation = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      // FIX: use shared getLocation() — adds 8-second timeout + last-known fallback.
      // Old code called getCurrentPositionAsync with no timeout, which could hang
      // and block the notification handler thread.
      const coords = await getLocation('soft');
      if (!coords) return; // GPS unavailable — skip this ping silently
      await fetch(`${BACKEND_URL}/api/location/ping-update`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude:  coords.latitude,
          longitude: coords.longitude,
          accuracy:  coords.accuracy,
        }),
      });
      console.log('[Ping] Location transmitted to security');
    } catch (err) {
      console.error('[Ping] Location transmission failed:', err);
    }
  }, []);
  useEffect(() => {
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false }) });
    const subscription = Notifications.addNotificationReceivedListener((notification) => { const data = notification.request.content.data; if (data?.type === 'ping') { sendPingLocation(); } });
    return () => subscription.remove();
  }, [sendPingLocation]);
  return (<View style={{ flex: 1 }}><Slot />{bannerVisible && <ShakeBanner onTap={handleBannerTap} onDismiss={handleBannerDismiss} />}</View>);
}

export default function RootLayout() {
  useEffect(() => {
    const resetAudioSession = async () => {
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: false, staysActiveInBackground: false, shouldDuckAndroid: true, playThroughEarpieceAndroid: false, interruptionModeIOS: 0, interruptionModeAndroid: 0 }); console.log('[RootLayout] Audio session reset to clean state'); } catch (err) { console.warn('[RootLayout] Audio session reset failed:', err); }
    };
    resetAudioSession();
  }, []);
  return (<SafeAreaProvider><View style={{ flex: 1, backgroundColor: '#0F172A' }}><AppContent /></View></SafeAreaProvider>);
}
