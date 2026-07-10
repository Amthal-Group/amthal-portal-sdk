package com.amthalgroup.portal

import org.json.JSONObject

/**
 * Result of a successful form submission (bridge `formSubmitted`).
 * Mirrors `FormSubmittedPayload` in protocol.ts; `applicationNo` / `batchID` /
 * `headerID` are `number | string` on the wire and are normalized to strings.
 *
 * @param rawJson anything else the portal surfaced (`payload.raw`), serialized
 *   back to a JSON string; opaque to the SDK.
 */
data class FormSubmitResult(
    val productID: Int,
    val applicationNo: String? = null,
    val batchID: String? = null,
    val headerID: String? = null,
    val rawJson: String? = null
) {
    companion object {
        internal fun fromPayload(payload: JSONObject?): FormSubmitResult {
            if (payload == null) return FormSubmitResult(productID = 0)
            return FormSubmitResult(
                productID = payload.optInt("productID", 0),
                applicationNo = payload.stringable("applicationNo"),
                batchID = payload.stringable("batchID"),
                headerID = payload.stringable("headerID"),
                rawJson = payload.stringable("raw")
            )
        }

        private fun JSONObject.stringable(key: String): String? {
            val v = opt(key) ?: return null
            if (v === JSONObject.NULL) return null
            return v.toString()
        }
    }
}
