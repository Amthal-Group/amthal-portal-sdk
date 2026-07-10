package com.amthalgroup.portal

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.result.ActivityResultCaller
import androidx.activity.result.ActivityResultRegistry
import com.amthalgroup.portal.internal.BridgeController
import com.amthalgroup.portal.internal.BridgeProtocol
import com.amthalgroup.portal.internal.DownloadHandler
import com.amthalgroup.portal.internal.FileChooserHandler
import com.amthalgroup.portal.internal.HardenedWebViewFactory
import com.amthalgroup.portal.internal.ManifestClient
import com.amthalgroup.portal.internal.PortalWebChromeClient
import com.amthalgroup.portal.internal.PortalWebViewClient
import com.amthalgroup.portal.internal.optStringOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONTokener

/**
 * The embeddable Amthal Client Portal view.
 *
 * ```
 * val portal = AmthalPortalView(context)
 * portal.attachActivityResultRegistry(activityResultRegistry) // file uploads
 * portal.start(config, PortalRequest.NewApplication("external", 42), auth, listener)
 * ```
 *
 * State machine: IDLE -> FETCHING_MANIFEST -> LOADING -> HANDSHAKING -> READY,
 * with ERROR (retriable via the interstitial / connectivity watcher) and
 * DESTROYED as terminal-ish states.
 *
 * File uploads: `WebChromeClient.onShowFileChooser` needs an activity-result
 * launcher. [PortalFormActivity] and [PortalFormFragment] wire this up
 * automatically; a bare view host must call [attachActivityResultRegistry]
 * (any time before the first upload) or [attachActivityResultCaller]
 * (Fragments must call it before they are created).
 */
class AmthalPortalView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    private enum class State { IDLE, FETCHING_MANIFEST, LOADING, HANDSHAKING, READY, ERROR, DESTROYED }

    private var state = State.IDLE
    private var config: PortalConfig? = null
    private var request: PortalRequest? = null
    private var auth: PortalAuth? = null
    private var listener: AmthalPortalListener? = null

    // Mutable runtime configure values (seeded from config in start()).
    private var currentLocale: PortalLocale = PortalLocale.EN
    private var currentTheme: PortalTheme = PortalTheme.SYSTEM
    private var currentFontScale: Float = 1f

    private var webView: WebView? = null
    private var bridge: BridgeController? = null
    private var downloadHandler: DownloadHandler? = null
    private val fileChooserHandler = FileChooserHandler(context)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var loadingView: View? = null
    private var errorView: View? = null
    private var lastError: PortalError? = null
    private var recreatedAfterRenderCrash = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // ------------------------------------------------------------------ public API

    /**
     * Starts the session: manifest fetch + version gate, then loads
     * `baseUrl + request.toPath()` (base-path aware) and performs the
     * bridge handshake.
     * May only be called once per view instance.
     */
    fun start(
        config: PortalConfig,
        request: PortalRequest,
        auth: PortalAuth,
        listener: AmthalPortalListener
    ) {
        check(state == State.IDLE) { "start() may only be called once" }
        this.config = config
        this.request = request
        this.auth = auth
        this.listener = listener
        currentLocale = config.locale
        currentTheme = config.theme
        currentFontScale = config.fontScale
        downloadHandler = DownloadHandler(context, config, scope) { error ->
            mainHandler.post { this.listener?.onPortalError(error) }
        }
        registerConnectivityWatcher()
        beginLoad()
    }

    /**
     * Hands fresh credentials to the portal (`auth` bridge message). Also
     * dismisses the session-expired interstitial if one is showing.
     */
    fun updateAuth(auth: PortalAuth) {
        this.auth = auth
        if (state == State.ERROR && lastError?.code == PortalErrorCode.AUTH_EXPIRED) {
            hideError()
            state = State.READY
        }
        bridge?.sendAuth()
    }

    /** Re-applies locale/theme/fontScale at runtime (`configure` bridge message). */
    fun updateConfigure(
        locale: PortalLocale? = null,
        theme: PortalTheme? = null,
        fontScale: Float? = null
    ) {
        locale?.let { currentLocale = it }
        theme?.let { currentTheme = it }
        fontScale?.let {
            require(it > 0f) { "fontScale must be > 0" }
            currentFontScale = it
        }
        bridge?.sendConfigure()
    }

    /**
     * Hardware-back contract (SPEC.md `backPressed`). Returns `true`
     * immediately when a bridge session is active and dispatches `backPressed`
     * to the web; if the web answers `{handled:false}` (or times out after
     * 10 s) the view calls [AmthalPortalListener.onCloseRequested].
     * Returns `false` when there is no active session — the caller should
     * apply its default back behavior.
     */
    fun onBackPressed(): Boolean {
        val b = bridge ?: return false
        if (state != State.READY && state != State.HANDSHAKING) return false
        b.requestBackPressed { handled ->
            if (!handled && state != State.DESTROYED) listener?.onCloseRequested()
        }
        return true
    }

    /**
     * Tears the session down: sends `destroy`, waits up to 1 s for the ack,
     * clears WebView storage/cookies (best-effort, global — the system WebView
     * has no reliable per-origin purge), and releases the WebView.
     */
    fun destroy() {
        if (state == State.DESTROYED) return
        state = State.DESTROYED
        unregisterConnectivityWatcher()
        val b = bridge
        if (b != null && webView != null) {
            b.sendDestroy { finishDestroy() }
        } else {
            finishDestroy()
        }
    }

    /**
     * Enables file uploads by registering an activity-result launcher on
     * [registry]. Safe to call at any point before the first upload; the
     * registration is released in [destroy].
     */
    fun attachActivityResultRegistry(registry: ActivityResultRegistry) {
        fileChooserHandler.attachRegistry(registry)
    }

    /**
     * Enables file uploads through an [ActivityResultCaller]. NOTE: Fragments
     * must call this before they are created (init / onAttach / onCreate);
     * Activities may call it up to onStart. Prefer
     * [attachActivityResultRegistry] when in doubt.
     */
    fun attachActivityResultCaller(caller: ActivityResultCaller) {
        fileChooserHandler.attachCaller(caller)
    }

    // ------------------------------------------------------------------ load pipeline

    private fun beginLoad() {
        val config = config ?: return
        if (state == State.DESTROYED) return
        hideError()
        showLoading()
        state = State.FETCHING_MANIFEST
        scope.launch {
            val result = ManifestClient.fetchAndGate(config)
            if (state != State.FETCHING_MANIFEST) return@launch
            when (result) {
                is ManifestClient.Result.Success -> loadPortal()
                is ManifestClient.Result.Failure -> fail(result.error)
            }
        }
    }

    private fun loadPortal() {
        val config = config ?: return
        val request = request ?: return
        if (webView == null) createWebView(config)
        state = State.LOADING
        webView?.loadUrl(config.normalizedBaseUrl + request.toPath())
    }

    private fun createWebView(config: PortalConfig) {
        val viewClient = PortalWebViewClient(config, webClientEvents)
        val chromeClient = PortalWebChromeClient(config, fileChooserHandler)
        val wv = HardenedWebViewFactory.create(context, viewClient, chromeClient)
        val b = BridgeController(wv, config, bridgeHost)
        // The JS interface MUST be installed before any loadUrl (SPEC.md §2.2).
        wv.addJavascriptInterface(b.jsInterface, BridgeProtocol.JS_INTERFACE_NAME)
        wv.setDownloadListener { url, _, contentDisposition, mimetype, _ ->
            downloadHandler?.download(
                url,
                URLUtil.guessFileName(url, contentDisposition, mimetype),
                mimetype,
                emptyMap()
            )
        }
        addView(wv, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        webView = wv
        bridge = b
    }

    private fun fail(error: PortalError) {
        if (state == State.DESTROYED) return
        state = State.ERROR
        lastError = error
        hideLoading()
        showError(error)
        listener?.onPortalError(error)
    }

    // ------------------------------------------------------------------ WebViewClient events

    private val webClientEvents = object : PortalWebViewClient.Events {
        override fun onPageStartedMainFrame() {
            bridge?.onPageStarted()
        }

        override fun onPageFinishedMainFrame() {
            if (state == State.LOADING || state == State.HANDSHAKING) {
                bridge?.startHelloTimeout()
            }
        }

        override fun onBlockedNavigation(url: String) {
            handleOpenExternal(url)
        }

        override fun onMainFrameError(code: PortalErrorCode, message: String?, httpStatus: Int?) {
            if (state == State.LOADING || state == State.HANDSHAKING || state == State.FETCHING_MANIFEST) {
                fail(PortalError(code, message, httpStatus))
            } else if (state == State.READY) {
                // In-session main-frame failure (e.g. a reload that broke).
                fail(PortalError(code, message, httpStatus))
            }
        }

        override fun onRenderProcessGone(crashed: Boolean) {
            tearDownWebView()
            if (!recreatedAfterRenderCrash && state != State.DESTROYED) {
                recreatedAfterRenderCrash = true
                beginLoad()
            } else if (state != State.DESTROYED) {
                fail(
                    PortalError(
                        PortalErrorCode.WEB_PROCESS_TERMINATED,
                        "WebView render process terminated"
                    )
                )
            }
        }
    }

    // ------------------------------------------------------------------ bridge host

    private val bridgeHost = object : BridgeController.Host {
        override fun buildConfigurePayload(): JSONObject {
            val payload = JSONObject()
            payload.put("locale", currentLocale.wire)
            payload.put("theme", currentTheme.wire)
            payload.put("fontScale", currentFontScale.toDouble())
            return payload
        }

        override fun buildAuthPayload(): JSONObject {
            val payload = JSONObject()
            val a = auth
            payload.put("token", a?.token ?: "")
            a?.branchId?.let { payload.put("branchId", it) }
            a?.userJson?.let { raw ->
                try {
                    payload.put("user", JSONTokener(raw).nextValue())
                } catch (_: Exception) {
                    // Invalid userJson — omit; the portal reconstructs the user itself.
                }
            }
            return payload
        }

        override fun onHello(portalVersion: String) {
            if (state == State.LOADING) state = State.HANDSHAKING
        }

        override fun onReady(portalVersion: String) {
            if (state == State.DESTROYED) return
            state = State.READY
            hideLoading()
            hideError()
            listener?.onPortalReady(portalVersion)
        }

        override fun onAuthExpired(reason: String?) {
            if (state == State.DESTROYED) return
            state = State.ERROR
            val error = PortalError(PortalErrorCode.AUTH_EXPIRED, reason)
            lastError = error
            hideLoading()
            showError(error)
            listener?.onPortalError(error)
        }

        override fun onFormSubmitted(payload: JSONObject?) {
            listener?.onFormSubmitted(FormSubmitResult.fromPayload(payload))
        }

        override fun onFormCancelled() {
            listener?.onFormCancelled()
        }

        override fun onNavigate(path: String, title: String?) {
            listener?.onNavigate(path, title)
        }

        override fun onOpenExternal(url: String) {
            handleOpenExternal(url)
        }

        override fun onDownloadRequest(payload: JSONObject) {
            val url = payload.optString("url", "")
            if (url.isEmpty()) return
            val headers = HashMap<String, String>()
            payload.optJSONObject("headers")?.let { json ->
                val keys = json.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    json.optStringOrNull(key)?.let { headers[key] = it }
                }
            }
            downloadHandler?.download(
                url,
                payload.optStringOrNull("filename"),
                payload.optStringOrNull("mime"),
                headers
            )
        }

        override fun onBridgeTimeout() {
            fail(
                PortalError(
                    PortalErrorCode.BRIDGE_TIMEOUT,
                    "Portal page loaded but no bridge hello arrived within 15s"
                )
            )
        }
    }

    // ------------------------------------------------------------------ external links

    private fun handleOpenExternal(url: String) {
        if (listener?.onOpenExternal(url) == true) return
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            // Hint browsers to present as a Custom Tab (no androidx.browser needed).
            val extras = Bundle()
            extras.putBinder("android.support.customtabs.extra.SESSION", null)
            intent.putExtras(extras)
            if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // No browser installed — nothing sensible to do.
        }
    }

    // ------------------------------------------------------------------ connectivity

    private fun registerConnectivityWatcher() {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                mainHandler.post {
                    val code = lastError?.code
                    if (state == State.ERROR && code != null && code in RETRIABLE_ON_RECONNECT) {
                        beginLoad()
                    }
                }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: Exception) {
            // Too many callbacks / missing permission — auto-retry silently unavailable.
        }
    }

    private fun unregisterConnectivityWatcher() {
        val callback = networkCallback ?: return
        networkCallback = null
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        try {
            cm.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    // ------------------------------------------------------------------ teardown

    private fun tearDownWebView() {
        bridge?.shutdown()
        bridge = null
        webView?.let { wv ->
            wv.removeJavascriptInterface(BridgeProtocol.JS_INTERFACE_NAME)
            removeView(wv)
            wv.destroy()
        }
        webView = null
    }

    private fun finishDestroy() {
        bridge?.shutdown()
        bridge = null
        fileChooserHandler.detach()
        scope.cancel()
        webView?.let { wv ->
            wv.stopLoading()
            wv.removeJavascriptInterface(BridgeProtocol.JS_INTERFACE_NAME)
            removeView(wv)
            wv.destroy()
        }
        webView = null
        // Best-effort storage clearing (SPEC.md §2.3). The system WebView only
        // offers app-global clearing; acceptable because this WebView is the
        // SDK's only web surface unless the host app has its own.
        try {
            WebStorage.getInstance().deleteAllData()
        } catch (_: Exception) {
        }
        try {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
        } catch (_: Exception) {
        }
        mainHandler.removeCallbacksAndMessages(null)
        removeAllViews()
        loadingView = null
        errorView = null
        listener = null
    }

    // ------------------------------------------------------------------ interstitials

    private fun showLoading() {
        hideLoading()
        val container = FrameLayout(context)
        container.setBackgroundColor(themedBackgroundColor())
        val progress = ProgressBar(context)
        container.addView(
            progress,
            LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        )
        addView(container, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        loadingView = container
    }

    private fun hideLoading() {
        loadingView?.let { removeView(it) }
        loadingView = null
    }

    private fun showError(error: PortalError) {
        hideError()
        val container = LinearLayout(context)
        container.orientation = LinearLayout.VERTICAL
        container.gravity = Gravity.CENTER
        container.setBackgroundColor(themedBackgroundColor())
        val pad = dp(32)
        container.setPadding(pad, pad, pad, pad)
        // Swallow touches so the (possibly broken) page underneath is inert.
        container.isClickable = true

        val (titleRes, bodyRes) = when (error.code) {
            PortalErrorCode.OFFLINE ->
                R.string.amthal_portal_error_offline_title to R.string.amthal_portal_error_offline_body
            PortalErrorCode.VERSION_INCOMPATIBLE ->
                R.string.amthal_portal_error_version_title to R.string.amthal_portal_error_version_body
            PortalErrorCode.AUTH_EXPIRED ->
                R.string.amthal_portal_error_auth_title to R.string.amthal_portal_error_auth_body
            else ->
                R.string.amthal_portal_error_load_title to R.string.amthal_portal_error_load_body
        }

        val title = TextView(context)
        title.setText(titleRes)
        title.textSize = 18f
        title.setTypeface(title.typeface, android.graphics.Typeface.BOLD)
        title.gravity = Gravity.CENTER
        container.addView(
            title,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        val body = TextView(context)
        body.setText(bodyRes)
        body.textSize = 14f
        body.alpha = 0.72f
        body.gravity = Gravity.CENTER
        val bodyLp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        bodyLp.topMargin = dp(8)
        container.addView(body, bodyLp)

        // AUTH_EXPIRED is resolved by the host via updateAuth() — no retry button.
        if (error.code != PortalErrorCode.AUTH_EXPIRED) {
            val retry = Button(context)
            retry.setText(R.string.amthal_portal_retry)
            retry.setOnClickListener { beginLoad() }
            val retryLp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            retryLp.topMargin = dp(20)
            container.addView(retry, retryLp)
        }

        addView(container, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        errorView = container
    }

    private fun hideError() {
        errorView?.let { removeView(it) }
        errorView = null
    }

    private fun themedBackgroundColor(): Int {
        val tv = TypedValue()
        val resolved = context.theme.resolveAttribute(android.R.attr.colorBackground, tv, true)
        return if (resolved && tv.type >= TypedValue.TYPE_FIRST_COLOR_INT &&
            tv.type <= TypedValue.TYPE_LAST_COLOR_INT
        ) {
            tv.data
        } else {
            Color.WHITE
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private companion object {
        private val RETRIABLE_ON_RECONNECT = setOf(
            PortalErrorCode.OFFLINE,
            PortalErrorCode.LOAD_FAILED,
            PortalErrorCode.HTTP_ERROR,
            PortalErrorCode.MANIFEST_FAILED,
            PortalErrorCode.BRIDGE_TIMEOUT
        )
    }
}
