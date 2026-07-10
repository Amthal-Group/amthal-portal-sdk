import Foundation
import WebKit

/// Internal event surface the bridge raises toward the host view controller.
@MainActor
protocol BridgeControllerDelegate: AnyObject {
    func bridgeDidReceiveHello(portalVersion: String?)
    func bridgeDidBecomeReady(portalVersion: String?)
    func bridgeAuthExpired(reason: String?)
    func bridgeFormSubmitted(_ result: FormSubmitResult)
    func bridgeFormCancelled()
    func bridgeNavigated(path: String, title: String?)
    func bridgeOpenExternal(urlString: String)
    func bridgeDownloadRequested(_ payload: DownloadRequestPayload)
    func bridgeHaptic(style: String)
    func bridgeHelloTimedOut()
}

/// Owns the message-level protocol: envelope parsing/serialization, the
/// hello→init handshake, request/ack correlation with timeouts, and the
/// origin allowlist checks required before any inbound dispatch or outbound
/// evaluation.
@MainActor
final class BridgeController: NSObject {
    /// WKScriptMessageHandler name — the web shim probes
    /// `window.webkit.messageHandlers.amthal`.
    static let handlerName = "amthal"

    weak var webView: WKWebView?
    weak var delegate: BridgeControllerDelegate?

    /// Latest credentials; re-sent in every `init` reply to `hello`.
    var currentAuth: PortalAuth

    /// Latest appearance configuration; re-sent in every `init`.
    var currentConfigure: ConfigurePayload

    private(set) var helloReceived = false

    private let config: PortalConfig
    private var helloTimeoutTask: Task<Void, Never>?
    private var pending: [String: PendingRequest] = [:]

    private struct PendingRequest {
        let completion: (Data?) -> Void
        let timeoutTask: Task<Void, Never>
    }

    init(config: PortalConfig, auth: PortalAuth) {
        self.config = config
        self.currentAuth = auth
        self.currentConfigure = ConfigurePayload(
            locale: config.locale.rawValue,
            theme: config.theme.rawValue,
            fontScale: config.fontScale
        )
        super.init()
    }

    // MARK: - Lifecycle

    /// Call when a main-frame load finishes: arms the 15 s `hello` watchdog.
    func pageDidFinishLoad() {
        guard !helloReceived else { return }
        helloTimeoutTask?.cancel()
        helloTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(BridgeProtocol.helloTimeout * 1_000_000_000))
            guard !Task.isCancelled, let self, !self.helloReceived else { return }
            self.delegate?.bridgeHelloTimedOut()
        }
    }

    /// Call before every fresh page load and on teardown: cancels the
    /// watchdog and resolves all pending round-trips with their safe defaults.
    func resetForNewLoad() {
        helloReceived = false
        helloTimeoutTask?.cancel()
        helloTimeoutTask = nil
        let inFlight = pending
        pending.removeAll()
        for (_, request) in inFlight {
            request.timeoutTask.cancel()
            request.completion(nil)
        }
    }

    // MARK: - Outbound

    /// `backPressed` round-trip. Timeout / missing answer ⇒ `handled:false`.
    func sendBackPressed(completion: @escaping (_ handled: Bool) -> Void) {
        sendRequest(type: MessageType.backPressed) { data in
            let payload = data.flatMap { try? JSONDecoder().decode(BackHandledPayload.self, from: $0) }
            completion(payload?.handled ?? false)
        }
    }

    /// `dismissRequested` round-trip. Timeout / missing answer ⇒ `dirty:false`.
    func sendDismissRequested(completion: @escaping (_ dirty: Bool) -> Void) {
        sendRequest(type: MessageType.dismissRequested) { data in
            let payload = data.flatMap { try? JSONDecoder().decode(DismissStatePayload.self, from: $0) }
            completion(payload?.dirty ?? false)
        }
    }

    /// (Re)issues credentials. Web MUST ack; `completion` receives the ack
    /// payload, or nil on timeout.
    func sendAuth(completion: ((AckPayload?) -> Void)? = nil) {
        let payload = makeAuthPayload()
        if let completion {
            sendRequest(type: MessageType.auth, payload: payload) { data in
                completion(data.flatMap { try? JSONDecoder().decode(AckPayload.self, from: $0) })
            }
        } else {
            send(type: MessageType.auth, payload: payload)
        }
    }

    /// Re-applies locale/theme/fontScale at runtime.
    func sendConfigure() {
        send(type: MessageType.configure, payload: currentConfigure)
    }

    /// Teardown notification; the web clears its persisted auth on receipt.
    func sendDestroy() {
        send(type: MessageType.destroy, payload: Optional<EmptyPayload>.none)
    }

    // MARK: - Outbound plumbing

    private func send<P: Encodable>(
        type: String,
        payload: P?,
        id: String = UUID().uuidString,
        replyTo: String? = nil
    ) {
        let envelope = OutboundEnvelope(id: id, replyTo: replyTo, type: type, payload: payload)
        guard let data = try? JSONEncoder().encode(envelope) else {
            log("failed to encode envelope of type \(type)")
            return
        }
        evaluate(envelopeData: data, type: type)
    }

    private func sendRequest<P: Encodable>(
        type: String,
        payload: P? = Optional<EmptyPayload>.none,
        timeout: TimeInterval = BridgeProtocol.requestTimeout,
        completion: @escaping (Data?) -> Void
    ) {
        let id = UUID().uuidString
        let timeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            guard !Task.isCancelled, let self,
                  let request = self.pending.removeValue(forKey: id)
            else { return }
            self.log("request \(type) (\(id)) timed out after \(timeout)s")
            request.completion(nil)
        }
        pending[id] = PendingRequest(completion: completion, timeoutTask: timeoutTask)
        send(type: type, payload: payload, id: id)
    }

    /// Serializes the envelope to a JSON string `S`, then evaluates
    /// `window.__amthalReceive(<JSON-encode of S>)` — the string is itself
    /// JSON-quoted, guaranteeing correct escaping. Verifies the WebView's
    /// current origin against the allowlist before every evaluation.
    private func evaluate(envelopeData: Data, type: String) {
        guard let webView else { return }
        guard config.isOriginAllowed(webView.url) else {
            log("dropped outbound \(type): WebView origin not allowlisted")
            return
        }
        guard let json = String(data: envelopeData, encoding: .utf8),
              let quotedData = try? JSONSerialization.data(
                withJSONObject: json,
                options: [.fragmentsAllowed]
              ),
              let quoted = String(data: quotedData, encoding: .utf8)
        else {
            log("failed to quote envelope of type \(type)")
            return
        }
        webView.evaluateJavaScript("window.__amthalReceive(\(quoted));") { [weak self] _, error in
            if error != nil {
                self?.log("evaluateJavaScript failed for \(type)")
            }
        }
    }

    private func sendInit(replyTo: String) {
        let payload = InitPayload(
            sdkVersion: AmthalPortalSDK.version,
            platform: "ios",
            protocolVersion: BridgeProtocol.version,
            configure: currentConfigure,
            auth: makeAuthPayload()
        )
        send(type: MessageType.bridgeInit, payload: payload, replyTo: replyTo)
    }

    private func makeAuthPayload() -> AuthPayload {
        var user: JSONValue?
        if let userJSON = currentAuth.userJSON,
           let data = userJSON.data(using: .utf8) {
            user = try? JSONDecoder().decode(JSONValue.self, from: data)
            if user == nil {
                log("auth.userJSON is not valid JSON — omitting `user` from payload")
            }
        }
        return AuthPayload(token: currentAuth.token, branchId: currentAuth.branchId, user: user)
    }

    // MARK: - Inbound

    private func handle(_ message: InboundMessage) {
        // Correlate replies to pending requests first. A message with
        // `replyTo` must never be re-replied to.
        if let replyTo = message.replyTo,
           let request = pending.removeValue(forKey: replyTo) {
            request.timeoutTask.cancel()
            request.completion(message.payloadData)
            return
        }

        switch message.type {
        case MessageType.hello:
            helloReceived = true
            helloTimeoutTask?.cancel()
            helloTimeoutTask = nil
            // Native MUST answer every hello with init (idempotent).
            sendInit(replyTo: message.id)
            let hello = message.decodePayload(HelloPayload.self)
            delegate?.bridgeDidReceiveHello(portalVersion: hello?.portalVersion)

        case MessageType.ready:
            let ready = message.decodePayload(ReadyPayload.self)
            delegate?.bridgeDidBecomeReady(portalVersion: ready?.portalVersion)

        case MessageType.authExpired:
            let payload = message.decodePayload(AuthExpiredPayload.self)
            delegate?.bridgeAuthExpired(reason: payload?.reason)

        case MessageType.formSubmitted:
            if let result = message.decodePayload(FormSubmitResult.self) {
                delegate?.bridgeFormSubmitted(result)
            } else {
                log("formSubmitted payload could not be decoded — ignored")
            }

        case MessageType.formCancelled:
            delegate?.bridgeFormCancelled()

        case MessageType.navigate:
            if let payload = message.decodePayload(NavigatePayload.self) {
                delegate?.bridgeNavigated(path: payload.path, title: payload.title)
            }

        case MessageType.openExternal:
            if let payload = message.decodePayload(OpenExternalPayload.self) {
                delegate?.bridgeOpenExternal(urlString: payload.url)
            }

        case MessageType.downloadRequest:
            if let payload = message.decodePayload(DownloadRequestPayload.self) {
                delegate?.bridgeDownloadRequested(payload)
            }

        case MessageType.haptic:
            if let payload = message.decodePayload(HapticPayload.self) {
                delegate?.bridgeHaptic(style: payload.style)
            }

        case MessageType.log:
            // Diagnostics channel — MUST be dropped in release builds.
            #if DEBUG
            if config.enableLogging, let payload = message.decodePayload(LogPayload.self) {
                print("[AmthalPortal][web][\(payload.level ?? "log")] \(payload.message ?? "")")
            }
            #endif

        case MessageType.ack:
            // Stray/late ack with no pending request — ignore.
            break

        default:
            // Unknown types MUST be ignored (forward compatibility).
            break
        }
    }

    // MARK: - Logging

    private func log(_ message: String) {
        #if DEBUG
        if config.enableLogging {
            print("[AmthalPortal] \(message)")
        }
        #endif
    }
}

// MARK: - WKScriptMessageHandler

extension BridgeController: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.handlerName else { return }

        // Origin gate 1 (normative): the WebView's current URL origin must be
        // allowlisted before any inbound message is dispatched.
        guard config.isOriginAllowed(webView?.url) else {
            log("dropped inbound message: WebView origin not allowlisted")
            return
        }

        // Origin gate 2 (defense in depth): the posting frame itself must
        // belong to an allowlisted origin.
        let frameHost = message.frameInfo.securityOrigin.host
        guard config.isHostAllowed(frameHost) else {
            log("dropped inbound message: frame origin not allowlisted")
            return
        }

        guard let inbound = InboundMessage(body: message.body) else {
            // Wrong `v`, malformed envelope, etc. — silently ignored per spec.
            return
        }
        handle(inbound)
    }
}
