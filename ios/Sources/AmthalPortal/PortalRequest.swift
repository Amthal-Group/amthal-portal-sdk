import Foundation

/// What the host asks the portal to show. Mirror of `PortalFormRequest`
/// in protocol.ts; `path` mirrors `requestToPath()` exactly.
public enum PortalRequest: Equatable, Sendable {
    /// `embed/form/:type/:productID`
    case newApplication(type: String, productID: Int)

    /// `embed/form/:type/:productID/:batchID/:headerID/:readOnly`
    case existingApplication(
        type: String,
        productID: Int,
        batchID: String,
        headerID: String,
        readOnly: Bool
    )

    /// Generic escape hatch: any path under /embed (leading slash optional).
    case path(String)

    /// Portal route for this request — mirror of `requestToPath()`.
    public var path: String {
        switch self {
        case let .newApplication(type, productID):
            return "\(BridgeProtocol.embedPathPrefix)/form/\(Self.encodeURIComponent(type))/\(productID)"

        case let .existingApplication(type, productID, batchID, headerID, readOnly):
            return "\(BridgeProtocol.embedPathPrefix)/form/\(Self.encodeURIComponent(type))/\(productID)"
                + "/\(batchID)/\(headerID)/\(readOnly)"

        case let .path(rawPath):
            let p = rawPath.hasPrefix("/") ? rawPath : "/\(rawPath)"
            return p.hasPrefix(BridgeProtocol.embedPathPrefix)
                ? p
                : "\(BridgeProtocol.embedPathPrefix)\(p)"
        }
    }

    /// Matches JavaScript `encodeURIComponent` (unreserved set: A–Z a–z 0–9 - _ . ! ~ * ' ( )).
    static func encodeURIComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: Self.encodeURIComponentAllowed) ?? value
    }

    private static let encodeURIComponentAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    )
}
