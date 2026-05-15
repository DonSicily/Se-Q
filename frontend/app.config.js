export default {
  expo: {
    name: "Se-Q",
    slug: "se-q",
    version: "2.1.9",
    owner: "siliano",
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
        "RECORD_AUDIO"
      ]
    },
    extra: {
      eas: {
        projectId: "31841578-3490-4485-a8d5-066029ceab8a"
      }
    }
  }
};
