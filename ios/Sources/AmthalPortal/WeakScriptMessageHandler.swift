import WebKit

/// `WKUserContentController` retains its script message handlers strongly,
/// which would create a retain cycle with any handler that (indirectly) owns
/// the WebView. This proxy holds the real handler weakly, making teardown
/// deinit-safe even if `removeScriptMessageHandler` is never called.
@MainActor
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) {
        self.target = target
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
