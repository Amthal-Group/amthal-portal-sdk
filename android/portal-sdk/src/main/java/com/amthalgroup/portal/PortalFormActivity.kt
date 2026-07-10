package com.amthalgroup.portal

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import com.amthalgroup.portal.internal.PortalSession
import com.amthalgroup.portal.internal.PortalSessionStore

/**
 * Full-screen convenience Activity hosting an [AmthalPortalView].
 *
 * ```
 * PortalFormActivity.start(context, config, request, auth, listener)
 * ```
 *
 * Handoff pattern: listeners are not parcelable, so the session (config,
 * request, auth, listener) is stashed in an in-memory store and only a lookup
 * key travels in the Intent. The session survives configuration changes but
 * NOT process death — after process death the activity finds no session and
 * finishes immediately.
 *
 * Behavior: hardware back goes through the `backPressed` bridge round-trip;
 * when the web declines ([AmthalPortalListener.onCloseRequested]) the activity
 * calls the host listener and then finishes. It does NOT auto-finish on
 * formSubmitted/formCancelled (per SPEC — the host decides); finish it from
 * your listener when appropriate.
 */
class PortalFormActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_SESSION_KEY = "com.amthalgroup.portal.SESSION_KEY"

        @JvmStatic
        fun start(
            context: Context,
            config: PortalConfig,
            request: PortalRequest,
            auth: PortalAuth,
            listener: AmthalPortalListener
        ) {
            val key = PortalSessionStore.put(PortalSession(config, request, auth, listener))
            val intent = Intent(context, PortalFormActivity::class.java)
            intent.putExtra(EXTRA_SESSION_KEY, key)
            if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    private var portalView: AmthalPortalView? = null
    private var sessionKey: String? = null

    /** Forwards fresh credentials after an AUTH_EXPIRED error. */
    fun updateAuth(auth: PortalAuth) {
        portalView?.updateAuth(auth)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionKey = intent.getStringExtra(EXTRA_SESSION_KEY)
        val session = sessionKey?.let { PortalSessionStore.get(it) }
        if (session == null) {
            finish()
            return
        }

        val view = AmthalPortalView(this)
        view.attachActivityResultRegistry(activityResultRegistry)
        portalView = view
        setContentView(view)

        val wrapped = object : AmthalPortalListener {
            override fun onPortalReady(portalVersion: String) =
                session.listener.onPortalReady(portalVersion)

            override fun onFormSubmitted(result: FormSubmitResult) =
                session.listener.onFormSubmitted(result)

            override fun onFormCancelled() = session.listener.onFormCancelled()

            override fun onPortalError(error: PortalError) =
                session.listener.onPortalError(error)

            override fun onOpenExternal(url: String): Boolean =
                session.listener.onOpenExternal(url)

            override fun onNavigate(path: String, title: String?) =
                session.listener.onNavigate(path, title)

            override fun onCloseRequested() {
                session.listener.onCloseRequested()
                if (!isFinishing) finish()
            }
        }
        view.start(session.config, session.request, session.auth, wrapped)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (portalView?.onBackPressed() != true) {
                        if (!isFinishing) finish()
                    }
                }
            }
        )
    }

    override fun onDestroy() {
        portalView?.destroy()
        portalView = null
        if (isFinishing) {
            sessionKey?.let { PortalSessionStore.remove(it) }
        }
        super.onDestroy()
    }
}
