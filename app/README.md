# Luther for iPhone

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
