package com.amthalgroup.portal

/**
 * Credentials handed to the portal over the bridge (`init.auth` / `auth`).
 * Credentials only ever travel in bridge messages — never in URLs.
 *
 * @param token backend bearer token, exactly as the portal's auth service expects.
 * @param branchId optional branch id the portal persists alongside the session.
 * @param userJson optional pre-built portal user object as a JSON string (the
 *   shape the portal persists under its `USER_KEY`). When omitted the portal
 *   reconstructs it from its profile endpoint using [token].
 */
data class PortalAuth(
    val token: String,
    val branchId: String? = null,
    val userJson: String? = null
) {
    /** Redact credentials from accidental logging. */
    override fun toString(): String =
        "PortalAuth(token=***, branchId=${if (branchId != null) "***" else "null"}, userJson=${if (userJson != null) "***" else "null"})"
}
