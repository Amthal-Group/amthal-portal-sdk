package com.amthalgroup.portal

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.Fragment
import com.amthalgroup.portal.internal.PortalSession
import com.amthalgroup.portal.internal.PortalSessionStore

/**
 * Full-screen convenience Fragment hosting an [AmthalPortalView].
 *
 * Handoff pattern: [AmthalPortalListener] (and the config's certificate
 * pinner) are not parcelable, so [newInstance] stores the whole session in an
 * in-memory [PortalSessionStore] and only a lookup key travels in the
 * arguments. The session survives configuration changes (the store is
 * process-wide) but NOT process death — on recreation after process death the
 * fragment finds no session and removes itself.
 *
 * Hardware back is routed through [AmthalPortalView.onBackPressed]
 * (`backPressed` bridge round-trip); when the web declines, the wrapped
 * listener's [AmthalPortalListener.onCloseRequested] fires and this fragment
 * removes itself. File-chooser wiring is automatic.
 */
class PortalFormFragment : Fragment() {

    companion object {
        private const val ARG_SESSION_KEY = "com.amthalgroup.portal.SESSION_KEY"

        @JvmStatic
        fun newInstance(
            config: PortalConfig,
            request: PortalRequest,
            auth: PortalAuth,
            listener: AmthalPortalListener
        ): PortalFormFragment {
            val key = PortalSessionStore.put(PortalSession(config, request, auth, listener))
            val fragment = PortalFormFragment()
            fragment.arguments = Bundle().apply { putString(ARG_SESSION_KEY, key) }
            return fragment
        }
    }

    private var portalView: AmthalPortalView? = null
    private var sessionKey: String? = null

    /** Forwards fresh credentials after an AUTH_EXPIRED error. */
    fun updateAuth(auth: PortalAuth) {
        portalView?.updateAuth(auth)
    }

    /** Re-applies locale/theme/fontScale at runtime. */
    fun updateConfigure(
        locale: PortalLocale? = null,
        theme: PortalTheme? = null,
        fontScale: Float? = null
    ) {
        portalView?.updateConfigure(locale, theme, fontScale)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionKey = arguments?.getString(ARG_SESSION_KEY)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        val view = AmthalPortalView(requireContext())
        // Register on the activity's registry: valid at any lifecycle point,
        // unregistered in AmthalPortalView.destroy().
        view.attachActivityResultRegistry(requireActivity().activityResultRegistry)
        portalView = view
        return view
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val session = sessionKey?.let { PortalSessionStore.get(it) }
        if (session == null) {
            // Process death: the in-memory session is gone; close quietly.
            parentFragmentManager.beginTransaction().remove(this).commitAllowingStateLoss()
            return
        }
        val self = this
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
                if (self.isAdded) {
                    self.parentFragmentManager.beginTransaction()
                        .remove(self)
                        .commitAllowingStateLoss()
                }
            }
        }
        portalView?.start(session.config, session.request, session.auth, wrapped)

        requireActivity().onBackPressedDispatcher.addCallback(
            viewLifecycleOwner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (portalView?.onBackPressed() != true) {
                        isEnabled = false
                        requireActivity().onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        )
    }

    override fun onDestroyView() {
        portalView?.destroy()
        portalView = null
        super.onDestroyView()
    }

    override fun onDestroy() {
        // Drop the session when the fragment is going away for real (not a
        // configuration change).
        if (isRemoving || activity?.isFinishing == true) {
            sessionKey?.let { PortalSessionStore.remove(it) }
        }
        super.onDestroy()
    }
}
