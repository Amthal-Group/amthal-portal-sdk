package com.amthalgroup.portal

/**
 * Host-app callbacks for an embedded portal session. All methods are invoked
 * on the main thread.
 *
 * Every method except [onFormSubmitted] has a sensible default, so simple
 * hosts only implement what they care about.
 */
interface AmthalPortalListener {

    /** Bridge handshake completed; the portal UI is visible ([portalVersion] from `ready`). */
    fun onPortalReady(portalVersion: String) {}

    /**
     * The embedded form was submitted successfully. Per the bridge spec the
     * SDK never auto-closes on submission — the host decides what happens next.
     */
    fun onFormSubmitted(result: FormSubmitResult)

    /** The user exited the form without submitting (in-form close/finish affordance). */
    fun onFormCancelled() {}

    /**
     * A fatal or recoverable error occurred. For [PortalErrorCode.AUTH_EXPIRED]
     * obtain a fresh token and call [AmthalPortalView.updateAuth]; the SDK
     * shows an interstitial meanwhile. Retriable errors show a retry UI and
     * auto-retry when connectivity returns.
     */
    fun onPortalError(error: PortalError)

    /**
     * The portal asked to open [url] outside the WebView. Return `true` if the
     * host consumed it; the default (`false`) lets the SDK fire an
     * `ACTION_VIEW` intent (opens Custom Tabs when the default browser
     * supports it).
     */
    fun onOpenExternal(url: String): Boolean = false

    // Do not write the embed route as a glob here: Kotlin nests block comments, so a `/*`
    // inside KDoc opens a second one and the trailing `*/` closes only that — silently
    // swallowing the rest of the interface.
    /** Informational: the portal navigated within its `/embed` routes. */
    fun onNavigate(path: String, title: String?) {}

    /**
     * The web content declined to handle a back press (`backPressed` answered
     * `{handled:false}` or timed out). The host should close/dismiss the
     * portal UI. [PortalFormActivity] finishes itself on this callback.
     */
    fun onCloseRequested() {}
}
