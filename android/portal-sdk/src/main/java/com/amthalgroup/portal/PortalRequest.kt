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

    /**
     * `/embed/form/:type/:productID/:batchID/:headerID/:readOnly` — an existing application.
     *
     * [workflowDetailID] is the workflow step the form is opened at. It travels as a QUERY
     * parameter rather than a path segment so the portal's two form routes keep matching, and is
     * omitted when null, blank or `"0"` — the portal's own "no workflow step" default — so an
     * ordinary form produces exactly the URL it always did.
     */
    data class ExistingApplication(
        val type: String,
        val productID: Int,
        val batchID: String,
        val headerID: String,
        val readOnly: Boolean,
        val workflowDetailID: String? = null
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
        is ExistingApplication -> {
            val base = "$EMBED_PATH_PREFIX/form/${Uri.encode(type)}/$productID/$batchID/$headerID/$readOnly"
            if (workflowDetailID.isNullOrBlank() || workflowDetailID == "0") base
            else "$base?workflowDetailID=${Uri.encode(workflowDetailID)}"
        }
        is Path -> {
            val p = if (path.startsWith("/")) path else "/$path"
            if (p.startsWith(EMBED_PATH_PREFIX)) p else "$EMBED_PATH_PREFIX$p"
        }
    }

    companion object {
        private const val EMBED_PATH_PREFIX = "/embed"
    }
}
