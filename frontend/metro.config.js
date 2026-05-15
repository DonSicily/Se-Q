// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');
const { mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

// Use a stable on-disk cache store (shared across web/android dev sessions)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');

const customConfig = {
  cacheStores: [
    new FileStore({ root: path.join(root, 'cache') }),
  ],
  // Limit Metro workers to reduce Codespaces memory pressure
  maxWorkers: 2,
};

// Merge the default config with custom config and React Native config
const config = mergeConfig(defaultConfig, customConfig);

module.exports = config;
