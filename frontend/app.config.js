/**
 * app.config.js
 *
 * MAPBOX TOKEN SETUP:
 *   The Mapbox Maps Android SDK reads mapbox_access_token from Android string
 *   resources at NATIVE INIT TIME — before any JS runs. Without it the app
 *   crashes with MapboxConfigurationException on any screen that shows a map.
 *
 *   Steps:
 *     1. Get your token from https://account.mapbox.com/access-tokens/
 *     2. Add it as an EAS secret:
 *          eas secret create MAPBOX_ACCESS_TOKEN pk.eyJ1...your_token
 *     3. Rebuild: eas build --platform android
 *
 *   The withMapboxToken plugin below injects the token into
 *   android/app/src/main/res/values/strings.xml at build time so the
 *   native Mapbox SDK can read it at startup.
 */

const { withStringsXml } = require('@expo/config-plugins');

// Read token from EAS secret (injected as env var during eas build) or local .env
const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';

// Validate token is present (fail build early if missing)
if (!MAPBOX_TOKEN && process.env.CI) {
  console.error('❌ ERROR: MAPBOX_ACCESS_TOKEN environment variable is not set!');
  console.error('   Run: eas secret create MAPBOX_ACCESS_TOKEN pk.your_token_here');
  process.exit(1);
}

/**
 * Expo config plugin: writes mapbox_access_token into Android strings.xml.
 * The native MapController reads this resource before any JS runs —
 * calling Mapbox.setAccessToken() from JS alone is NOT sufficient on Android.
 */
const withMapboxToken = (config) => {
  return withStringsXml(config, (mod) => {
    const strings = mod.modResults.resources.string || [];
    // Remove any stale entry to avoid duplicates on repeated builds
    mod.modResults.resources.string = strings.filter(
      (item) => item.$ && item.$.name !== 'mapbox_access_token'
    );
    mod.modResults.resources.string.push({
      $: { name: 'mapbox_access_token', translatable: 'false' },
      _: MAPBOX_TOKEN || 'PASTE_YOUR_MAPBOX_TOKEN_HERE',
    });
    
    console.log(`✅ Injected Mapbox token into strings.xml (length: ${MAPBOX_TOKEN.length})`);
    return mod;
  });
};

module.exports = {
  expo: {
    name: "Se-Q",
    slug: "se-q",
    version: "2.1.9",
    owner: "nwababy",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "safeguard",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-image.png",
      resizeMode: "contain",
      backgroundColor: "#0F172A"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.seq.app"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#0F172A"
      },
      package: "com.seq.app",
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "CAMERA",
        "RECORD_AUDIO",
        "SEND_SMS",
        "READ_PHONE_STATE",
        "RECEIVE_BOOT_COMPLETED",
        "VIBRATE",
        "WAKE_LOCK",
        "FOREGROUND_SERVICE",
        "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
      ]
    },
    extra: {
      eas: {
        // ✅ FIXED: Use the correct project ID from your build error
        projectId: "374e4bfb-9d3d-4525-9d6e-7f27b51a7a79"
      },
      backendUrl: "https://se-q-production.up.railway.app",
      // JS layer reads this via Constants.expoConfig.extra.mapboxToken
      mapboxToken: MAPBOX_TOKEN,
    },
    plugins: [
      withMapboxToken,
    ],
  }
};
