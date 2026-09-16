# Amthal Portal SDK

<div align="center">
<br>
<br>
<a href="https://www.amthalgroup.com/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/img/amthal-logo-white.svg">
    <img src="docs/assets/img/amthal-logo.svg" alt="Amthal Group" width="200">
  </picture>
</a>
<br>
<br>

**Embed the Amthal Client Portal — including its dynamic form builder — inside any native or hybrid mobile app.**

### 📖 [Read the documentation →](https://amthal.erpamthal.com/portal-sdk-docs/)

Getting started, every configuration option, the full API reference for all four platforms,
recipes, the bridge protocol, security and troubleshooting — searchable, in one place.

[![Documentation](https://img.shields.io/badge/Docs-portal--sdk--docs-121E4C?style=flat-square&logo=readthedocs&logoColor=white)](https://amthal.erpamthal.com/portal-sdk-docs/)
[![Bridge Protocol](https://img.shields.io/badge/Amthal%20Bridge-v1-00598A?style=flat-square)](bridge/SPEC.md)
[![SDK](https://img.shields.io/badge/SDK-1.0.0-00598A?style=flat-square)](#-compatibility)
[![iOS](https://img.shields.io/badge/iOS-15%2B-black?style=flat-square&logo=apple)](ios/)
[![Android](https://img.shields.io/badge/Android-minSdk%2024-3DDC84?style=flat-square&logo=android)](android/)
[![React Native](https://img.shields.io/badge/React%20Native-0.72%2B-61DAFB?style=flat-square&logo=react)](wrappers/react-native/)
[![Expo](https://img.shields.io/badge/Expo-module-000020?style=flat-square&logo=expo)](wrappers/expo/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](#-licence)

</div>

---

## 📱 What your users see

The same portal form, embedded in a real production app — Tasleeh, a maintenance-services
company running on Amthal. No web chrome, no address bar, no visible seam.

<table>
<tr>
<td width="33%" align="center"><img src="docs/assets/screenshots/ios-splash.png" alt="The SDK's wait screen on iOS, tinted with the tenant's brand colour and carrying the host app's own logo" width="250"></td>
<td width="33%" align="center"><img src="docs/assets/screenshots/ios-form.png" alt="A portal form rendered edge to edge on iOS, with a pinned submit bar" width="250"></td>
<td width="33%" align="center"><img src="docs/assets/screenshots/android-form.png" alt="A multi-step portal form on Android, with the stepper and a pinned action bar" width="250"></td>
</tr>
<tr>
<td align="center"><b>The wait</b><br><sub>iOS · your logo, your brand colour</sub></td>
<td align="center"><b>The form</b><br><sub>iOS · edge to edge, pinned action bar</sub></td>
<td align="center"><b>Multi-step</b><br><sub>Android · stepper, Prev / Submit</sub></td>
</tr>
</table>

The forms are not reimplemented natively — they are the portal's own dynamic forms, defined by
your Amthal tenant and updated without shipping an app release. The SDK's job is to make that
indistinguishable from native: full-bleed layout, safe-area aware action bars, RTL, the system
theme and font scale, native downloads and file pickers, and a hardware back button that the
form can answer.

The wait screen above is the SDK's own — one brand colour in, everything derived, your logo
optional. Replace it entirely with `renderLoading` if you would rather.

---

## 📋 Table of contents

- [What your users see](#-what-your-users-see)
- [What this is — and what it is not](#-what-this-is--and-what-it-is-not)
- [Architecture](#-architecture)
- [Compatibility](#-compatibility)
- [Quick start](#-quick-start)
  - [React Native — inline](#react-native--inline-the-most-used-path)
  - [Expo — native iOS sheet](#expo--native-ios-sheet)
  - [iOS (Swift / SwiftUI)](#ios-swift--swiftui)
  - [Android (Kotlin)](#android-kotlin)
- [Setup, A–Z](#-setup-az)
- [API reference](#-api-reference)
- [Recipes](#-recipes)
- [Troubleshooting](#-troubleshooting)
- [Security notes](#-security-notes)
- [Repository layout](#-repository-layout)
- [Local development, contributing & releasing](#-local-development-contributing--releasing)
- [Licence](#-licence)

---

## 🚀 What this is — and what it is not

The **Amthal Portal SDK** loads the Amthal **Client Portal** — a deployed Angular application — inside a hardened WebView in your app, and puts a versioned message bridge between the two. Your app stays in charge of identity, navigation and native chrome; the portal stays in charge of the forms.

**What the SDK does for you**

- **Auth handoff.** Your bearer token is handed over in a bridge message, never in a URL, and re-issued on demand when the portal's session expires.
- **Lifecycle.** Version handshake → load → bridge handshake → `ready`, with submission / cancellation / error surfaced as ordinary callbacks.
- **Navigation confinement.** The WebView's main frame may only reach the portal origin's `/embed` subtree. Anything else is cancelled and handed to the system browser.
- **Native capabilities.** File downloads and preview, external links, file uploads, back-button and swipe-dismiss semantics, locale/theme/font-scale at runtime.

**What it deliberately does not do**

- It does **not** render forms. Field types, layout, validation rules, option sources, drafts and submission all live in the portal's own form engine and its backend. Deploy a new form and every app sees it immediately — no app release.
- It does **not** log anyone in. You obtain the token with your own login flow, against the same backend the portal uses.
- It does **not** decide when to close. `formSubmitted` never auto-dismisses anything; your app owns the screen.

> **One form engine, three runtimes.** The same Angular portal runs in a plain browser, as a standalone app, and **embedded in your app through this SDK**.

---

## 🏗 Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│  YOUR APP                                                                 │
│                                                                           │
│   login / token store        navigation & chrome        your own screens  │
│            │                        ▲                                     │
│            │  config + auth +       │  onSubmitted · onCancelled           │
│            │  request               │  onError · onAuthExpired             │
│            ▼                        │                                     │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │  Amthal Portal SDK                                               │    │
│   │  <AmthalPortalForm/>  ·  presentPortalSheet()                    │    │
│   │  AmthalPortalViewController  ·  AmthalPortalView / Activity      │    │
│   │                                                                  │    │
│   │  1. GET {baseUrl}/embed/manifest.json   → version gate           │    │
│   │  2. load {baseUrl}/embed/form/…         → hardened WebView       │    │
│   │  3. hello ⇄ init ⇄ ready                → Amthal Bridge v1       │    │
│   └──────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────┬─────────────────────────────────────────┘
                                  │  Amthal Bridge Protocol v1
                                  │  auth · lifecycle · downloads ·
                                  │  back / dismiss · locale & theme
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  CLIENT PORTAL  (Angular, deployed by Amthal)                             │
│  /embed/*  chromeless routes   ·   form engine   ·   /embed/manifest.json  │
└─────────────────────────────────┬─────────────────────────────────────────┘
                                  ▼
                       Optimum Core API  (/Portal/Forms/*, /Portal/PublicForms/*)
```

The protocol is normative and lives in **[`bridge/SPEC.md`](bridge/SPEC.md)**; the canonical TypeScript shapes are in [`bridge/src/protocol.ts`](bridge/src/protocol.ts). Every runtime in this repository implements that one contract, so behaviour is identical across platforms except where the [capability matrix](#capability-matrix) says otherwise.

---

## 🧩 Compatibility

| Component | Requirement |
|---|---|
| **Bridge protocol** | v1 (`bridgeProtocolVersion: 1`) — the SDK gates on **strict equality** |
| **SDK version** | `1.0.0` on all platforms (reported to the portal as `sdkVersion`) |
| **Client Portal** | A deployment that serves `/embed/*` and `/embed/manifest.json`. Whatever it reports as `portalVersion` must satisfy your `minPortalVersion` (this repo is developed against portal **1.8.0**) |
| **iOS** | 15.0+ (Swift 5.9, Swift Package). The Expo module's pod targets iOS 15.1+ |
| **Android** | `minSdk` 24 (Android 7.0), `compileSdk` 35, JVM target 17 |
| **React Native** | ≥ 0.72, React ≥ 18, `react-native-webview` ≥ 13 — old or new architecture |
| **Expo** | SDK 52+ with a dev client / prebuild (**iOS only** — the Expo module declares `platforms: ["apple"]`) |
| **TypeScript** | 5.x (types ship with the packages; `strict` friendly) |

### Packages

| Artifact | Registry | Use it for |
|---|---|---|
| `@amthal-group/portal-react-native` | GitHub Packages (npm) | React Native / Expo apps — **inline** embedding |
| `@amthal-group/portal-expo` | GitHub Packages (npm) | Expo apps that want a **native iOS sheet** |
| `@amthal-group/portal-bridge` | GitHub Packages (npm) | Protocol types/helpers (a transitive dependency of both wrappers) |
| `AmthalPortal` (Swift Package) | this repo, `ios/Package.swift` | Native iOS apps |
| `com.amthalgroup:portal-sdk:1.0.0` | GitHub Packages (Maven) | Native Android apps |

### Capability matrix

Honest differences between the four hosts. Everything unlisted behaves the same everywhere.

| Capability | RN inline | Expo sheet (iOS) | Native iOS | Native Android |
|---|:--:|:--:|:--:|:--:|
| Version handshake + error interstitials | ✅ | ✅ | ✅ | ✅ |
| Auth handoff + `authExpired` → refresh | ✅ | ✅ | ✅ | ✅ |
| Navigation confinement to `basePath + /embed` | ✅ | ✅ | ✅ | ✅ |
| Runtime `configure` (locale / theme / fontScale) | ✅ | ✅ | ✅ | ✅ |
| Hardware back → `backPressed` round-trip | ✅ | n/a | ✅ (`performBack()`) | ✅ |
| Unsaved-changes guard (`dismissRequested`) | ✅ `requestDismiss()` | ✅ built into `dismiss()` | ✅ built into Close + swipe | ⚠️ implemented internally, **no public API** |
| Authenticated downloads with headers | ⚠️ via your `onDownloadRequest` | ✅ QuickLook | ✅ QuickLook | ✅ `ACTION_VIEW` |
| File uploads from the form | ✅ (webview) | ✅ | ✅ | ✅ (auto-wired by Activity/Fragment) |
| **Form delegation** (`formOp`, SPEC §4.1) | ✅ | ❌ fails fast | ❌ | ❌ |
| Haptics (`haptic` message) | ❌ ignored | ✅ | ✅ | ❌ ignored |
| Certificate-pinning hook | ❌ | ❌ | ❌ | ✅ `certificatePinner` |
| Auto-retry when connectivity returns | ❌ (manual retry UI) | ✅ | ✅ | ✅ |
| Custom loading / error UI | ✅ `renderLoading` / `renderError` | ❌ native chrome | ❌ native chrome | ❌ native chrome |

> **Form delegation is React-Native-only today.** The native Android host does not implement `formOp` and its `init` omits `formDelegation` entirely; native iOS is the same. If your app owns the form data plane, use the inline `<AmthalPortalForm/>`.

---

## ⚡ Quick start

Five minutes, assuming you already have a portal URL and a token. If you do not, jump to [Setup, A–Z](#-setup-az) first — steps 3 to 6 are exactly "where do these values come from".

### React Native — inline (the most used path)

```sh
npm install @amthal-group/portal-react-native react-native-webview
cd ios && pod install
```

`src/screens/ServiceRequestScreen.tsx` — complete and copy-pasteable:

```tsx
import React, { useCallback, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import {
  AmthalPortalForm,
  type AmthalPortalFormHandle,
  type FormSubmitResult,
  type PortalAuthState,
  type PortalErrorInfo,
} from '@amthal-group/portal-react-native';

/** MUST include the portal's deploy path prefix — see Setup step 3. */
const PORTAL_BASE_URL = 'https://portal.example.com/portal';
const BRANCH_ID = '12';

type Props = {
  /** Your app's bearer token, or undefined for an anonymous/public form. */
  token?: string;
  productID: number;
  onClose: () => void;
};

export default function ServiceRequestScreen({ token, productID, onClose }: Props) {
  const portal = useRef<AmthalPortalFormHandle>(null);

  const [auth, setAuth] = useState<PortalAuthState | undefined>(
    token ? { token, branchId: BRANCH_ID } : undefined,
  );

  const handleSubmitted = useCallback(
    (result: FormSubmitResult) => {
      Alert.alert('Submitted', `Reference #${result.applicationNo ?? '—'}`, [
        { text: 'OK', onPress: onClose },
      ]);
    },
    [onClose],
  );

  const handleError = useCallback((error: PortalErrorInfo) => {
    Alert.alert('Could not open the form', `${error.code}: ${error.message ?? ''}`);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <AmthalPortalForm
        ref={portal}
        style={{ flex: 1 }}
        config={{ baseUrl: PORTAL_BASE_URL, locale: 'en', theme: 'light' }}
        // Omit `auth` entirely for the anonymous plane. Never pass { token: '' }.
        auth={auth}
        request={{
          kind: 'newApplication',
          // 'internal' = signed in (/Portal/Forms/*). Anything else = public.
          type: auth ? 'internal' : 'external',
          productID,
        }}
        onSubmitted={handleSubmitted}
        onCancelled={onClose}
        // Required for the Android hardware-back handler to be installed at all.
        onCloseRequested={onClose}
        onError={handleError}
        onAuthExpired={async (refresh) => {
          const fresh = await myRefreshToken();          // your refresh call
          const next = { token: fresh, branchId: BRANCH_ID };
          setAuth(next);
          refresh(next);                                  // resumes the portal
        }}
      />
    </View>
  );
}

declare function myRefreshToken(): Promise<string>;
```

### Expo — native iOS sheet

Presents the **native** iOS SDK inside a `UISheetPresentationController`. Requires a prebuild / dev client (it contains native code); it does nothing on Android.

```ts
// src/portal/sheet.ts
import {
  presentPortalSheet,
  type PortalSheetSession,
} from '@amthal-group/portal-expo';

const PORTAL_BASE_URL = 'https://portal.example.com/portal';
const BRANCH_ID = '12';

let sheet: PortalSheetSession | null = null;

export function openServiceForm(token: string, productID: number) {
  sheet = presentPortalSheet({
    config: { baseUrl: PORTAL_BASE_URL, locale: 'en', theme: 'system' },
    auth: { token, branchId: BRANCH_ID },
    request: { kind: 'newApplication', type: 'internal', productID },
    sheet: { detents: ['large', 'medium'], grabber: true, cornerRadius: 20 },

    onReady: ({ portalVersion }) => console.log('portal', portalVersion),
    onSubmitted: (result) => console.log('application', result.applicationNo),
    onCancelled: () => sheet?.dismiss(),
    onError: (error) => console.warn(error.code, error.message),
    onAuthExpired: async () => {
      const fresh = await myRefreshToken();
      sheet?.updateAuth({ token: fresh, branchId: BRANCH_ID });
    },
    onNavigate: ({ path, title }) => console.log('navigated', path, title),
    onClosed: () => { sheet = null; },
  });
}

/** Runtime theme switch, e.g. from your settings screen. */
export function setPortalTheme(theme: 'light' | 'dark' | 'system') {
  sheet?.configure({ theme });
}

declare function myRefreshToken(): Promise<string>;
```

`sheet.dismiss()` runs the SDK's unsaved-changes guard before it closes, so it is safe to call from a Cancel button.

<a id="ios-swift--swiftui"></a>

<details>
<summary><strong>iOS (Swift / SwiftUI)</strong> — click to expand</summary>

<br>

**Install.** A [`Package.swift`](Package.swift) at the repository root declares the `AmthalPortal` library (its sources live in [`ios/Sources/AmthalPortal`](ios/Sources/AmthalPortal)), so SwiftPM can resolve it straight from the Git URL:

- Xcode → **File ▸ Add Package Dependencies…** → paste the repository URL.
- Working from a local checkout instead? **Add Local…** → select `portal-sdk/ios`, which carries an equivalent manifest so the SDK also opens standalone in Xcode.
- Or, in your own `Package.swift`:

  ```swift
  dependencies: [
      .package(url: "https://github.com/Amthal-Group/amthal-portal-sdk.git", from: "1.0.0")
      // local checkout instead:
      // .package(path: "../portal-sdk/ios")
  ],
  targets: [
      .target(name: "MyApp", dependencies: [.product(name: "AmthalPortal", package: "amthal-portal-sdk")])
  ]
  ```

  > `from: "1.0.0"` resolves against git tags. Until the first release is tagged, use `branch: "main"`. With the local-path form the package name is `AmthalPortal`, not `portal-sdk`.

**UIKit — present modally**, with a Close button and swipe-dismiss already wired to the unsaved-changes guard:

```swift
import AmthalPortal
import UIKit

final class ServicesViewController: UIViewController {

    func openForm(token: String, productID: Int) {
        guard let baseURL = URL(string: "https://portal.example.com/portal") else { return }

        do {
            let config = try PortalConfig(
                baseURL: baseURL,          // includes the deploy path prefix
                locale: .en,
                theme: .system,
                minPortalVersion: "1.8.0"  // optional floor — the oldest portal you tested
            )

            AmthalPortalViewController.present(
                from: self,
                config: config,
                request: .newApplication(type: "internal", productID: productID),
                auth: PortalAuth(token: token, branchId: "12"),
                delegate: self
            )
        } catch {
            // PortalConfigError.invalidBaseURL / .insecureBaseURL
            print("Portal config rejected: \(error.localizedDescription)")
        }
    }
}

extension ServicesViewController: AmthalPortalDelegate {

    func portalReady(portalVersion: String) {
        print("portal \(portalVersion) ready")
    }

    func formSubmitted(_ result: FormSubmitResult) {
        let reference = result.applicationNo?.description ?? "—"
        print("application \(reference) for product \(result.productID)")
    }

    func formCancelled() {
        dismiss(animated: true)
    }

    func portalError(_ error: PortalError) {
        // .authExpired → obtain a fresh token and call updateAuth(_:) on the controller.
        print(error.description)
    }

    func closeRequested() {
        // `present(from:)` already dismisses itself; clean up your own state here.
    }
}
```

**SwiftUI** — `AmthalPortalView` forwards `auth` / `locale` / `theme` / `fontScale` changes to the live session automatically:

```swift
import AmthalPortal
import SwiftUI

struct PortalFormSheet: View {
    let config: PortalConfig
    let auth: PortalAuth
    let productID: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        AmthalPortalView(
            config: config,
            request: .newApplication(type: "internal", productID: productID),
            auth: auth,
            onReady: { version in print("portal \(version)") },
            onSubmitted: { result in
                print("submitted \(result.applicationNo?.description ?? "—")")
                dismiss()
            },
            onCancelled: { dismiss() },
            onError: { error in print(error.description) },
            onNavigate: { path, title in print(path, title ?? "") },
            onCloseRequested: { dismiss() },
            onOpenExternal: { _ in false }   // false ⇒ SDK presents SFSafariViewController
        )
        .ignoresSafeArea()
    }
}
```

To drive close/back yourself, keep a reference to the `AmthalPortalViewController` and call `requestClose()` (runs the dirty-state guard) or `performBack()` (steps the form back first).

</details>

<a id="android-kotlin"></a>

<details>
<summary><strong>Android (Kotlin)</strong> — click to expand</summary>

<br>

**Install.** Add the GitHub Packages Maven repository and the dependency:

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("https://maven.pkg.github.com/Amthal-Group/amthal-portal-sdk")
            credentials {
                username = providers.gradleProperty("gpr.user").orNull ?: System.getenv("GITHUB_ACTOR")
                password = providers.gradleProperty("gpr.key").orNull ?: System.getenv("GITHUB_TOKEN")
            }
        }
    }
}

// app/build.gradle.kts
dependencies {
    implementation("com.amthalgroup:portal-sdk:1.0.0")
}
```

The token needs `read:packages`. Put `gpr.user` / `gpr.key` in `~/.gradle/gradle.properties`, never in the repository.

**Full-screen Activity** — the fastest path. `PortalFormActivity` is already declared in the SDK's manifest, handles hardware back through the bridge, and wires file uploads:

```kotlin
import com.amthalgroup.portal.*

fun openForm(context: Context, token: String, productID: Int) {
    val config = PortalConfig(
        baseUrl = "https://portal.example.com/portal",  // includes the deploy path prefix
        locale = PortalLocale.EN,
        theme = PortalTheme.SYSTEM,
        minPortalVersion = "1.8.0"   // optional floor — the oldest portal you tested
    )

    PortalFormActivity.start(
        context,
        config,
        PortalRequest.NewApplication(type = "internal", productID = productID),
        PortalAuth(token = token, branchId = "12"),
        object : AmthalPortalListener {

            override fun onPortalReady(portalVersion: String) {
                Log.i("Portal", "ready $portalVersion")
            }

            override fun onFormSubmitted(result: FormSubmitResult) {
                Log.i("Portal", "application ${result.applicationNo} / product ${result.productID}")
                // The SDK never auto-closes: finish the activity yourself when you are ready.
            }

            override fun onFormCancelled() { /* the user backed out */ }

            override fun onPortalError(error: PortalError) {
                if (error.code == PortalErrorCode.AUTH_EXPIRED) {
                    // refresh, then: activity.updateAuth(PortalAuth(freshToken, "12"))
                }
            }

            override fun onNavigate(path: String, title: String?) { /* header titles */ }
        }
    )
}
```

**Embedding the view yourself** (inside your own Activity or Fragment):

```kotlin
class MyFormActivity : AppCompatActivity() {

    private lateinit var portal: AmthalPortalView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        portal = AmthalPortalView(this)
        setContentView(portal)

        // Required for file uploads from the form.
        portal.attachActivityResultRegistry(activityResultRegistry)

        portal.start(config, request, auth, listener)

        onBackPressedDispatcher.addCallback(this) {
            // Returns false when there is no live session — then do your own thing.
            if (!portal.onBackPressed()) finish()
        }
    }

    override fun onDestroy() {
        portal.destroy()
        super.onDestroy()
    }
}
```

`PortalFormFragment.newInstance(config, request, auth, listener)` is the Fragment equivalent and wires all of the above for you.

</details>

---

## 🛠 Setup, A–Z

Everything you need, in order. If a step's verification command does not print what it says it should, stop there — the next step will not work.

### 1. Get access to the package registry

`@amthal-group/*` packages are published to **GitHub Packages**, which requires authentication even for public reads. Create a GitHub personal access token (classic) with the **`read:packages`** scope, then:

**`~/.npmrc`** (user-wide, keeps the token out of your repository):

```ini
@amthal-group:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Verify:

```bash
npm view @amthal-group/portal-react-native version
# → 1.0.0
```

`401 Unauthorized` here means the token is missing, expired, or lacks `read:packages`. In CI, set the token as a secret and write the same two lines at build time — never commit them.

> Working from a local checkout of this monorepo instead? Depend on the path directly and skip the registry:
> `"@amthal-group/portal-react-native": "file:../portal-sdk/wrappers/react-native"`, then run `npm run build:bridge` in `portal-sdk/` once.

### 2. Install the SDK and its peer dependencies

```sh
# React Native / Expo — inline embedding
npm install @amthal-group/portal-react-native react-native-webview

# Expo — additionally, for the native iOS sheet
npm install @amthal-group/portal-expo

# iOS pods (react-native-webview has native code; the RN wrapper itself does not)
cd ios && pod install
```

| Peer dependency | Version | Why |
|---|---|---|
| `react` | ≥ 18 | hooks used by the component |
| `react-native` | ≥ 0.72 | `BackHandler`, `Linking`, `Platform` |
| `react-native-webview` | ≥ 13 | the WebView, `onMessage` / `injectJavaScript` transport, `onOpenWindow` |
| `expo`, `expo-modules-core` | any | `@amthal-group/portal-expo` only |

Expo apps cannot use Expo Go — both wrappers need native code (`react-native-webview`, and the Expo module's pod). Build a dev client:

```sh
npx expo prebuild
npx expo run:ios      # or: npx expo run:android
```

### 3. Configure your portal URL — the single most important value

`config.baseUrl` is the **full** base URL of the portal deployment, **including any deploy path prefix**.

The Amthal Client Portal ships with `<base href="/portal/">`, so the correct value on a typical deployment is:

```
https://portal.example.com/portal          ✅
https://portal.example.com                 ❌ drops the prefix
https://portal.example.com/portal/         ✅ (a trailing slash is tolerated)
https://portal.example.com/portal?x=1      ❌ no query string, ever
```

**Why the prefix matters.** The SDK derives the allowed navigation subtree from `baseUrl` — everything under `basePath + /embed` is permitted, everything else is cancelled. Drop the `/portal` segment and the *first* in-portal navigation looks off-subtree; the user is thrown into the system browser or left staring at a blank view.

Ask your Amthal contact for the URL, or read it off a browser session: open the portal, and the string up to and including the base-href segment is your `baseUrl`.

**Verify — this is the check that catches most broken integrations:**

```bash
curl -sI https://portal.example.com/portal/embed/manifest.json | grep -i '^content-type'
# → content-type: application/json

curl -s https://portal.example.com/portal/embed/manifest.json
# → {"portalVersion":"1.8.0","bridgeProtocolVersion":1,"minSdkVersion":"1.0.0"}
```

If the content type is `text/html`, you are being served the SPA's `index.html` by a catch-all rewrite — the manifest file is not deployed, or your path prefix is wrong. The SDK will fail with **`manifestFailed`**. See [Troubleshooting](#-troubleshooting).

**http vs https.** HTTPS is mandatory. `http://` is accepted only for loopback hosts, or behind the DEV-only `allowInsecureHttp` flag described in steps 7 and 8. Release builds enforce HTTPS on every platform regardless of that flag.

The loopback set differs slightly per host — `localhost` and `127.0.0.1` are accepted everywhere; `10.0.2.2` (the Android-emulator alias for your machine) is accepted by the React Native and Android hosts; `::1` by the iOS and Android hosts. When in doubt, use `localhost` or set `allowInsecureHttp`.

### 4. Know your branch (`branchId`)

An Amthal deployment is multi-tenant: a **branch** is the tenant/organisation whose forms, workflow and branding apply. `branchId` is a numeric id passed as a string (`"12"`).

- **In most apps it is a constant.** Get it from your Amthal contact and put it in your environment config (`EXPO_PUBLIC_BRANCH_ID`, `BuildConfig`, …).
- **To look it up from the API**, either endpoint works (both are anonymous):

  ```bash
  # resolves from the Host/Referer of the request
  curl -s "https://api.example.com/Portal/Container/GetPortalConfig"
  # → { "succeeded": true, "data": { "branchID": 12, ... } }

  # resolves from an explicit origin
  curl -s "https://api.example.com/Container/GetWebsiteContainerInfo?referer=https://portal.example.com"
  # → { "succeeded": true, "data": { "branchID": 12, "companyName": "…", "primaryColor": "#…" } }
  ```

- **Do not derive it from a login response.** A customer/contact login can legitimately carry a null branch; use your configured value.
- If you omit `branchId` on an anonymous session, the portal falls back to resolving the branch from the host name the WebView loaded — correct on a single-tenant host, ambiguous otherwise. Pass it when you know it.

### 5. Obtain a token

The SDK never shows a login screen. Use your own login against the same backend the portal uses:

```bash
curl -s -X POST "https://api.example.com/Portal/Authentication/Authenticate" \
  -H 'Content-Type: application/json' \
  -d '{"username":"customer@example.com","password":"…","rememberme":true}'
```

```jsonc
{
  "success": true,
  "authenticationResponse": {
    "token": "eyJhbGciOi…",     //  ← this is what you pass as auth.token
    "tokenExpiry": 1757000000,
    "branchID": "12",
    "employeeID": "4187",
    "employeeName": "…"
  }
}
```

**What to store, and where.** The token only. Keep it in the platform keystore — iOS Keychain / Android Keystore, or `expo-secure-store` in Expo — never in `AsyncStorage`, never in a file, never in a log line.

**Refreshing.** When the portal's own refresh fails it emits `authExpired` and pauses. Mint a new token and hand it back:

```bash
curl -s -X POST "https://api.example.com/Portal/Authentication/RefreshTokenWithExpiredToken" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<the expired token>","contactID":4187}'
```

```jsonc
{
  "succeeded": true,
  "data": {
    "token": "…",
    "refreshtoken": "eyJhbGciOi…"   //  ← the NEW token is HERE, not in `token`
  }
}
```

> ⚠️ **Read `data.refreshtoken`, not `data.token`.** This trips up every first integration.

**Passing the user object.** `auth.user` is optional: hand over the profile object your app already has and the portal skips a profile round-trip. When omitted, the portal reconstructs the user from the token. It is worth passing when you have it — the portal's silent-refresh path uses profile fields.

**Anonymous sessions.** For a public form, **omit `auth` entirely** in React Native:

```tsx
<AmthalPortalForm config={config} request={request} /* no auth prop */ … />
```

`init` then carries no `auth` key, which is how the portal is told "public plane" — and it also clears any credentials a previous launch left in the WebView's storage. **Do not pass `{ token: '' }`** to mean this. (On the native iOS/Android/Expo APIs the `auth` argument is not optional; there, an empty token string is the way to declare an anonymous session, and the portal treats a blank token as no credential.)

### 6. Open a form — finding `type` and `productID`

A request is one of three shapes:

| Request | Portal route |
|---|---|
| `{ kind: 'newApplication', type, productID }` | `{basePath}/embed/form/:type/:productID` |
| `{ kind: 'existingApplication', type, productID, batchID, headerID, readOnly }` | `{basePath}/embed/form/:type/:productID/:batchID/:headerID/:readOnly` |
| `{ kind: 'path', path }` | any other `{basePath}/embed/…` route (escape hatch) |

**`type` selects the application plane, and getting it wrong fails silently.**

| `type` | Plane | Endpoints | Effect |
|---|---|---|---|
| `'internal'` (the literal string) | Signed in | `/Portal/Forms/*` | Files the application against the signed-in contact; it appears in *their* requests list |
| anything else — by convention `'external'` | Anonymous / public | `/Portal/PublicForms/*` | The server resolves a stand-in applicant; the submission belongs to nobody |

The portal tests `type === "internal"` and falls through for every other value. A signed-in user opened with `'external'` gets a form that submits successfully and then never shows up in their history.

**`productID` is the form's id in the DMS catalogue.** List the catalogue from the same API:

```bash
# anonymous / public forms
curl -s "https://api.example.com/Portal/PublicForms/GetCategories?formType=1"

# signed-in catalogue
curl -s "https://api.example.com/Portal/Forms/GetCategories?formType=1" \
  -H "Authorization: Bearer $TOKEN"
```

```jsonc
{
  "succeeded": true,
  "data": [
    {
      "id": 4,
      "name": "Maintenance",
      "subLevels": [
        { "productID": 830, "productName": "Maintenance Request", "active": true, "visibility": true }
      ]
    }
  ]
}
```

`productID` is what you pass; `productName` is what you show. In most apps these come from your own services/menu screen, which is already driven by this catalogue.

### 7. iOS specifics

**Nothing is required for a normal HTTPS portal.** App Transport Security is satisfied out of the box.

**For a plain-HTTP development portal** (an Amthal portal dev server bound to a tenant hostname, because the backend resolves the tenant from the request host) you need two things — and both are development-only:

1. `config.allowInsecureHttp = true` — honoured only in `__DEV__` (React Native) / `#if DEBUG` (native and Expo) builds. Release builds always enforce HTTPS.
2. An ATS exception for that exact domain, in your app's **`Info.plist`**:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSExceptionDomains</key>
  <dict>
    <key>portal-dev.example.com</key>
    <dict>
      <key>NSExceptionAllowsInsecureHTTPLoads</key>
      <true/>
      <key>NSIncludesSubdomains</key>
      <true/>
    </dict>
  </dict>
</dict>
```

In **Expo**, put the same thing in `app.json` / `app.config.ts` and re-run prebuild:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSAppTransportSecurity": {
          "NSExceptionDomains": {
            "portal-dev.example.com": {
              "NSExceptionAllowsInsecureHTTPLoads": true,
              "NSIncludesSubdomains": true
            }
          }
        }
      }
    }
  }
}
```

Never use `NSAllowsArbitraryLoads`, and never ship either exception in a production build.

**Camera / photo uploads.** If your forms accept file attachments, add the usage strings your app needs (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`) — iOS terminates the app without them.

### 8. Android specifics

**Nothing is required for a normal HTTPS portal.** The SDK declares `INTERNET` and `ACCESS_NETWORK_STATE` itself.

**For a plain-HTTP development portal**, alongside `allowInsecureHttp = true` (honoured only when your app is **debuggable** — a release APK ignores it and logs that it did), permit cleartext to that host. Prefer a scoped network-security config over a blanket flag:

`app/src/debug/res/xml/network_security_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">portal-dev.example.com</domain>
    <domain includeSubdomains="true">10.0.2.2</domain>
  </domain-config>
</network-security-config>
```

`app/src/debug/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:networkSecurityConfig="@xml/network_security_config" />
</manifest>
```

In **Expo**, use `expo-build-properties` and keep it out of production builds:

```json
{
  "expo": {
    "plugins": [["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]]
  }
}
```

**Predictive back (`android:enableOnBackInvokedCallback`).** The native SDK routes hardware back through `OnBackPressedDispatcher`, so opting into predictive back in your application tag is supported:

```xml
<application android:enableOnBackInvokedCallback="true" … >
```

If you are on **React Native**, verify after enabling it that back presses still reach `BackHandler` on your RN version — the inline wrapper's back handling depends on it, and support for predictive back landed in RN at different points across versions. When in doubt, leave the flag off for the screen that hosts the portal.

**Hardware back only works if you pass `onCloseRequested`** (React Native). Without that prop the SDK does not install a back handler at all and the platform default applies, so the form never gets the chance to step back internally.

### 9. Wire the required callbacks

Three React Native props are mandatory, and a fourth is effectively mandatory:

| Prop | Why you cannot skip it |
|---|---|
| `onSubmitted` | The SDK never auto-closes. Without it a successful submission does nothing visible. |
| `onCancelled` | The user tapped the form's own close/finish affordance; nobody else will pop your screen. |
| `onError` | Every SDK failure lands here. Without it a broken portal is a blank screen. |
| `onCloseRequested` | No Android hardware-back handling at all without it. |

### 10. Verify your setup

Run through this list before you write any UI. Each line has an expected result.

| # | Check | Command / action | Expected |
|---|---|---|---|
| 1 | Registry auth | `npm view @amthal-group/portal-react-native version` | `1.0.0` |
| 2 | Manifest is JSON | `curl -sI {baseUrl}/embed/manifest.json \| grep -i content-type` | `application/json` |
| 3 | Manifest content | `curl -s {baseUrl}/embed/manifest.json` | `{"portalVersion":"…","bridgeProtocolVersion":1,…}` |
| 4 | Protocol matches | read `bridgeProtocolVersion` from step 3 | exactly `1` |
| 5 | Form route exists | `curl -sI {baseUrl}/embed/form/external/{productID}` | `200` (HTML — the SPA shell) |
| 6 | Token is valid | `curl -s {api}/Portal/Forms/GetCategories?formType=1 -H "Authorization: Bearer $TOKEN"` | `"succeeded": true` with a non-empty `data` |
| 7 | `productID` exists | find it in step 6's `data[].subLevels[]` | present, `active: true` |
| 8 | Bridge opens | run the app with `enableLogging: true` in `__DEV__` | console shows `manifest OK`, then the loading overlay disappears |
| 9 | Submission round-trip | submit the form | your `onSubmitted` fires with an `applicationNo` |
| 10 | Android back | press hardware back mid-form | steps back inside the form, then calls `onCloseRequested` |

**Portal-side debugging without a device.** A `-dev` portal build accepts a mock native host in a desktop browser — useful for isolating whether a problem is yours or the portal's:

```
https://portal-dev.example.com/portal/embed/form/external/830?mockEmbed=1
https://portal-dev.example.com/portal/embed/form/internal/830?mockEmbed=1&mockToken=<jwt>&mockBranch=12
```

Extra parameters: `&mockLocale=ar`, `&mockTheme=dark`, `&mockFontScale=1.2`, `&mockPlatform=ios|android|react-native`. The default is deliberately anonymous.

### 11. Ship it

- Remove `allowInsecureHttp`, the ATS exception and the cleartext config from release builds. They are ignored at runtime anyway — but leaving them in a shipped manifest is a finding in any security review.
- Set `enableLogging` to `__DEV__` only. The SDK drops portal `log` messages in release builds regardless, per the protocol.
- Consider setting `config.minPortalVersion` to the oldest portal you have tested against, and treating `versionIncompatible` in your UI as "please update the app".

---

## 📚 API reference

Everything below is the React Native surface (`@amthal-group/portal-react-native`), which is the richest. Native equivalents are named in the [capability matrix](#capability-matrix) and in each quick start.

### `<AmthalPortalForm />` props

| Prop | Type | Required | Description |
|---|---|:--:|---|
| `config` | `PortalSdkConfig` | ✔ | Portal location and presentation options. See below. |
| `auth` | `PortalAuthState \| undefined` | | Credentials seeded into `init` and re-sent whenever the prop changes. **Omit entirely for an anonymous session** — `init` then carries no `auth` key at all, which is how the portal is told to use the public plane and to drop credentials left by a previous launch. Never pass `{ token: '' }`. |
| `request` | `PortalFormRequest` | ✔ | What to open. Mapped to a URL by `resolveEmbedUrl` — never carries credentials. |
| `onSubmitted` | `(result: FormSubmitResult) => void` | ✔ | The form was submitted successfully. The SDK never auto-closes; you decide what happens next. |
| `onCancelled` | `() => void` | ✔ | The user exited through the form's own close/finish affordance. |
| `onError` | `(error: PortalErrorInfo) => void` | ✔ | Any SDK-level failure. Also fires for `authExpired` when no `onAuthExpired` handler is set. |
| `onReady` | `() => void` | | The portal emitted `ready`; the loading overlay is gone. |
| `onAuthExpired` | `(refresh: (auth: PortalAuthState) => void, reason?: string) => void` | | The portal's own token refresh failed. Obtain a fresh token and call `refresh(next)`. A "Refreshing your session…" overlay is shown until the portal acknowledges. |
| `onCloseRequested` | `() => void` | | Android hardware back was **not** consumed by the form (or timed out) — close your screen. **Without this prop the SDK does not intercept the back button at all.** |
| `onOpenExternal` | `(url: string) => boolean` | | The portal asked to open a URL outside the WebView. Return `true` to handle it yourself; otherwise the SDK calls `Linking.openURL`. |
| `onDownloadRequest` | `(download: DownloadRequestPayload) => void` | | Handle a file download. Default behaviour is `Linking.openURL(url)`, which **cannot attach `headers`**. See the [downloads recipe](#downloads-that-need-an-authorization-header). |
| `onNavigate` | `(nav: NavigatePayload) => void` | | Informational: fired on every router navigation inside `/embed/*` (`{path, title?}`). Ideal for a native header title. |
| `onFormOp` | `(request: FormOpRequestPayload) => Promise<unknown>` | | **Form delegation (SPEC §4.1).** When present, `init` declares `formDelegation: true` and the portal routes every form data operation here instead of calling its own endpoints. Resolve with the raw response body; reject to surface an error; reject with an object carrying `status: 401` to trigger the auth-expired flow. |
| `style` | `StyleProp<ViewStyle>` | | Container style (the container is `flex: 1` by default). |
| `renderLoading` | `() => ReactElement` | | Custom loading UI, shown until `ready`. |
| `renderError` | `({ error, retry }) => ReactElement` | | Custom error UI. Call `retry()` to re-run the manifest gate and reload. |

### `PortalSdkConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | — | **Required.** Portal base URL including any deploy path prefix (`https://host/portal`). HTTPS only; `http://localhost` for development. No query string, no credentials. |
| `locale` | `'en' \| 'ar'` | portal default | Portal UI language. `'ar'` also flips the document direction to RTL. |
| `theme` | `'light' \| 'dark' \| 'system'` | portal default | Portal theme; also drives the SDK's own loading/error overlays. |
| `fontScale` | `number` | `1.0` | Root font-size multiplier applied by the portal. |
| `minPortalVersion` | `string` | — | Fail with `versionIncompatible` when the deployed portal is older than this (dotted semver). |
| `allowedOrigins` | `string[]` | `[origin of baseUrl]` | Extra origins permitted for main-frame navigation. Rarely needed. |
| `enableLogging` | `boolean` | `false` | Forward portal `log` messages and SDK diagnostics to the console. **`__DEV__` builds only** — always dropped in release, per the protocol. |
| `allowInsecureHttp` | `boolean` | `false` | **DEV only.** Permit a plain-`http://` `baseUrl` on a non-localhost host. Build-gated on every platform (`__DEV__` / `#if DEBUG` / `FLAG_DEBUGGABLE`); release builds always enforce HTTPS. On iOS you also need the ATS exception from [step 7](#7-ios-specifics). |

### `PortalAuthState`

| Field | Type | Description |
|---|---|---|
| `token` | `string` | Bearer token, exactly as the portal's auth service expects it. |
| `branchId` | `string \| null` | Tenant/branch id (see [step 4](#4-know-your-branch-branchid)). |
| `user` | `unknown` | Optional pre-built portal user object. When omitted the portal reconstructs it from the token via its profile endpoint. |

### `PortalFormRequest`

```ts
type PortalFormRequest =
  | { kind: 'newApplication'; type: string; productID: number }
  | { kind: 'existingApplication'; type: string; productID: number;
      batchID: number | string; headerID: number | string; readOnly: boolean;
      /** Workflow step the form is opened at — selects the signatory's field
       *  template. Sent as a query parameter; omit it (or pass 0) when the form
       *  is not being opened from an approval inbox. */
      workflowDetailID?: number | string }
  | { kind: 'path'; path: string };   // any /embed/… route; leading slash optional
```

### `AmthalPortalFormHandle` (via `ref`)

```tsx
const portal = useRef<AmthalPortalFormHandle>(null);
```

| Method | Returns | Use it for |
|---|---|---|
| `updateAuth(auth)` | `void` | Send fresh credentials — identical to the `refresh` callback handed to `onAuthExpired`. |
| `configure({ locale?, theme?, fontScale? })` | `void` | Re-apply presentation at runtime. Changing those fields on the `config` prop does this for you. |
| `handleBackPress()` | `Promise<boolean>` | Ask the web to go **back** one step. `true` = the form consumed it (e.g. a wizard page); `false` (or a 10 s timeout) = you should close. |
| `requestDismiss()` | `Promise<boolean>` | Ask the web whether there is **unsaved input**. `true` = safe to close without warning. Use for a ✕ button or an iOS swipe-to-dismiss, where there is no "back" to model. A timeout or an unopened bridge resolves `true` — a broken bridge must never trap the user. |
| `destroy()` | `void` | Send `destroy` (best-effort) and stop all bridge activity. Called automatically on unmount. |

> **`handleBackPress` vs `requestDismiss`.** Back = *step backwards inside the form*. Dismiss = *leave the form entirely*. A header ✕ should ask both, in that order — see the [unsaved-changes recipe](#unsaved-changes-guard-on-a--button).

### `FormSubmitResult` (the `formSubmitted` payload)

| Field | Type | Notes |
|---|---|---|
| `productID` | `number` | The form that was submitted. |
| `applicationNo` | `number \| string \| undefined` | The customer-facing reference. Show this. |
| `batchID` | `number \| string \| undefined` | For reopening the application later. |
| `headerID` | `number \| string \| undefined` | For reopening the application later. |
| `raw` | `unknown` | Anything else the portal surfaced; opaque to the SDK. |

### `PortalErrorInfo` and error codes

`{ code: PortalErrorCode; message?: string; httpStatus?: number }`

| Code | Meaning | Recoverable? |
|---|---|---|
| `offline` | No network when the load was attempted. | Yes — retry when connectivity returns. |
| `loadFailed` | The WebView could not load the page; also raised for an invalid or insecure `baseUrl`. | Sometimes — check the message. |
| `httpError` | The **main frame** returned a non-2xx status (`httpStatus` is set). | Depends on the status. |
| `manifestFailed` | `{baseUrl}/embed/manifest.json` could not be fetched, timed out (10 s), or was not JSON. | Fix the deployment or the URL. |
| `bridgeTimeout` | The page loaded but never opened the bridge (no `hello` within 15 s). | Usually a wrong route or a portal without embed mode. |
| `versionIncompatible` | `bridgeProtocolVersion` ≠ 1, portal older than `minPortalVersion`, or SDK older than the manifest's `minSdkVersion`. | No — treat as "update the app". |
| `authExpired` | Token refresh failed **and** no `onAuthExpired` handler was provided. | Yes — provide the handler. |
| `webProcessTerminated` | The WebView content process died. The SDK reloads once automatically before surfacing this. | Retry. |

### Protocol timings (from `TIMINGS`, normative)

| Constant | Value | What it bounds |
|---|---|---|
| `helloTimeoutMs` | 15 s | Native waits this long after page load for `hello`, then raises `bridgeTimeout`. |
| `initTimeoutMs` | 10 s | Web re-sends `hello` on this interval until `init` arrives. |
| `requestTimeoutMs` | 10 s | Any request/ack round-trip (`backPressed`, `dismissRequested`, `auth`, `configure`). |
| `formOpTimeoutMs` | 20 s | Delegated form **reads**. |
| `formSubmitTimeoutMs` | 90 s | Delegated form **writes** (may carry files). |

---

## 🍳 Recipes

### Anonymous (public) form

```tsx
<AmthalPortalForm
  config={{ baseUrl: PORTAL_BASE_URL }}
  // no `auth` prop at all
  request={{ kind: 'newApplication', type: 'external', productID: 830 }}
  onSubmitted={(r) => showReceipt(r)}
  onCancelled={close}
  onCloseRequested={close}
  onError={showError}
/>
```

### Signed-in form

```tsx
<AmthalPortalForm
  config={{ baseUrl: PORTAL_BASE_URL, locale: 'en' }}
  auth={{ token: session.token, branchId: '12', user: session.profile }}
  request={{ kind: 'newApplication', type: 'internal', productID: 830 }}
  onSubmitted={(r) => showReceipt(r)}
  onCancelled={close}
  onCloseRequested={close}
  onError={showError}
/>
```

Passing `type: 'internal'` is what puts the submission in the customer's own requests list. `type: 'external'` files it against an anonymous stand-in — a silent, invisible mistake.

### Reopening an existing application

Keep `batchID` and `headerID` from a previous `onSubmitted` (or from your own list screen), then:

```tsx
<AmthalPortalForm
  config={{ baseUrl: PORTAL_BASE_URL }}
  auth={auth}
  request={{
    kind: 'existingApplication',
    type: 'internal',
    productID: 830,
    batchID: application.batchID,
    headerID: application.headerID,
    readOnly: true,          // false to let the customer amend it
  }}
  onSubmitted={close}
  onCancelled={close}
  onCloseRequested={close}
  onError={showError}
/>
```

### Handling a submission properly

The WebView unmounts with your screen, so the portal's own receipt is never the last thing the user sees. Render a native confirmation:

```tsx
const [phase, setPhase] = useState<
  { kind: 'form' } | { kind: 'submitted'; result: FormSubmitResult }
>({ kind: 'form' });

if (phase.kind === 'submitted') {
  return (
    <SuccessScreen
      reference={phase.result.applicationNo}
      onDone={() => navigation.goBack()}
      onTrack={() => navigation.navigate('Requests')}
    />
  );
}

return <AmthalPortalForm … onSubmitted={(result) => setPhase({ kind: 'submitted', result })} />;
```

### Refreshing an expired session

```tsx
onAuthExpired={async (refresh) => {
  try {
    const response = await fetch(`${API}/Portal/Authentication/RefreshTokenWithExpiredToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.token, contactID: Number(session.contactID) }),
    });
    const body = await response.json();
    const token: string | undefined = body?.data?.refreshtoken;   // NOT body.data.token
    if (!token) throw new Error('response carried no refreshtoken');

    const next = { token, branchId: BRANCH_ID, user: { ...session.profile, token } };
    setAuth(next);   // keep your own state in sync
    refresh(next);   // resumes the portal; the overlay clears on the web's ack
  } catch {
    navigation.replace('Login');
  }
}}
```

### Downloads that need an `Authorization` header

The React Native wrapper is dependency-free, so its default for `downloadRequest` is `Linking.openURL(url)` — which cannot attach headers. Fine for pre-signed or public URLs; broken for header-authenticated ones. Provide your own:

```tsx
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

onDownloadRequest={async ({ url, filename, headers }) => {
  const target = FileSystem.cacheDirectory + (filename ?? 'document');
  await FileSystem.downloadAsync(url, target, { headers });
  await Sharing.shareAsync(target);
}}
```

Never log the header values. The native iOS and Android SDKs handle this out of the box (QuickLook / `ACTION_VIEW`).

### Switching locale or theme at runtime

Either change the `config` prop — the SDK diffs `locale` / `theme` / `fontScale` and sends `configure` for you:

```tsx
config={{ baseUrl: PORTAL_BASE_URL, locale: appLanguage, theme: appTheme }}
```

…or push it imperatively:

```tsx
portal.current?.configure({ locale: 'ar', theme: 'dark', fontScale: 1.15 });
```

`'ar'` flips the portal to RTL as well as translating it.

### Unsaved-changes guard on a ✕ button

Two questions, in order — back first, then dirty-state:

```tsx
const onHeaderBack = useCallback(async () => {
  // 1. Can the form step back inside itself (a wizard page)?
  if (await portal.current?.handleBackPress()) return;

  // 2. Is there unsaved input worth confirming?
  const safeToClose = await portal.current?.requestDismiss();
  if (safeToClose !== false) return close();

  Alert.alert('Discard this form?', 'Your changes will be lost.', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: close },
  ]);
}, [close]);
```

Without step 2 a half-filled form disappears on a single tap — which on iOS is also what a swipe-to-dismiss would do.

### Form delegation (React Native only)

When your app — not the portal — owns the form data plane (a back-office identity, per-login pre-entrance checks, a different API host), set `onFormOp`. `init` then declares `formDelegation: true` and the portal stops calling its own endpoints inside `/embed`:

```tsx
onFormOp={async (request) => {
  // request.op: 'getCategories' | 'getFormSchema' | 'getFormFields' | 'validateForm'
  //           | 'submitForm' | 'getWorkflowDetails' | 'submitFinalApproval' | 'submitForApproval'
  // request.params: route/product values only — NEVER identity. You add identity.
  // request.entries: ordered multipart entries for validateForm / submitForm.
  const response = await myApi.call(request.op, { ...request.params, userID: staff.id }, request.entries);
  if (response.status === 401) throw Object.assign(new Error('unauthorised'), { status: 401 });
  return response.body;   // the raw body the portal's HTTP client would have parsed
}}
```

Rebuild multipart bodies **preserving entry order and duplicate keys**; files arrive as `{ key, file: { name, type, dataBase64 } }`. Throwing with `status: 401` runs the portal's auth-expired flow. Read [SPEC §4.1](bridge/SPEC.md) before using this.

---

## 🔧 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `onError({ code: 'manifestFailed' })` immediately, nothing renders | `{baseUrl}/embed/manifest.json` returned **`text/html`** — the SPA catch-all served `index.html` because the manifest is not deployed, or the path prefix is missing from `baseUrl`. **This is the #1 setup mistake.** | `curl -sI {baseUrl}/embed/manifest.json \| grep -i content-type` must say `application/json`. If it says `text/html`, fix `baseUrl` (include `/portal`) or ask for a portal build that ships `embed/manifest.json`. |
| `manifestFailed` with "Timed out fetching the portal manifest (10 s)" | Host unreachable from the device: VPN-only origin, wrong port, simulator/emulator cannot resolve the name. | On the Android emulator use `10.0.2.2` for your machine, not `localhost`. Test the exact URL with `curl` from the device's network. |
| `manifestFailed` with an `httpStatus` of 404 | The deploy path prefix is wrong, or the portal is not built with embed mode. | Recheck [step 3](#3-configure-your-portal-url--the-single-most-important-value). |
| Blank screen / loading spinner never disappears, then `bridgeTimeout` after 15 s | The page loaded but the portal's bridge shim never sent `hello`. Usually a non-embed route (a login page or a 404 SPA shell), or a portal build without embed mode. | Open `{baseUrl}/embed/form/external/{productID}?mockEmbed=1` in a desktop browser against a `-dev` portal. If it hangs there too, it is portal-side. |
| `versionIncompatible` | The manifest's `bridgeProtocolVersion` ≠ 1, the portal is older than your `minPortalVersion`, or your SDK is older than the manifest's `minSdkVersion`. The `message` says which. | Upgrade the SDK, lower `minPortalVersion`, or ask for a portal deployment on the matching protocol. Present it to the user as "update the app". |
| The user is thrown into Safari / Chrome as soon as the form opens | `baseUrl` is missing the deploy path prefix, so the portal's own first navigation looks off-subtree and gets externalised. | Include the prefix: `https://host/portal`, not `https://host`. |
| External links open in the WebView instead of the browser, or vice versa | `onOpenExternal` returns the wrong value. | Return `true` **only** when you handled the URL yourself. Return `false`/omit to let the SDK call `Linking.openURL`. |
| A public (`external`) form returns **401** on every request | A token from a previous signed-in session is still in the WebView's storage; the portal's interceptor attaches it to `/Portal/PublicForms/*` too, and the API rejects a stale token even on an anonymous endpoint. | Omit the `auth` prop entirely (do not pass `{ token: '' }`) — `init` without an `auth` key makes the portal clear its stored credentials. |
| A signed-in submission never appears in the customer's requests list | `type` was not the literal string `'internal'`, so it went down the public plane and was filed against an anonymous stand-in. | Pass `type: 'internal'` for signed-in users. |
| Android hardware back does nothing (or exits the screen without asking the form) | `onCloseRequested` was not passed, so no back handler was installed. | Pass `onCloseRequested`. If you enabled `android:enableOnBackInvokedCallback`, confirm `BackHandler` still fires on your RN version. |
| Everything works in debug, the portal refuses to open in release | `allowInsecureHttp` is build-gated and dropped outside debug builds. React Native surfaces `loadFailed` with "Insecure baseUrl rejected"; iOS throws `PortalConfigError.insecureBaseURL` from `PortalConfig.init`; Android's `PortalConfig` constructor throws `IllegalArgumentException` (and logs that the flag was ignored). | Point release builds at an HTTPS portal. There is no production escape hatch, by design. |
| `authExpired` fires and the session never resumes | Your refresh read `data.token` instead of `data.refreshtoken`, or `refresh(next)` was never called. | Read `data.refreshtoken`. Always call `refresh(next)` — the overlay only clears on the web's ack. |
| File attachments do nothing on Android (bare view host) | `AmthalPortalView` needs an activity-result launcher for `onShowFileChooser`. | Call `attachActivityResultRegistry(activityResultRegistry)`, or use `PortalFormActivity` / `PortalFormFragment`, which wire it automatically. |
| Downloads open without authentication and fail | The default `Linking.openURL` fallback cannot attach `headers`. | Provide `onDownloadRequest` — see the [downloads recipe](#downloads-that-need-an-authorization-header). |
| `npm install` fails with 401 on `@amthal-group/*` | Missing or under-scoped GitHub token. | Add `~/.npmrc` per [step 1](#1-get-access-to-the-package-registry); the token needs `read:packages`. |
| `presentPortalSheet` immediately calls `onError` with "does not support form delegation" | `onFormOp` was passed to the Expo native sheet, which does not implement it. | Use the inline `<AmthalPortalForm/>` for delegated forms. |

**Turn on diagnostics** while investigating — `config.enableLogging: __DEV__` prints the manifest result, blocked navigations, dropped cross-origin messages and the portal's own `log` messages, all prefixed `[AmthalPortal]`. It is inert in release builds.

---

## 🔒 Security notes

**What the SDK guarantees**

1. **Credentials never travel in a URL.** Tokens exist only inside `init` / `auth` bridge payloads — never in a path, query or fragment, so they cannot leak through history, referrers or server logs.
2. **Origin confinement, both directions.** Main-frame navigation is restricted to the configured origin **and** the `basePath + /embed` subtree; anything else is cancelled and offered to the system browser. Inbound bridge messages are dropped unless the WebView's current URL is on an allowed origin, and the current URL is re-checked before every native→web evaluation.
3. **Sub-frames are deliberately exempt** from that cancellation — a page legitimately loads third-party frames (reCAPTCHA, payment widgets, maps), and externalising one would hand the user a fragment of a page in Safari. Only the main frame is confined.
4. **HTTPS enforced at config time.** `http://` is rejected unless the host is loopback, or the build is a debug build that opted into `allowInsecureHttp`. The flag is dropped by the compiler/runtime outside debug on every platform.
5. **Version handshake before anything loads.** `bridgeProtocolVersion` must equal 1; `minSdkVersion` and your `minPortalVersion` are enforced. A mismatched pairing never gets as far as rendering.
6. **Hardened WebView.** File access off, mixed content never allowed, no multiple windows, no link preview, no universal access from file URLs, JavaScript scoped to the portal content.
7. **Teardown clears the session.** `destroy` is sent on unmount; the portal clears its persisted auth regardless of ack delivery, and the native hosts clear WebView storage best-effort.
8. **Logs are dropped in release.** Portal `log` messages are only surfaced in debug builds, and download header values are never logged.

**What remains your responsibility**

- **Token storage.** Keychain / Keystore / `expo-secure-store`. Never `AsyncStorage`, never a plain file, never a log.
- **Token lifetime.** Request the shortest token your backend supports and implement `onAuthExpired` properly; the SDK cannot mint credentials.
- **Logout.** Unmount the portal screen (which sends `destroy`) and discard your stored token. A live SDK session and a logged-out app is your bug, not the SDK's.
- **Transport at the edge.** The portal page load goes through the system WebView network stack, which exposes no pinning hook. The Android SDK's `certificatePinner` covers only SDK-initiated HTTPS (manifest fetch, downloads). Pin at the network edge if you need full coverage.
- **Not shipping dev escape hatches.** Strip the ATS exception, the cleartext network config and `allowInsecureHttp` from release configurations.
- **Your own deep links.** If you route into the portal from a deep link, validate `productID`/`type` before handing them to the SDK; treat them as untrusted input like any other.

The normative text is [`bridge/SPEC.md` §2.3](bridge/SPEC.md).

---

## 📦 Repository layout

| Path | What it is |
|---|---|
| [`bridge/`](bridge/) | **Amthal Bridge Protocol v1** — the normative [SPEC](bridge/SPEC.md), the canonical TypeScript types (`src/protocol.ts`), the web-side shim the portal uses (`src/web.ts`), and a mock native host for browser QA (`src/mock.ts`). Everything else implements this. |
| [`ios/`](ios/) | **iOS SDK** — Swift Package (`AmthalPortal`, iOS 15+). `AmthalPortalViewController`, SwiftUI `AmthalPortalView`, `PortalConfig` / `PortalAuth` / `PortalRequest`, hardened `WKWebView`, native interstitials and download preview. |
| [`android/`](android/) | **Android SDK** — Gradle library (`com.amthalgroup:portal-sdk`, minSdk 24). `AmthalPortalView`, `PortalFormFragment`, `PortalFormActivity`, file-chooser and download handlers. |
| [`wrappers/react-native/`](wrappers/react-native/) | **`@amthal-group/portal-react-native`** — pure-TypeScript host over `react-native-webview` for **inline** embedding. No custom native code. |
| [`wrappers/expo/`](wrappers/expo/) | **`@amthal-group/portal-expo`** — Expo module that presents the native iOS SDK in a device-native **sheet**. Apple platforms only. |
| [`demos/react-native-example/`](demos/react-native-example/) | A runnable end-to-end React Native sample (login → home → embedded form). Set your portal origin in `src/config.ts`. |
| [`docs/`](docs/) | The documentation site — the same material as this README, navigable. |

The **portal side** of the embed runtime — the chromeless `/embed/*` routes, the platform bridge service, the auth-handoff service and `manifest.json` — ships with the Amthal Client Portal itself, which Amthal deploys and operates for your tenant. A portal deployment must serve embed mode for any of this to connect.

---

## 🛠 Local development, contributing & releasing

This is an npm workspaces monorepo (`bridge` + `wrappers/*`) plus two native projects.

```bash
# 1. Install workspace dependencies
npm install

# 2. Build the shared bridge package
#    (both wrappers resolve @amthal-group/portal-bridge from its dist)
npm run build:bridge

# 3. Type-check everything
npm run typecheck
```

- **iOS** is a Swift Package (`ios/Package.swift`). The Expo module compiles those same sources into its pod through a `prepare_command` at `pod install` time, so there is exactly one copy of the Swift SDK.
- **Android** is a Gradle library under `android/` (`./gradlew :portal-sdk:assembleRelease`), published to GitHub Packages via the `release` Maven publication.
- **Demo app**: `demos/react-native-example` — a full login → form flow; point `src/config.ts` at your portal.

**Protocol changes are spec PRs first.** `bridge/SPEC.md` is normative and `bridge/src/protocol.ts` is the canonical type definition; every native implementation mirrors those shapes by hand. Change the spec, then the types, then the four hosts — in that order, in that PR. Additive changes (new optional message types or payload fields) stay within protocol 1; a breaking change bumps the protocol version, and portal plus SDKs must each support `{N, N−1}` for one release cycle.

**Versioning.** `SDK_VERSION` is declared in three places that must move together: `wrappers/react-native/src/version.ts`, `ios/Sources/AmthalPortal/Version.swift`, and `android/.../internal/Bridge.kt` — plus each `package.json` / `build.gradle.kts`. The portal gates on it through `minSdkVersion`, so a drift here is a runtime failure, not a lint error.

---

## 📄 Licence

MIT © [Amthal Group](https://www.amthalgroup.com/). See the individual package manifests for details.

---

<div align="center">
<sub>Built with ❤️ by the Amthal Group engineering team.</sub>
</div>
