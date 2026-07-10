import Foundation

/// Credentials handed to the portal over the bridge (`init.auth` / `auth`).
/// Credentials only ever travel in bridge payloads — never in URLs.
public struct PortalAuth: Equatable, Sendable {
    /// Backend bearer token, exactly as the portal's auth service expects.
    public var token: String

    /// Optional branch identifier (`BRANCH_ID`).
    public var branchId: String?

    /// Optional raw JSON string of the pre-built portal user object (the shape
    /// the portal persists under `USER_KEY`). When omitted the portal
    /// reconstructs it by calling its profile endpoint with the token.
    public var userJSON: String?

    public init(token: String, branchId: String? = nil, userJSON: String? = nil) {
        self.token = token
        self.branchId = branchId
        self.userJSON = userJSON
    }
}
