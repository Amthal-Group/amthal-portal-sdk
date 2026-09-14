# Amthal Bridge Protocol v1 — Specification

Normative spec for communication between a native host SDK (iOS, Android, React Native, Flutter) and the Amthal Client Portal loaded in an embedded WebView. TypeScript shapes in `src/protocol.ts` are the canonical type definitions; this document defines behavior.

Keywords MUST / SHOULD / MAY per RFC 2119.

## 1. Envelope

Every message, both directions, is one JSON object:

```json
{ "v": 1, "id": "<unique-string>", "replyTo": "<request-id, optional>", "type": "<string>", "payload": { } }
```

- `v` MUST be `1`. Receivers MUST silently ignore envelopes with any other `v`.
- `id` MUST be unique per sender per session (uuid or equivalent).
- `replyTo` correlates a response to its request. A message with `replyTo` MUST NOT be re-replied to.
- Unknown `type` values MUST be ignored (forward compatibility) — never treated as an error.
- Unknown payload fields MUST be ignored.

## 2. Transport

### 2.1 Web → Native
The web shim (`src/web.ts`) probes, in order, and uses the first present:

| Hook | Platform |
|---|---|
| `window.__amthalAndroid.postMessage(json)` | Android (`addJavascriptInterface` object named `__amthalAndroid`) |
| `window.webkit.messageHandlers.amthal.postMessage(json)` | iOS (`WKScriptMessageHandler` named `amthal`) |
| `window.ReactNativeWebView.postMessage(json)` **only if** `window.__AMTHAL_EMBEDDED_RN__ === true` | React Native (react-native-webview) |

The RN flag MUST be set via `injectedJavaScriptBeforeContentLoaded` so the portal never mistakes an arbitrary RN WebView for an Amthal host.

Presence of any hook ⇒ runtime is **embedded**. No hook ⇒ browser/Capacitor (out of this protocol's scope).

### 2.2 Native → Web
Native serializes the envelope to a JSON string `S`, then evaluates:

```
window.__amthalReceive(<JSON-encode of S>)
```

i.e. the *string* `S` is itself JSON-encoded when embedded in the JS call, guaranteeing correct escaping (quotes, newlines, unicode). Example (envelope `{"v":1,...}` → evaluate `window.__amthalReceive("{\"v\":1,...}")`).

Natives MUST inject their hooks **before page content loads** (WKUserScript at `.atDocumentStart` / `addJavascriptInterface` before `loadUrl` / `injectedJavaScriptBeforeContentLoaded`). The shim buffers inbound messages that arrive before app listeners attach; natives MAY send `init` the moment they receive `hello` without further synchronization.

### 2.3 Security (normative)
- Credentials MUST only travel in `init`/`auth` payloads — never in URLs (path, query, or fragment).
- **Base path awareness:** the configured portal base URL MAY include a path prefix (the portal deploys under a baseHref, e.g. `https://host/portal`). All URL construction MUST append to the full base URL (`{baseURL}/embed/...`), and all path checks MUST test against `basePath + /embed` (see `basePathOf`/`isEmbedPath` in protocol.ts) — never against a literal `/embed` prefix.
- Native MUST restrict WebView main-frame navigation to the configured portal origin **and** the `basePath + /embed` subtree; any other origin or path MUST be cancelled and surfaced through the `openExternal` handling path.
- Native MUST verify, before dispatching any inbound message and before every native→web evaluation, that the WebView's current URL origin is the configured portal origin.
- HTTPS only. `http:` base URLs MUST be rejected at config time (exception: `localhost` for development).
- On `destroy` (and on host-app logout via the SDK's `clearSession`), the web side MUST clear its persisted auth (`USER_KEY`, `BRANCH_ID`) and the native side SHOULD clear WebView storage for the portal origin.
- Android: file access flags off, mixed content never allowed. iOS: no `allowsLinkPreview` on the form view; JavaScript enabled only for the portal origin content.

## 3. Handshake & lifecycle

```
native                                   web (portal)
  │  fetch /embed/manifest.json             │
  │  version-gate (see §5)                  │
  │  load  origin + requestToPath(request)  │
  │                                         │  shim boots (before Angular)
  │            ◄── hello {protocolVersion, portalVersion}
  │  init {sdkVersion, platform,            │
  │        protocolVersion, configure,      │
  │        auth} (replyTo: hello.id) ──►    │
  │                                         │  apply configure, seed auth,
  │                                         │  resolve embed route
  │            ◄── ready {portalVersion, protocolVersion}
  │  (session active)                       │
```

- Web MUST send `hello` as early as possible (before Angular route resolution) and MUST re-send it every `initTimeoutMs` (10 s) until `init` arrives.
- Native MUST answer every `hello` with `init` (idempotent — web applies the latest).
- Native MUST raise `bridgeTimeout` if no `hello` arrives within `helloTimeoutMs` (15 s) of the page finishing load.
- Web MUST NOT activate any `/embed/*` route before `init` is applied; it MUST show its own minimal loading state meanwhile.
- Web MUST emit `ready` exactly once per page load, after the first embed route resolves.
- Native surfaces `portalReady` to the host app on `ready` and hides its skeleton.

**Auth refresh:** when the portal's token refresh fails, web sends `authExpired {reason?}` and pauses (interstitial). Host obtains a fresh token, calls the SDK's `updateAuth`, native sends `auth {token, branchId?, user?}`; web MUST ack (`ack {ok}`) and resume, retrying the failed request(s) where feasible.

**Teardown:** native sends `destroy`, waits up to 1 s for `ack` (best-effort), then releases the WebView. Web clears persisted auth on `destroy` regardless of ack delivery.

## 4. Message semantics

| Type | Dir | Payload | Behavior |
|---|---|---|---|
| `hello` | W→N | `HelloPayload` | §3. |
| `init` | N→W | `InitPayload` | MUST be sent as reply to `hello`. |
| `ready` | W→N | `ReadyPayload` | Once per page load. |
| `auth` | N→W | `AuthPayload` | (Re)issue credentials any time. Web MUST ack. |
| `authExpired` | W→N | `AuthExpiredPayload` | §3 auth refresh. |
| `configure` | N→W | `ConfigurePayload` | Apply locale/theme/fontScale at runtime. Web SHOULD ack. Locale switch MUST also flip document direction (`dir=rtl` for `ar`). |
| `formSubmitted` | W→N | `FormSubmittedPayload` | Emitted on successful submission of the embedded form. Native forwards to host; native MUST NOT auto-close (host decides). |
| `formCancelled` | W→N | — | User exited without submitting (in-form close/finish affordance). |
| `navigate` | W→N | `NavigatePayload` | Informational; fired on every router navigation within `/embed/*`. |
| `openExternal` | W→N | `OpenExternalPayload` | Host SHOULD open in system browser / SFSafariViewController / Custom Tabs unless it intercepts. |
| `downloadRequest` | W→N | `DownloadRequestPayload` | Native downloads (attaching `headers`) and presents a native preview (QuickLook / ACTION_VIEW). Native MUST NOT log the header values. |
| `formOp` | W→N | `FormOpRequestPayload` | Form delegation (§4.1). Host MUST reply `ack`-style with `FormOpResponsePayload` within `formOpTimeoutMs` (reads) / `formSubmitTimeoutMs` (validate/submit). Only sent when `init.formDelegation === true`. |
| `haptic` | W→N | `HapticPayload` | Optional; natives MAY ignore. |
| `log` | W→N | `LogPayload` | Diagnostics; natives MUST drop in release builds. |
| `backPressed` | N→W | — | Android hardware back. Web MUST reply `ack`-style with `BackHandledPayload` (`{handled:true}` = web consumed it, e.g. went back a form step; `{handled:false}` = native should close/dismiss). Web MUST answer within `requestTimeoutMs`; on timeout native treats it as `{handled:false}`. |
| `dismissRequested` | N→W | — | iOS swipe-dismiss guard. Web replies with `DismissStatePayload` (`{dirty:true}` = native SHOULD show a confirm-discard prompt). Timeout ⇒ `{dirty:false}`. |
| `destroy` | N→W | — | §3 teardown. |
| `ack` | both | `AckPayload` or the typed reply payloads above | Always carries `replyTo`. |

### 4.1 Form delegation (`init.formDelegation`)

Additive protocol-v1 capability for hosts that own the form data plane (e.g. a
backoffice app whose staff identity must hit `/DMS/Forms/*` with per-login
pre-entrance checks the portal must not know about).

- The host opts in by sending `formDelegation: true` in `init`. Absent/false ⇒
  the portal calls its own HTTP endpoints as before (customer plane).
- When active, the portal MUST NOT call its form HTTP endpoints inside
  `/embed/*`; every data operation is sent as a `formOp` request whose `op`
  mirrors the portal `FormsApi` method (`getCategories`, `getFormSchema`,
  `getFormFields`, `validateForm`, `submitForm`, `getWorkflowDetails`,
  `submitFinalApproval`, `submitForApproval`).
- `getFormSchema` returns the whole render shape in one call — header fields
  inline (`isHeader`) and subforms on `headerJsonControls` — which
  `getFormFields` and the former `getProductFieldsTemplates` op returned
  separately. Hosts MUST NOT expect a second templates call.
- `params` carries only route/product values (productID, batchID, headerID,
  workflowDetailID, isEdit, …). The portal MUST NOT send identity (userID,
  token, branch) in `params` — the host owns identity and augments the call.
- Multipart bodies (validate/submit) cross as `entries`: ordered
  `{key,value}` pairs plus `{key,file:{name,type,dataBase64}}` for binary
  parts. The host MUST rebuild the multipart body preserving entry order and
  duplicate keys.
- The host replies `ack` with `FormOpResponsePayload`: `ok:true` + `body`
  (the raw response body the portal's HTTP client would have parsed), or
  `ok:false` + `error` (+ optional `status`). A `status` of `401` MUST make
  the portal run its embedded auth-expired flow (`authExpired` → host `auth`).
- Timeout or missing reply ⇒ the portal surfaces a generic load/submit error;
  it MUST NOT fall back to its own HTTP endpoints while delegation is active.

## 5. Version handshake (manifest)

Before loading any route, native MUST `GET {baseURL}/embed/manifest.json` (no auth; `{baseURL}` includes any deploy path prefix — never fetch from the bare origin):

```json
{ "portalVersion": "1.8.0", "bridgeProtocolVersion": 1, "minSdkVersion": "1.0.0" }
```

Gate rules (any failure ⇒ `versionIncompatible`, except network failure ⇒ `manifestFailed`):
- `bridgeProtocolVersion` MUST equal a protocol version the SDK implements.
- `portalVersion` MUST be ≥ the SDK config's `minPortalVersion` (when set).
- SDK version MUST be ≥ `minSdkVersion` (when present).

Additive changes (new optional message types / payload fields) stay within protocol 1. Breaking changes bump the protocol version; portal and SDKs MUST each support {N, N−1} for one release cycle.

## 6. SDK error codes

`offline`, `loadFailed`, `httpError` (main-frame non-2xx), `manifestFailed`, `bridgeTimeout`, `versionIncompatible`, `authExpired`, `webProcessTerminated` (iOS content-process death; SDK SHOULD auto-reload once before surfacing).

## 7. Conformance

An implementation is conformant when it passes the scripted sequences in `bridge/conformance/` (handshake happy path; hello-retry; auth-expiry round-trip; back-press both answers; dismiss-guard both answers; destroy teardown; unknown-type ignore; wrong-`v` ignore; origin-violation drop). The `MockNativeHost` (`src/mock.ts`) drives the web side; a static portal build + scripted pages drive the native side.
