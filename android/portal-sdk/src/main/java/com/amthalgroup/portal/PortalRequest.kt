package com.amthalgroup.portal

import android.net.Uri

/**
 * What the host asks the portal to show. Mirrors `PortalFormRequest` /
 * `requestToPath()` in the bridge protocol (`bridge/src/protocol.ts`).
 */
sealed class PortalRequest {

    /** `/embed/form/:type/:productID` — a new application form. */
    data class NewApplication(
        val type: String,
        val productID: Int
    ) : PortalRequest()

    /** `/embed/form/:type/:productID/:batchID/:headerID/:readOnly` — an existing application. */
    data class ExistingApplication(
        val type: String,
        val productID: Int,
        val batchID: String,
        val headerID: String,
        val readOnly: Boolean
    ) : PortalRequest()

    /** Generic escape hatch: any path under `/embed` (leading slash optional). */
    data class Path(
        val path: String
    ) : PortalRequest()

    /**
     * Maps this request to its portal route. Mirrors `requestToPath()` in
     * protocol.ts exactly. Never put tokens or other credentials in the path.
     */
    fun toPath(): String = when (this) {
        is NewApplication ->
            "$EMBED_PATH_PREFIX/form/${Uri.encode(type)}/$productID"
        is ExistingApplication ->
            "$EMBED_PATH_PREFIX/form/${Uri.encode(type)}/$productID/$batchID/$headerID/$readOnly"
        is Path -> {
            val p = if (path.startsWith("/")) path else "/$path"
            if (p.startsWith(EMBED_PATH_PREFIX)) p else "$EMBED_PATH_PREFIX$p"
        }
    }

    companion object {
        private const val EMBED_PATH_PREFIX = "/embed"
    }
}
