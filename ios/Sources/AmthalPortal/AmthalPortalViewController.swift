import UIKit
import WebKit
import SafariServices
import Network

/// The core host: a hardened WKWebView bound to the Amthal bridge, plus the
/// SDK's native chrome (loading skeleton, error/offline/version/session
/// interstitials, connectivity watcher, close/back guards).
public final class AmthalPortalViewController: UIViewController {

    // MARK: - Public surface

    public weak var delegate: AmthalPortalDelegate?

    /// Session configuration (appearance fields are mutated by
    /// `updateConfigure`; the origin/base URL never changes).
    public private(set) var config: PortalConfig

    /// The request this controller was created for.
    public let request: PortalRequest

    public init(
        config: PortalConfig,
        request: PortalRequest,
        auth: PortalAuth,
        delegate: AmthalPortalDelegate? = nil
    ) {
        self.config = config
        self.request = request
        self.bridge = BridgeController(config: config, auth: auth)
        self.delegate = delegate
        super.init(nibName: nil, bundle: nil)
        bridge.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// (Re)issues credentials. Call any time — before `ready`, or in response
    /// to a `portalError(.authExpired)` callback. Hides the session-expired
    /// overlay once the portal acknowledges the new credentials.
    public func updateAuth(_ auth: PortalAuth) {
        bridge.currentAuth = auth
        guard bridge.helloReceived else { return } // delivered with the next `init`
        bridge.sendAuth { [weak self] ack in
            guard let self else { return }
            // Hide unless the portal explicitly rejected the credentials.
            if ack?.ok != false {
                self.hideSessionExpiredOverlay()
            }
        }
    }

    /// Re-applies locale/theme/fontScale at runtime (sends `configure`).
    public func updateConfigure(
        locale: PortalLocale? = nil,
        theme: PortalTheme? = nil,
        fontScale: Double? = nil
    ) {
        if let locale { config.locale = locale }
        if let theme { config.theme = theme }
        if let fontScale { config.fontScale = fontScale }
        bridge.currentConfigure = ConfigurePayload(
            locale: config.locale.rawValue,
            theme: config.theme.rawValue,
            fontScale: config.fontScale
        )
        if bridge.helloReceived {
            bridge.sendConfigure()
        }
    }

    /// Runs the dismiss guard: sends `dismissRequested`; `{dirty:true}` shows
    /// a confirm-discard alert, `{dirty:false}` (or timeout, or a session that
    /// never became ready) resolves the close immediately. On resolution the
    /// delegate's `closeRequested()` fires and, when presented via
    /// `present(from:...)`, the controller dismisses itself.
    public func requestClose() {
        guard !isResolvingClose else { return }
        guard bridge.helloReceived else {
            resolveClose()
            return
        }
        isResolvingClose = true
        bridge.sendDismissRequested { [weak self] dirty in
            guard let self else { return }
            self.isResolvingClose = false
            if dirty {
                self.presentDiscardConfirmation()
            } else {
                self.resolveClose()
            }
        }
    }

    /// Sends `backPressed` (useful for host apps with their own back
    /// affordance). `{handled:true}` means the web consumed it (e.g. went back
    /// a form step); `{handled:false}` or timeout resolves the close.
    public func performBack() {
        guard bridge.helloReceived else {
            resolveClose()
            return
        }
        bridge.sendBackPressed { [weak self] handled in
            if !handled {
                self?.resolveClose()
            }
        }
    }

    /// Presents the portal modally, wrapped in a UINavigationController with a
    /// Close button. Close and swipe-dismiss both run the dismiss guard
    /// (`dismissRequested` → confirm-discard when dirty).
    @discardableResult
    public static func present(
        from presenter: UIViewController,
        config: PortalConfig,
        request: PortalRequest,
        auth: PortalAuth,
        delegate: AmthalPortalDelegate? = nil
    ) -> AmthalPortalViewController {
        let portalController = AmthalPortalViewController(
            config: config,
            request: request,
            auth: auth,
            delegate: delegate
        )
        let navigationController = UINavigationController(rootViewController: portalController)
        navigationController.modalPresentationStyle = .pageSheet

        let closeButton = UIBarButtonItem(
            barButtonSystemItem: .close,
            target: portalController,
            action: #selector(closeButtonTapped)
        )
        closeButton.accessibilityLabel = PortalStrings.string("action.close", locale: config.locale)
        portalController.navigationItem.rightBarButtonItem = closeButton

        // Swipe-dismiss goes through the same dismissRequested guard.
        navigationController.presentationController?.delegate = portalController

        portalController.onCloseResolved = { [weak navigationController] in
            navigationController?.presentingViewController?.dismiss(animated: true)
        }

        presenter.present(navigationController, animated: true)
        return portalController
    }

    // MARK: - Internals

    /// Set by the presentation helper / SwiftUI wrapper; called after the
    /// close round-trip resolves to "close".
    var onCloseResolved: (() -> Void)?

    private let bridge: BridgeController
    private let downloadHandler = DownloadHandler()

    private var webView: WKWebView!
    private var skeletonView: PortalSkeletonView?
    private var interstitialView: PortalStatusView?
    private var sessionExpiredOverlay: PortalStatusView?

    private enum State {
        case idle
        case fetchingManifest
        case loading
        case handshaking
        case ready
        case failed(PortalErrorCode)
    }

    private var state: State = .idle
    private var manifestTask: Task<Void, Never>?
    private var didAutoReloadAfterTermination = false
    private var isResolvingClose = false
    private var didTearDown = false

    private let pathMonitor = NWPathMonitor()
    private var isNetworkAvailable = true

    // MARK: - Lifecycle

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let webView = WebViewFactory.make(config: config, bridge: bridge)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        self.webView = webView
        bridge.webView = webView

        startConnectivityMonitor()
        start()
    }

    public override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        let isGoingAway = isBeingDismissed
            || isMovingFromParent
            || navigationController?.isBeingDismissed == true
            || parent?.isBeingDismissed == true
        if isGoingAway {
            tearDown()
        }
    }

    // MARK: - Session state machine

    private func start() {
        guard let targetURL = config.portalURL(forPath: request.path) else {
            fail(.loadFailed, message: "Could not build a portal URL for path \(request.path).")
            return
        }
        transition(to: .fetchingManifest)
        manifestTask?.cancel()
        manifestTask = Task { [weak self] in
            guard let self else { return }
            let result = await ManifestClient(
                config: self.config,
                sdkVersion: AmthalPortalSDK.version
            ).fetchAndGate()
            guard !Task.isCancelled, !self.didTearDown else { return }
            switch result {
            case .success:
                self.transition(to: .loading)
                self.bridge.resetForNewLoad()
                self.webView.load(URLRequest(url: targetURL))
            case .failure(let error):
                self.fail(error.code, message: error.message)
            }
        }
    }

    private func transition(to newState: State) {
        state = newState
        switch newState {
        case .idle:
            break
        case .fetchingManifest, .loading, .handshaking:
            hideInterstitial()
            showSkeleton()
        case .ready:
            hideInterstitial()
            hideSkeleton()
        case .failed(let code):
            hideSkeleton()
            showInterstitial(for: code)
        }
    }

    private func fail(_ code: PortalErrorCode, message: String) {
        transition(to: .failed(code))
        delegate?.portalError(PortalError(code: code, message: message))
    }

    // MARK: - Overlays

    private func showSkeleton() {
        if skeletonView == nil {
            let skeleton = PortalSkeletonView()
            skeleton.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(skeleton)
            pinToEdges(skeleton)
            skeletonView = skeleton
        }
        skeletonView.map(view.bringSubviewToFront)
    }

    private func hideSkeleton() {
        skeletonView?.removeFromSuperview()
        skeletonView = nil
    }

    private func showInterstitial(for code: PortalErrorCode) {
        hideInterstitial()

        let titleKey: String
        let messageKey: String
        let retryable: Bool
        switch code {
        case .offline:
            (titleKey, messageKey, retryable) = ("error.offline.title", "error.offline.message", true)
        case .versionIncompatible:
            (titleKey, messageKey, retryable) = ("error.versionIncompatible.title", "error.versionIncompatible.message", false)
        case .authExpired:
            // Handled via the session-expired overlay instead.
            return
        case .loadFailed, .httpError, .manifestFailed, .bridgeTimeout, .webProcessTerminated:
            (titleKey, messageKey, retryable) = ("error.loadFailed.title", "error.loadFailed.message", true)
        }

        let locale = config.locale
        let interstitial = PortalStatusView(
            title: PortalStrings.string(titleKey, locale: locale),
            message: PortalStrings.string(messageKey, locale: locale),
            retryTitle: retryable ? PortalStrings.string("action.retry", locale: locale) : nil,
            isRTL: locale == .ar,
            onRetry: retryable ? { [weak self] in self?.start() } : nil
        )
        interstitial.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(interstitial)
        pinToEdges(interstitial)
        interstitialView = interstitial
    }

    private func hideInterstitial() {
        interstitialView?.removeFromSuperview()
        interstitialView = nil
    }

    private func showSessionExpiredOverlay() {
        guard sessionExpiredOverlay == nil else { return }
        let locale = config.locale
        let overlay = PortalStatusView(
            title: PortalStrings.string("sessionExpired.title", locale: locale),
            message: PortalStrings.string("sessionExpired.message", locale: locale),
            showsSpinner: true,
            dimmed: true,
            isRTL: locale == .ar
        )
        overlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlay)
        pinToEdges(overlay)
        sessionExpiredOverlay = overlay
    }

    private func hideSessionExpiredOverlay() {
        sessionExpiredOverlay?.removeFromSuperview()
        sessionExpiredOverlay = nil
    }

    private func pinToEdges(_ subview: UIView) {
        NSLayoutConstraint.activate([
            subview.topAnchor.constraint(equalTo: view.topAnchor),
            subview.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            subview.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            subview.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    // MARK: - Connectivity

    private func startConnectivityMonitor() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, !self.didTearDown else { return }
                let wasAvailable = self.isNetworkAvailable
                self.isNetworkAvailable = satisfied
                // Auto-retry when connectivity returns while an offline (or
                // network-caused manifest) interstitial is showing.
                if satisfied, !wasAvailable, case .failed(let code) = self.state,
                   code == .offline || code == .manifestFailed {
                    self.start()
                }
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.amthal.portal.connectivity"))
    }

    // MARK: - Close / dismiss guards

    @objc private func closeButtonTapped() {
        requestClose()
    }

    private func resolveClose() {
        delegate?.closeRequested()
        onCloseResolved?()
    }

    private func presentDiscardConfirmation() {
        let locale = config.locale
        let alert = UIAlertController(
            title: PortalStrings.string("discard.title", locale: locale),
            message: PortalStrings.string("discard.message", locale: locale),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(
            title: PortalStrings.string("discard.confirm", locale: locale),
            style: .destructive,
            handler: { [weak self] _ in self?.resolveClose() }
        ))
        alert.addAction(UIAlertAction(
            title: PortalStrings.string("discard.cancel", locale: locale),
            style: .cancel
        ))
        present(alert, animated: true)
    }

    // MARK: - External URLs

    private func handleExternalURL(_ url: URL) {
        if delegate?.openExternal(url: url) == true { return }
        let scheme = url.scheme?.lowercased()
        if scheme == "http" || scheme == "https" {
            let safari = SFSafariViewController(url: url)
            (presentedViewController ?? self).present(safari, animated: true)
        } else {
            UIApplication.shared.open(url)
        }
    }

    // MARK: - Teardown

    private func tearDown() {
        guard !didTearDown else { return }
        didTearDown = true

        pathMonitor.cancel()
        manifestTask?.cancel()

        // Best-effort destroy: give the web up to 1 s to process it before
        // the handler is removed and the WebView released.
        bridge.sendDestroy()

        let webView = self.webView
        let bridge = self.bridge
        Task { @MainActor in
            try? await Task.sleep(
                nanoseconds: UInt64(BridgeProtocol.destroyGrace * 1_000_000_000)
            )
            bridge.resetForNewLoad()
            webView?.stopLoading()
            webView?.configuration.userContentController
                .removeScriptMessageHandler(forName: BridgeController.handlerName)
            webView?.navigationDelegate = nil
            webView?.uiDelegate = nil
        }
    }
}

// MARK: - BridgeControllerDelegate

extension AmthalPortalViewController: BridgeControllerDelegate {
    func bridgeDidReceiveHello(portalVersion: String?) {
        // Handshake progressing; `ready` completes it.
        if case .loading = state {
            transition(to: .handshaking)
        }
    }

    func bridgeDidBecomeReady(portalVersion: String?) {
        didAutoReloadAfterTermination = false
        transition(to: .ready)
        delegate?.portalReady(portalVersion: portalVersion ?? "")
    }

    func bridgeAuthExpired(reason: String?) {
        showSessionExpiredOverlay()
        delegate?.portalError(PortalError(
            code: .authExpired,
            message: reason ?? "The portal session expired; call updateAuth(_:) with a fresh token."
        ))
    }

    func bridgeFormSubmitted(_ result: FormSubmitResult) {
        // Never auto-close on submission — the host decides.
        delegate?.formSubmitted(result)
    }

    func bridgeFormCancelled() {
        delegate?.formCancelled()
    }

    func bridgeNavigated(path: String, title: String?) {
        if let title, !title.isEmpty, navigationController != nil {
            navigationItem.title = title
        }
        delegate?.navigate(path: path, title: title)
    }

    func bridgeOpenExternal(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        handleExternalURL(url)
    }

    func bridgeDownloadRequested(_ payload: DownloadRequestPayload) {
        downloadHandler.handle(payload, config: config, presenter: self)
    }

    func bridgeHaptic(style: String) {
        Haptics.perform(style: style)
    }

    func bridgeHelloTimedOut() {
        fail(.bridgeTimeout, message: "The portal page loaded but the bridge never said hello (15 s).")
    }
}

// MARK: - WKNavigationDelegate

extension AmthalPortalViewController: WKNavigationDelegate {
    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel, preferences)
            return
        }

        // target=_blank / window.open: no target frame — route externally.
        guard let targetFrame = navigationAction.targetFrame else {
            decisionHandler(.cancel, preferences)
            handleExternalURL(url)
            return
        }

        // Sub-frame navigations are the page's business.
        guard targetFrame.isMainFrame else {
            decisionHandler(.allow, preferences)
            return
        }

        if url.scheme?.lowercased() == "about" {
            decisionHandler(.allow, preferences)
            return
        }

        // Main-frame navigation is restricted to the configured origin and
        // the basePath + /embed/* subtree (base-path aware: the portal may
        // deploy under a path prefix); everything else surfaces via
        // openExternal.
        if config.isOriginAllowed(url), config.isEmbedPath(url.path) {
            preferences.allowsContentJavaScript = true
            decisionHandler(.allow, preferences)
        } else {
            decisionHandler(.cancel, preferences)
            handleExternalURL(url)
        }
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.isForMainFrame,
           let http = navigationResponse.response as? HTTPURLResponse,
           !(200...299).contains(http.statusCode) {
            decisionHandler(.cancel)
            fail(.httpError(http.statusCode), message: "Portal returned HTTP \(http.statusCode).")
            return
        }
        decisionHandler(.allow)
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if case .loading = state {
            transition(to: .handshaking)
        }
        // Arm the 15 s hello watchdog.
        bridge.pageDidFinishLoad()
    }

    public func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        handleLoadError(error)
    }

    public func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        handleLoadError(error)
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if !didAutoReloadAfterTermination {
            // SHOULD auto-reload once before surfacing the error.
            didAutoReloadAfterTermination = true
            start()
        } else {
            fail(.webProcessTerminated, message: "The web content process terminated repeatedly.")
        }
    }

    private func handleLoadError(_ error: Error) {
        let nsError = error as NSError
        // Ignore cancellations (including our own policy .cancel decisions).
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return } // frame load interrupted

        let offlineCodes = [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorDataNotAllowed,
            NSURLErrorInternationalRoamingOff,
        ]
        if nsError.domain == NSURLErrorDomain, offlineCodes.contains(nsError.code) {
            fail(.offline, message: "The device appears to be offline.")
        } else {
            fail(.loadFailed, message: "Portal failed to load: \(nsError.localizedDescription)")
        }
    }

}

// MARK: - WKUIDelegate

extension AmthalPortalViewController: WKUIDelegate {
    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // target=_blank and window.open never spawn a WebView — the URL is
        // routed through the external-open flow instead.
        if let url = navigationAction.request.url {
            handleExternalURL(url)
        }
        return nil
    }
}

// MARK: - UIAdaptivePresentationControllerDelegate (swipe-dismiss guard)

extension AmthalPortalViewController: UIAdaptivePresentationControllerDelegate {
    public func presentationControllerShouldDismiss(
        _ presentationController: UIPresentationController
    ) -> Bool {
        // Never dismiss synchronously; the dismissRequested round-trip decides.
        false
    }

    public func presentationControllerDidAttemptToDismiss(
        _ presentationController: UIPresentationController
    ) {
        requestClose()
    }
}
