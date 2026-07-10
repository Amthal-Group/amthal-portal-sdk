# AmthalPortal — iOS SDK

Thin native SDK that embeds the Amthal Client Portal (`/embed/*` routes) in a
hardened `WKWebView` and speaks the **Amthal Bridge Protocol v1**
(`bridge/SPEC.md`, `bridge/src/protocol.ts`). Pure Swift, no external
dependencies — Foundation, UIKit, WebKit, QuickLook, SafariServices only.

- **Swift** 5.9+ · **iOS** 15+
- Localized native chrome (EN / AR) for loading, offline, error, version and
  session-expired states.

## Installation (Swift Package Manager)

Xcode → *File ▸ Add Package Dependencies…* and point at this repository
(subpath `ios/`), or in `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/amthal-group/portal-sdk.git", from: "1.0.0")
],
targets: [
    .target(
        name: "MyApp",
        dependencies: [.product(name: "AmthalPortal", package: "portal-sdk")]
    )
]
```

> When consuming the monorepo locally: `.package(path: "../portal-sdk/ios")`.

## Quickstart — UIKit

```swift
import AmthalPortal

// baseURL must be the FULL portal base URL, including the deploy path prefix
// when the portal is served under a baseHref (e.g. https://host.example.com/portal).
let config = try PortalConfig(
    baseURL: URL(string: "https://host.example.com/portal")!,
    locale: .ar,                     // .en / .ar (drives portal locale + RTL)
    theme: .system,                  // .light / .dark / .system
    fontScale: 1.0,
    minPortalVersion: "1.3.0",       // optional version-handshake floor
    enableLogging: false
)

let auth = PortalAuth(
    token: backendBearerToken,       // same token the portal's auth service uses
    branchId: "12",                  // optional
    userJSON: nil                    // optional pre-built user object (raw JSON string)
)

// Fire-and-forget modal presentation (navigation controller + Close button):
AmthalPortalViewController.present(
    from: self,
    config: config,
    request: .newApplication(type: "external", productID: 42),
    auth: auth,
    delegate: self
)

// Or embed the controller yourself for custom layouts:
let portal = AmthalPortalViewController(
    config: config,
    request: .existingApplication(
        type: "external", productID: 42,
        batchID: "7", headerID: "991", readOnly: true
    ),
    auth: auth,
    delegate: self
)
addChild(portal); view.addSubview(portal.view); portal.didMove(toParent: self)
```

Delegate — every method has a default no-op, implement only what you need:

```swift
extension MyViewController: AmthalPortalDelegate {
    func portalReady(portalVersion: String) { }

    func formSubmitted(_ result: FormSubmitResult) {
        // result.productID, result.applicationNo / batchID / headerID
        // (NumberOrString — use .stringValue / .intValue), result.raw (opaque).
        // The SDK never auto-closes on submit — dismiss here if you want to.
    }

    func formCancelled() { }

    func portalError(_ error: PortalError) {
        if error.code == .authExpired {
            // Refresh your token, then:
            // portal.updateAuth(PortalAuth(token: freshToken, branchId: branch))
        }
    }

    func openExternal(url: URL) -> Bool {
        false // false = SDK presents SFSafariViewController for you
    }

    func navigate(path: String, title: String?) { }

    func closeRequested() {
        // Fired when the close/back round-trip resolved to "close".
        // With present(from:...) the SDK also dismisses itself.
    }
}
```

Other request forms:

```swift
.newApplication(type: "external", productID: 42)
.existingApplication(type: "external", productID: 42, batchID: "7", headerID: "991", readOnly: true)
.path("statements")          // generic escape hatch → /embed/statements
```

Runtime updates:

```swift
portal.updateAuth(PortalAuth(token: freshToken))          // after authExpired, or any time
portal.updateConfigure(locale: .en, theme: .dark)         // re-applies live via `configure`
```

## Quickstart — SwiftUI

```swift
import SwiftUI
import AmthalPortal

struct FormScreen: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        AmthalPortalView(
            config: try! PortalConfig(baseURL: URL(string: "https://host.example.com/portal")!),
            request: .newApplication(type: "external", productID: 42),
            auth: PortalAuth(token: token),
            onReady: { version in print("portal \(version) ready") },
            onSubmitted: { result in dismiss() },
            onCancelled: { dismiss() },
            onError: { error in print(error) },
            onCloseRequested: { dismiss() }
        )
        .ignoresSafeArea()
    }
}
```

Changing the `auth` or the `config` appearance fields (locale/theme/fontScale)
you pass across view updates forwards them to the running session
(`updateAuth` / `updateConfigure`). The SwiftUI wrapper never dismisses itself
— handle `onCloseRequested` and dismiss from your side.

## Dismiss / back semantics

The portal — not the SDK — knows whether the form has unsaved changes, so
closing is always a bridge round-trip:

- **Close button / swipe-dismiss** (with `present(from:...)`): the SDK sends
  `dismissRequested`. The web answers `{dirty:false}` → the SDK calls
  `closeRequested()` and dismisses. `{dirty:true}` → the SDK shows a native,
  localized confirm-discard alert; confirming discards and closes. No answer
  within 10 s is treated as clean.
- **`requestClose()`**: run the same guard programmatically (e.g. from your
  own close affordance when embedding the controller).
- **`performBack()`**: sends `backPressed`; `{handled:true}` means the web
  consumed it (went back a form step), `{handled:false}` (or 10 s timeout)
  resolves to `closeRequested()`.
- **Submission never auto-closes.** `formSubmitted` is forwarded and the host
  decides what happens next.
- On teardown the SDK sends `destroy` (web clears its persisted auth), waits
  up to 1 s, then releases the WebView.

## Error handling

`PortalError.code` (`PortalErrorCode`) mirrors the protocol:
`offline`, `loadFailed`, `httpError(Int)`, `manifestFailed`, `bridgeTimeout`,
`versionIncompatible`, `authExpired`, `webProcessTerminated`.

The SDK shows its own localized interstitials (EN/AR, following
`config.locale`) with Retry where meaningful, auto-retries `offline` when
connectivity returns (NWPathMonitor), and auto-reloads once after a web
content process termination. `versionIncompatible` (from the
`/embed/manifest.json` handshake) is terminal — ship an app update or deploy a
compatible portal.

## Security notes

- **HTTPS only.** `PortalConfig` throws for `http:` base URLs (exception:
  localhost for development).
- **Credentials never travel in URLs** — only inside `init`/`auth` bridge
  payloads. Never put tokens in `.path(...)` requests.
- **Origin allowlist** (default: the `baseURL` host) is enforced on
  main-frame navigation (origin + `basePath + /embed/*` only — base-path
  aware when the portal deploys under a path prefix), before dispatching
  every inbound bridge message, and before every native→web JavaScript
  evaluation.
  Anything else is cancelled and routed through the `openExternal` flow
  (SFSafariViewController by default). `target=_blank` / `window.open` never
  spawn a WebView.
- **Hardened WebView**: link previews off, back/forward gestures off,
  `javaScriptCanOpenWindowsAutomatically` off.
- **Downloads** (`downloadRequest`): the payload's headers (e.g.
  Authorization) are attached only when the download URL's origin is
  allowlisted, are never logged, and files are previewed natively via
  QuickLook from the app's temporary directory.
- **Web `log` messages** are compiled out of release builds; SDK diagnostics
  (`enableLogging`) are DEBUG-only and never include tokens or header values.
- On host-app logout, tear the portal controller down (dismiss it) — the
  `destroy` message makes the web side clear its persisted auth.

## Version handshake

Before loading any route the SDK fetches `GET {baseURL}/embed/manifest.json`
(10 s timeout, no auth) and gates:

- `bridgeProtocolVersion` must equal 1 (this SDK's protocol),
- `portalVersion ≥ config.minPortalVersion` (when set),
- SDK version (1.0.0) `≥ manifest.minSdkVersion` (when present).

Gate failures surface as `versionIncompatible`; network/parse failures as
`manifestFailed` (pure connectivity loss as `offline`, which auto-retries).
