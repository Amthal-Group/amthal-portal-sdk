import Foundation

/// Resolves SDK-bundled strings against the *configured* portal locale
/// (not the device locale), so interstitials match the portal UI language.
enum PortalStrings {
    static func string(_ key: String, locale: PortalLocale) -> String {
        if let path = Bundle.module.path(forResource: locale.rawValue, ofType: "lproj"),
           let bundle = Bundle(path: path) {
            let value = bundle.localizedString(forKey: key, value: nil, table: nil)
            if value != key { return value }
        }
        return Bundle.module.localizedString(forKey: key, value: key, table: nil)
    }
}
