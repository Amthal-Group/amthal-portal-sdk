package com.amthalgroup.portal.internal

import com.amthalgroup.portal.AmthalPortalListener
import com.amthalgroup.portal.PortalAuth
import com.amthalgroup.portal.PortalConfig
import com.amthalgroup.portal.PortalRequest
import java.util.UUID

/** Everything needed to start a portal session in a wrapper component. */
internal class PortalSession(
    val config: PortalConfig,
    val request: PortalRequest,
    val auth: PortalAuth,
    val listener: AmthalPortalListener
)

/**
 * In-memory handoff for [PortalSession]s. Listeners are not parcelable, so the
 * convenience wrappers (PortalFormActivity / PortalFormFragment) pass only a
 * key through the Intent/arguments and look the session up here.
 *
 * Consequence: sessions do NOT survive process death — the wrappers detect the
 * missing session on recreation and close themselves.
 */
internal object PortalSessionStore {

    private val sessions = HashMap<String, PortalSession>()

    @Synchronized
    fun put(session: PortalSession): String {
        val key = UUID.randomUUID().toString()
        sessions[key] = session
        return key
    }

    @Synchronized
    fun get(key: String): PortalSession? = sessions[key]

    @Synchronized
    fun remove(key: String) {
        sessions.remove(key)
    }
}
