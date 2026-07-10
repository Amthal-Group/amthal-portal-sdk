# Amthal Portal SDK

<div align="center">
<br>
<br>
<div style="background-color: #ffffff; padding: 20px; border-radius: 8px; text-align: center; display: inline-block; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
  <a href="https://www.amthalgroup.com/" target="_blank">
    <img src="https://cdn2.mallats.com/cdn-cgi/image/width=45,format=webp/AmthalGroup/img/Amthal-Logo.svg" alt="Amthal Group Logo" width="200">
  </a>
</div>
<br>
<br>

**Embed the Amthal Client Portal — including its dynamic form builder — inside any native or hybrid mobile app.**

[![Bridge Protocol](https://img.shields.io/badge/Amthal%20Bridge-v1-00598A?style=flat-square)](bridge/SPEC.md)
[![iOS](https://img.shields.io/badge/iOS-15%2B-black?style=flat-square&logo=apple)](ios/)
[![Android](https://img.shields.io/badge/Android-minSdk%2024-3DDC84?style=flat-square&logo=android)](android/)
[![React Native](https://img.shields.io/badge/React%20Native-0.72%2B-61DAFB?style=flat-square&logo=react)](wrappers/react-native/)
[![Expo](https://img.shields.io/badge/Expo-module-000020?style=flat-square&logo=expo)](wrappers/expo/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](#-license)

</div>

---

## 🚀 Overview

The **Amthal Portal SDK** lets your app embed the **Client Portal** and its `ng-form-builder` dynamic forms with a native API surface and a versioned message bridge. Credentials never travel in URLs, navigation is confined to the portal's embed routes, and the portal owns all form logic — the SDK brokers **authentication, lifecycle, navigation confinement, and native capabilities** only.

> **One form engine, three runtimes:** the same Angular portal runs in a plain browser, as a standalone Capacitor app, and **embedded in your app through this SDK**.

```
your app ──(presentPortalSheet / <AmthalPortalForm/> / present(from:))──► hardened WebView ──► https://portal/embed/…
                     ▲                                                                     │
                     └─────────────────── Amthal Bridge Protocol v1 ◄─────────────────────┘
                        (auth handoff · lifecycle events · downloads ·
                         back-button semantics · locale / theme)
```

### ✨ Key Features

- 📱 **Native presentation** — present a portal form as a device-native modal **sheet** (iOS `UISheetPresentationController`) or embed it **inline** in your screen.
- 🔐 **Secure auth handoff** — the bearer token is handed to the portal over the bridge (`init` / `auth`), never in a URL; automatic session-expiry → refresh round-trip.
- 🧱 **The portal owns the forms** — schemas, validation, and submission stay server-driven via `@amthal-group/ng-form-builder`; the SDK stays thin.
- 🛡️ **Hardened WebView** — origin/navigation confinement to the embed subtree, HTTPS-only, external links routed to the system browser.
- 🤝 **Version handshake** — `GET /embed/manifest.json` gates on `bridgeProtocolVersion` / `minPortalVersion` / `minSdkVersion` before anything loads.
- 🌐 **Locale & theme aware** — live English / Arabic (RTL) and light / dark, driven over the bridge.
- 🧩 **Native capabilities** — file downloads & preview, external links, and haptics brokered to the host.
- 🧪 **First-class TypeScript** — protocol types shared from a single source of truth (`@amthal-group/portal-bridge`).

---

## 📋 Table of Contents

- [Repository Layout](#-repository-layout)
- [Compatibility](#-compatibility)
- [Quick Start](#-quick-start)
  - [React Native — inline](#react-native--inline-embed)
  - [Expo — native sheet](#expo--native-sheet)
  - [iOS (Swift)](#ios-swift)
  - [Android (Kotlin)](#android-kotlin)
- [The Bridge Protocol](#-the-bridge-protocol)
- [Portal-Side Embed Mode](#-portal-side-embed-mode)
- [Local Development](#-local-development)
- [Security & Design Rules](#-security--design-rules)
- [License](#-license)

---

## 📦 Repository Layout

| Path | What it is |
|---|---|
| [`bridge/`](bridge/) | **Amthal Bridge Protocol v1** — the normative [SPEC](bridge/SPEC.md), TypeScript types, the web-side shim used by the portal, and a mock native host for browser QA. Everything else implements this. |
| [`ios/`](ios/) | **iOS SDK** (Swift Package, iOS 15+). `AmthalPortalViewController`, SwiftUI `AmthalPortalView`. |
| [`android/`](android/) | **Android SDK** (Kotlin, View-based, minSdk 24). `AmthalPortalView`, `PortalFormFragment`, `PortalFormActivity`. |
| [`wrappers/react-native/`](wrappers/react-native/) | **`@amthal-group/portal-react-native`** — pure-TypeScript wrapper over `react-native-webview` for **inline** embedding. |
| [`wrappers/expo/`](wrappers/expo/) | **`@amthal-group/portal-expo`** — Expo module that presents the native iOS SDK in a device-native **sheet** (`presentPortalSheet`). |
| [`demos/react-native-example/`](demos/react-native-example/) | Complete React Native example app (login → home → embedded form). |
| [`docs/`](docs/) | Integration & backend guides. |

The portal-side embed runtime (routes under `/embed/*`, platform bridge, auth handoff, `manifest.json`) lives in the **Client-Portal-Angular** repository.

---

## 🧩 Compatibility

| Platform | Requirement |
|---|---|
| iOS | 15.0+ |
| Android | minSdk 24 (Android 7.0)+ |
| React Native | 0.72+ with `react-native-webview` 13+ |
| Expo | SDK 52+ (prebuild / dev client) |
| Bridge protocol | v1 |

---

## ⚡ Quick Start

### React Native — inline embed

```tsx
import { AmthalPortalForm } from '@amthal-group/portal-react-native';

<AmthalPortalForm
  config={{ baseUrl: 'https://portal.example.com/portal', locale: 'ar', theme: 'system' }}
  auth={{ token, branchId }}
  request={{ kind: 'newApplication', type: 'external', productID: 42 }}
  onSubmitted={(r) => console.log('application', r.applicationNo)}
  onCancelled={() => navigation.goBack()}
  onError={(e) => console.warn(e.code, e.message)}
  onAuthExpired={(refresh) => myAuth.refreshToken().then(refresh)}
/>
```

### Expo — native sheet

```ts
import { presentPortalSheet } from '@amthal-group/portal-expo';

const session = presentPortalSheet({
  config: { baseUrl: 'https://portal.example.com/portal', locale: 'en', theme: 'system' },
  auth: { token, branchId },
  request: { kind: 'newApplication', type: 'external', productID: 42 },
  sheet: { detents: ['large', 'medium'], grabber: true },
  onSubmitted: (r) => console.log('submitted', r.applicationNo),
  onError: (e) => console.warn(e.code, e.message),
  onClosed: () => console.log('sheet closed'),
});

// later: session.updateAuth({ token: fresh });  session.configure({ theme: 'dark' });  session.dismiss();
```

### iOS (Swift)

```swift
import AmthalPortal

AmthalPortalViewController.present(
    from: self,
    config: try PortalConfig(baseURL: URL(string: "https://portal.example.com/portal")!),
    request: .newApplication(type: "external", productID: 42),
    auth: PortalAuth(token: token, branchId: branchId),
    delegate: self // AmthalPortalDelegate
)
```

### Android (Kotlin)

```kotlin
PortalFormActivity.start(
    context,
    PortalConfig(baseUrl = "https://portal.example.com/portal"),
    PortalRequest.NewApplication(type = "external", productID = 42),
    PortalAuth(token = token, branchId = branchId),
    listener // AmthalPortalListener
)
```

See each module's README for its platform quick start, and [`docs/`](docs/) for the auth handoff, version handshake, and security model.

---

## 🔌 The Bridge Protocol

All runtimes speak **Amthal Bridge Protocol v1** — the single contract between the native host and the embedded portal. Before anything loads, the SDK fetches `GET {baseUrl}/embed/manifest.json` and gates on:

```json
{ "bridgeProtocolVersion": 1, "portalVersion": "1.6.2", "minSdkVersion": "1.0.0" }
```

The full message catalogue (handshake, auth, lifecycle, downloads, back-button semantics, locale/theme) and the compatibility policy are defined in **[bridge/SPEC.md](bridge/SPEC.md)**. Protocol changes are spec PRs first.

---

## 🅰️ Portal-Side Embed Mode

This repository is the **client (host) side**. The **portal side** — the chromeless `/embed/*` routes, the platform bridge service, the auth-handoff service, and the version `manifest.json` — lives in the **Client-Portal-Angular** repository. A portal deployment must serve embed mode for the SDK to connect.

---

## 🛠️ Local Development

This is an npm workspaces monorepo (`bridge` + `wrappers/*`).

```bash
# 1. Install workspace dependencies
npm install

# 2. Build the shared bridge package (wrappers resolve @amthal-group/portal-bridge from its dist)
npm run build:bridge

# 3. Type-check everything
npm run typecheck
```

- **iOS** is a Swift Package (`ios/Package.swift`); the Expo module (`wrappers/expo`) compiles those same sources into its pod via a `prepare_command` at `pod install` time.
- **Android** is a Gradle library under `android/`.
- **`demos/react-native-example`** is a runnable end-to-end sample — set your portal origin in `src/config.ts`.

---

## 🔒 Security & Design Rules

1. **Credentials never travel in URLs** — only in `init` / `auth` bridge messages.
2. **The URL is the request** — the SDK navigates straight to `/embed/form/...`; deep routes are the portal's public embed API.
3. **The portal owns all form logic** — schemas, validation, submission. The SDK brokers auth, lifecycle, navigation confinement, and native capabilities only.
4. **Version handshake before anything loads** — `GET /embed/manifest.json`, gated by `bridgeProtocolVersion` / `minPortalVersion` / `minSdkVersion`.
5. **Protocol changes are spec PRs first** — see [bridge/SPEC.md](bridge/SPEC.md) §5 for the compatibility policy.

---

## 📄 License

MIT © [Amthal Group](https://www.amthalgroup.com/). See individual package manifests for details.

---

<div align="center">
<sub>Built with ❤️ by the Amthal Group engineering team.</sub>
</div>
