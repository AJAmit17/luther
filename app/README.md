# Luther mobile

The Expo/React Native controller for Luther's Mac-side server. Start with the [project README](../README.md), [native iPhone builds](../README.md#build-the-iphone-app), and [contribution guide](../CONTRIBUTING.md).

## Local checks

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

The project uses Expo SDK 58 and `package-lock.json`. Read matching versioned documentation before changing APIs/config plugins; do not upgrade React Native independently.

## Layout

- `src/app`: Expo Router routes.
- `src/components`: screens and reusable UI.
- `src/lib`: client logic, mirrored protocol, shared palette, and pure tests.
- `src/widgets`: widget/Live Activity code with its own runtime.
- `assets/luther.icon`: layered Relay app icon.
- `assets/images/luther-*`: generated icons and splash marks.

Regenerate branding from the repository root with `swift scripts/generate-brand.swift` on macOS. The generator reads `src/lib/palette.ts`; do not edit generated artwork directly.

Physical iPhones use a signed standalone Release built with `xcodebuild`, installed/launched using `xcrun devicectl`. Do not use Expo Go, `expo run:*`, or a Metro development server for that workflow. Native directories are generated from `app.config.js` and config plugins rather than hand-maintained.

## Build the Android APK

The Android app uses the same TypeScript code and app configuration. For a standalone arm64 phone build, use native Gradle rather than an Expo run command or a Metro development server.

Install/configure JDK 17 and the Android SDK first. The local build used Build Tools 37.0.0, compile SDK 37, target SDK 36, NDK 27.1.12297006, and CMake 3.22.1. On an Apple Silicon Mac with the Homebrew toolchain used here:

```sh
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
```

Use the corresponding paths for your installation. From `app/`:

```sh
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=3
adb devices -l
adb -s <DEVICE_ID> install -r app/build/outputs/apk/release/app-release.apk
adb -s <DEVICE_ID> shell am start -W -n dev.luther.app/.MainActivity
```

USB debugging must be enabled and authorised on the phone. The APK embeds its JavaScript bundle and runs without a development server. This build targets arm64; omit the architecture override for the template's multi-ABI build.

The generated template signs local Release APKs with its development keystore. That is suitable for this device test, **not production/Play Store signing**. Do not commit signing secrets or generated native/build folders.

On Android, icons are Material Symbols (`src/lib/icons.ts`, and `src/components/android/toolbar-icon.android.ts` for header toolbars) and long-press menus are bottom sheets. Platform-specific components live in `src/components/ios/` and `src/components/android/`; `@/components/<name>` resolves to the platform's file (see `metro.config.js`). Widgets and Live Activities remain iOS-only.
