import UIKit
import WebKit

/// Builds the hardened WKWebView used to host the portal.
@MainActor
enum WebViewFactory {
    static func make(config: PortalConfig, bridge: BridgeController) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // JavaScript is only ever granted to allowlisted main-frame
        // navigations (re-affirmed per-navigation in the navigation delegate).
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        // The message handler must be registered before any content loads so
        // `window.webkit.messageHandlers.amthal` exists when the shim probes
        // (document-start semantics). The weak proxy avoids the
        // WKUserContentController → handler retain cycle.
        let contentController = WKUserContentController()
        contentController.add(
            WeakScriptMessageHandler(target: bridge),
            contentWorld: .page,
            name: BridgeController.handlerName
        )
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = true
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = config.enableLogging
        }
        #endif

        return webView
    }
}
