# Frontend dependency notes

The drop-in React Native screens assume the following packages are
installed.  They are referenced by name only so the existing `package.json`
can be updated without pulling this whole file in.

## Required (already in your stack per CHANGES.md)
- `expo`, `expo-router`, `expo-status-bar`
- `expo-notifications`
- `expo-task-manager`, `expo-background-fetch`
- `expo-secure-store`, `@react-native-async-storage/async-storage`
- `expo-location`
- `react-native-maps`

## Newly required
- `@react-native-community/slider`         — for the radius slider in Team Location
- `expo-file-system`, `expo-sharing`       — used by Admin Export to save the download

## Optional
- `expo-document-picker`                   — if you want to attach the export
                                              directly to an email or file picker

## Babel / TS settings
Nothing exotic.  Standard `expo-router` setup works.
