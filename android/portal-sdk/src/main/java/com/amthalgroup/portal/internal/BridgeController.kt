package com.amthalgroup.portal.internal

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.amthalgroup.portal.PortalConfig
import org.json.JSONException
import org.json.JSONObject

/**
 * Bridge Protocol v1 endpoint on the native side.
 *
 * - Inbound: a single `@JavascriptInterface` object named `__amthalAndroid`
 *   (installed by [com.amthalgroup.portal.AmthalPortalView] BEFORE `loadUrl`).
 * - Outbound: `window.__amthalReceive(<JSON-quoted envelope string>)` via
 *   `evaluateJavascript`.
 *
 * Every inbound dispatch and every outbound evaluation first verifies that
 * the WebView's current URL origin is allowed (SPEC.md §2.3).
 * All WebView interaction happens on the main looper.
 */
internal class BridgeController(
    private val webView: WebView,
    private val config: PortalConfig,
    private val host: Host
) {

    internal interface Host {
        /** Current `configure` payload ({locale, theme, fontScale}). */
        fun buildConfigurePayload(): JSONObject

        /** Current `auth` payload ({token, branchId?, user?}). */
        fun buildAuthPayload(): JSONObject

        fun onHello(portalVersion: String)
        fun onReady(portalVersion: String)
        fun onAuthExpired(reason: String?)
        fun onFormSubmitted(payload: JSONObject?)
        fun onFormCancelled()
        fun onNavigate(path: String, title: String?)
        fun onOpenExternal(url: String)
        fun onDownloadRequest(payload: JSONObject)
        fun onBridgeTimeout()
    }

    private class Pending(val timeout: Runnable, val callback: (JSONObject?) -> Unit)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val pending = HashMap<String, Pending>()
    private var helloReceivedThisPage = false
    private var readyEmittedThisPage = false
    private var helloTimeout: Runnable? = null
    private var shutDown = false

    /** The object registered as `window.__amthalAndroid`. */
    val jsInterface = JsBridge()

    internal inner class JsBridge {
        /** Called by the web shim on an arbitrary WebView-internal thread. */
        @JavascriptInterface
        fun postMessage(message: String?) {
            if (message == null) return
            mainHandler.post { handleInbound(message) }
        }
    }

    // ------------------------------------------------------------------ page lifecycle

    /** New main-frame page load started: reset per-page state, fail stale requests. */
    fun onPageStarted() {
        helloReceivedThisPage = false
        readyEmittedThisPage = false
        cancelHelloTimeout()
        failAllPending()
    }

    /** Page finished loading: expect `hello` within 15 s (unless it already arrived). */
    fun startHelloTimeout() {
        if (shutDown || helloReceivedThisPage) return
        cancelHelloTimeout()
        val r = Runnable {
            helloTimeout = null
            if (!helloReceivedThisPage && !shutDown) host.onBridgeTimeout()
        }
        helloTimeout = r
        mainHandler.postDelayed(r, BridgeProtocol.HELLO_TIMEOUT_MS)
    }

    // ------------------------------------------------------------------ outbound API

    /** (Re)issues credentials — `auth` message (web acks; ack is consumed silently). */
    fun sendAuth() {
        dispatch(BridgeProtocol.newEnvelope(BridgeProtocol.MessageType.AUTH, host.buildAuthPayload()))
    }

    /** Re-applies locale/theme/fontScale — `configure` message. */
    fun sendConfigure() {
        dispatch(BridgeProtocol.newEnvelope(BridgeProtocol.MessageType.CONFIGURE, host.buildConfigurePayload()))
    }

    /**
     * `backPressed` round-trip. [onResult] is invoked on the main thread with
     * the web's `{handled}` answer; timeout (10 s) counts as `handled = false`.
     */
    fun requestBackPressed(onResult: (handled: Boolean) -> Unit) {
        request(BridgeProtocol.MessageType.BACK_PRESSED, null, BridgeProtocol.REQUEST_TIMEOUT_MS) { reply ->
            onResult(reply?.optBoolean("handled", false) ?: false)
        }
    }

    /**
     * `dismissRequested` round-trip (dirty-state guard). Timeout counts as
     * `dirty = false`.
     */
    fun requestDismissState(onResult: (dirty: Boolean) -> Unit) {
        request(BridgeProtocol.MessageType.DISMISS_REQUESTED, null, BridgeProtocol.REQUEST_TIMEOUT_MS) { reply ->
            onResult(reply?.optBoolean("dirty", false) ?: false)
        }
    }

    /** Sends `destroy`; [onDone] fires on ack or after 1 s, whichever is first. */
    fun sendDestroy(onDone: () -> Unit) {
        request(BridgeProtocol.MessageType.DESTROY, null, BridgeProtocol.DESTROY_ACK_TIMEOUT_MS) { onDone() }
    }

    /** Stops timers and drops pending requests. No WebView access after this. */
    fun shutdown() {
        shutDown = true
        cancelHelloTimeout()
        for (p in pending.values) mainHandler.removeCallbacks(p.timeout)
        pending.clear()
    }

    // ------------------------------------------------------------------ internals

    /** Main thread only. */
    private fun handleInbound(message: String) {
        if (shutDown) return
        if (!isCurrentOriginAllowed()) {
            log("Dropped inbound bridge message from disallowed origin")
            return
        }
        val envelope = try {
            JSONObject(message)
        } catch (e: JSONException) {
            log("Dropped unparseable bridge message")
            return
        }

        // Wrong protocol version -> silently ignore (SPEC.md §1).
        if (envelope.optInt("v", -1) != BridgeProtocol.PROTOCOL_VERSION) return

        val type = envelope.optString("type", "")
        val id = envelope.optString("id", "")
        val replyTo = envelope.optStringOrNull("replyTo")
        val payload = envelope.optJSONObject("payload")

        if (replyTo != null) {
            val p = pending.remove(replyTo)
            if (p != null) {
                mainHandler.removeCallbacks(p.timeout)
                p.callback(payload)
                return
            }
            // A reply nobody is waiting for: never re-reply; acks end here.
            if (type == BridgeProtocol.MessageType.ACK) return
        }

        when (type) {
            BridgeProtocol.MessageType.HELLO -> {
                helloReceivedThisPage = true
                cancelHelloTimeout()
                // Answer EVERY hello with init (idempotent on the web side).
                sendInit(replyToHelloId = id)
                host.onHello(payload?.optString("portalVersion").orEmpty())
            }
            BridgeProtocol.MessageType.READY -> {
                // `ready` is emitted once per page load; guard against repeats.
                if (!readyEmittedThisPage) {
                    readyEmittedThisPage = true
                    host.onReady(payload?.optString("portalVersion").orEmpty())
                }
            }
            BridgeProtocol.MessageType.AUTH_EXPIRED ->
                host.onAuthExpired(payload?.optStringOrNull("reason"))
            BridgeProtocol.MessageType.FORM_SUBMITTED ->
                host.onFormSubmitted(payload)
            BridgeProtocol.MessageType.FORM_CANCELLED ->
                host.onFormCancelled()
            BridgeProtocol.MessageType.NAVIGATE ->
                host.onNavigate(
                    payload?.optString("path").orEmpty(),
                    payload?.optStringOrNull("title")
                )
            BridgeProtocol.MessageType.OPEN_EXTERNAL -> {
                val url = payload?.optString("url").orEmpty()
                if (url.isNotEmpty()) host.onOpenExternal(url)
            }
            BridgeProtocol.MessageType.DOWNLOAD_REQUEST -> {
                if (payload != null) host.onDownloadRequest(payload)
            }
            BridgeProtocol.MessageType.HAPTIC -> {
                // Optional nicety; intentionally ignored on Android.
            }
            BridgeProtocol.MessageType.LOG -> {
                // Diagnostics channel — dropped unless logging is explicitly enabled.
                if (config.enableLogging) {
                    Log.d(TAG, "[web:${payload?.optString("level")}] ${payload?.optString("message")}")
                }
            }
            else -> {
                // Unknown type -> ignore (forward compatibility, SPEC.md §1).
            }
        }
    }

    private fun sendInit(replyToHelloId: String) {
        val payload = JSONObject()
        payload.put("sdkVersion", BridgeProtocol.SDK_VERSION)
        payload.put("platform", BridgeProtocol.PLATFORM)
        payload.put("protocolVersion", BridgeProtocol.PROTOCOL_VERSION)
        payload.put("configure", host.buildConfigurePayload())
        payload.put("auth", host.buildAuthPayload())
        dispatch(
            BridgeProtocol.newEnvelope(
                BridgeProtocol.MessageType.INIT,
                payload,
                replyTo = if (replyToHelloId.isEmpty()) null else replyToHelloId
            )
        )
    }

    private fun request(
        type: String,
        payload: JSONObject?,
        timeoutMs: Long,
        onReply: (JSONObject?) -> Unit
    ) {
        if (shutDown) {
            onReply(null)
            return
        }
        val envelope = BridgeProtocol.newEnvelope(type, payload)
        val id = envelope.getString("id")
        val timeout = Runnable {
            if (pending.remove(id) != null) onReply(null)
        }
        pending[id] = Pending(timeout, onReply)
        mainHandler.postDelayed(timeout, timeoutMs)
        dispatch(envelope)
    }

    /** Serializes + evaluates on the main thread, after the origin check. */
    private fun dispatch(envelope: JSONObject) {
        val run = Runnable {
            if (shutDown && envelope.optString("type") != BridgeProtocol.MessageType.DESTROY) return@Runnable
            if (!isCurrentOriginAllowed()) {
                log("Suppressed outbound '${envelope.optString("type")}' — WebView origin not allowed")
                return@Runnable
            }
            val js = BridgeProtocol.RECEIVE_FUNCTION + "(" + JSONObject.quote(envelope.toString()) + ")"
            webView.evaluateJavascript(js, null)
        }
        if (Looper.myLooper() == Looper.getMainLooper()) run.run() else mainHandler.post(run)
    }

    /** Main thread only (reads WebView.getUrl()). */
    private fun isCurrentOriginAllowed(): Boolean = config.isUrlOriginAllowed(webView.url)

    private fun failAllPending() {
        if (pending.isEmpty()) return
        val stale = pending.values.toList()
        pending.clear()
        for (p in stale) {
            mainHandler.removeCallbacks(p.timeout)
            p.callback(null)
        }
    }

    private fun cancelHelloTimeout() {
        helloTimeout?.let { mainHandler.removeCallbacks(it) }
        helloTimeout = null
    }

    private fun log(message: String) {
        if (config.enableLogging) Log.d(TAG, message)
    }

    private companion object {
        private const val TAG = "AmthalPortal"
    }
}
