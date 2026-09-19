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

## Features Included in Android App

- **Bundled Offline Assets**: `index.html` is embedded directly into `app/src/main/assets/index.html` for offline-first performance and zero hosting cost.
- **Native File Chooser Integration**: `WebChromeClient.onShowFileChooser` is configured so that tapping profile picture uploads, team emblem uploads, or file attachments triggers Android's native system file picker.
- **Hardware Acceleration & DOM Storage**: Full IndexedDB and HTML5 localStorage enabled.
- **Safe External Navigation**: Hyperlinks to external websites (GitHub, Figma, Docs) open in the system default browser.
