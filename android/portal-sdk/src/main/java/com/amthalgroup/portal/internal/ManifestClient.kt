package com.amthalgroup.portal.internal

import com.amthalgroup.portal.PortalConfig
import com.amthalgroup.portal.PortalError
import com.amthalgroup.portal.PortalErrorCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection

/**
 * Fetches `GET {baseUrl}/embed/manifest.json` — against the FULL base URL
 * including any deploy path prefix (SPEC.md §2.3 "Base path awareness",
 * protocol.ts `manifestUrl()`) — and applies the version gate (SPEC.md §5).
 * No auth is attached to this request.
 */
internal object ManifestClient {

    internal data class Manifest(
        val portalVersion: String,
        val bridgeProtocolVersion: Int,
        val minSdkVersion: String?
    )

    internal sealed class Result {
        data class Success(val manifest: Manifest) : Result()
        data class Failure(val error: PortalError) : Result()
    }

    suspend fun fetchAndGate(config: PortalConfig): Result = withContext(Dispatchers.IO) {
        val raw = try {
            httpGet(config, config.normalizedBaseUrl + BridgeProtocol.MANIFEST_PATH)
        } catch (e: HttpStatusException) {
            return@withContext Result.Failure(
                PortalError(PortalErrorCode.MANIFEST_FAILED, "Manifest request failed (HTTP ${e.status})", e.status)
            )
        } catch (e: Exception) {
            return@withContext Result.Failure(
                PortalError(PortalErrorCode.MANIFEST_FAILED, e.message ?: "Manifest request failed")
            )
        }

        val manifest = try {
            val json = JSONObject(raw)
            Manifest(
                portalVersion = json.optString("portalVersion", ""),
                bridgeProtocolVersion = json.optInt("bridgeProtocolVersion", -1),
                minSdkVersion = json.optStringOrNull("minSdkVersion")
            )
        } catch (e: JSONException) {
            return@withContext Result.Failure(
                PortalError(PortalErrorCode.MANIFEST_FAILED, "Manifest is not valid JSON")
            )
        }

        gate(config, manifest)?.let { return@withContext Result.Failure(it) }
        Result.Success(manifest)
    }

    /** Returns null when compatible; a VERSION_INCOMPATIBLE error otherwise. */
    private fun gate(config: PortalConfig, manifest: Manifest): PortalError? {
        if (manifest.bridgeProtocolVersion != BridgeProtocol.PROTOCOL_VERSION) {
            return PortalError(
                PortalErrorCode.VERSION_INCOMPATIBLE,
                "Portal speaks bridge protocol ${manifest.bridgeProtocolVersion}; SDK implements ${BridgeProtocol.PROTOCOL_VERSION}"
            )
        }
        val minPortal = config.minPortalVersion
        if (minPortal != null &&
            BridgeProtocol.compareVersions(manifest.portalVersion, minPortal) < 0
        ) {
            return PortalError(
                PortalErrorCode.VERSION_INCOMPATIBLE,
                "Portal ${manifest.portalVersion} is older than required minPortalVersion $minPortal"
            )
        }
        val minSdk = manifest.minSdkVersion
        if (minSdk != null &&
            BridgeProtocol.compareVersions(BridgeProtocol.SDK_VERSION, minSdk) < 0
        ) {
            return PortalError(
                PortalErrorCode.VERSION_INCOMPATIBLE,
                "SDK ${BridgeProtocol.SDK_VERSION} is older than portal's minSdkVersion $minSdk"
            )
        }
        return null
    }

    private class HttpStatusException(val status: Int) : IOException("HTTP $status")

    private fun httpGet(config: PortalConfig, url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.requestMethod = "GET"
        conn.setRequestProperty("Accept", "application/json")
        conn.instanceFollowRedirects = true
        try {
            conn.connect()
            verifyPinning(config, conn)
            val status = conn.responseCode
            if (status < 200 || status > 299) throw HttpStatusException(status)
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /** Applies the optional certificate pinning hook to an established connection. */
    internal fun verifyPinning(config: PortalConfig, conn: HttpURLConnection) {
        val pinner = config.certificatePinner ?: return
        if (conn is HttpsURLConnection) {
            val leaf = conn.serverCertificates.firstOrNull() as? X509Certificate
            if (leaf == null || !pinner(leaf)) {
                throw IOException("Certificate pinning check failed")
            }
        }
    }
}
