import Foundation

/// Anchor class used to locate the pod's own bundle at runtime.
private final class AmthalPortalBundleToken {}

/// `Bundle.module` shim for the CocoaPods build.
///
/// The native iOS SDK's `Localization.swift` reads its localized interstitial
/// strings via `Bundle.module` — an accessor that Swift Package Manager
/// synthesizes for a resource-bearing target. When these same sources are
/// compiled as part of this Expo module's pod (no SPM), that synthesized symbol
/// does not exist, so we provide it here.
///
/// This file ships ONLY inside the pod, never in the SPM build of the SDK, so it
/// never collides with SPM's generated `Bundle.module`.
extension Bundle {
    static var module: Bundle {
        let bundleName = "AmthalPortalResources"
        let candidateURLs: [URL?] = [
            Bundle(for: AmthalPortalBundleToken.self).resourceURL,
            Bundle.main.resourceURL,
            Bundle(for: AmthalPortalBundleToken.self).bundleURL,
            Bundle.main.bundleURL
        ]
        for base in candidateURLs {
            if let url = base?.appendingPathComponent(bundleName + ".bundle"),
               let bundle = Bundle(url: url) {
                return bundle
            }
        }
        // Last resort: the framework bundle itself (strings may sit at its root).
        return Bundle(for: AmthalPortalBundleToken.self)
    }
}
