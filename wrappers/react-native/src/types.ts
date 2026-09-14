/**
 * Public types of @amthal-group/portal-react-native.
 *
 * Protocol shapes are re-exported verbatim from @amthal-group/portal-bridge —
 * the single source of truth for Amthal Bridge Protocol v1. Wrapper-specific
 * types (config, auth state, error info) live below.
 */

// ---------------------------------------------------------------------------
// Protocol re-exports (canonical definitions in @amthal-group/portal-bridge)
// ---------------------------------------------------------------------------

export type {
  AckPayload,
  AuthExpiredPayload,
  AuthPayload,
  BackHandledPayload,
  BridgeEnvelope,
  ConfigurePayload,
  DismissStatePayload,
  DownloadRequestPayload,
  EmbedManifest,
  FormSubmittedPayload,
  HapticPayload,
  HapticStyle,
  HelloPayload,
  HostPlatform,
  InitPayload,
  LogPayload,
  MessageType,
  NativeToWebType,
  NavigatePayload,
  OpenExternalPayload,
  PortalErrorCode,
  PortalFormRequest,
  PortalLocale,
  PortalTheme,
  ReadyPayload,
  WebToNativeType,
} from '@amthal-group/portal-bridge';

export {
  BRIDGE_PROTOCOL_VERSION,
  EMBED_PATH_PREFIX,
  MANIFEST_PATH,
  TIMINGS,
  basePathOf,
  compareVersions,
  isEmbedPath,
  manifestUrl,
  requestToPath,
  resolveEmbedUrl,
} from '@amthal-group/portal-bridge';

import type {
  FormSubmittedPayload,
  PortalErrorCode,
  PortalLocale,
  PortalTheme,
} from '@amthal-group/portal-bridge';

// ---------------------------------------------------------------------------
// Wrapper-specific types
// ---------------------------------------------------------------------------

/** Static configuration of the embedded portal. */
export interface PortalSdkConfig {
  /**
   * Portal base URL, e.g. `https://portal.example.com` — MAY include a deploy
   * path prefix (baseHref) such as `https://portal.example.com/portal`. HTTPS
   * is required (exception: `http://localhost[:port]` for development). Never
   * include a query string or credentials here.
   */
  baseUrl: string;
  /** UI locale forwarded to the portal ('ar' also flips document direction). */
  locale?: PortalLocale;
  /** 'light' | 'dark' | 'system'. Also drives the SDK's own overlays. */
  theme?: PortalTheme;
  /** 1.0 = default; the portal maps it to a root font-size adjustment. */
  fontScale?: number;
  /**
   * Your brand colour, as `#rgb`, `#rrggbb` or `#rrggbbaa`, used for the SDK's OWN
   * interstitials — the loading indicator and the retry button.
   *
   * This cannot come over the bridge: the overlay is on screen before the WebView can
   * speak, so nothing the portal sends could colour the first frame. Set it here and the
   * wait is your colour from the very first pixel.
   *
   * Omit it and the SDK uses the surface's own foreground rather than inventing a colour —
   * deliberately plain, never another company's brand. An unparseable value is ignored the
   * same way (a bad colour string crashes the platform on Android).
   *
   * The portal's own UI is themed server-side from the branch, so this only needs to match
   * it, not replace it.
   */
  brandColor?: string;
  /**
   * Minimum portal version this app supports. When the manifest reports an
   * older portal, the SDK fails with `versionIncompatible`.
   */
  minPortalVersion?: string;
  /**
   * Additional origins allowed for main-frame navigation (rarely needed).
   * The portal origin derived from `baseUrl` is always allowed.
   */
  allowedOrigins?: string[];
  /**
   * Forward portal `log` messages to console. Only honored in __DEV__ builds —
   * logs are always dropped in release builds, per SPEC §4.
   */
  enableLogging?: boolean;
  /**
   * DEV ONLY: permit a plain-`http://` base URL for non-localhost hosts.
   * Needed when the portal dev server is bound to a tenant hostname (e.g.
   * `http://portal-dev.example.com:4200/portal`) because the backend resolves
   * the tenant from the request host/referer. Only honored in __DEV__ builds —
   * release builds always enforce HTTPS regardless of this flag. On iOS the
   * host app additionally needs an ATS exception for the dev domain.
   */
  allowInsecureHttp?: boolean;
}

/** Credentials handed to the portal (init / auth messages). */
export interface PortalAuthState {
  /** Backend bearer token, exactly as the portal's auth service expects it. */
  token: string;
  branchId?: string | null;
  /**
   * Optional pre-built portal user object. When omitted the portal
   * reconstructs it from its profile endpoint using the token.
   */
  user?: unknown;
}

/** Payload delivered by `onSubmitted` (alias of the protocol payload). */
export type FormSubmitResult = FormSubmittedPayload;

/** Error surfaced through `onError` and the error render hook. */
export interface PortalErrorInfo {
  code: PortalErrorCode;
  message?: string;
  /** Set for `httpError` / failed manifest fetches. */
  httpStatus?: number;
}
