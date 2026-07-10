import Foundation

/// Fetches `GET {baseURL}/embed/manifest.json` (no auth) and applies the
/// version gate of SPEC.md §5 before any route is loaded.
struct ManifestClient {
    let config: PortalConfig
    let sdkVersion: String

    /// 10 s network timeout. Gate rules:
    /// - `bridgeProtocolVersion` must equal the protocol this SDK implements.
    /// - `portalVersion` must be >= `config.minPortalVersion` (when set).
    /// - SDK version must be >= manifest `minSdkVersion` (when present).
    /// Gate failures ⇒ `versionIncompatible`; network/parse failures ⇒
    /// `manifestFailed` (except no-connectivity, surfaced as `offline` so the
    /// SDK can auto-retry when the network returns).
    func fetchAndGate() async -> Result<EmbedManifest, PortalError> {
        guard let url = config.portalURL(forPath: BridgeProtocol.manifestPath) else {
            return .failure(PortalError(
                code: .manifestFailed,
                message: "Could not construct the manifest URL from the configured base URL."
            ))
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            let nsError = error as NSError
            let offlineCodes = [
                NSURLErrorNotConnectedToInternet,
                NSURLErrorNetworkConnectionLost,
                NSURLErrorDataNotAllowed,
                NSURLErrorInternationalRoamingOff,
            ]
            if nsError.domain == NSURLErrorDomain, offlineCodes.contains(nsError.code) {
                return .failure(PortalError(
                    code: .offline,
                    message: "No internet connection while fetching the portal manifest."
                ))
            }
            return .failure(PortalError(
                code: .manifestFailed,
                message: "Manifest request failed: \(nsError.localizedDescription)"
            ))
        }

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            return .failure(PortalError(
                code: .manifestFailed,
                message: "Manifest request returned HTTP \(status)."
            ))
        }

        guard let manifest = try? JSONDecoder().decode(EmbedManifest.self, from: data) else {
            return .failure(PortalError(
                code: .manifestFailed,
                message: "Manifest response could not be parsed."
            ))
        }

        if manifest.bridgeProtocolVersion != BridgeProtocol.version {
            return .failure(PortalError(
                code: .versionIncompatible,
                message: "Portal speaks bridge protocol \(manifest.bridgeProtocolVersion); "
                    + "this SDK implements protocol \(BridgeProtocol.version)."
            ))
        }

        if let minPortal = config.minPortalVersion,
           compareVersions(manifest.portalVersion, minPortal) < 0 {
            return .failure(PortalError(
                code: .versionIncompatible,
                message: "Portal version \(manifest.portalVersion) is older than the "
                    + "required minimum \(minPortal)."
            ))
        }

        if let minSdk = manifest.minSdkVersion,
           compareVersions(sdkVersion, minSdk) < 0 {
            return .failure(PortalError(
                code: .versionIncompatible,
                message: "SDK version \(sdkVersion) is older than the portal's "
                    + "required minimum \(minSdk)."
            ))
        }

        return .success(manifest)
    }
}
