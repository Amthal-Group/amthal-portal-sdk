import Foundation

/// SDK error codes — mirror of `PortalErrorCode` in protocol.ts.
/// `httpError` carries the main-frame HTTP status as an associated value.
public enum PortalErrorCode: Equatable, Hashable, Sendable {
    case offline
    case loadFailed
    case httpError(Int)
    case manifestFailed
    case bridgeTimeout
    case versionIncompatible
    case authExpired
    case webProcessTerminated

    /// Wire string exactly as defined by the protocol.
    public var rawValue: String {
        switch self {
        case .offline: return "offline"
        case .loadFailed: return "loadFailed"
        case .httpError: return "httpError"
        case .manifestFailed: return "manifestFailed"
        case .bridgeTimeout: return "bridgeTimeout"
        case .versionIncompatible: return "versionIncompatible"
        case .authExpired: return "authExpired"
        case .webProcessTerminated: return "webProcessTerminated"
        }
    }

    /// Convenience accessor for the `httpError` status code.
    public var httpStatus: Int? {
        if case .httpError(let status) = self { return status }
        return nil
    }
}

/// Error surfaced through `AmthalPortalDelegate.portalError(_:)`.
public struct PortalError: Error, Equatable, Sendable, CustomStringConvertible {
    public let code: PortalErrorCode
    /// Human-readable, developer-facing message (not localized; the SDK shows
    /// its own localized interstitials to end users).
    public let message: String

    public init(code: PortalErrorCode, message: String) {
        self.code = code
        self.message = message
    }

    public var description: String { "PortalError(\(code.rawValue)): \(message)" }
}
