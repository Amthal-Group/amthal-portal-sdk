# @amthal-group/portal-expo

Present the **native** Amthal Portal SDK (a hardened `WKWebView` in
`AmthalPortalViewController`) inside a device-native `UISheetPresentationController`,
driven from React Native via an Expo module.

Unlike [`@amthal-group/portal-react-native`](../react-native) — which renders the
portal inline through `react-native-webview` — this wrapper hands presentation to
the native SDK, so the sheet chrome, WebView hardening, loading skeleton, and
error/offline/session interstitials are all native.

> **iOS only** in this release. Android (a themed slide-up `PortalFormActivity`)
> is planned.

## Install (local / monorepo)

Consumed the same way as the RN wrapper: a `file:` dependency plus a
`node_modules/@amthal-group/portal-expo` symlink into this monorepo, then Expo
autolinking picks up the podspec on `expo prebuild` + `pod install`.

The pod compiles the iOS SDK sources (symlinked in as `ios/AmthalPortal`) together
with the Expo glue into one Swift module; `BundleModuleShim.swift` supplies the
`Bundle.module` accessor the SDK expects under SPM.

## Usage

```ts
import { presentPortalSheet } from '@amthal-group/portal-expo';

const session = presentPortalSheet({
  config: { baseUrl: 'https://portal.example.com/portal', locale: 'en', theme: 'system' },
  auth: { token, branchId },
  request: { kind: 'newApplication', type: 'external', productID: 42 },
  sheet: { detents: ['large', 'medium'], grabber: true },
  onSubmitted: (r) => console.log('submitted', r.applicationNo),
  onError: (e) => console.warn(e.code, e.message),
  onAuthExpired: () => session.updateAuth({ token: fresh }),
  onClosed: () => console.log('closed'),
});

// session.updateAuth(...) / session.configure({ theme: 'dark' }) / session.dismiss()
// DEV: config.allowInsecureHttp = true permits a plain-http baseUrl on a tenant
// hostname (e.g. http://portal-dev.example.com:4200/portal — the backend resolves
// the tenant from the request host/referer). DEBUG builds only; the host app
// also needs an ATS exception for the dev domain.
```
