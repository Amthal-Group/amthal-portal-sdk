/**
 * Amthal Bridge Protocol v1
 * =========================
 * The single source of truth for every message exchanged between a native
 * host SDK (iOS / Android / React Native / Flutter) and the Angular Client
 * Portal running in an embedded WebView.
 *
 * Native implementations MUST mirror these shapes exactly. Any change to this
 * file is a protocol change and requires a SPEC.md PR first.
 */

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

/**
 * Path prefix under which all embeddable portal routes live — RELATIVE TO THE
 * PORTAL BASE URL, which may itself include a path (the portal deploys under
 * a baseHref such as `/portal/`). Use resolveEmbedUrl/isEmbedPath below; never
 * compare a full URL's path against this constant directly.
 */
export const EMBED_PATH_PREFIX = '/embed';

/** Location of the version-handshake manifest, relative to the portal BASE URL. */
export const MANIFEST_PATH = '/embed/manifest.json';

/**
 * Path component of a base URL, without trailing slash ('' when root).
 * e.g. 'https://host/portal/' -> '/portal', 'https://host' -> ''.
 */
export function basePathOf(baseUrl: string): string {
  const path = new URL(baseUrl).pathname;
  return path === '/' ? '' : path.replace(/\/+$/, '');
}

/**
 * True when `path` (a URL path component) is within the embed subtree of a
 * portal deployed at `basePath` (the value from basePathOf). This is the
 * check every SDK MUST use for main-frame navigation confinement.
 */
export function isEmbedPath(path: string, basePath: string): boolean {
  const prefix = basePath + EMBED_PATH_PREFIX;
  return path === prefix || path.startsWith(prefix + '/');
}

/** Full URL for a request against a base URL that may include a path prefix. */
export function resolveEmbedUrl(baseUrl: string, request: PortalFormRequest): string {
  return baseUrl.replace(/\/+$/, '') + requestToPath(request);
}

/** Full manifest URL for a base URL that may include a path prefix. */
export function manifestUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + MANIFEST_PATH;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * Every message in either direction is a JSON-serialized BridgeEnvelope.
 *
 * Transport:
 *  - web -> native: the web shim serializes the envelope and hands the string
 *    to whichever native hook is present (see web.ts).
 *  - native -> web: the native side serializes the envelope to a JSON string,
 *    then embeds that string as a *JSON-quoted JS string literal* in:
 *        window.__amthalReceive(<quoted-json>)
 *    (i.e. serialize the envelope, then JSON-encode the resulting string —
 *    this guarantees correct escaping on every platform).
 */
export interface BridgeEnvelope<TType extends MessageType = MessageType, TPayload = unknown> {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  /** Unique id of this message (uuid v4 or equivalent). */
  id: string;
  /** When this message answers a request, the id of that request. */
  replyTo?: string;
  type: TType;
  payload?: TPayload;
}

// ---------------------------------------------------------------------------
// Message catalog
// ---------------------------------------------------------------------------

/** Messages sent by the WEB (portal) to the NATIVE host. */
export type WebToNativeType =
  | 'hello' // first message once the shim boots; native answers with `init`
  | 'ready' // Angular booted, auth applied, embed route resolved
  | 'authExpired' // token refresh failed inside the portal; host must send `auth`
  | 'formSubmitted'
  | 'formCancelled'
  | 'navigate' // informational route change inside /embed/*
  | 'openExternal' // host should open URL outside the WebView
  | 'downloadRequest' // host should download + natively preview a file
  | 'formOp' // form-delegation data op; host replies ack {FormOpResponsePayload}
  | 'haptic'
  | 'log'
  | 'ack';

/** Messages sent by the NATIVE host to the WEB (portal). */
export type NativeToWebType =
  | 'init' // answer to `hello`; carries config + auth
  | 'auth' // (re)issue credentials at any time
  | 'configure' // re-apply locale/theme at runtime
  | 'backPressed' // Android hardware back; web replies ack {handled}
  | 'dismissRequested' // iOS swipe-dismiss guard; web replies ack {dirty}
  | 'destroy' // teardown: clear storage, abort requests
  | 'ack';

export type MessageType = WebToNativeType | NativeToWebType;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type PortalLocale = 'en' | 'ar';
export type PortalTheme = 'light' | 'dark' | 'system';
export type HostPlatform = 'ios' | 'android' | 'react-native' | 'flutter';

export interface ConfigurePayload {
  locale?: PortalLocale;
  theme?: PortalTheme;
  /** 1.0 = default. The portal maps this to a root font-size adjustment. */
  fontScale?: number;
}

export interface AuthPayload {
  /** Backend bearer token, exactly as the portal's auth.service expects. */
  token: string;
  branchId?: string | null;
  /**
   * Optional pre-built portal user object (the shape auth.service persists
   * under USER_KEY). When omitted the portal reconstructs it by calling its
   * profile endpoint with the token.
   */
  user?: unknown;
}

export interface HelloPayload {
  protocolVersion: number;
  portalVersion: string;
}

export interface InitPayload {
  sdkVersion: string;
  platform: HostPlatform;
  protocolVersion: number;
  configure: ConfigurePayload;
  auth: AuthPayload;
  /**
   * Host owns the form data plane: the portal routes every FormsService op
   * through `formOp` bridge requests instead of its own HTTP endpoints.
   * Additive protocol-v1 capability — absent/false keeps legacy behavior.
   */
  formDelegation?: boolean;
}

export interface ReadyPayload {
  portalVersion: string;
  protocolVersion: number;
}

export interface AuthExpiredPayload {
  reason?: string;
}

export interface FormSubmittedPayload {
  productID: number;
  applicationNo?: number | string;
  batchID?: number | string;
  headerID?: number | string;
  /** Anything else the portal wants to surface (opaque to the SDK). */
  raw?: unknown;
}

export interface NavigatePayload {
  path: string;
  title?: string;
}

export interface OpenExternalPayload {
  url: string;
}

export interface DownloadRequestPayload {
  url: string;
  filename?: string;
  mime?: string;
  /** Extra headers (e.g. Authorization) the host must attach. */
  headers?: Record<string, string>;
}

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'error';

export interface HapticPayload {
  style: HapticStyle;
}

export interface LogPayload {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

/** ack replying to `backPressed`. */
export interface BackHandledPayload {
  handled: boolean;
}

/** ack replying to `dismissRequested`. */
export interface DismissStatePayload {
  dirty: boolean;
}

/** Generic ack. `ok:false` carries a human-readable error. */
export interface AckPayload {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Form delegation (host-mediated form data plane)
//
// When the host declares `formDelegation: true` in `init`, the portal stops
// calling its own form HTTP endpoints inside /embed and instead sends every
// data operation as a `formOp` request; the host performs it against whatever
// API/plane/identity it owns (e.g. backoffice /DMS/Forms/* with a staff
// token, plus any per-login pre-entrance checks) and replies with the raw
// response body the portal's HTTP client would have received. The portal
// stays a pure renderer — no identity or plane logic in the web code.
// ---------------------------------------------------------------------------

/** Data operations the portal can delegate. Mirrors the portal `FormsApi`. */
export type FormOp =
  | 'getCategories'
  | 'getFormSchema'
  | 'getFormFields'
  | 'validateForm'
  | 'submitForm'
  | 'getWorkflowDetails'
  | 'submitFinalApproval'
  | 'submitForApproval';

/** One entry of a serialized multipart body: plain field or base64 file. */
export type SerializedFormEntry =
  | { key: string; value: string }
  | { key: string; file: { name: string; type: string; dataBase64: string } };

export interface FormOpRequestPayload {
  op: FormOp;
  /**
   * Route/product params the portal knows (productID, batchID, headerID,
   * workflowDetailID, isEdit, ...) as strings. The host augments them with
   * identity (userID / branch / token) and chooses the endpoint — the portal
   * never sends identity here.
   */
  params: Record<string, string>;
  /** Serialized multipart body for validateForm / submitForm. */
  entries?: SerializedFormEntry[];
  /** JSON body for ops that post JSON (submitForApproval). */
  body?: unknown;
}

/** ack replying to `formOp`. */
export interface FormOpResponsePayload {
  ok: boolean;
  /** Raw response body, exactly as the portal's HTTP layer would parse it. */
  body?: unknown;
  /** Human-readable error when ok=false (surfaced to the portal UI). */
  error?: string;
  /** Optional HTTP status for error mapping (401 triggers authExpired flow). */
  status?: number;
}

// ---------------------------------------------------------------------------
// Requests (what the host asks the portal to show)
// ---------------------------------------------------------------------------

export type PortalFormRequest =
  | { kind: 'newApplication'; type: string; productID: number }
  | {
      kind: 'existingApplication';
      type: string;
      productID: number;
      batchID: number | string;
      headerID: number | string;
      readOnly: boolean;
      /**
       * Workflow detail the document is being opened at, when it comes from an
       * approval inbox: it selects which field template the CURRENT signatory
       * sees. Travels as a QUERY parameter (see requestToPath) so the portal's
       * existing routes keep matching and an older portal ignores it.
       */
      workflowDetailID?: number | string;
    }
  /** Generic escape hatch: any path under /embed (leading slash optional). */
  | { kind: 'path'; path: string };

/**
 * Maps a request to its portal route. The SDK navigates the WebView directly
 * to `origin + requestToPath(request)`; the URL *is* the request. Never put
 * tokens or other credentials in this URL.
 */
export function requestToPath(request: PortalFormRequest): string {
  switch (request.kind) {
    case 'newApplication':
      return `${EMBED_PATH_PREFIX}/form/${encodeURIComponent(request.type)}/${request.productID}`;
    case 'existingApplication': {
      const path =
        `${EMBED_PATH_PREFIX}/form/${encodeURIComponent(request.type)}/${request.productID}` +
        `/${request.batchID}/${request.headerID}/${request.readOnly}`;
      // '0' is the portal's own "no workflow detail" default, so it is dropped
      // like an absent value — every ordinary form keeps the bare legacy path.
      const detail = String(request.workflowDetailID ?? '').trim();
      return !detail || detail === '0'
        ? path
        : `${path}?workflowDetailID=${encodeURIComponent(detail)}`;
    }
    case 'path': {
      const p = request.path.startsWith('/') ? request.path : `/${request.path}`;
      return p.startsWith(EMBED_PATH_PREFIX) ? p : `${EMBED_PATH_PREFIX}${p}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Manifest (version handshake — fetched by the SDK before loading any route)
// ---------------------------------------------------------------------------

export interface EmbedManifest {
  portalVersion: string;
  bridgeProtocolVersion: number;
  /** Oldest SDK version the portal still supports (semver), optional. */
  minSdkVersion?: string;
}

// ---------------------------------------------------------------------------
// SDK-side error codes (mirrored by every native SDK)
// ---------------------------------------------------------------------------

export type PortalErrorCode =
  | 'offline'
  | 'loadFailed'
  | 'httpError'
  | 'manifestFailed'
  | 'bridgeTimeout'
  | 'versionIncompatible'
  | 'authExpired'
  | 'webProcessTerminated';

// ---------------------------------------------------------------------------
// Timings (normative — see SPEC.md)
// ---------------------------------------------------------------------------

export const TIMINGS = {
  /** Native waits this long after page load for `hello` before bridgeTimeout. */
  helloTimeoutMs: 15_000,
  /** Web waits this long after `hello` for `init`, then re-sends `hello`. */
  initTimeoutMs: 10_000,
  /** Default timeout for any request/ack round-trip. */
  requestTimeoutMs: 10_000,
  /** Timeout for delegated form reads (`formOp` getFormFields etc.). */
  formOpTimeoutMs: 20_000,
  /** Timeout for delegated form writes (validate/submit, may carry files). */
  formSubmitTimeoutMs: 90_000,
} as const;

/** Compares dotted versions; returns -1 | 0 | 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
