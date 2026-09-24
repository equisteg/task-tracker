# Task Tracker Mobile (`apps/mobile`)

Expo (React Native) app that opens your hosted Task Tracker web app, so accounts, data and the UI are shared with the website.

## Setup

1. Set your site address in `config.ts`:
   ```ts
   export const APP_URL = 'https://your-app.vercel.app';
   ```
2. Install dependencies from the repository root:
   ```bash
   npm install
   ```

## Run

```bash
npm run start --workspace=apps/mobile     # Expo dev server (scan the QR code with Expo Go)
npm run android --workspace=apps/mobile   # build & run on an Android device / emulator
npm run ios --workspace=apps/mobile       # build & run on iOS (macOS only)
```

## Native folders

`android/` and `ios/` inside this folder are **generated** by `npx expo prebuild` and are not committed
(see `.gitignore`). Re-generate them any time with:

```bash
cd apps/mobile
npx expo prebuild --clean
```

App icons and the splash screen come from `assets/` (referenced in `app.json`).

The separate hand-written Android WebView project (no Expo) lives in the repository's top-level `android/` folder.
