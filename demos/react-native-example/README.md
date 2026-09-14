# Amthal Portal — React Native example

A complete bare React Native (CLI-style) app showing how to embed Amthal Client Portal forms with [`@amthal-group/portal-react-native`](../../wrappers/react-native).

Flow: **Login** (mock) → **Home** (pick a demo form) → **Form** (`AmthalPortalForm` — the screen you'll copy into your own app).

## Point it at a real portal

1. Edit [`src/config.ts`](src/config.ts) and set `PORTAL_BASE_URL` to your portal origin, e.g. `https://portal.yourcompany.com`. HTTPS is required; `http://localhost:4200` works for local dev (Android emulator: `http://10.0.2.2:4200`). The deployment must serve the embed routes — the SDK fetches `/embed/manifest.json` before loading anything.
2. Replace the mock functions in [`src/api/auth.ts`](src/api/auth.ts) with your real login/refresh endpoints. The token returned must be the bearer token the portal's auth service expects.
3. Adjust the demo entries in [`src/screens/HomeScreen.tsx`](src/screens/HomeScreen.tsx) to product IDs that exist in your environment.

## Run it

This example ships JS/TS only — its `ios/` and `android/` projects are generated rather
than committed, so they can never drift out of step with the React Native version in
`package.json`. `npm run prebuild` creates them from the official template.

```sh
# 1. Build the bridge first. The wrapper imports values from it at runtime, and its
#    `main` (dist/index.js) does not exist in a fresh clone.
npm run build:bridge --prefix ../..

# 2. Install, then generate the native projects (once; add --force to regenerate).
npm install
npm run prebuild

# 3. iOS
cd ios && pod install && cd ..
npm run ios

# 3. Android
npm run android
```

> The wrapper and the bridge are linked via `file:` — `metro.config.js` already adds them to `watchFolders`, so edits to the SDK hot-reload into the app.
>
> Typecheck without building: `npm run typecheck`.

## Walkthrough: `src/screens/FormScreen.tsx`

FormScreen is the reference integration — every SDK callback is wired:

| Piece | What it does |
|---|---|
| `config` | `{ baseUrl, locale, theme, minPortalVersion, enableLogging: __DEV__ }`. The SDK fetches the manifest, version-gates, then loads the form. |
| `auth` | Comes from `AuthContext` (in-memory; use Keychain/EncryptedStorage in production). Changing it automatically re-sends credentials to the portal. |
| `request` | Arrives as a navigation param from HomeScreen: `newApplication`, `existingApplication` (read-only), or a raw `path`. |
| `onSubmitted` | Shows a success `Alert`, then navigates back to Home **with the result** (`navigation.navigate('Home', { lastResult })`) — Home renders it in a banner. The SDK never closes the screen for you. |
| `onCancelled` | The user finished/closed inside the form → `navigation.goBack()`. |
| `onError` | `switch (error.code)`: `offline` and `versionIncompatible` get dedicated alerts, `authExpired` signs the user out, everything else relies on the component's built-in retryable error state and just logs. |
| `onAuthExpired` | Calls the mock `refreshToken()`, stores the new token in `AuthContext`, then calls `refresh(newAuth)` — the portal resumes and its "refreshing session" overlay clears when the web acks. On failure it signs the user out. |
| `onCloseRequested` | Confirm-dialog ("Leave this form?") → `navigation.goBack()`. This fires when the **Android hardware back** press was not consumed by the web form — the component's built-in `BackHandler` asks the form first (`backPressed` → `{handled}`), so in-form wizard steps still work. |
| `onNavigate` | Updates the native header title from the portal's route titles (`navigation.setOptions`). |
| `onOpenExternal` | Logs and returns `false` → the SDK opens the URL in the system browser. Return `true` to handle it yourself (in-app browser, etc.). |
| `renderLoading` | Custom spinner + label shown until the portal reports `ready`. |

Also note in [`App.tsx`](App.tsx): the Form screen sets `gestureEnabled: false` so the iOS swipe-back gesture doesn't bypass the close-confirmation flow.

## Files

```
App.tsx                     navigation container + auth-gated stack
index.js                    RN entry point
src/config.ts               PORTAL_BASE_URL
src/api/auth.ts             mock login()/refreshToken() — replace with your API
src/AuthContext.tsx         in-memory auth store (token + branchId)
src/navigation.ts           typed route params (Form receives a PortalFormRequest)
src/screens/LoginScreen.tsx credential form → mock login
src/screens/HomeScreen.tsx  demo form list + last-submission banner
src/screens/FormScreen.tsx  ★ the reference AmthalPortalForm integration
```
