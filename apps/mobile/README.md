# Product Mobile App (`apps/mobile`)

React Native + Expo mobile application, also incorporating the native Android Studio offline build.

## Development

```bash
# Start Expo development server
npm run start --workspace=apps/mobile

# Run directly on Android
npm run android --workspace=apps/mobile

# Run directly on iOS
npm run ios --workspace=apps/mobile
```

## Native Android Project

The complete native Android project with Gradle wrapper and offline assets is located in `android/` and synchronized in `apps/mobile/android/`.
