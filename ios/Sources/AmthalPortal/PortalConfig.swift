import Foundation
import UIKit

/// Portal locale, forwarded to the web app via `configure`.
/// `ar` also flips document direction to RTL on the web side.
public enum PortalLocale: String, Codable, CaseIterable, Sendable {
    case en
    case ar
}

/// Portal theme, forwarded to the web app via `configure`.
public enum PortalTheme: String, Codable, CaseIterable, Sendable {
    case light
    case dark
    case system
}

/// Errors thrown by `PortalConfig.init` when the base URL is unacceptable.
public enum PortalConfigError: Error, Equatable, LocalizedError {
    /// The base URL has no usable scheme/host.
    case invalidBaseURL(URL)
    /// `http:` base URLs are rejected — HTTPS only (exception: localhost for development).
    case insecureBaseURL(URL)

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let url):
            return "Invalid portal base URL: \(url.absoluteString)"
        case .insecureBaseURL(let url):
            return "Portal base URL must use https (http is only allowed for localhost, "
                + "or any host via the DEV-only allowInsecureHttp flag): \(url.absoluteString)"
        }
    }
}

/// Immutable-origin configuration for a portal session.
public struct PortalConfig: Equatable, Sendable {
    /// Portal base URL, e.g. `https://portal.example.com` — **including any
    /// deploy path prefix** when the portal is served under a baseHref, e.g.
    /// `https://host.example.com/portal`. HTTPS required (`http` allowed for
    /// localhost only, for development).
    public let baseURL: URL

    /// Path component of `baseURL` without trailing slash (`""` when the
    /// portal is deployed at the origin root). Mirror of `basePathOf()` in
    /// protocol.ts; all embed-subtree checks are made against
    /// `basePath + "/embed"`.
    public let basePath: String

    /// UI locale passed to the portal (`configure.locale`).
    public var locale: PortalLocale

    /// UI theme passed to the portal (`configure.theme`).
    public var theme: PortalTheme

    /// 1.0 = default; the portal maps it to a root font-size adjustment.
    public var fontScale: Double

    /// Your brand colour, used for the SDK's OWN interstitials (the loading indicator and
    /// the retry affordance) — not for the portal's UI, which is themed server-side.
    ///
    /// It cannot arrive over the bridge: the interstitial is on screen before the WebView
    /// can speak, so nothing the portal sends could colour the first frame. Set it here and
    /// the wait is your colour from the very first pixel.
    ///
    /// `nil` (the default) draws with the platform's own label colour rather than a colour
    /// we invented — deliberately plain, never another tenant's brand.
    public var brandColor: UIColor?

    /// When set, the manifest's `portalVersion` must be >= this or the SDK
    /// surfaces `versionIncompatible`.
    public var minPortalVersion: String?

    /// Hosts the WebView may navigate to (main frame) and that bridge traffic
    /// is accepted from. Defaults to the `baseURL` host.
    public var allowedOrigins: Set<String>

    /// Enables SDK diagnostics logging (DEBUG builds only; never logs
    /// credentials or header values).
    public var enableLogging: Bool

    /// DEV ONLY: permit a plain-`http` base URL for non-localhost hosts —
    /// needed when the portal dev server is bound to a tenant hostname (the
    /// backend resolves the tenant from the request host/referer). The host
    /// app also needs an ATS exception for the domain.
    ///
    /// This is what was *honoured*, not what the caller asked for: it is
    /// forced to `false` outside DEBUG builds (see `honourInsecureHTTP`), so
    /// `isOriginAllowed` and the init check below are gated by construction.
    public let allowInsecureHTTP: Bool

    public init(
        baseURL: URL,
        locale: PortalLocale = .en,
        theme: PortalTheme = .system,
        fontScale: Double = 1.0,
        brandColor: UIColor? = nil,
        minPortalVersion: String? = nil,
        allowedOrigins: Set<String>? = nil,
        enableLogging: Bool = false,
        allowInsecureHTTP: Bool = false
    ) throws {
        guard let scheme = baseURL.scheme?.lowercased(),
              let host = baseURL.host, !host.isEmpty
        else {
            throw PortalConfigError.invalidBaseURL(baseURL)
        }
        let insecureHTTPHonoured = Self.honourInsecureHTTP(allowInsecureHTTP)
        switch scheme {
        case "https":
            break
        case "http" where Self.isLocalhost(host) || insecureHTTPHonoured:
            break
        default:
            throw PortalConfigError.insecureBaseURL(baseURL)
        }
        self.baseURL = baseURL
        // basePathOf(): path without trailing slash, '' for root.
        var basePath = baseURL.path
        while basePath.hasSuffix("/") { basePath.removeLast() }
        self.basePath = basePath
        self.locale = locale
        self.theme = theme
        self.fontScale = fontScale
        self.brandColor = brandColor
        self.minPortalVersion = minPortalVersion
        self.allowedOrigins = allowedOrigins ?? [host]
        self.enableLogging = enableLogging
        self.allowInsecureHTTP = insecureHTTPHonoured
    }

    // MARK: Internal helpers

    /// The DEV-only cleartext escape hatch counts only in a DEBUG build: a
    /// shipped app must not be talked into http by one boolean in the
    /// embedding code. Outside DEBUG the flag is dropped, and a base URL that
    /// needed it then fails `init` with `.insecureBaseURL` — a thrown, typed
    /// error rather than a silent downgrade.
    private static func honourInsecureHTTP(_ requested: Bool) -> Bool {
        #if DEBUG
        return requested
        #else
        return false
        #endif
    }

    static func isLocalhost(_ host: String) -> Bool {
        let h = host.lowercased()
        return h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]"
            || h.hasSuffix(".localhost")
    }

    /// True when `url`'s origin (scheme + host) is acceptable for bridge
    /// traffic and main-frame navigation.
    func isOriginAllowed(_ url: URL?) -> Bool {
        guard let url,
              let host = url.host, !host.isEmpty,
              let scheme = url.scheme?.lowercased()
        else { return false }
        guard isHostAllowed(host) else { return false }
        if scheme == "https" { return true }
        if scheme == "http", Self.isLocalhost(host) || allowInsecureHTTP { return true }
        return false
    }

    func isHostAllowed(_ host: String) -> Bool {
        allowedOrigins.contains { $0.caseInsensitiveCompare(host) == .orderedSame }
    }

    /// True when `path` (a URL path component) is within the embed subtree of
    /// a portal deployed at `basePath`. Mirror of `isEmbedPath()` in
    /// protocol.ts — the check used for main-frame navigation confinement.
    /// Never test against a literal "/embed" prefix.
    func isEmbedPath(_ path: String) -> Bool {
        let prefix = basePath + BridgeProtocol.embedPathPrefix
        return path == prefix || path.hasPrefix(prefix + "/")
    }

    /// Builds `{baseURL}{path}`, preserving any deploy path prefix in the
    /// base URL. Mirror of `resolveEmbedUrl()`/`manifestUrl()` in protocol.ts
    /// (trailing-slash-stripped base + path). The URL *is* the request —
    /// never put tokens or other credentials in it.
    func portalURL(forPath path: String) -> URL? {
        guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true),
              let scheme = components.scheme,
              let host = components.host
        else { return nil }
        let portPart = components.port.map { ":\($0)" } ?? ""
        // Percent-encoded base path keeps the rebuilt URL string valid;
        // any query/fragment on the base URL is deliberately dropped.
        var encodedBasePath = components.percentEncodedPath
        while encodedBasePath.hasSuffix("/") { encodedBasePath.removeLast() }
        return URL(string: "\(scheme)://\(host)\(portPart)\(encodedBasePath)\(path)")
    }
}
