require('dotenv').config();

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

if (!GOOGLE_MAPS_KEY && process.env.EAS_BUILD === 'true') {
  throw new Error('❌ FATAL: GOOGLE_MAPS_API_KEY is required for EAS Build!');
}

module.exports = {
  expo: {
    name: 'Se-Q',
    slug: 'se-q',
    version: '2.1.9',
    owner: 'kinasgroup',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'safeguard',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/images/splash-image.png',
      resizeMode: 'contain',
      backgroundColor: '#0F172A',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.seq.app',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#0F172A',
      },
      package: 'com.seq.app',
      config: {
        // Injects the key into the native Google Maps Android SDK at prebuild
        // time so react-native-maps (PROVIDER_GOOGLE) can render map tiles.
        // This writes google_maps_api_key into strings.xml automatically —
        // strings.xml still has the key hardcoded as a fallback for local builds.
        googleMaps: {
          apiKey: GOOGLE_MAPS_KEY,
        },
      },
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'CAMERA',
        'RECORD_AUDIO',
        'SEND_SMS',
        'READ_PHONE_STATE',
        'RECEIVE_BOOT_COMPLETED',
        'VIBRATE',
        'WAKE_LOCK',
        'FOREGROUND_SERVICE',
        'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      ],
    },
    extra: {
      eas: {
        projectId: '89e286bc-d95d-422b-95a7-f7c355de060e',
      },
      backendUrl: 'https://se-q-production.up.railway.app',
      googleMapsApiKey: GOOGLE_MAPS_KEY,
    },
  },
};
