import Foundation

/// What the host asks the portal to show. Mirror of `PortalFormRequest`
/// in protocol.ts; `path` mirrors `requestToPath()` exactly.
public enum PortalRequest: Equatable, Sendable {
    /// `embed/form/:type/:productID`
    case newApplication(type: String, productID: Int)

    /// `embed/form/:type/:productID/:batchID/:headerID/:readOnly`
    ///
    /// `workflowDetailID` is the workflow step the form is opened at. It travels as a QUERY
    /// parameter rather than a path segment so the portal's two form routes keep matching, and is
    /// omitted when absent or `"0"` — the portal's own "no workflow step" default — so an ordinary
    /// form produces exactly the URL it always did.
    case existingApplication(
        type: String,
        productID: Int,
        batchID: String,
        headerID: String,
        readOnly: Bool,
        workflowDetailID: String? = nil
    )

    /// Generic escape hatch: any path under /embed (leading slash optional).
    case path(String)

    /// Portal route for this request — mirror of `requestToPath()`.
    public var path: String {
        switch self {
        case let .newApplication(type, productID):
            return "\(BridgeProtocol.embedPathPrefix)/form/\(Self.encodeURIComponent(type))/\(productID)"

        case let .existingApplication(type, productID, batchID, headerID, readOnly, workflowDetailID):
            let base = "\(BridgeProtocol.embedPathPrefix)/form/\(Self.encodeURIComponent(type))/\(productID)"
                + "/\(batchID)/\(headerID)/\(readOnly)"
            guard let detail = workflowDetailID, !detail.isEmpty, detail != "0" else { return base }
            return base + "?workflowDetailID=\(Self.encodeURIComponent(detail))"

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
