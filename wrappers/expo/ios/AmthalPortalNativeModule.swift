import ExpoModulesCore
import UIKit

/// Expo module that presents the **native** Amthal Portal SDK
/// (`AmthalPortalViewController`, a hardened WKWebView) inside a device-native
/// `UISheetPresentationController`, driven from React Native.
///
/// The native iOS SDK sources are compiled into this same Swift module (see the
/// podspec), so this glue has `internal` access to the SDK and reuses all of its
/// bridge / hardening / interstitial logic — it only owns presentation and the
/// delegate → JS event relay.
///
/// One active sheet at a time (matches modal UX). `present` retains the
/// controller; `onClosed` releases it.
public final class AmthalPortalNativeModule: Module {

    private var activeController: AmthalPortalViewController?
    private var activeNavigation: UINavigationController?
    private var activeDelegate: PortalDelegateAdapter?

    public func definition() -> ModuleDefinition {
        Name("AmthalPortalNative")

        Events(
            "onReady",
            "onSubmitted",
            "onCancelled",
            "onError",
            "onAuthExpired",
            "onNavigate",
            "onClosed"
        )

        AsyncFunction("present") { (options: [String: Any], promise: Promise) in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return promise.reject("E_MODULE", "Module deallocated") }
                self.present(options: options, promise: promise)
            }
        }

        Function("updateAuth") { (auth: [String: Any]) in
            DispatchQueue.main.async { [weak self] in
                guard let self, let controller = self.activeController else { return }
                controller.updateAuth(Self.parseAuth(auth))
            }
        }

        Function("configure") { (configure: [String: Any]) in
            DispatchQueue.main.async { [weak self] in
                guard let self, let controller = self.activeController else { return }
                let locale = (configure["locale"] as? String).flatMap(PortalLocale.init(rawValue:))
                let theme = (configure["theme"] as? String).flatMap(PortalTheme.init(rawValue:))
                let fontScale = Self.doubleValue(configure["fontScale"])
                controller.updateConfigure(locale: locale, theme: theme, fontScale: fontScale)
            }
        }

        Function("dismiss") {
            DispatchQueue.main.async { [weak self] in
                // Runs the dismiss guard (confirm-discard when the form is dirty);
                // resolution fires onCloseResolved (dismiss) + onClosed (event).
                self?.activeController?.requestClose()
            }
        }
    }

    // MARK: - Presentation

    @MainActor
    private func present(options: [String: Any], promise: Promise) {
        guard activeController == nil else {
            return promise.reject("E_ALREADY_PRESENTED", "A portal sheet is already presented; dismiss it first.")
        }
        guard let presenter = Self.topViewController() else {
            return promise.reject("E_NO_PRESENTER", "Could not find a view controller to present from.")
        }

        let config: PortalConfig
        let request: PortalRequest
        let auth: PortalAuth
        do {
            config = try Self.parseConfig(options["config"])
            request = try Self.parseRequest(options["request"])
            auth = Self.parseAuth(options["auth"] as? [String: Any] ?? [:])
        } catch let error as PortalConfigError {
            return promise.reject("E_CONFIG", error.errorDescription ?? "Invalid portal config")
        } catch let error as PresentArgumentError {
            return promise.reject("E_ARGS", error.message)
        } catch {
            return promise.reject("E_ARGS", error.localizedDescription)
        }

        let adapter = PortalDelegateAdapter(module: self)
        let controller = AmthalPortalViewController(
            config: config,
            request: request,
            auth: auth,
            delegate: adapter
        )
        adapter.controller = controller

        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .pageSheet

        // Native sheet chrome — detents + grabber + rounded corners.
        if #available(iOS 15.0, *), let sheet = navigation.sheetPresentationController {
            let sheetOptions = options["sheet"] as? [String: Any]
            let names = (sheetOptions?["detents"] as? [String]) ?? []
            var detents: [UISheetPresentationController.Detent] = []
            var hasMedium = false
            for name in names {
                if name == "medium" { detents.append(.medium()); hasMedium = true }
                else if name == "large" { detents.append(.large()) }
            }
            sheet.detents = detents.isEmpty ? [.large()] : detents
            sheet.prefersGrabberVisible = (sheetOptions?["grabber"] as? Bool) ?? true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = false
            if let radius = Self.doubleValue(sheetOptions?["cornerRadius"]) {
                sheet.preferredCornerRadius = CGFloat(radius)
            }
            // When both detents are offered, open expanded (large) first.
            if hasMedium && names.contains("large") {
                sheet.selectedDetentIdentifier = .large
            }
        }

        // Close bar button + swipe-dismiss both run the SDK's dismiss guard.
        let closeButton = UIBarButtonItem(
            barButtonSystemItem: .close,
            target: adapter,
            action: #selector(PortalDelegateAdapter.closeTapped)
        )
        controller.navigationItem.rightBarButtonItem = closeButton
        navigation.presentationController?.delegate = controller

        // `onCloseResolved` is internal to the SDK — reachable because the SDK
        // compiles into this same Swift module.
        controller.onCloseResolved = { [weak self, weak navigation] in
            navigation?.presentingViewController?.dismiss(animated: true)
            self?.clearActive()
        }

        activeController = controller
        activeNavigation = navigation
        activeDelegate = adapter

        presenter.present(navigation, animated: true) {
            promise.resolve(nil)
        }
    }

    @MainActor
    fileprivate func clearActive() {
        activeController = nil
        activeNavigation = nil
        activeDelegate = nil
    }

    // MARK: - Argument parsing

    private struct PresentArgumentError: Error { let message: String }

    private static func parseConfig(_ raw: Any?) throws -> PortalConfig {
        guard let dict = raw as? [String: Any] else {
            throw PresentArgumentError(message: "Missing `config`.")
        }
        guard let baseUrlString = dict["baseUrl"] as? String, !baseUrlString.isEmpty,
              let baseURL = URL(string: baseUrlString) else {
            throw PresentArgumentError(message: "`config.baseUrl` is missing or invalid.")
        }
        let locale = (dict["locale"] as? String).flatMap(PortalLocale.init(rawValue:)) ?? .en
        let theme = (dict["theme"] as? String).flatMap(PortalTheme.init(rawValue:)) ?? .system
        let fontScale = doubleValue(dict["fontScale"]) ?? 1.0
        let minPortalVersion = dict["minPortalVersion"] as? String
        let allowedOrigins = (dict["allowedOrigins"] as? [String]).map(Set.init)
        let enableLogging = dict["enableLogging"] as? Bool ?? false
        // DEV-only escape hatch: forwarded to PortalConfig only in DEBUG
        // builds — release builds always enforce HTTPS.
        #if DEBUG
        let allowInsecureHTTP = dict["allowInsecureHttp"] as? Bool ?? false
        #else
        let allowInsecureHTTP = false
        #endif

        return try PortalConfig(
            baseURL: baseURL,
            locale: locale,
            theme: theme,
            fontScale: fontScale,
            minPortalVersion: minPortalVersion,
            allowedOrigins: allowedOrigins,
            enableLogging: enableLogging,
            allowInsecureHTTP: allowInsecureHTTP
        )
    }

    private static func parseRequest(_ raw: Any?) throws -> PortalRequest {
        guard let dict = raw as? [String: Any] else {
            throw PresentArgumentError(message: "Missing `request`.")
        }
        let kind = (dict["kind"] as? String) ?? "newApplication"
        switch kind {
        case "existingApplication":
            guard let type = dict["type"] as? String,
                  let productID = intValue(dict["productID"]) else {
                throw PresentArgumentError(message: "`request` needs `type` and `productID`.")
            }
            return .existingApplication(
                type: type,
                productID: productID,
                batchID: stringValue(dict["batchID"]) ?? "0",
                headerID: stringValue(dict["headerID"]) ?? "0",
                readOnly: dict["readOnly"] as? Bool ?? false,
                workflowDetailID: stringValue(dict["workflowDetailID"])
            )
        case "path":
            guard let path = dict["path"] as? String else {
                throw PresentArgumentError(message: "`request.path` is required for kind=path.")
            }
            return .path(path)
        default: // newApplication
            guard let type = dict["type"] as? String,
                  let productID = intValue(dict["productID"]) else {
                throw PresentArgumentError(message: "`request` needs `type` and `productID`.")
            }
            return .newApplication(type: type, productID: productID)
        }
    }

    fileprivate static func parseAuth(_ dict: [String: Any]) -> PortalAuth {
        PortalAuth(
            token: dict["token"] as? String ?? "",
            branchId: stringValue(dict["branchId"]),
            userJSON: dict["userJSON"] as? String
        )
    }

    // MARK: - Value coercion (JS numbers arrive as Double/Int/NSNumber)

    fileprivate static func intValue(_ any: Any?) -> Int? {
        switch any {
        case let v as Int: return v
        case let v as Double: return Int(v)
        case let v as NSNumber: return v.intValue
        case let v as String: return Int(v)
        default: return nil
        }
    }

    fileprivate static func doubleValue(_ any: Any?) -> Double? {
        switch any {
        case let v as Double: return v
        case let v as Int: return Double(v)
        case let v as NSNumber: return v.doubleValue
        case let v as String: return Double(v)
        default: return nil
        }
    }

    private static func stringValue(_ any: Any?) -> String? {
        switch any {
        case let v as String: return v
        case let v as Int: return String(v)
        case let v as Double: return String(Int(v))
        case let v as NSNumber: return v.stringValue
        default: return nil
        }
    }

    // MARK: - Top view controller

    @MainActor
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = (scenes.first { $0.activationState == .foregroundActive } as? UIWindowScene)
            ?? (scenes.first as? UIWindowScene)
        let keyWindow = windowScene?.windows.first { $0.isKeyWindow } ?? windowScene?.windows.first
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

// MARK: - Delegate → JS event adapter

/// Bridges `AmthalPortalDelegate` callbacks to `sendEvent(...)`. NSObject so it
/// can be the target of the Close bar-button selector.
@MainActor
final class PortalDelegateAdapter: NSObject, AmthalPortalDelegate {
    private weak var module: AmthalPortalNativeModule?
    weak var controller: AmthalPortalViewController?

    init(module: AmthalPortalNativeModule) {
        self.module = module
    }

    @objc func closeTapped() {
        controller?.requestClose()
    }

    func portalReady(portalVersion: String) {
        module?.sendEvent("onReady", ["portalVersion": portalVersion])
    }

    func formSubmitted(_ result: FormSubmitResult) {
        module?.sendEvent("onSubmitted", Self.serialize(result))
    }

    func formCancelled() {
        module?.sendEvent("onCancelled", [:])
    }

    func portalError(_ error: PortalError) {
        if error.code == .authExpired {
            module?.sendEvent("onAuthExpired", ["reason": error.message])
            return
        }
        var payload: [String: Any] = [
            "code": error.code.rawValue,
            "message": error.message
        ]
        if let status = error.code.httpStatus { payload["httpStatus"] = status }
        module?.sendEvent("onError", payload)
    }

    func navigate(path: String, title: String?) {
        var payload: [String: Any] = ["path": path]
        if let title { payload["title"] = title }
        module?.sendEvent("onNavigate", payload)
    }

    func closeRequested() {
        module?.sendEvent("onClosed", [:])
        module?.clearActive()
    }

    // MARK: Serialization

    private static func serialize(_ result: FormSubmitResult) -> [String: Any] {
        var dict: [String: Any] = ["productID": result.productID]
        if let value = result.applicationNo { dict["applicationNo"] = anyValue(value) }
        if let value = result.batchID { dict["batchID"] = anyValue(value) }
        if let value = result.headerID { dict["headerID"] = anyValue(value) }
        return dict
    }

    private static func anyValue(_ value: NumberOrString) -> Any {
        switch value {
        case .number(let double): return double
        case .string(let string): return string
        }
    }
}
