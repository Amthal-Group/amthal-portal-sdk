package com.amthalgroup.portal.internal

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Parcelable
import android.provider.MediaStore
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultCaller
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import com.amthalgroup.portal.R
import java.io.File
import java.util.UUID

/**
 * Implements `WebChromeClient.onShowFileChooser`: presents a chooser combining
 * the params' ACTION_GET_CONTENT intent with a camera capture intent
 * (MediaStore.ACTION_IMAGE_CAPTURE writing to a FileProvider temp file).
 *
 * Requires a launcher: [PortalFormActivity]/[PortalFormFragment] wire one
 * automatically; a bare [com.amthalgroup.portal.AmthalPortalView] host must
 * call `attachActivityResultRegistry(...)` (or `attachActivityResultCaller(...)`
 * early enough in its lifecycle — Fragments must register before creation).
 *
 * The WebView's callback is always invoked exactly once (null on cancel).
 */
internal class FileChooserHandler(private val context: Context) {

    private var launcher: ActivityResultLauncher<Intent>? = null
    private var ownsRegistration = false
    private var pendingCallback: ValueCallback<Array<Uri>>? = null
    private var cameraFile: File? = null
    private var cameraUri: Uri? = null

    /** Registers directly on a registry; the handler unregisters itself in [detach]. */
    fun attachRegistry(registry: ActivityResultRegistry) {
        detachLauncher()
        launcher = registry.register(
            "amthal_portal_file_chooser_" + UUID.randomUUID().toString(),
            ActivityResultContracts.StartActivityForResult()
        ) { result -> onResult(result) }
        ownsRegistration = true
    }

    /** Registers through an ActivityResultCaller (lifecycle-managed unregistration). */
    fun attachCaller(caller: ActivityResultCaller) {
        detachLauncher()
        launcher = caller.registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result -> onResult(result) }
        ownsRegistration = false
    }

    /** Cancels any pending chooser and releases the launcher. */
    fun detach() {
        resolve(null)
        detachLauncher()
    }

    /** Always returns true; the callback is resolved exactly once. */
    fun show(
        callback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams
    ): Boolean {
        // A second chooser while one is pending: cancel the first.
        resolve(null)

        val l = launcher
        if (l == null) {
            callback.onReceiveValue(null)
            return true
        }
        pendingCallback = callback
        val chooser = buildChooserIntent(params)
        try {
            l.launch(chooser)
        } catch (e: Exception) {
            // ActivityNotFoundException / IllegalStateException (unregistered)
            resolve(null)
        }
        return true
    }

    private fun buildChooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val contentIntent = params.createIntent()
        if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            contentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }

        cameraFile = null
        cameraUri = null
        val extraIntents = ArrayList<Parcelable>()
        val accepts = params.acceptTypes
            ?.filter { !it.isNullOrBlank() }
            ?: emptyList()
        val wantsImage = accepts.isEmpty() ||
            accepts.any { it == "*/*" || it.startsWith("image/") }
        if (wantsImage) {
            try {
                val dir = File(context.cacheDir, "amthal-portal-camera")
                dir.mkdirs()
                val file = File(dir, "capture_" + System.currentTimeMillis() + ".jpg")
                val uri = FileProvider.getUriForFile(
                    context,
                    context.packageName + FILE_PROVIDER_AUTHORITY_SUFFIX,
                    file
                )
                val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                camera.putExtra(MediaStore.EXTRA_OUTPUT, uri)
                // Grant flags apply to clipData, not extras — mirror the uri there.
                camera.clipData = ClipData.newRawUri("capture", uri)
                camera.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
                cameraFile = file
                cameraUri = uri
                extraIntents.add(camera)
            } catch (e: Exception) {
                // No FileProvider match or IO failure — camera option simply absent.
                cameraFile = null
                cameraUri = null
            }
        }

        val chooser = Intent.createChooser(
            contentIntent,
            context.getString(R.string.amthal_portal_file_chooser_title)
        )
        if (extraIntents.isNotEmpty()) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extraIntents.toTypedArray())
        }
        return chooser
    }

    private fun onResult(result: ActivityResult) {
        val camFile = cameraFile
        val camUri = cameraUri
        cameraFile = null
        cameraUri = null

        if (result.resultCode != Activity.RESULT_OK) {
            camFile?.delete()
            resolve(null)
            return
        }

        val uris = ArrayList<Uri>()
        val data = result.data
        val clip = data?.clipData
        if (clip != null) {
            for (i in 0 until clip.itemCount) {
                clip.getItemAt(i).uri?.let { uris.add(it) }
            }
        } else {
            data?.data?.let { uris.add(it) }
        }
        // Camera results come back with a null data intent.
        if (uris.isEmpty() && camUri != null && camFile != null && camFile.length() > 0L) {
            uris.add(camUri)
        }
        resolve(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private fun resolve(value: Array<Uri>?) {
        val cb = pendingCallback ?: return
        pendingCallback = null
        cb.onReceiveValue(value)
    }

    private fun detachLauncher() {
        val l = launcher
        launcher = null
        if (l != null && ownsRegistration) {
            try {
                l.unregister()
            } catch (_: Exception) {
            }
        }
        ownsRegistration = false
    }

    internal companion object {
        internal const val FILE_PROVIDER_AUTHORITY_SUFFIX = ".amthalportal.fileprovider"
    }
}
