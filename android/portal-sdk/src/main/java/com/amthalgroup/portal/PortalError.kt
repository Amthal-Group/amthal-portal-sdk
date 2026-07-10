package com.amthalgroup.portal

/** SDK error codes. Wire values mirror `PortalErrorCode` in protocol.ts. */
enum class PortalErrorCode(val wire: String) {
    OFFLINE("offline"),
    LOAD_FAILED("loadFailed"),
    HTTP_ERROR("httpError"),
    MANIFEST_FAILED("manifestFailed"),
    BRIDGE_TIMEOUT("bridgeTimeout"),
    VERSION_INCOMPATIBLE("versionIncompatible"),
    AUTH_EXPIRED("authExpired"),
    WEB_PROCESS_TERMINATED("webProcessTerminated")
}

/**
 * An error surfaced through [AmthalPortalListener.onPortalError].
 *
 * @param httpStatus present for [PortalErrorCode.HTTP_ERROR] (and manifest
 *   fetches that failed with a non-2xx status).
 */
data class PortalError(
    val code: PortalErrorCode,
    val message: String? = null,
    val httpStatus: Int? = null
)
