module.exports = {
  name: "Se-Q",
  slug: "se-q",
  version: "2.1.9",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "se-q",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  splash: {
    image: "./assets/images/splash-image.png",
    resizeMode: "contain",
    backgroundColor: "#0F172A"
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.seq.app",
    infoPlist: {
      NSLocationWhenInUseUsageDescription: "Se-Q needs your location to provide emergency services and track your safety during panic alerts.",
      NSLocationAlwaysAndWhenInUseUsageDescription: "Se-Q needs continuous location access for emergencies and security escort.",
      NSLocationAlwaysUsageDescription: "Se-Q needs background location to monitor your safety.",
      NSCameraUsageDescription: "Se-Q needs camera access to record live video reports.",
      NSMicrophoneUsageDescription: "Se-Q needs microphone access to record audio reports."
    }
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
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "CAMERA",
      "RECORD_AUDIO",
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE"
    ]
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png"
  },
  plugins: [
    "expo-router",
    ["expo-location", {
      locationAlwaysAndWhenInUsePermission: "Se-Q needs your location for emergency tracking.",
      locationAlwaysPermission: "Se-Q needs background location for safety monitoring.",
      locationWhenInUsePermission: "Se-Q needs your location for emergency tracking.",
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true
    }],
    ["expo-camera", {
      cameraPermission: "Se-Q needs camera access to record video reports.",
      microphonePermission: "Se-Q needs microphone access for audio reports.",
      recordAudioAndroid: true
    }],
    ["expo-av", {
      microphonePermission: "Se-Q needs microphone access to record audio reports."
    }],
    ["expo-notifications", {
      icon: "./assets/images/icon.png",
      color: "#EF4444"
    }],
    "expo-task-manager",
    "expo-secure-store",
    ["expo-splash-screen", {
      image: "./assets/images/splash-image.png",
      imageWidth: 200,
      resizeMode: "contain",
      backgroundColor: "#0F172A"
    }],
    "expo-font",
    "@react-native-community/datetimepicker",
    "expo-image",
    "expo-sharing",
    "expo-web-browser"
  ],
  experiments: {
    typedRoutes: true
  },
  extra: {
    eas: {
      projectId: "78f8faad-eee5-4262-83e8-2986cbda964b"
    },
    backendUrl: "https://se-q-app8-production.up.railway.app",
    mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || "",
    router: {
      origin: false
    }
  }
};
