/**
 * Mapbox Configuration
 *
 * TOKEN SETUP (EAS Secrets - Recommended for Production):
 *
 * Run this command to add your secret:
 *    eas secret create MAPBOX_ACCESS_TOKEN=pk.your_token_here
 *
 * The token will be injected via app.config.js extra.mapboxToken
 * which reads from EAS secrets.
 *
 * Token source priority (highest to lowest):
 *   1. EAS Secret: MAPBOX_ACCESS_TOKEN
 *   2. app.config.js: extra.mapboxToken
 *   3. Environment variable: process.env.MAPBOX_ACCESS_TOKEN
 */

import Constants from 'expo-constants';

// Get Mapbox token from multiple sources
const getMapboxToken = (): string => {
  // 1. From EAS secrets (injected via app.config.js extra)
  const configToken = Constants.expoConfig?.extra?.mapboxToken as string | undefined;
  if (configToken && configToken.trim() !== '') {
    return configToken;
  }

  // 2. From environment variable (local dev)
  const envToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 3. No token found
  console.warn('[Mapbox] No access token found! Map will not display.');
  console.warn('[Mapbox] Run: eas secret create MAPBOX_ACCESS_TOKEN=pk.your_token_here');
  return '';
};

export const MAPBOX_TOKEN: string = getMapboxToken();

// Map style options
export const MAP_STYLES = {
  SATELLITE: 'mapbox://styles/mapbox/satellite-streets-v12',
  STREETS: 'mapbox://styles/mapbox/streets-v12',
  DARK: 'mapbox://styles/mapbox/dark-v11',
  LIGHT: 'mapbox://styles/mapbox/light-v11',
};

export default MAPBOX_TOKEN;