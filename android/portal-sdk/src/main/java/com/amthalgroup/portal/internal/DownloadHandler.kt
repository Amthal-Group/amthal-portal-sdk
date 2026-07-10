package com.amthalgroup.portal.internal

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import androidx.core.content.FileProvider
import com.amthalgroup.portal.PortalConfig
import com.amthalgroup.portal.PortalError
import com.amthalgroup.portal.PortalErrorCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Handles bridge `downloadRequest` messages and the WebView DownloadListener:
 * fetches the file with HttpURLConnection on a background dispatcher (with the
 * payload's headers attached — header values are never logged), writes it to
 * `cacheDir/amthal-portal/`, then presents it via FileProvider + ACTION_VIEW.
 *
 * Failures are surfaced through [onError] (HTTP_ERROR) — no toasts.
 */
internal class DownloadHandler(
    private val context: Context,
    private val config: PortalConfig,
    private val scope: CoroutineScope,
    private val onError: (PortalError) -> Unit
) {

    fun download(url: String, filename: String?, mime: String?, headers: Map<String, String>) {
        scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { fetchToFile(url, filename, mime, headers) }
                openFile(file, mime)
            } catch (e: HttpStatusException) {
                onError(PortalError(PortalErrorCode.HTTP_ERROR, "Download failed (HTTP ${e.status})", e.status))
            } catch (e: Exception) {
                onError(PortalError(PortalErrorCode.HTTP_ERROR, e.message ?: "Download failed"))
            }
        }
    }

    private class HttpStatusException(val status: Int) : IOException("HTTP $status")

    private fun fetchToFile(
        url: String,
        filename: String?,
        mime: String?,
        headers: Map<String, String>
    ): File {
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") {
            throw IOException("Unsupported download scheme")
        }

        val dir = File(context.cacheDir, "amthal-portal")
        dir.mkdirs()
        val name = sanitizeFilename(
            filename?.takeIf { it.isNotBlank() } ?: URLUtil.guessFileName(url, null, mime)
        )
        val target = File(dir, System.currentTimeMillis().toString() + "_" + name)

        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.requestMethod = "GET"
        conn.instanceFollowRedirects = true
        for ((key, value) in headers) {
            conn.setRequestProperty(key, value)
        }
        try {
            conn.connect()
            ManifestClient.verifyPinning(config, conn)
            val status = conn.responseCode
            if (status < 200 || status > 299) throw HttpStatusException(status)
            conn.inputStream.use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            }
        } catch (e: Exception) {
            target.delete()
            throw e
        } finally {
            conn.disconnect()
        }
        return target
    }

    /** Main thread (scope is Main-dispatched). */
    private fun openFile(file: File, mime: String?) {
        val uri = FileProvider.getUriForFile(
            context,
            context.packageName + FileChooserHandler.FILE_PROVIDER_AUTHORITY_SUFFIX,
            file
        )
        val resolvedMime = mime?.takeIf { it.isNotBlank() } ?: guessMime(file.name)
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, resolvedMime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (context !is Activity) view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(view)
        } catch (e: ActivityNotFoundException) {
            val chooser = Intent.createChooser(view, null)
            if (context !is Activity) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(chooser)
            } catch (e2: ActivityNotFoundException) {
                onError(PortalError(PortalErrorCode.HTTP_ERROR, "No app available to open the downloaded file"))
            }
        }
    }

    private fun guessMime(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        if (ext.isEmpty()) return "application/octet-stream"
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            ?: "application/octet-stream"
    }

    private fun sanitizeFilename(raw: String): String {
        val cleaned = raw.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").trim()
        val safe = cleaned.ifEmpty { "download" }
        return if (safe.length > 120) safe.takeLast(120) else safe
    }
}
