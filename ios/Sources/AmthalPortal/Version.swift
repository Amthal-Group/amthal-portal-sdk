import Foundation

/// SDK-level constants surfaced to the portal during the `init` handshake.
public enum AmthalPortalSDK {
    /// Semantic version of this SDK build. Sent as `sdkVersion` in `init`
    /// and gated against the manifest's `minSdkVersion`.
    public static let version = "1.0.0"

    /// Bridge protocol version implemented by this SDK.
    public static let protocolVersion = BridgeProtocol.version
}

/// Compares dotted version strings; returns -1 | 0 | 1.
/// Mirrors `compareVersions` in `bridge/src/protocol.ts` (including
/// `parseInt`-style tolerance for suffixes like `"3-beta"` → 3).
func compareVersions(_ a: String, _ b: String) -> Int {
    func leadingInt(_ segment: Substring) -> Int {
        var digits = ""
        var seenSign = false
        for ch in segment.drop(while: { $0 == " " || $0 == "\t" }) {
            if !seenSign, digits.isEmpty, ch == "-" || ch == "+" {
                seenSign = true
                if ch == "-" { digits.append(ch) }
                continue
            }
            if ch.isASCII, ch.isNumber {
                digits.append(ch)
            } else {
                break
            }
        }
        return Int(digits) ?? 0
    }

    let pa = a.split(separator: ".", omittingEmptySubsequences: false).map(leadingInt)
    let pb = b.split(separator: ".", omittingEmptySubsequences: false).map(leadingInt)
    let len = max(pa.count, pb.count)
    for i in 0..<len {
        let x = i < pa.count ? pa[i] : 0
        let y = i < pb.count ? pb[i] : 0
        if x != y { return x < y ? -1 : 1 }
    }
    return 0
}
