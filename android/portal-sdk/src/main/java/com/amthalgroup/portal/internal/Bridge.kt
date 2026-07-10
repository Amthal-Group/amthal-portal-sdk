package com.amthalgroup.portal.internal

import org.json.JSONObject
import java.util.UUID

/**
 * Amthal Bridge Protocol v1 constants and envelope helpers.
 * Mirrors `bridge/src/protocol.ts`.
 */
internal object BridgeProtocol {

    const val PROTOCOL_VERSION = 1
    const val SDK_VERSION = "1.0.0"
    const val PLATFORM = "android"

    /**
     * Path prefix of the embed subtree — RELATIVE TO THE PORTAL BASE URL,
     * which may itself include a path (baseHref deploys, e.g. `/portal`).
     * Never compare a full URL's path against this constant directly; use
     * [isEmbedPath].
     */
    const val EMBED_PATH_PREFIX = "/embed"

    /** Manifest location, relative to the portal BASE URL (not the origin). */
    const val MANIFEST_PATH = "/embed/manifest.json"

    /** Name of the object installed via addJavascriptInterface. */
    const val JS_INTERFACE_NAME = "__amthalAndroid"

    /** Native -> web entry point evaluated with a JSON-quoted envelope string. */
    const val RECEIVE_FUNCTION = "window.__amthalReceive"

    // Timings (normative — SPEC.md / protocol.ts TIMINGS).
    const val HELLO_TIMEOUT_MS = 15_000L
    const val REQUEST_TIMEOUT_MS = 10_000L
    const val DESTROY_ACK_TIMEOUT_MS = 1_000L

    object MessageType {
        // web -> native
        const val HELLO = "hello"
        const val READY = "ready"
        const val AUTH_EXPIRED = "authExpired"
        const val FORM_SUBMITTED = "formSubmitted"
        const val FORM_CANCELLED = "formCancelled"
        const val NAVIGATE = "navigate"
        const val OPEN_EXTERNAL = "openExternal"
        const val DOWNLOAD_REQUEST = "downloadRequest"
        const val HAPTIC = "haptic"
        const val LOG = "log"

        // native -> web
        const val INIT = "init"
        const val AUTH = "auth"
        const val CONFIGURE = "configure"
        const val BACK_PRESSED = "backPressed"
        const val DISMISS_REQUESTED = "dismissRequested"
        const val DESTROY = "destroy"

        // both directions
        const val ACK = "ack"
    }

    /** Builds a v1 envelope with a fresh uuid. */
    fun newEnvelope(type: String, payload: JSONObject? = null, replyTo: String? = null): JSONObject {
        val env = JSONObject()
        env.put("v", PROTOCOL_VERSION)
        env.put("id", UUID.randomUUID().toString())
        if (replyTo != null) env.put("replyTo", replyTo)
        env.put("type", type)
        if (payload != null) env.put("payload", payload)
        return env
    }

    /**
     * True when [path] (a URL path component) is within the embed subtree of
     * a portal deployed at [basePath] (PortalConfig.basePath: '' for a root
     * deploy, `/portal` for a baseHref deploy). Mirrors `isEmbedPath()` in
     * protocol.ts — the check every main-frame navigation MUST use.
     */
    fun isEmbedPath(path: String, basePath: String): Boolean {
        val prefix = basePath + EMBED_PATH_PREFIX
        return path == prefix || path.startsWith("$prefix/")
    }

    /**
     * Compares dotted versions; returns -1 | 0 | 1.
     * Mirrors `compareVersions()` in protocol.ts (`parseInt(n, 10) || 0`).
     */
    fun compareVersions(a: String, b: String): Int {
        val pa = a.split(".").map { seg -> seg.trim().takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { seg -> seg.trim().takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }
        val len = maxOf(pa.size, pb.size)
        for (i in 0 until len) {
            val x = pa.getOrElse(i) { 0 }
            val y = pb.getOrElse(i) { 0 }
            if (x != y) return if (x < y) -1 else 1
        }
        return 0
    }
}

/** `opt` that treats absent and JSON null the same and normalizes to String. */
internal fun JSONObject.optStringOrNull(key: String): String? {
    val v = opt(key) ?: return null
    if (v === JSONObject.NULL) return null
    return v.toString()
}
