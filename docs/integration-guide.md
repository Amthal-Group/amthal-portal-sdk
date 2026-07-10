# Integration Guide — Amthal Portal SDK

This guide covers the concepts shared by every platform. Platform mechanics live in each module's README (`android/`, `ios/`, `wrappers/react-native/`).

## 1. Prerequisites

- A deployed Client Portal build that includes **Embed Mode** (routes under `/embed/*` and `/embed/manifest.json`). Verify: `curl https://<portal>/embed/manifest.json` returns `{"portalVersion": "...", "bridgeProtocolVersion": 1, ...}`.
- **`baseUrl` must include the portal's deploy path.** The portal ships with `baseHref: /portal/`, so a typical config is `baseUrl: "https://host.example.com/portal"` — the SDK appends `/embed/...` to whatever you pass.
- Token-only auth works, but **hosts should pass the full portal user object** (`userJson`) when they have it: the portal's token-refresh needs profile fields (`employeeID`), so a token-only session falls back to the `authExpired` → host-refresh loop instead of refreshing silently.
- A backend token for the user, obtained by **your app's own login** against the same backend the portal uses. The SDK never shows a login screen.

## 2. The auth handoff

```
your login screen ──► your backend ──► token (+ branchId)
        │
        ▼
sdk.updateAuth(token, branchId)      // or the `auth` prop in React Native
        │
        ▼   (bridge `init`/`auth` message — never in a URL)
portal AuthHandoffService seeds its session and loads the form
```

- Pass the **same bearer token** the portal's `auth.service` uses.
- Optionally pass a pre-built portal user object (`userJson`) if your app already has the profile; otherwise the portal reconstructs it.
- When the token expires mid-session the portal emits `authExpired`. Your app must obtain a fresh token (your refresh flow) and call `updateAuth` again — the form resumes where it was.
- On your app's logout, call the SDK's session-clearing API so portal storage is wiped from the WebView.

## 3. Requests (what to open)

| Request | Portal route |
|---|---|
| `newApplication(type, productID)` | `/embed/form/:type/:productID` |
| `existingApplication(type, productID, batchID, headerID, readOnly)` | `/embed/form/:type/:productID/:batchID/:headerID/:readOnly` |
| `path("...")` | any other `/embed/...` screen (escape hatch) |

`type` and `productID` come from your backend's product catalog — the same values the portal itself uses in its application links.

## 4. Lifecycle events you must handle

| Event | What to do |
|---|---|
| `formSubmitted {productID, applicationNo?, batchID?, headerID?}` | Show your success UX, refresh your lists, close the form screen. The SDK never auto-closes. |
| `formCancelled` | Close the form screen. |
| `authExpired` | Refresh token → `updateAuth`. |
| `closeRequested` | Fired when the user pressed back/close and the form had nothing to handle. Confirm-and-close is your call (the SDK already ran the dirty-check prompt where applicable). |
| `portalError {code}` | See error table below. |

Error codes: `offline`, `loadFailed`, `httpError`, `manifestFailed`, `bridgeTimeout`, `versionIncompatible`, `authExpired`, `webProcessTerminated`. The SDK shows built-in retry interstitials for the recoverable ones; surface the rest in your own UX as needed.

## 5. Appearance

`locale` (`en`/`ar` — flips portal translations **and** RTL), `theme` (`light`/`dark`/`system`), `fontScale`. Set at start or at runtime via `updateConfigure`.

## 6. Version handshake

Before loading, the SDK fetches `/embed/manifest.json` and gates on:
- `bridgeProtocolVersion` supported by the SDK
- `portalVersion ≥ minPortalVersion` (your config)
- SDK version ≥ portal's `minSdkVersion`

Deploying the portal updates every app instantly; the manifest is the safety valve. Treat `versionIncompatible` as "force app update" in your UX.

## 7. Security model (summary — normative text in bridge/SPEC.md §2.3)

- Tokens only in bridge messages; never URLs.
- WebView navigation locked to the portal origin + `/embed/*`; external links open in the system browser.
- Origin check on every bridge message, both directions.
- HTTPS only (localhost excepted for development).
- `destroy`/logout clears portal storage.

## 8. Testing your integration

- Point `baseUrl` at the staging portal.
- The portal's embed routes also work in a desktop browser with `?mockEmbed=1` (mock native host) — useful for debugging portal-side issues without a device.
- Simulate token expiry by revoking the token server-side mid-form; verify your `authExpired` → refresh path.
- Android: test the hardware back button on a multi-step form (should step back, then ask to close).
- Test offline: airplane-mode mid-form → SDK interstitial → reconnect → retry.
