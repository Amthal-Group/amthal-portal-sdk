# @amthal-group/portal-react-native

Embed the **Amthal Client Portal** (and its form builder) inside a React Native app.

A single component — `<AmthalPortalForm />` — loads a portal form in a hardened WebView, speaks [Amthal Bridge Protocol v1](../../bridge/SPEC.md) with it, and surfaces everything your app needs as ordinary React callbacks: submission results, cancellation, auth expiry, external links, navigation, errors.

```
Your app  ──(props: config + auth + request)──▶  AmthalPortalForm
Your app  ◀─(callbacks: onSubmitted / onError / …)──  AmthalPortalForm
                              │
                              ▼  react-native-webview + Bridge Protocol v1
                     Amthal Client Portal (/embed/*)
```

## Why pure JS

This wrapper is **pure TypeScript on top of `react-native-webview`** — there is no custom native code in this package, by design:

- **`react-native-webview` already ships the hard parts.** A hardened, battle-tested WebView with file-input/camera support, `onMessage`/`injectJavaScript` transport, per-platform quirks fixed for you. Re-wrapping `WKWebView`/`android.webkit.WebView` in this package would duplicate all of that and add a native build surface for zero gain.
- **Protocol conformance is guaranteed by construction.** The wrapper imports `@amthal-group/portal-bridge` — the same canonical protocol types, constants (`BRIDGE_PROTOCOL_VERSION`, `MANIFEST_PATH`, timeouts) and helpers (`requestToPath`, `compareVersions`) the portal itself uses. There is no hand-mirrored native copy of the protocol to drift out of sync.
- **RN teams debug best in JS.** Every message, timer and state transition is readable TypeScript in `src/AmthalPortalForm.tsx`; you can step through the whole bridge in your own debugger without Xcode/Android Studio.
- **No native install cost.** Nothing to pod-install or autolink beyond `react-native-webview`, which most apps already have. Works with any RN ≥ 0.72, old or new architecture.

The native **iOS and Android SDKs** in this repo exist for fully native apps (Swift/Kotlin hosts). React Native apps should use this package.

## Installation

The package is published to **GitHub Packages**. Point the `@amthal-group` scope at the GitHub registry once per project (`.npmrc` next to your `package.json`):

```ini
@amthal-group:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

(The token needs `read:packages`. In a monorepo checkout you can instead depend on it directly with `"@amthal-group/portal-react-native": "file:../portal-sdk/wrappers/react-native"`.)

Then:

```sh
npm install @amthal-group/portal-react-native react-native-webview
cd ios && pod install   # react-native-webview has native code; this package does not
```

Peer dependencies: `react >= 18`, `react-native >= 0.72`, `react-native-webview >= 13`.

## Quick start

```tsx
import { AmthalPortalForm } from '@amthal-group/portal-react-native';

<AmthalPortalForm
  config={{ baseUrl: 'https://portal.example.com', locale: 'en', theme: 'system' }}
  auth={{ token: session.token, branchId: session.branchId }}
  request={{ kind: 'newApplication', type: 'external', productID: 42 }}
  onSubmitted={(result) => navigation.goBack()}
  onCancelled={() => navigation.goBack()}
  onError={(e) => Alert.alert('Portal error', `${e.code}: ${e.message ?? ''}`)}
/>
```

The component handles the whole lifecycle for you: manifest version-gate → WebView load → bridge handshake (`hello`/`init`) → `ready`. A loading overlay is shown until the portal reports `ready`; failures render a retryable error state.

## API reference

### `<AmthalPortalForm />` props

| Prop | Type | Required | Description |
|---|---|---|---|
| `config` | `PortalSdkConfig` | ✔ | Portal origin + presentation options (below). |
| `auth` | `PortalAuthState` | ✔ | `{ token, branchId?, user? }`. Seeded into `init`; when the prop changes, an `auth` message is sent automatically. |
| `request` | `PortalFormRequest` | ✔ | What to open: `{kind:'newApplication', type, productID}`, `{kind:'existingApplication', …, readOnly}` or `{kind:'path', path}`. The URL is derived via `requestToPath` — never contains credentials. |
| `onReady` | `() => void` | | Portal emitted `ready`; the loading overlay has been hidden. |
| `onSubmitted` | `(result: FormSubmitResult) => void` | ✔ | Form submitted successfully (`{productID, applicationNo?, batchID?, headerID?, raw?}`). The SDK never auto-closes — you decide. |
| `onCancelled` | `() => void` | ✔ | User exited via the form's own close/finish affordance. |
| `onError` | `(error: PortalErrorInfo) => void` | ✔ | `{code, message?, httpStatus?}` — see error codes below. |
| `onAuthExpired` | `(refresh, reason?) => void` | | Portal token refresh failed. Fetch a fresh token, call `refresh(newAuth)`. A "refreshing session" overlay is shown until the portal acks. Without this handler, `onError({code:'authExpired'})` fires instead. |
| `onOpenExternal` | `(url: string) => boolean` | | Intercept external links. Return `true` = handled; otherwise the SDK calls `Linking.openURL(url)`. |
| `onDownloadRequest` | `(d: DownloadRequestPayload) => void` | | Handle portal file downloads (`{url, filename?, mime?, headers?}`). Default: `Linking.openURL(url)` — see limitations below. |
| `onNavigate` | `(nav: NavigatePayload) => void` | | Informational; fired on every portal navigation inside `/embed/*` (`{path, title?}`). Useful for header titles. |
| `onCloseRequested` | `() => void` | | Android hardware back was **not** consumed by the web form (or timed out) — close your screen. Without this handler the SDK does not intercept the back button at all. |
| `style` | `StyleProp<ViewStyle>` | | Container style (defaults to `flex: 1`). |
| `renderLoading` | `() => ReactElement` | | Custom loading UI (shown until `ready`). |
| `renderError` | `({error, retry}) => ReactElement` | | Custom error UI; call `retry()` to re-run the manifest gate + reload. |

### `PortalSdkConfig`

| Field | Type | Description |
|---|---|---|
| `baseUrl` | `string` | Portal origin, e.g. `https://portal.example.com`. HTTPS required (`http://localhost` allowed for dev). |
| `locale` | `'en' \| 'ar'` | Portal UI locale (`ar` flips document direction). |
| `theme` | `'light' \| 'dark' \| 'system'` | Portal theme; also drives the SDK's own overlays. |
| `fontScale` | `number` | `1.0` = default; maps to a root font-size adjustment. |
| `minPortalVersion` | `string` | Fail with `versionIncompatible` when the portal is older. |
| `allowedOrigins` | `string[]` | Extra origins allowed for main-frame navigation (rare). |
| `enableLogging` | `boolean` | Forward portal `log` messages to the console — **dev builds only**; always dropped in release per SPEC. |

### Imperative handle (`ref`)

```tsx
const portal = useRef<AmthalPortalFormHandle>(null);
```

| Method | Description |
|---|---|
| `updateAuth(auth)` | Send fresh credentials (same as the `refresh` passed to `onAuthExpired`). |
| `configure({locale?, theme?, fontScale?})` | Re-apply presentation options at runtime. (Changing the `config` prop's `locale`/`theme`/`fontScale` does this automatically.) |
| `handleBackPress(): Promise<boolean>` | Dispatch `backPressed` to the web. Resolves `true` if the web consumed it (e.g. stepped back inside the form), `false` (or 10 s timeout) if you should close the screen. |
| `destroy()` | Send `destroy` (best-effort) and stop all bridge activity. Called automatically on unmount. |

### Error codes (`PortalErrorInfo.code`)

`offline` · `loadFailed` · `httpError` (main-frame non-2xx, has `httpStatus`) · `manifestFailed` · `versionIncompatible` · `bridgeTimeout` (no `hello` within 15 s of load) · `authExpired` (only when no `onAuthExpired` handler is set) · `webProcessTerminated` (auto-reloads once before surfacing).

## Auth flow

Credentials only ever travel inside bridge messages (`init` / `auth`) — never in URLs.

```tsx
function PortalScreen({ session, renewSession }) {
  const [auth, setAuth] = useState({ token: session.token, branchId: session.branchId });

  return (
    <AmthalPortalForm
      config={{ baseUrl: PORTAL_BASE_URL }}
      auth={auth}                    // prop change ⇒ `auth` message is sent automatically
      request={{ kind: 'newApplication', type: 'external', productID: 42 }}
      onAuthExpired={async (refresh) => {
        try {
          const fresh = await renewSession();       // your token endpoint
          const next = { token: fresh.token, branchId: fresh.branchId };
          setAuth(next);   // keep your state in sync
          refresh(next);   // resumes the portal; overlay clears on web ack
        } catch {
          // refresh failed → log the user out
        }
      }}
      onSubmitted={…} onCancelled={…} onError={…}
    />
  );
}
```

## Back-button recipe (Android)

The component registers a `BackHandler` while mounted **if you pass `onCloseRequested`**. A hardware back press is forwarded to the web form (`backPressed`); if the form consumes it (`{handled:true}` — e.g. it went back one wizard step) nothing else happens. If the form says `{handled:false}` (or doesn't answer within 10 s), `onCloseRequested` is called — close your screen there, with a confirm dialog if you like:

```tsx
<AmthalPortalForm
  …
  onCloseRequested={() =>
    Alert.alert('Leave this form?', 'Your changes may be lost.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
    ])
  }
/>
```

If you omit `onCloseRequested`, the SDK does not touch the back button and the platform default (e.g. your navigator popping the screen) applies — but then the web form never gets a chance to step back internally, so passing it is recommended. For custom UI (a header ✕ button, iOS modals), call `ref.handleBackPress()` yourself and close when it resolves `false`.

## `downloadRequest` limitations

When the portal asks the host to download a file it may include `headers` (e.g. `Authorization`). This wrapper is intentionally dependency-free, and React Native has no built-in authenticated download + native preview, so the **default** behavior is `Linking.openURL(url)` — the file opens in the system browser **without** the extra headers (fine for pre-signed/public URLs; will fail for header-authenticated ones).

If your portal serves auth-guarded files, provide `onDownloadRequest` and download with your own stack, e.g. `expo-file-system` + `expo-sharing`, or `react-native-blob-util`:

```tsx
onDownloadRequest={async ({ url, filename, headers }) => {
  const file = FileSystem.cacheDirectory + (filename ?? 'document');
  await FileSystem.downloadAsync(url, file, { headers });
  await Sharing.shareAsync(file);
}}
```

(The fully native iOS/Android SDKs handle this out of the box with QuickLook / `ACTION_VIEW`. Never log the header values.)

## Migration: coming from `@amthal-group/react-native-form-builder`

The old package rendered forms natively in your app and made **you** the form engine's host. The portal now owns the entire form lifecycle — you only say *which* form and *who* is filling it:

```tsx
<AmthalPortalForm config={{ baseUrl }} auth={{ token, branchId }} request={{ kind: 'newApplication', type: 'external', productID: 42 }} … />
```

Everything below **disappears — do not port it**. The portal performs all of it internally:

| Old form-builder API | Now |
|---|---|
| Schema fetching (`getFormSchema`, product/control definitions) | Gone — the portal fetches its own schema. |
| `onSearchTermChange` | Gone — lookups/search run inside the portal. |
| `getSavedData` | Gone — drafts/saved data are loaded by the portal (`existingApplication` request). |
| `setControlOptions` | Gone — option sources are resolved by the portal. |
| `setControlErrors` | Gone — validation and error display are the portal's. |
| Manual submit wiring / payload assembly | Replaced by the `onSubmitted(result)` callback. |

What you keep from your old integration: your auth acquisition (login/refresh) and your navigation. What you pass in: `{request, auth}` — nothing else.

## Development

```sh
npm install
npm run typecheck
```

A complete example app lives at [`demos/react-native-example`](../../demos/react-native-example).
