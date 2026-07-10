# Amthal Portal SDK — Android

Embeds the Amthal Client Portal (`/embed/*` surfaces — forms first) in any Android app via a hardened WebView and the **Amthal Bridge Protocol v1** (`../bridge/SPEC.md`). Kotlin, View-based (no Compose), minSdk 24, dependency-light: androidx.appcompat / activity / webkit + kotlinx-coroutines only. All networking uses `HttpURLConnection`; all JSON uses `org.json`.

## Installation

The library publishes to GitHub Packages as `com.amthalgroup:portal-sdk`.

```kotlin
// settings.gradle.kts of the consuming app
dependencyResolutionManagement {
    repositories {
        google(); mavenCentral()
        maven {
            url = uri("https://maven.pkg.github.com/amthal-group/portal-sdk")
            credentials {
                username = providers.gradleProperty("gpr.user").orNull ?: System.getenv("GITHUB_ACTOR")
                password = providers.gradleProperty("gpr.token").orNull ?: System.getenv("GITHUB_TOKEN")
            }
        }
    }
}

// build.gradle.kts (app)
dependencies {
    implementation("com.amthalgroup:portal-sdk:1.0.0")
}
```

> This repo ships no Gradle wrapper. To build locally, run `gradle wrapper --gradle-version 8.9` once (AGP 8.7 needs Gradle ≥ 8.9), then `./gradlew :portal-sdk:assembleRelease`.
> To publish: set `GITHUB_ACTOR` / `GITHUB_TOKEN` (and optionally `GITHUB_MAVEN_URL` to override the repo URL) and run `./gradlew :portal-sdk:publishReleasePublicationToGitHubPackagesRepository`.

## Quickstart

### Shared pieces

```kotlin
val config = PortalConfig(
    baseUrl = "https://portal.example.com",   // https required (http only for localhost/10.0.2.2)
    locale = PortalLocale.AR,
    theme = PortalTheme.SYSTEM,
    minPortalVersion = "1.3.0",               // optional version-handshake floor
)
val auth = PortalAuth(token = backendBearerToken, branchId = "12")
val request = PortalRequest.NewApplication(type = "external", productID = 42)
// or: PortalRequest.ExistingApplication("external", 42, batchID = "7", headerID = "991", readOnly = true)
// or: PortalRequest.Path("/statements")     // any /embed/* surface

val listener = object : AmthalPortalListener {
    override fun onFormSubmitted(result: FormSubmitResult) { /* host decides what happens next */ }
    override fun onPortalError(error: PortalError) {
        if (error.code == PortalErrorCode.AUTH_EXPIRED) {
            // refresh your token, then call updateAuth(...) on the view/fragment/activity
        }
    }
}
```

Credentials travel **only** over the bridge (`init`/`auth` messages) — never in URLs.

### 1. Full-screen Activity (fire-and-forget)

```kotlin
PortalFormActivity.start(context, config, request, auth, listener)
```

Because `AmthalPortalListener` is not parcelable, the session is handed to the activity through an **in-memory store** keyed by a UUID in the Intent. It survives rotation but not process death (the activity then finishes silently). The activity finishes itself on `onCloseRequested` (back press declined by the web) — it does **not** auto-finish on submit/cancel; do that from your listener if desired.

### 2. Fragment

```kotlin
supportFragmentManager.beginTransaction()
    .replace(R.id.container, PortalFormFragment.newInstance(config, request, auth, listener))
    .commit()
```

Same handoff pattern. Back handling and file-chooser wiring are automatic; call `fragment.updateAuth(...)` after refreshing a token.

### 3. Raw view (custom layouts)

```kotlin
val portal = AmthalPortalView(this)
portal.attachActivityResultRegistry(activityResultRegistry)   // enables <input type="file"> + camera
container.addView(portal)
portal.start(config, request, auth, listener)

// Hardware back (raw-view hosts must wire this themselves):
onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
        if (!portal.onBackPressed()) { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
    }
})

// When done:
portal.destroy()
```

## Back handling

`AmthalPortalView.onBackPressed()` implements the SPEC `backPressed` contract: it returns `true` immediately when a bridge session is active and asks the web page. If the web answers `{handled:false}` (or doesn't answer within 10 s), the SDK calls `listener.onCloseRequested()` — close your UI there. It returns `false` when no session is active (apply your default back behavior).

## File chooser & camera

`onShowFileChooser` presents a system chooser combining a documents picker with camera capture (`MediaStore.ACTION_IMAGE_CAPTURE` into a `FileProvider` temp file under `cacheDir/amthal-portal-camera/`). No `CAMERA` permission is required or declared — the camera *app* takes the picture.

- `PortalFormActivity` / `PortalFormFragment`: wired automatically.
- Raw `AmthalPortalView`: call `attachActivityResultRegistry(activityResultRegistry)` (works at any lifecycle point) or `attachActivityResultCaller(this)` (Fragments must call it before creation). Without one, file inputs resolve to "cancelled".

The library manifest ships the `FileProvider` under the authority `${applicationId}.amthalportal.fileprovider` — no host-app setup needed. If your app defines its own FileProvider, the authorities don't clash.

## Downloads

Bridge `downloadRequest` messages (and plain WebView downloads) are fetched with the payload's headers attached (values are never logged), stored under `cacheDir/amthal-portal/`, and opened via `ACTION_VIEW` + FileProvider with a chooser fallback. Failures surface as `PortalErrorCode.HTTP_ERROR` through `onPortalError`.

## Errors, offline & retry

`PortalErrorCode`: `OFFLINE`, `LOAD_FAILED`, `HTTP_ERROR`, `MANIFEST_FAILED`, `BRIDGE_TIMEOUT`, `VERSION_INCOMPATIBLE`, `AUTH_EXPIRED`, `WEB_PROCESS_TERMINATED`.

The view shows localized (EN/AR) interstitials with a retry button; a connectivity watcher auto-retries retriable errors when the network returns. `AUTH_EXPIRED` shows a "session expired" interstitial with no retry — resolve it with `updateAuth(freshAuth)`. Render-process death auto-recovers once before surfacing `WEB_PROCESS_TERMINATED`.

## Security notes

- Main-frame navigation is confined to the configured origin + `/embed/*`; anything else is cancelled and routed through `onOpenExternal` (default: external browser/Custom Tab).
- Every inbound bridge message and every native→web evaluation checks the WebView's current URL origin against the allowlist.
- File/content access off, mixed content never allowed, geolocation and media-permission prompts denied, Safe Browsing asserted where supported.
- `PortalConfig.certificatePinner` is applied to SDK-initiated HTTPS connections (manifest fetch, downloads). The portal page load itself uses the system WebView network stack, which exposes no pinning hook.
- `destroy()` sends the bridge `destroy` message (web clears its persisted auth), waits ≤ 1 s for the ack, then clears WebView storage/cookies best-effort and releases the WebView.

## ProGuard / R8

Nothing to do — `consumer-rules.pro` ships with the AAR and keeps the single `@JavascriptInterface` bridge object. The SDK adds `INTERNET` and `ACCESS_NETWORK_STATE` permissions (the latter powers the offline auto-retry).

## Logging

`PortalConfig(enableLogging = true)` forwards bridge `log` messages and WebView console output to Logcat. Leave it `false` (default) in release builds — the SDK then drops all web diagnostics, per SPEC.
