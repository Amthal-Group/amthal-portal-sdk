import Foundation

/// Host-app callbacks for a portal session. All methods have default (no-op)
/// implementations, so hosts implement only what they need.
///
/// All callbacks are delivered on the main actor.
@MainActor
public protocol AmthalPortalDelegate: AnyObject {
    /// The portal finished its handshake and resolved its first embed route.
    func portalReady(portalVersion: String)

    /// The embedded form was submitted successfully. The SDK never auto-closes
    /// on submission — the host decides what happens next.
    func formSubmitted(_ result: FormSubmitResult)

    /// The user exited the form without submitting (in-form close affordance).
    func formCancelled()

    /// A session-level error occurred. For `.authExpired` the host must obtain
    /// a fresh token and call `updateAuth(_:)`; the SDK shows a waiting
    /// interstitial meanwhile.
    func portalError(_ error: PortalError)

    /// The portal asked to open a URL outside the WebView. Return `true` if
    /// the host handled it; return `false` (the default) to let the SDK
    /// present `SFSafariViewController` (or hand non-HTTP URLs to the system).
    func openExternal(url: URL) -> Bool

    /// Informational: the portal navigated within `/embed/*`.
    func navigate(path: String, title: String?)

    /// The close/back round-trip resolved to "close": the web answered
    /// `backPressed` with `{handled:false}` or `dismissRequested` with
    /// `{dirty:false}` (or the user confirmed discarding changes). When using
    /// the built-in `present(from:...)` helper the SDK also dismisses itself.
    func closeRequested()
}

public extension AmthalPortalDelegate {
    func portalReady(portalVersion: String) {}
    func formSubmitted(_ result: FormSubmitResult) {}
    func formCancelled() {}
    func portalError(_ error: PortalError) {}
    func openExternal(url: URL) -> Bool { false }
    func navigate(path: String, title: String?) {}
    func closeRequested() {}
}
