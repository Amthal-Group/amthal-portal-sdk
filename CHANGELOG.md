# Changelog

Notable changes to the Amthal Portal SDK. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

The **bridge protocol** versions separately from the packages — see
[`bridge/SPEC.md`](bridge/SPEC.md). Protocol 1 is current.

## [1.0.0]

First public release. Everything below is what 1.0.0 ships, not a diff against anything.

### Packages

- `@amthal-group/portal-bridge` — Amthal Bridge Protocol v1: message and payload types, envelope
  helpers, the version-handshake constants, and `MockNativeHost` for testing a web side without a
  device.
- `@amthal-group/portal-react-native` — `<AmthalPortalForm />`, an inline WebView host. Pure
  TypeScript over `react-native-webview`; no native module to link.
- `@amthal-group/portal-expo` — presents the native iOS SDK in a device-native modal sheet,
  bridged from JS as an Expo module.
- `ios/` — the Swift SDK (`AmthalPortalViewController`, plus `AmthalPortalView` for SwiftUI),
  added through SwiftPM from the manifest at the repository root. No external dependencies.
- `android/` — the Kotlin SDK (`AmthalPortalView`), published as an AAR.

### What it does

- **Bridge protocol v1** with a version handshake against `<baseUrl>/embed/manifest.json` before
  any route loads, so an SDK and a portal that cannot talk say so instead of half-working.
- **Auth handoff** over the bridge — never in a URL — with an `authExpired` → `auth` round trip so
  an expired session is re-issued without tearing the form down.
- **Navigation confinement** to the portal origin's `/embed` subtree. Everything else is cancelled
  and handed to the host, which decides whether it opens in the system browser.
- **Native capabilities**: downloads (including ones needing an `Authorization` header), file
  preview, file uploads, external links, hardware back and swipe-dismiss that the form can answer
  with an unsaved-changes guard.
- **Runtime locale, theme and font scale**, including RTL.
- **Form delegation** (React Native): the host performs the form's HTTP itself, so an app with its
  own networking stack, certificate pinning or offline queue keeps owning the wire.
- **A default wait screen** derived from one brand colour, with your own logo optional — or
  replace it wholesale with `renderLoading`.

### Requirements

iOS 15+ · Android minSdk 24 · React Native 0.72+ · a portal deployment with embed support.
