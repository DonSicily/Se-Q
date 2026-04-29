/**
 * _layout.tsx — Root layout
 *
 * AMENDMENT 4 — ALL push/system notifications removed.
 *
 * The app is of discrete covert use. Any system-level notification
 * (banners, sounds, badges, heads-up cards) would expose the app's
 * presence and operations to a bystander or attacker who sees the phone.
 *
 * THE ONLY PERMITTED NOTIFICATION is the in-app ShakeBanner that appears
 * after the phone is shaken 5 times. This is rendered entirely within the
 * app's own view hierarchy — it is NOT a system notification. It shows
 * "Tap to activate / swipe away to cancel" so the user can confirm or
 * abort the panic trigger. No push registration. No notification channels.
 * No badge counts. No sounds from the OS notification system.
 *
 * Preserved behaviour:
 *   – ShakeBanner (in-app only) ← the one allowed notification
 *   – Native shake bridge (cold-start / foreground panic detection)
 *   – Offline queue processor
 *   – Role-based routing
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  AppState, AppStateStatus, View, Text,
  TouchableOpacity, Animated, StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startQueueProcessor } from '../utils/offlineQueue';
import { useShakeDetector } from '../utils/shakeDetector';
import { checkAndConsumePanic } from '../utils/nativePanicBridge';

// ─── Shake Banner ─────────────────────────────────────────────────────────────
// The ONE ALLOWED notification: an in-app banner that appears after
// 5 phone shakes.  Tap → activates panic. Wait / swipe → silently cancels.
// Neutral text, no mention of security or emergency — safe if seen by
// an assailant who glances at the phone.
interface ShakeBannerProps {
  onTap: () => void;
  onDismiss: () => void;
}

function ShakeBanner({ onTap, onDismiss }: ShakeBannerProps) {
  const translateY = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, []);

  const handleDismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: -80,
      duration: 200,
      useNativeDriver: true,
    }).start(onDismiss);
  }, [onDismiss]);

  const handleTap = useCallback(() => {
    Animated.timing(translateY, {
      toValue: -80,
      duration: 150,
      useNativeDriver: true,
    }).start(onTap);
  }, [onTap]);

  return (
    <Animated.View
      style={[bannerStyles.wrapper, { transform: [{ translateY }] }]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={bannerStyles.banner}
        onPress={handleTap}
        activeOpacity={0.85}
      >
        <View style={bannerStyles.dot} />
        <View style={bannerStyles.textCol}>
          <Text style={bannerStyles.title}>Tap to activate</Text>
          <Text style={bannerStyles.sub}>Swipe away or wait 3 s to cancel</Text>
        </View>
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={bannerStyles.x}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const bannerStyles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 44,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 20,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  textCol: { flex: 1 },
  title:   { fontSize: 14, fontWeight: '700', color: '#fff' },
  sub:     { fontSize: 11, color: '#64748B', marginTop: 1 },
  x:       { fontSize: 14, color: '#475569', fontWeight: '600' },
});

// ─── Inner app ────────────────────────────────────────────────────────────────
function AppContent() {
  const router   = useRouter();
  const segments = useSegments();

  const queueCleanup = useRef<(() => void) | null>(null);
  const initialized  = useRef(false);

  const [userRole, setUserRole] = useState<string | null>(null);

  // ── Shake banner state ──────────────────────────────────────────────
  const [bannerVisible, setBannerVisible] = useState(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showShakeBanner = useCallback(() => {
    setBannerVisible(true);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => {
      setBannerVisible(false);
    }, 3000);
  }, []);

  const handleBannerTap = useCallback(() => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setBannerVisible(false);
    try { router.push('/civil/panic-shake'); } catch (_) {}
  }, []);

  const handleBannerDismiss = useCallback(() => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setBannerVisible(false);
  }, []);

  useEffect(() => () => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
  }, []);

  // ── User role (gates JS shake detector) ────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('user_role').then(role => setUserRole(role));
  }, [segments.join('/')]);

  const currentRoute    = segments.join('/');
  const isOnPanicScreen = currentRoute.includes('panic-shake') || currentRoute.includes('panic-active');
  const shakeEnabled    = userRole === 'civil' && !isOnPanicScreen;

  const handleShakeTrigger = useCallback(async () => {
    if (isOnPanicScreen) return;
    try {
      const panicActive = await AsyncStorage.getItem('panic_active');
      const activePanic = await AsyncStorage.getItem('active_panic');
      if (panicActive === 'true' || !!activePanic) return;
    } catch (_) {}
    // Show the in-app shake banner — the one permitted notification.
    showShakeBanner();
  }, [isOnPanicScreen, showShakeBanner]);

  useShakeDetector({
    enabled:        shakeEnabled,
    threshold:      2.2,
    requiredShakes: 5,   // 5 shakes as specified
    windowMs:       2000,
    cooldownMs:     6000,
    onTriggered:    handleShakeTrigger,
  });

  // ── Native shake bridge ─────────────────────────────────────────────
  useEffect(() => {
    let isMounted  = true;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 300;

    const navigate = async () => {
      try {
        const pending = await checkAndConsumePanic();
        if (!pending || !isMounted) return;

        const role = await AsyncStorage.getItem('user_role');
        if (role !== 'civil') return;

        const route = segments.join('/');
        if (route.includes('panic-shake') || route.includes('panic-active')) return;

        router.replace('/civil/panic-shake');
      } catch (error) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(navigate, RETRY_DELAY);
        }
      }
    };

    const coldStartTimer = setTimeout(navigate, 500);

    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') navigate();
    });

    return () => {
      isMounted = false;
      clearTimeout(coldStartTimer);
      appStateSub.remove();
    };
  }, [segments]);

  // ── Offline queue ───────────────────────────────────────────────────
  useEffect(() => {
    if (!initialized.current) {
      initialized.current  = true;
      queueCleanup.current = startQueueProcessor();
    }
    return () => { queueCleanup.current?.(); queueCleanup.current = null; };
  }, []);

  // AMENDMENT 4: push notification listeners REMOVED entirely.
  // Previously this section registered addNotificationReceivedListener and
  // addNotificationResponseReceivedListener which surfaced system alerts for
  // panic events, chat messages, and report uploads.  All of those are gone.

  return (
    <View style={{ flex: 1 }}>
      <Slot />
      {bannerVisible && (
        <ShakeBanner onTap={handleBannerTap} onDismiss={handleBannerDismiss} />
      )}
    </View>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#0F172A' }}>
        <AppContent />
      </View>
    </SafeAreaProvider>
  );
}
