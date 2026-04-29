/**
 * Authentication Utility Module
 * Centralized authentication handling for SafeGuard app
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const AUTH_TOKEN_KEY = 'auth_token';
const USER_ID_KEY    = 'user_id';
const USER_ROLE_KEY  = 'user_role';
const IS_PREMIUM_KEY = 'is_premium';

const SESSION_STATE_KEYS = [
  'panic_active',
  'panic_started_at',
  'panic_id',
  'active_panic',
  'active_escort',
];

const isSecureStoreAvailable = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  try {
    await SecureStore.getItemAsync('__test__');
    return true;
  } catch {
    return false;
  }
};

export const getAuthToken = async (): Promise<string | null> => {
  try {
    if (Platform.OS !== 'web') {
      try {
        const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
        if (token) return token;
      } catch (_) {}
    }
    return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
};

export const saveAuthData = async (data: {
  token: string;
  user_id: string;
  role: string;
  is_premium?: boolean;
}): Promise<boolean> => {
  try {
    if (Platform.OS !== 'web') {
      try {
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, data.token);
      } catch (_) {
        await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
      }
    } else {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
    }
    await AsyncStorage.multiSet([
      [USER_ID_KEY,    data.user_id],
      [USER_ROLE_KEY,  data.role],
      [IS_PREMIUM_KEY, String(data.is_premium || false)],
    ]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Clear ALL authentication data (logout).
 *
 * 1. Stops any active escort session on the backend (best-effort).
 *    This ensures the session is marked inactive in MongoDB so it
 *    is NOT restored when the same user logs back in — the user
 *    intentionally logged out, so the escort should not resume.
 * 2. Unregisters push token.
 * 3. Clears JWT from SecureStore + AsyncStorage.
 * 4. Clears all session-state keys.
 */
export const clearAuthData = async (): Promise<boolean> => {
  try {
    const token = await getAuthToken();

    if (token) {
      const { default: axios }       = await import('axios');
      const { default: BACKEND_URL } = await import('./config');

      // Stop active escort session so it is not incorrectly restored on re-login
      try {
        await axios.post(
          `${BACKEND_URL}/api/escort/action`,
          { action: 'stop', location: { latitude: 0, longitude: 0, timestamp: new Date().toISOString() } },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }
        );
      } catch (_) {}

      // Unregister push token
      try {
        await axios.delete(`${BACKEND_URL}/api/push-token/unregister`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000,
        });
      } catch (_) {}
    }

    if (Platform.OS !== 'web') {
      try { await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY); } catch (_) {}
    }

    await AsyncStorage.multiRemove([
      AUTH_TOKEN_KEY,
      USER_ID_KEY,
      USER_ROLE_KEY,
      IS_PREMIUM_KEY,
      ...SESSION_STATE_KEYS,
    ]);

    return true;
  } catch {
    return false;
  }
};

export const getUserMetadata = async (): Promise<{
  userId: string | null;
  role: string | null;
  isPremium: boolean;
}> => {
  try {
    const results = await AsyncStorage.multiGet([USER_ID_KEY, USER_ROLE_KEY, IS_PREMIUM_KEY]);
    const data: { [key: string]: string | null } = {};
    results.forEach(([key, value]) => { data[key] = value; });
    return {
      userId:    data[USER_ID_KEY],
      role:      data[USER_ROLE_KEY],
      isPremium: data[IS_PREMIUM_KEY] === 'true',
    };
  } catch {
    return { userId: null, role: null, isPremium: false };
  }
};

export const isAuthenticated = async (): Promise<boolean> => {
  const token = await getAuthToken();
  return !!token;
};

export const getAuthHeader = async (): Promise<{ Authorization: string } | {}> => {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
