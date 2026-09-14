/**
 * Public types of @amthal-group/portal-expo.
 *
 * Protocol shapes are re-exported from @amthal-group/portal-bridge (the single
 * source of truth for Amthal Bridge Protocol v1); the wrapper-specific config /
 * auth / error types mirror @amthal-group/portal-react-native so both wrappers
 * present the same surface to app code.
 */

export type {
  PortalFormRequest,
  PortalLocale,
  PortalTheme,
  PortalErrorCode,
  FormSubmittedPayload,
} from '@amthal-group/portal-bridge';

import type {
  FormSubmittedPayload,
  PortalErrorCode,
  PortalLocale,
  PortalTheme,
} from '@amthal-group/portal-bridge';

/** Static configuration of the embedded portal (mirrors the RN wrapper). */
export interface PortalSdkConfig {
  /** Portal base URL — MAY include a deploy path prefix (baseHref). HTTPS only
   * (http allowed for localhost). No query string or credentials. */
  baseUrl: string;
  /** UI locale ('ar' also flips direction). */
  locale?: PortalLocale;
  /** 'light' | 'dark' | 'system'. */
  theme?: PortalTheme;
  /** 1.0 = default. */
  fontScale?: number;
  /** Minimum acceptable portal version (else `versionIncompatible`). */
  minPortalVersion?: string;
  /** Extra origins allowed for main-frame navigation. */
  allowedOrigins?: string[];
  /** Forward SDK diagnostics to the native log (DEBUG builds only). */
  enableLogging?: boolean;
  /** DEV ONLY: permit a plain-`http://` base URL for non-localhost hosts
   * (portal dev server bound to a tenant hostname). Only honored in DEBUG
   * native builds; release builds always enforce HTTPS. On iOS the host app
   * additionally needs an ATS exception for the dev domain. */
  allowInsecureHttp?: boolean;
}

/** Credentials handed to the portal. */
export interface PortalAuthState {
  /** Backend bearer token, exactly as the portal's auth service expects. */
  token: string;
  branchId?: string | null;
  /** Optional pre-built portal user object; JSON-stringified before crossing to native. */
  user?: unknown;
}

/** Result delivered on successful submission (alias of the protocol payload). */
export type FormSubmitResult = FormSubmittedPayload;

/** Error surfaced through `onError`. */
export interface PortalErrorInfo {
  code: PortalErrorCode;
  message?: string;
  httpStatus?: number;
}

/** Native sheet presentation options (iOS `UISheetPresentationController`). */
export interface PortalSheetOptions {
  /** Allowed detents; defaults to `['large']`. */
  detents?: Array<'large' | 'medium'>;
  /** Show the grab handle (default true). */
  grabber?: boolean;
  /** Corner radius of the sheet card. */
  cornerRadius?: number;
}

/** Options for {@link presentPortalSheet}. */
export interface PresentPortalSheetOptions {
  config: PortalSdkConfig;
  auth: PortalAuthState;
  request: import('@amthal-group/portal-bridge').PortalFormRequest;
  sheet?: PortalSheetOptions;

  /** Portal finished its handshake and is visible. */
  onReady?: (info: { portalVersion: string }) => void;
  /** Form submitted successfully (the sheet is NOT auto-closed on submit). */
  onSubmitted?: (result: FormSubmitResult) => void;
  /** User exited via an in-form close affordance. */
  onCancelled?: () => void;
  /** SDK-level failure. */
  onError?: (error: PortalErrorInfo) => void;
  /** Token refresh failed — obtain a fresh token and call `session.updateAuth`. */
  onAuthExpired?: (reason?: string) => void;
  /** Informational navigation inside /embed/*. */
  onNavigate?: (navigation: { path: string; title?: string }) => void;
  /** The sheet was dismissed (swipe, Close, or `dismiss()`); listeners are torn down. */
  onClosed?: () => void;
  /**
   * Form delegation (bridge SPEC §4.1). NOT YET SUPPORTED on the native sheet
   * path — the JS↔native↔web round-trip is not wired. Providing it makes
   * `presentPortalSheet` fail fast via `onError` instead of silently letting
   * the portal call its own HTTP endpoints with the wrong identity. Use the
   * inline `AmthalPortalForm` (portal-react-native) for delegated forms.
   */
  onFormOp?: (request: import('@amthal-group/portal-bridge').FormOpRequestPayload) => Promise<unknown>;
}

/** Imperative handle to the presented sheet. */
export interface PortalSheetSession {
  /** Re-issue credentials (e.g. after `onAuthExpired`). */
  updateAuth: (auth: PortalAuthState) => void;
  /** Re-apply locale / theme / fontScale at runtime. */
  configure: (configure: { locale?: PortalLocale; theme?: PortalTheme; fontScale?: number }) => void;
  /** Request dismissal (runs the SDK's confirm-discard guard when dirty). */
  dismiss: () => void;
}
