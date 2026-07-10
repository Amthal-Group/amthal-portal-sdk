import Foundation

// =============================================================================
// Amthal Bridge Protocol v1 — Swift mirror of bridge/src/protocol.ts.
// Names and field shapes MUST stay in lockstep with the TypeScript source of
// truth. Any change here is a protocol change and requires a SPEC.md PR first.
// =============================================================================

/// Protocol-level constants (mirror of protocol.ts).
enum BridgeProtocol {
    /// `BRIDGE_PROTOCOL_VERSION`
    static let version = 1
    /// `EMBED_PATH_PREFIX`
    static let embedPathPrefix = "/embed"
    /// `MANIFEST_PATH`
    static let manifestPath = "/embed/manifest.json"

    // TIMINGS (normative — see SPEC.md)
    /// Native waits this long after page load for `hello` before `bridgeTimeout`.
    static let helloTimeout: TimeInterval = 15
    /// Web waits this long after `hello` for `init`, then re-sends `hello`.
    static let initTimeout: TimeInterval = 10
    /// Default timeout for any request/ack round-trip.
    static let requestTimeout: TimeInterval = 10
    /// Best-effort wait for the `destroy` ack before releasing the WebView.
    static let destroyGrace: TimeInterval = 1
}

/// Message type string constants (mirror of `WebToNativeType` / `NativeToWebType`).
enum MessageType {
    // Web → native
    static let hello = "hello"
    static let ready = "ready"
    static let authExpired = "authExpired"
    static let formSubmitted = "formSubmitted"
    static let formCancelled = "formCancelled"
    static let navigate = "navigate"
    static let openExternal = "openExternal"
    static let downloadRequest = "downloadRequest"
    static let haptic = "haptic"
    static let log = "log"

    // Native → web ("init" is a Swift keyword, hence `bridgeInit`)
    static let bridgeInit = "init"
    static let auth = "auth"
    static let configure = "configure"
    static let backPressed = "backPressed"
    static let dismissRequested = "dismissRequested"
    static let destroy = "destroy"

    // Both directions
    static let ack = "ack"
}

// MARK: - JSON value (for `unknown` / opaque payload fields)

/// A fully generic, Codable JSON value. Used wherever protocol.ts says
/// `unknown` (e.g. `FormSubmittedPayload.raw`, `AuthPayload.user`).
public enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

/// Mirrors protocol.ts `number | string` union fields (applicationNo, batchID,
/// headerID may arrive as either type from the portal).
public enum NumberOrString: Codable, Equatable, Hashable, Sendable, CustomStringConvertible {
    case number(Double)
    case string(String)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected number or string"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        }
    }

    /// Integral numbers render without a trailing ".0".
    public var description: String {
        switch self {
        case .number(let value):
            if value.truncatingRemainder(dividingBy: 1) == 0, abs(value) < 9e15 {
                return String(Int64(value))
            }
            return String(value)
        case .string(let value):
            return value
        }
    }

    public var stringValue: String { description }

    public var intValue: Int? {
        switch self {
        case .number(let value): return Int(exactly: value.rounded())
        case .string(let value): return Int(value)
        }
    }
}

// MARK: - Envelope

/// Outbound (native → web) envelope. `v` is always 1.
struct OutboundEnvelope<Payload: Encodable>: Encodable {
    let v = BridgeProtocol.version
    let id: String
    var replyTo: String?
    let type: String
    var payload: Payload?
}

/// Placeholder for messages that carry no payload.
struct EmptyPayload: Codable {}

/// Inbound (web → native) message, envelope-validated (`v == 1`, `id`, `type`
/// present) with the payload re-serialized to Data for typed decoding.
struct InboundMessage {
    let id: String
    let replyTo: String?
    let type: String
    let payloadData: Data?

    /// Accepts either a JSON string or an already-bridged dictionary body.
    /// Returns nil for anything that is not a protocol-v1 envelope — per spec
    /// those are silently ignored.
    init?(body: Any) {
        let object: Any
        if let string = body as? String {
            guard let data = string.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data)
            else { return nil }
            object = parsed
        } else {
            object = body
        }
        guard let dict = object as? [String: Any] else { return nil }
        // `v` MUST be 1; anything else is silently ignored.
        guard let v = dict["v"] as? Int, v == BridgeProtocol.version else { return nil }
        guard let id = dict["id"] as? String, !id.isEmpty,
              let type = dict["type"] as? String, !type.isEmpty
        else { return nil }
        self.id = id
        self.type = type
        self.replyTo = dict["replyTo"] as? String
        if let payload = dict["payload"], !(payload is NSNull) {
            self.payloadData = try? JSONSerialization.data(
                withJSONObject: payload,
                options: [.fragmentsAllowed]
            )
        } else {
            self.payloadData = nil
        }
    }

    func decodePayload<T: Decodable>(_ type: T.Type) -> T? {
        guard let payloadData else { return nil }
        return try? JSONDecoder().decode(T.self, from: payloadData)
    }
}

// MARK: - Payloads (mirror protocol.ts names/fields exactly)

/// `ConfigurePayload`
struct ConfigurePayload: Codable {
    var locale: String?
    var theme: String?
    /// 1.0 = default. The portal maps this to a root font-size adjustment.
    var fontScale: Double?
}

/// `AuthPayload`
struct AuthPayload: Encodable {
    let token: String
    var branchId: String?
    /// Optional pre-built portal user object (opaque to the SDK).
    var user: JSONValue?
}

/// `HelloPayload` (fields lenient — unknown/missing fields are ignored)
struct HelloPayload: Decodable {
    var protocolVersion: Int?
    var portalVersion: String?
}

/// `InitPayload`
struct InitPayload: Encodable {
    let sdkVersion: String
    let platform: String // HostPlatform — always "ios" here
    let protocolVersion: Int
    let configure: ConfigurePayload
    let auth: AuthPayload
}

/// `ReadyPayload`
struct ReadyPayload: Decodable {
    var portalVersion: String?
    var protocolVersion: Int?
}

/// `AuthExpiredPayload`
struct AuthExpiredPayload: Decodable {
    var reason: String?
}

/// `NavigatePayload`
struct NavigatePayload: Decodable {
    let path: String
    var title: String?
}

/// `OpenExternalPayload`
struct OpenExternalPayload: Decodable {
    let url: String
}

/// `DownloadRequestPayload`
struct DownloadRequestPayload: Decodable {
    let url: String
    var filename: String?
    var mime: String?
    /// Extra headers (e.g. Authorization) the host must attach.
    /// Values MUST never be logged.
    var headers: [String: String]?
}

/// `HapticPayload` (style kept as raw string so unknown values are ignorable)
struct HapticPayload: Decodable {
    let style: String
}

/// `LogPayload`
struct LogPayload: Decodable {
    var level: String?
    var message: String?
    var data: JSONValue?
}

/// `BackHandledPayload` — ack replying to `backPressed`.
struct BackHandledPayload: Decodable {
    let handled: Bool
}

/// `DismissStatePayload` — ack replying to `dismissRequested`.
struct DismissStatePayload: Decodable {
    let dirty: Bool
}

/// `AckPayload` — generic ack. `ok:false` carries a human-readable error.
struct AckPayload: Decodable {
    var ok: Bool?
    var error: String?
}

/// `EmbedManifest` — version handshake, fetched before loading any route.
struct EmbedManifest: Decodable {
    let portalVersion: String
    let bridgeProtocolVersion: Int
    /// Oldest SDK version the portal still supports (semver), optional.
    var minSdkVersion: String?
}

// MARK: - Form submission result (public surface for `formSubmitted`)

/// Mirror of `FormSubmittedPayload` — the payload the portal emits on a
/// successful submission of the embedded form.
public struct FormSubmitResult: Decodable, Equatable, Sendable {
    public let productID: Int
    public let applicationNo: NumberOrString?
    public let batchID: NumberOrString?
    public let headerID: NumberOrString?
    /// Anything else the portal wants to surface (opaque to the SDK).
    public let raw: JSONValue?

    public init(
        productID: Int,
        applicationNo: NumberOrString? = nil,
        batchID: NumberOrString? = nil,
        headerID: NumberOrString? = nil,
        raw: JSONValue? = nil
    ) {
        self.productID = productID
        self.applicationNo = applicationNo
        self.batchID = batchID
        self.headerID = headerID
        self.raw = raw
    }
}
