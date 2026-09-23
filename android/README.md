# AegisFlow Android Studio Project

This is the official Android Studio project for **AegisFlow Enterprise**.

## How to Open in Android Studio

1. Launch **Android Studio**.
2. Click **Open** (or `File -> Open...`).
3. Navigate to and select this `android` folder:
   `/Users/tejonarasimhavemulapalli/Downloads/files/android`
4. Android Studio will automatically sync the Gradle project and index files.
5. Select an Android Emulator or connected physical device, then click **Run (Shift + F10)**.

Alternatively, from the terminal, you can open it directly:
```bash
open -a "/Applications/Android Studio.app" /Users/tejonarasimhavemulapalli/Downloads/files/android
```

## Connect the app to your live site (required for real accounts)

The app shows your deployed Task Tracker web app, so accounts, data and the UI are shared with the website.

1. Open `gradle.properties` and set your site address:
   ```properties
   appUrl=https://your-app.vercel.app
   ```
   (or pass it at build time: `./gradlew assembleRelease -PappUrl=https://your-app.vercel.app`)
2. Build and install as usual.

If `appUrl` is empty the app opens the bundled **offline demo** instead (data stays on the device; emails and payments are simulated). If the phone is offline, a "You're offline — Try again" screen is shown.

## Features Included in Android App

- **Live site + offline demo**: opens `appUrl` when set; `app/src/main/assets/index.html` is the bundled offline demo and `offline.html` the no-connection screen.
- **Native File Chooser Integration**: `WebChromeClient.onShowFileChooser` is configured so that tapping profile picture uploads, team emblem uploads, or file attachments triggers Android's native system file picker.
- **Hardware Acceleration & DOM Storage**: Full IndexedDB and HTML5 localStorage enabled.
- **Safe External Navigation**: Your own site and the Razorpay checkout stay in the app; other websites open in the browser, and UPI / payment-app links open the matching app.
