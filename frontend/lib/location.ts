/**
 * lib/location.ts — single, well-typed wrapper around expo-location.
 *
 * Centralised so the same GPS acquisition is used by:
 *   - the panic-active screen (continuous tracking)
 *   - the ping background task (one-shot, high accuracy)
 *   - the escort session (continuous)
 *   - the team-location setter (one-shot)
 */
import * as Location from "expo-location";

export type Coords = {
  coords: {
    latitude:    number;
    longitude:   number;
    accuracy:    number | null;
    altitude:    number | null;
    heading:     number | null;
    speed:       number | null;
    timestamp:   number;
  };
};

export async function getCurrentLocation(opts: { accuracy?: "low" | "high" } = {}): Promise<Coords | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;
  return await Location.getCurrentPositionAsync({
    accuracy: opts.accuracy === "high"
      ? Location.Accuracy.High
      : Location.Accuracy.Balanced,
  });
}

export async function watchLocation(onChange: (loc: Coords) => void): Promise<() => void> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return () => {};
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 4000 },
    onChange,
  );
  return () => sub.remove();
}
