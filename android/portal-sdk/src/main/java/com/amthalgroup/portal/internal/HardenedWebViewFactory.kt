package com.amthalgroup.portal.internal

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.Uri
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.amthalgroup.portal.PortalConfig
import com.amthalgroup.portal.PortalErrorCode

/**
 * Creates WebViews hardened per SPEC.md §2.3: no file/content access, mixed
 * content never allowed, geolocation off, single JS interface (added by the
 * caller), main-frame navigation confined to the portal origin + the
 * `basePath + /embed` subtree (base-path aware, SPEC.md §2.3).
 */
internal object HardenedWebViewFactory {

    @SuppressLint("SetJavaScriptEnabled")
    fun create(
        context: Context,
        viewClient: WebViewClient,
        chromeClient: WebChromeClient
    ): WebView {
        val webView = WebView(context)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        // Safe Browsing is on by default (Android 8+); assert it where supported.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(webView.settings, true)
        }
        webView.webViewClient = viewClient
        webView.webChromeClient = chromeClient
        return webView
    }
}

/**
 * WebViewClient enforcing the navigation policy and mapping load failures to
 * SDK error codes. All callbacks arrive on the main thread.
 */
internal class PortalWebViewClient(
    private val config: PortalConfig,
    private val events: Events
) : WebViewClient() {

    internal interface Events {
        fun onPageStartedMainFrame()
        fun onPageFinishedMainFrame()

        /** A disallowed main-frame navigation was cancelled; route through openExternal. */
        fun onBlockedNavigation(url: String)

        fun onMainFrameError(code: PortalErrorCode, message: String?, httpStatus: Int?)

        /** Renderer died. Implementations recreate once, then surface WEB_PROCESS_TERMINATED. */
        fun onRenderProcessGone(crashed: Boolean)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        val uri = request.url
        val allowed = config.isUrlOriginAllowed(uri.toString()) &&
            BridgeProtocol.isEmbedPath(uri.path ?: "/", config.basePath)
        if (allowed) return false
        events.onBlockedNavigation(uri.toString())
        return true
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        events.onPageStartedMainFrame()
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        events.onPageFinishedMainFrame()
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        super.onReceivedError(view, request, error)
        if (!request.isForMainFrame) return
        val code = when (error.errorCode) {
            ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_TIMEOUT -> PortalErrorCode.OFFLINE
            else -> PortalErrorCode.LOAD_FAILED
        }
        events.onMainFrameError(code, error.description?.toString(), null)
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse
    ) {
        super.onReceivedHttpError(view, request, errorResponse)
        if (!request.isForMainFrame) return
        events.onMainFrameError(
            PortalErrorCode.HTTP_ERROR,
            "Main frame returned HTTP ${errorResponse.statusCode}",
            errorResponse.statusCode
        )
    }

    // Only invoked on API 26+; safe to override with minSdk 24.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        events.onRenderProcessGone(crashed = true)
        // true = we handled it (the view gets destroyed); false would kill the app process.
        return true
    }
}

/**
 * WebChromeClient: file chooser via [FileChooserHandler], console dropped
 * unless logging is enabled, geolocation and runtime media permissions denied.
 */
internal class PortalWebChromeClient(
    private val config: PortalConfig,
    private val fileChooser: FileChooserHandler
) : WebChromeClient() {

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams
    ): Boolean = fileChooser.show(filePathCallback, fileChooserParams)

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        if (config.enableLogging) {
            Log.d(
                "AmthalPortal",
                "[console:${consoleMessage.messageLevel()}] ${consoleMessage.message()} " +
                    "(${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
            )
        }
        return true // consumed — never forwarded to the system log in release
    }

    override fun onGeolocationPermissionsShowPrompt(
        origin: String?,
        callback: GeolocationPermissions.Callback?
    ) {
        callback?.invoke(origin, false, false)
    }

    override fun onPermissionRequest(request: PermissionRequest?) {
        request?.deny()
    }
}
