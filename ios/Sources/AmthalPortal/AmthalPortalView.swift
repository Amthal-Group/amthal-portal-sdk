import SwiftUI
import UIKit

/// SwiftUI wrapper around `AmthalPortalViewController` with callback closures
/// mirroring `AmthalPortalDelegate`.
///
/// Changing `auth` (token/branch/user) or the appearance fields of `config`
/// (locale/theme/fontScale) across view updates forwards the change to the
/// running session via `updateAuth` / `updateConfigure`.
public struct AmthalPortalView: UIViewControllerRepresentable {
    private let config: PortalConfig
    private let request: PortalRequest
    private let auth: PortalAuth

    private let onReady: ((String) -> Void)?
    private let onSubmitted: ((FormSubmitResult) -> Void)?
    private let onCancelled: (() -> Void)?
    private let onError: ((PortalError) -> Void)?
    private let onNavigate: ((String, String?) -> Void)?
    private let onCloseRequested: (() -> Void)?
    /// Return `true` to handle the URL yourself; `false` lets the SDK present
    /// SFSafariViewController.
    private let onOpenExternal: ((URL) -> Bool)?

    public init(
        config: PortalConfig,
        request: PortalRequest,
        auth: PortalAuth,
        onReady: ((String) -> Void)? = nil,
        onSubmitted: ((FormSubmitResult) -> Void)? = nil,
        onCancelled: (() -> Void)? = nil,
        onError: ((PortalError) -> Void)? = nil,
        onNavigate: ((String, String?) -> Void)? = nil,
        onCloseRequested: (() -> Void)? = nil,
        onOpenExternal: ((URL) -> Bool)? = nil
    ) {
        self.config = config
        self.request = request
        self.auth = auth
        self.onReady = onReady
        self.onSubmitted = onSubmitted
        self.onCancelled = onCancelled
        self.onError = onError
        self.onNavigate = onNavigate
        self.onCloseRequested = onCloseRequested
        self.onOpenExternal = onOpenExternal
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    public func makeUIViewController(context: Context) -> AmthalPortalViewController {
        context.coordinator.parent = self
        context.coordinator.lastAuth = auth
        context.coordinator.lastConfig = config
        let controller = AmthalPortalViewController(
            config: config,
            request: request,
            auth: auth,
            delegate: context.coordinator
        )
        controller.onCloseResolved = nil // SwiftUI host owns dismissal via onCloseRequested
        return controller
    }

    public func updateUIViewController(
        _ controller: AmthalPortalViewController,
        context: Context
    ) {
        context.coordinator.parent = self

        if auth != context.coordinator.lastAuth {
            context.coordinator.lastAuth = auth
            controller.updateAuth(auth)
        }

        if let previous = context.coordinator.lastConfig,
           previous.locale != config.locale
            || previous.theme != config.theme
            || previous.fontScale != config.fontScale {
            controller.updateConfigure(
                locale: config.locale,
                theme: config.theme,
                fontScale: config.fontScale
            )
        }
        context.coordinator.lastConfig = config
    }

    @MainActor
    public final class Coordinator: NSObject, AmthalPortalDelegate {
        var parent: AmthalPortalView
        var lastAuth: PortalAuth?
        var lastConfig: PortalConfig?

        init(parent: AmthalPortalView) {
            self.parent = parent
        }

        public func portalReady(portalVersion: String) {
            parent.onReady?(portalVersion)
        }

        public func formSubmitted(_ result: FormSubmitResult) {
            parent.onSubmitted?(result)
        }

        public func formCancelled() {
            parent.onCancelled?()
        }

        public func portalError(_ error: PortalError) {
            parent.onError?(error)
        }

        public func openExternal(url: URL) -> Bool {
            parent.onOpenExternal?(url) ?? false
        }

        public func navigate(path: String, title: String?) {
            parent.onNavigate?(path, title)
        }

        public func closeRequested() {
            parent.onCloseRequested?()
        }
    }
}
