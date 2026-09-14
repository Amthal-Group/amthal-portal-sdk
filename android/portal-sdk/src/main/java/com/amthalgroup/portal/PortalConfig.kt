package com.amthalgroup.portal

import android.content.Context
import android.content.pm.ApplicationInfo
import android.net.Uri
import androidx.annotation.ColorInt
import android.util.Log
import java.security.cert.X509Certificate

/** UI locale passed to the portal (bridge `configure.locale`). */
enum class PortalLocale(val wire: String) {
    EN("en"),
    AR("ar")
}

/** Theme passed to the portal (bridge `configure.theme`). */
enum class PortalTheme(val wire: String) {
    LIGHT("light"),
    DARK("dark"),
    SYSTEM("system")
}

/**
 * Immutable configuration for an embedded portal session.
 *
 * @param baseUrl full portal base URL, INCLUDING any deploy path prefix when
 *   the portal is served under a baseHref — e.g. `https://portal.example.com`
 *   or `https://host.example.com/portal`. A trailing slash is tolerated.
 *   Must be `https`; `http` is allowed only for local development hosts
 *   (`localhost`, `127.0.0.1`, `10.0.2.2`, `::1`). No query or fragment.
 * @param locale initial portal locale.
 * @param theme initial portal theme.
 * @param fontScale initial font scale (1.0 = default).
 * @param brandColor ARGB colour for the SDK's OWN interstitials — the loading indicator
 *   and the retry affordance — not for the portal's UI, which is themed server-side from
 *   the branch. It cannot arrive over the bridge: the interstitial is on screen before the
 *   WebView can speak, so nothing the portal sends could colour the first frame. `null`
 *   (the default) leaves the widget to tint itself from the host app's own theme, rather
 *   than substituting a colour of ours — never another tenant's brand.
 * @param minPortalVersion optional floor for the portal version reported by
 *   `/embed/manifest.json`; older portals fail with `VERSION_INCOMPATIBLE`.
 * @param allowedOrigins additional allowed hosts (or full origins) for the
 *   WebView / bridge origin check. When empty, only the [baseUrl] host is
 *   allowed.
 * @param certificatePinner optional hook invoked with the server's leaf
 *   certificate for SDK-initiated HTTPS connections (manifest fetch and
 *   downloads); return `false` to abort the connection. Note: the portal
 *   page load itself goes through the system WebView network stack, which
 *   does not expose a pinning hook — pin at the network edge if you need
 *   full coverage.
 * @param enableLogging when `true`, bridge `log` messages and WebView console
 *   output are forwarded to Logcat. Keep `false` in release builds.
 * @param allowInsecureHttp DEV ONLY: permit a plain-`http` [baseUrl] for
 *   non-loopback hosts — needed when the portal dev server is bound to a
 *   tenant hostname (the backend resolves the tenant from the request
 *   host/referer). Honoured only in a debuggable app — see
 *   [isInsecureHttpHonoured]; the app manifest must also allow cleartext
 *   traffic to the dev host.
 */
data class PortalConfig(
    val baseUrl: String,
    val locale: PortalLocale = PortalLocale.EN,
    val theme: PortalTheme = PortalTheme.SYSTEM,
    val fontScale: Float = 1f,
    @ColorInt val brandColor: Int? = null,
    val minPortalVersion: String? = null,
    val allowedOrigins: Set<String> = emptySet(),
    val certificatePinner: ((X509Certificate) -> Boolean)? = null,
    val enableLogging: Boolean = false,
    val allowInsecureHttp: Boolean = false
) {

    /** Precomputed portal origin (scheme://host[:port] — no path, no trailing slash). */
    val origin: String

    /**
     * Path component of [baseUrl] without trailing slash; empty (`""`) for a
     * root deploy, `/portal` for `https://host/portal/`. Mirrors
     * `basePathOf()` in protocol.ts. Every embed-path check tests against
     * `basePath + "/embed"` — never a literal `/embed`.
     */
    val basePath: String

    /**
     * [baseUrl] with trailing slashes stripped — the string all portal URLs
     * (manifest fetch, initial load) are concatenated onto. Mirrors the
     * normalization in protocol.ts `resolveEmbedUrl()` / `manifestUrl()`.
     */
    val normalizedBaseUrl: String

    /** Lower-cased hosts allowed for main-frame navigation and bridge traffic. */
    val allowedHosts: Set<String>

    /** Lower-cased scheme of [baseUrl] — read by [isBaseUrlTransportAllowed]. */
    private val baseScheme: String

    /** Lower-cased host of [baseUrl] — read by [isBaseUrlTransportAllowed]. */
    private val baseHost: String

    init {
        require(fontScale > 0f) { "fontScale must be > 0" }
        val uri = Uri.parse(baseUrl.trim())
        val scheme = uri.scheme?.lowercase()
            ?: throw IllegalArgumentException("baseUrl must be an absolute URL: $baseUrl")
        val host = uri.host?.lowercase()
            ?: throw IllegalArgumentException("baseUrl must contain a host: $baseUrl")
        require(
            scheme == "https" || (scheme == "http" && (isLoopbackHost(host) || allowInsecureHttp))
        ) {
            "baseUrl must use https (http is allowed only for localhost / 127.0.0.1 / 10.0.2.2, " +
                "or any host via the DEV-only allowInsecureHttp flag): $baseUrl"
        }
        require(uri.query == null && uri.fragment == null) {
            "baseUrl must not contain a query or fragment: $baseUrl"
        }
        val port = uri.port
        origin = buildString {
            append(scheme).append("://").append(host)
            if (port != -1 && !isDefaultPort(scheme, port)) append(':').append(port)
        }
        // basePathOf(): path component without trailing slash, '' for root.
        basePath = (uri.path ?: "").trimEnd('/')
        normalizedBaseUrl = baseUrl.trim().trimEnd('/')
        val hosts = HashSet<String>()
        hosts.add(host)
        for (entry in allowedOrigins) {
            val trimmed = entry.trim().lowercase()
            if (trimmed.isEmpty()) continue
            if (trimmed.contains("://")) {
                Uri.parse(trimmed).host?.let { hosts.add(it.lowercase()) }
            } else {
                // Bare host, possibly with a port — strip the port.
                hosts.add(trimmed.substringBefore('/').substringBefore(':'))
            }
        }
        allowedHosts = hosts
        baseScheme = scheme
        baseHost = host
    }

    /**
     * `true` when [url]'s origin is acceptable for main-frame navigation and
     * bridge traffic: an allowed host over https (or http for loopback hosts).
     *
     * Cleartext here rides on the requested [allowInsecureHttp] rather than the
     * build-gated one, which is safe only because [isBaseUrlTransportAllowed]
     * stops a cleartext session before a page exists to navigate. A caller that
     * reaches this without that gate must apply it first.
     */
    fun isUrlOriginAllowed(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.lowercase() ?: return false
        if (scheme != "https" && !(scheme == "http" && (isLoopbackHost(host) || allowInsecureHttp))) {
            return false
        }
        return host in allowedHosts
    }

    /**
     * `true` when the DEV-only [allowInsecureHttp] escape hatch is honoured in
     * [context]'s app.
     *
     * The hatch counts only where the host app itself is debuggable: a release
     * APK must not be talked into cleartext by one boolean in the embedding
     * code. Ignoring it is logged — a portal that silently refuses to load is
     * worse than one that says why.
     */
    fun isInsecureHttpHonoured(context: Context): Boolean {
        if (!allowInsecureHttp) return false
        val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (!debuggable) {
            Log.w(
                TAG,
                "allowInsecureHttp is ignored in a non-debuggable build — " +
                    "the portal must be served over https."
            )
        }
        return debuggable
    }

    /**
     * `true` when [baseUrl] may be loaded in [context]'s app: https, a loopback
     * host, or a debuggable app that opted into [allowInsecureHttp].
     *
     * The constructor accepts a cleartext [baseUrl] whenever [allowInsecureHttp]
     * was passed, because a config is just data and has no Context to judge the
     * build with. THIS is the check that decides whether the request may leave
     * the device, and [AmthalPortalView] makes it before every load.
     */
    fun isBaseUrlTransportAllowed(context: Context): Boolean =
        baseScheme == "https" || isLoopbackHost(baseHost) || isInsecureHttpHonoured(context)

    private companion object {
        private const val TAG = "AmthalPortal"

        private fun isLoopbackHost(host: String): Boolean =
            host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2" || host == "::1"

        private fun isDefaultPort(scheme: String, port: Int): Boolean =
            (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
    }
}
