/**
 * AmthalPortalForm — embeds an Amthal Client Portal form in a React Native app.
 *
 * Pure-TypeScript native host for Amthal Bridge Protocol v1 (see bridge/SPEC.md),
 * implemented on top of react-native-webview. No custom native code.
 *
 * Lifecycle (per SPEC §3/§5):
 *   1. GET manifestUrl(baseUrl) (10 s timeout) and version-gate.
 *   2. Load resolveEmbedUrl(baseUrl, request) in the WebView with
 *      `window.__AMTHAL_EMBEDDED_RN__ = true` injected before content loads.
 *   3. Answer every `hello` with `init` (config + auth). `bridgeTimeout` if no
 *      hello within 15 s of load end.
 *   4. `ready` hides the loading overlay; events are forwarded to callbacks.
 *   5. `destroy` is sent best-effort on unmount.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';
import {
  BRIDGE_PROTOCOL_VERSION,
  TIMINGS,
  basePathOf,
  compareVersions,
  isEmbedPath,
  manifestUrl,
  resolveEmbedUrl,
} from '@amthal-group/portal-bridge';
import type {
  AuthExpiredPayload,
  AuthPayload,
  BackHandledPayload,
  DismissStatePayload,
  BridgeEnvelope,
  ConfigurePayload,
  DownloadRequestPayload,
  EmbedManifest,
  FormOpRequestPayload,
  FormOpResponsePayload,
  FormSubmittedPayload,
  LogPayload,
  NativeToWebType,
  NavigatePayload,
  OpenExternalPayload,
  PortalErrorCode,
  PortalFormRequest,
} from '@amthal-group/portal-bridge';
import { PortalSplash } from './PortalSplash';
import { SDK_VERSION } from './version';
import type {
  FormSubmitResult,
  PortalAuthState,
  PortalErrorInfo,
  PortalSdkConfig,
} from './types';

// ---------------------------------------------------------------------------
// Props / handle
// ---------------------------------------------------------------------------

export interface AmthalPortalFormProps {
  /** Portal configuration (baseUrl is required). */
  config: PortalSdkConfig;
  /**
   * Credentials seeded into `init` and re-sent when the prop changes.
   *
   * Omit it entirely for an anonymous session: `init` then carries no `auth` key at all, which
   * is how the portal is told to render the public plane and to drop any credentials a previous
   * launch left in the WebView's storage. Do NOT pass `{ token: '' }` to mean the same thing.
   */
  auth?: PortalAuthState;
  /** What to show — mapped to a portal URL via `resolveEmbedUrl`. */
  request: PortalFormRequest;

  /** Portal emitted `ready`; the loading overlay has been hidden. */
  onReady?: () => void;
  /** The embedded form was submitted successfully. Host decides what happens next (the SDK never auto-closes). */
  onSubmitted: (result: FormSubmitResult) => void;
  /** User exited the form without submitting (in-form close/finish affordance). */
  onCancelled: () => void;
  /** SDK-level failure (see PortalErrorCode). Also fired for `authExpired` when no `onAuthExpired` handler is set. */
  onError: (error: PortalErrorInfo) => void;
  /**
   * The portal's token refresh failed. Obtain a fresh token, then call
   * `refresh(newAuth)` — the SDK sends `auth`, waits for the web ack and
   * clears the waiting overlay.
   */
  onAuthExpired?: (refresh: (auth: PortalAuthState) => void, reason?: string) => void;
  /**
   * The portal asked to open a URL outside the WebView. Return `true` to
   * intercept; otherwise the SDK falls back to `Linking.openURL`.
   */
  onOpenExternal?: (url: string) => boolean;
  /**
   * The portal asked the host to download + preview a file. Default behavior
   * is `Linking.openURL(url)` — which cannot attach `headers`. See README
   * ("downloadRequest limitations") if your files require an Authorization header.
   */
  onDownloadRequest?: (download: DownloadRequestPayload) => void;
  /** Informational router navigation inside /embed/* (path + optional title). */
  onNavigate?: (navigation: NavigatePayload) => void;
  /**
   * Form delegation (bridge SPEC §4.1): when provided, the SDK declares
   * `formDelegation: true` in `init` and the portal routes every form data
   * operation here instead of calling its own HTTP endpoints — the host
   * performs the API call with its own identity/plane (e.g. backoffice
   * /DMS/Forms/* with a staff token, plus any per-login pre-entrance checks)
   * and resolves with the raw response body. Reject (or resolve
   * `{ok:false,...}` via throw) to surface an error in the portal UI; throw
   * an object with `status: 401` to trigger the portal's auth-expired flow.
   */
  onFormOp?: (request: FormOpRequestPayload) => Promise<unknown>;
  /**
   * Android hardware back was pressed and the web did NOT consume it
   * (`{handled:false}` or 10 s timeout) — the host should close this screen.
   * When omitted, the SDK does not intercept the hardware back button at all
   * and the platform default applies.
   */
  onCloseRequested?: () => void;

  style?: StyleProp<ViewStyle>;
  /** Custom loading UI (shown until `ready`). */
  renderLoading?: () => React.ReactElement;
  /** Custom error UI. Receives the error and a `retry` callback. */
  renderError?: (info: { error: PortalErrorInfo; retry: () => void }) => React.ReactElement;
}

export interface AmthalPortalFormHandle {
  /** Send fresh credentials (same as the `refresh` given to onAuthExpired). */
  updateAuth: (auth: PortalAuthState) => void;
  /** Re-apply locale / theme / fontScale at runtime. */
  configure: (configure: ConfigurePayload) => void;
  /**
   * Dispatch `backPressed` to the web. Resolves `true` when the web consumed
   * it (e.g. went back a form step), `false` when the host should close
   * (`{handled:false}` reply or 10 s timeout).
   */
  handleBackPress: () => Promise<boolean>;
  /**
   * Ask the web whether the form has unsaved input (`dismissRequested` → `{dirty}`).
   * Resolves `true` when it is safe to close without warning the user.
   *
   * Use this for a gesture or button that CLOSES rather than goes back — an iOS sheet's
   * swipe-to-dismiss, or a ✕ in your own header — where there is no hardware back for
   * `handleBackPress` to model. A timeout or an unopened bridge resolves `true`: a broken
   * bridge must not trap the user in a screen they cannot leave.
   */
  requestDismiss: () => Promise<boolean>;
  /** Send `destroy` (best-effort) and stop all bridge activity. */
  destroy: () => void;
}

type Phase = 'manifest' | 'loading' | 'ready' | 'error';

interface PendingRequest {
  resolve: (envelope: BridgeEnvelope | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// URL helpers (RN's URL polyfill does not implement `.origin`, so parse manually)
// ---------------------------------------------------------------------------

function originOf(url: string): string | null {
  const m = /^(https?):\/\/([^/?#]+)/i.exec(url);
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : null;
}

function pathOf(url: string): string {
  const m = /^https?:\/\/[^/?#]+([^?#]*)/i.exec(url);
  return m && m[1] ? m[1] : '/';
}

function isLocalhostOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/i.test(origin);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * basePathOf with a React Native guard: the canonical bridge helper uses
 * `new URL(baseUrl).pathname`, and RN's built-in URL polyfill throws
 * "URL.pathname not implemented". Falls back to the same string derivation
 * (path component, no trailing slash, '' when root).
 */
function safeBasePathOf(baseUrl: string): string {
  try {
    return basePathOf(baseUrl);
  } catch {
    const path = pathOf(baseUrl);
    return path === '/' ? '' : path.replace(/\/+$/, '');
  }
}

const ERROR_TITLES: Record<PortalErrorCode, string> = {
  offline: 'No internet connection.',
  loadFailed: 'The portal could not be loaded.',
  httpError: 'The portal returned an unexpected response.',
  manifestFailed: 'The portal could not be reached.',
  bridgeTimeout: 'The portal did not respond in time.',
  versionIncompatible: 'This app version is not compatible with the portal. Please update the app.',
  authExpired: 'Your session has expired.',
  webProcessTerminated: 'The portal view stopped unexpectedly.',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AmthalPortalForm = forwardRef<AmthalPortalFormHandle, AmthalPortalFormProps>(
  function AmthalPortalForm(props, ref) {
    const { config, auth, request, style, renderLoading, renderError } = props;

    const [phase, setPhase] = useState<Phase>('manifest');
    const [error, setError] = useState<PortalErrorInfo | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [authWaiting, setAuthWaiting] = useState(false);

    // Latest props/state accessible from stable callbacks.
    const propsRef = useRef(props);
    propsRef.current = props;
    const phaseRef = useRef<Phase>(phase);
    phaseRef.current = phase;

    // Note: WebView<object>, not WebView — react-native-webview's class is
    // generic with `P = undefined`, and `WebViewProps & undefined` collapses
    // to `never` under TS ≥4.8, breaking every prop. `object` is the identity.
    const webviewRef = useRef<WebView<object>>(null);
    const authRef = useRef<PortalAuthState | undefined>(auth);
    const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
    const helloTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const helloReceivedRef = useRef(false);
    const destroyedRef = useRef(false);
    const currentUrlRef = useRef<string | null>(null);
    const idCounterRef = useRef(0);
    const crashReloadedRef = useRef(false);

    const baseUrl = stripTrailingSlash(config.baseUrl);
    const portalOrigin = useMemo(() => originOf(baseUrl), [baseUrl]);
    const sourceUri = useMemo(() => resolveEmbedUrl(baseUrl, request), [baseUrl, request]);
    // Deploy path prefix (baseHref) of the portal, '' when hosted at the root.
    // All embed-path checks must use basePath + '/embed' (SPEC §2.3).
    const basePath = useMemo(() => safeBasePathOf(baseUrl), [baseUrl]);
    // `theme` defaults to 'system' (SPEC / protocol.ts), so testing only for 'dark' resolved
    // every default-configured session to the LIGHT palette — a white full-screen overlay
    // handing over to a form the web side had correctly painted dark, because the portal
    // resolves 'system' against prefers-color-scheme. Resolve it the same way here.
    const deviceScheme = useColorScheme();
    const dark =
      config.theme === 'dark' || (config.theme !== 'light' && deviceScheme === 'dark');

    const allowedOrigins = useMemo(() => {
      const set = new Set<string>();
      if (portalOrigin) set.add(portalOrigin);
      for (const o of config.allowedOrigins ?? []) {
        const parsed = originOf(o);
        if (parsed) set.add(parsed);
      }
      return set;
    }, [portalOrigin, config.allowedOrigins]);

    const isAllowedOrigin = useCallback(
      (origin: string | null): boolean => origin != null && allowedOrigins.has(origin),
      [allowedOrigins],
    );

    const logDev = useCallback(
      (...args: unknown[]) => {
        if (__DEV__ && propsRef.current.config.enableLogging) {
          console.log('[AmthalPortal]', ...args);
        }
      },
      [],
    );

    // -----------------------------------------------------------------------
    // Failure / retry
    // -----------------------------------------------------------------------

    const clearHelloTimer = useCallback(() => {
      if (helloTimerRef.current != null) {
        clearTimeout(helloTimerRef.current);
        helloTimerRef.current = null;
      }
    }, []);

    const clearPending = useCallback(() => {
      pendingRef.current.forEach((p) => {
        clearTimeout(p.timer);
        p.resolve(null);
      });
      pendingRef.current.clear();
    }, []);

    const fail = useCallback(
      (code: PortalErrorCode, message?: string, httpStatus?: number) => {
        if (destroyedRef.current || phaseRef.current === 'error') return;
        phaseRef.current = 'error'; // guard against double onError before re-render
        clearHelloTimer();
        const info: PortalErrorInfo = { code, message: message ?? ERROR_TITLES[code], httpStatus };
        setError(info);
        setPhase('error');
        setAuthWaiting(false);
        propsRef.current.onError(info);
      },
      [clearHelloTimer],
    );

    const retry = useCallback(() => {
      if (destroyedRef.current) return;
      clearHelloTimer();
      clearPending();
      helloReceivedRef.current = false;
      crashReloadedRef.current = false;
      currentUrlRef.current = null;
      setError(null);
      setAuthWaiting(false);
      phaseRef.current = 'manifest';
      setPhase('manifest');
      setAttempt((a) => a + 1); // remounts the WebView (key) and re-runs the manifest gate
    }, [clearHelloTimer, clearPending]);

    // -----------------------------------------------------------------------
    // Native → web transport (SPEC §2.2: double-encoded JSON string)
    // -----------------------------------------------------------------------

    const newId = useCallback((): string => {
      idCounterRef.current += 1;
      return `rn-${Date.now().toString(36)}-${idCounterRef.current}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    }, []);

    const postToWeb = useCallback(
      (envelope: BridgeEnvelope): boolean => {
        const webview = webviewRef.current;
        if (!webview || destroyedRef.current) return false;
        // SPEC §2.3: verify the WebView still shows the portal origin before
        // every native→web evaluation.
        const current = currentUrlRef.current;
        if (current && current !== 'about:blank' && !isAllowedOrigin(originOf(current))) {
          logDev('blocked native→web message: WebView left the portal origin', current);
          return false;
        }
        const json = JSON.stringify(envelope);
        webview.injectJavaScript(
          `window.__amthalReceive && window.__amthalReceive(${JSON.stringify(json)}); true;`,
        );
        return true;
      },
      [isAllowedOrigin, logDev],
    );

    const send = useCallback(
      (type: NativeToWebType, payload?: unknown, replyTo?: string): string | null => {
        const envelope: BridgeEnvelope = { v: BRIDGE_PROTOCOL_VERSION, id: newId(), type, payload };
        if (replyTo) envelope.replyTo = replyTo;
        return postToWeb(envelope) ? envelope.id : null;
      },
      [newId, postToWeb],
    );

    /** Send and await the correlated reply; resolves null on timeout / failure. */
    const requestReply = useCallback(
      (
        type: NativeToWebType,
        payload?: unknown,
        timeoutMs: number = TIMINGS.requestTimeoutMs,
      ): Promise<BridgeEnvelope | null> =>
        new Promise((resolve) => {
          const envelope: BridgeEnvelope = {
            v: BRIDGE_PROTOCOL_VERSION,
            id: newId(),
            type,
            payload,
          };
          if (!postToWeb(envelope)) {
            resolve(null);
            return;
          }
          const timer = setTimeout(() => {
            pendingRef.current.delete(envelope.id);
            resolve(null);
          }, timeoutMs);
          pendingRef.current.set(envelope.id, { resolve, timer });
        }),
      [newId, postToWeb],
    );

    // -----------------------------------------------------------------------
    // Outbound actions
    // -----------------------------------------------------------------------

    const sendAuth = useCallback(
      (next: PortalAuthState) => {
        authRef.current = next;
        const payload: AuthPayload = {
          token: next.token,
          branchId: next.branchId,
          user: next.user,
        };
        requestReply('auth', payload).then((reply) => {
          if (destroyedRef.current) return;
          setAuthWaiting(false);
          if (reply == null) {
            logDev('auth message was not acknowledged within the timeout');
          }
        });
      },
      [requestReply, logDev],
    );

    const sendConfigure = useCallback(
      (configure: ConfigurePayload) => {
        requestReply('configure', configure).then(() => undefined);
      },
      [requestReply],
    );

    const handleBackPress = useCallback(async (): Promise<boolean> => {
      if (destroyedRef.current || phaseRef.current !== 'ready' || !helloReceivedRef.current) {
        return false;
      }
      const reply = await requestReply('backPressed');
      const payload = reply?.payload as BackHandledPayload | undefined;
      return payload?.handled === true; // {handled:false} or timeout ⇒ native closes
    }, [requestReply]);

    const requestDismiss = useCallback(async (): Promise<boolean> => {
      if (destroyedRef.current || phaseRef.current !== 'ready' || !helloReceivedRef.current) {
        return true; // nothing rendered yet — nothing to lose
      }
      const reply = await requestReply('dismissRequested');
      const payload = reply?.payload as DismissStatePayload | undefined;
      return payload?.dirty !== true; // no reply ⇒ assume clean rather than trap the user
    }, [requestReply]);

    const destroy = useCallback(() => {
      if (destroyedRef.current) return;
      send('destroy'); // best-effort; web clears persisted auth regardless of ack
      destroyedRef.current = true;
      clearHelloTimer();
      clearPending();
    }, [send, clearHelloTimer, clearPending]);

    const handleExternal = useCallback(
      (url: string, via: string = 'unknown') => {
        logDev(`handleExternal via ${via}:`, url);
        const intercept = propsRef.current.onOpenExternal;
        if (intercept && intercept(url)) return;
        Linking.openURL(url).catch(() => logDev('failed to open external URL', url));
      },
      [logDev],
    );

    const handleDownload = useCallback(
      (payload: DownloadRequestPayload) => {
        const handler = propsRef.current.onDownloadRequest;
        if (handler) {
          handler(payload);
          return;
        }
        // Default: hand off to the system. NOTE: this cannot attach
        // payload.headers (e.g. Authorization) — see README for options.
        if (payload.headers && Object.keys(payload.headers).length > 0) {
          logDev(
            'downloadRequest carries auth headers; the default Linking.openURL fallback cannot attach them — provide onDownloadRequest',
          );
        }
        Linking.openURL(payload.url).catch(() => logDev('failed to open download URL'));
      },
      [logDev],
    );

    const handleAuthExpired = useCallback(
      (payload: AuthExpiredPayload | undefined) => {
        setAuthWaiting(true);
        const refresh = (next: PortalAuthState) => {
          if (destroyedRef.current) return;
          sendAuth(next);
        };
        const handler = propsRef.current.onAuthExpired;
        if (handler) {
          handler(refresh, payload?.reason);
        } else {
          propsRef.current.onError({
            code: 'authExpired',
            message: payload?.reason ?? ERROR_TITLES.authExpired,
          });
        }
      },
      [sendAuth],
    );

    // -----------------------------------------------------------------------
    // Inbound messages
    // -----------------------------------------------------------------------

    const handleHello = useCallback(
      (envelope: BridgeEnvelope) => {
        helloReceivedRef.current = true;
        clearHelloTimer();
        const cfg = propsRef.current.config;
        const a = authRef.current;
        // A blank token is not a credential. Omitting the key is the protocol's way of saying
        // "anonymous", and the portal branches on the key's presence.
        const auth = a?.token ? { token: a.token, branchId: a.branchId, user: a.user } : undefined;
        // SPEC §3: answer EVERY hello with init (idempotent; web applies latest).
        send(
          'init',
          {
            sdkVersion: SDK_VERSION,
            platform: 'react-native' as const,
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            configure: { locale: cfg.locale, theme: cfg.theme, fontScale: cfg.fontScale },
            ...(auth ? { auth } : {}),
            // SPEC §4.1: host owns the form data plane when a handler is set.
            formDelegation: !!propsRef.current.onFormOp,
          },
          envelope.id,
        );
      },
      [send, clearHelloTimer],
    );

    const handleFormOp = useCallback(
      (envelope: BridgeEnvelope) => {
        const payload = envelope.payload as FormOpRequestPayload | undefined;
        const handler = propsRef.current.onFormOp;
        const replyOp = (response: FormOpResponsePayload) => {
          if (destroyedRef.current) return;
          send('ack', response, envelope.id);
        };
        if (!handler || !payload?.op) {
          replyOp({ ok: false, error: handler ? 'Malformed formOp request.' : 'Form delegation is not enabled on this host.' });
          return;
        }
        handler(payload)
          .then((body) => replyOp({ ok: true, body }))
          .catch((error: unknown) => {
            const status =
              typeof (error as { status?: unknown })?.status === 'number'
                ? ((error as { status: number }).status)
                : undefined;
            const message =
              error instanceof Error
                ? error.message
                : typeof (error as { message?: unknown })?.message === 'string'
                  ? ((error as { message: string }).message)
                  : 'Form operation failed.';
            logDev('formOp failed', payload.op, message);
            replyOp({ ok: false, error: message, status });
          });
      },
      [send, logDev],
    );

    const handlePortalLog = useCallback(
      (payload: LogPayload | undefined) => {
        // SPEC §4: natives MUST drop `log` in release builds.
        if (!__DEV__ || !propsRef.current.config.enableLogging || !payload) return;
        const level = payload.level === 'debug' ? 'log' : payload.level;
        // eslint-disable-next-line no-console
        console[level]('[AmthalPortal:web]', payload.message, payload.data ?? '');
      },
      [],
    );

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        if (destroyedRef.current) return;
        const { data, url } = event.nativeEvent;
        // SPEC §2.3: drop messages arriving from a non-portal origin.
        if (url && url !== 'about:blank' && !isAllowedOrigin(originOf(url))) {
          logDev('dropped message from non-portal origin', url);
          return;
        }

        let envelope: BridgeEnvelope;
        try {
          envelope = JSON.parse(data) as BridgeEnvelope;
        } catch {
          return; // not a bridge message
        }
        if (
          !envelope ||
          envelope.v !== BRIDGE_PROTOCOL_VERSION || // wrong protocol version ⇒ silently ignore
          typeof envelope.type !== 'string'
        ) {
          return;
        }

        // Correlated replies (acks to backPressed / dismissRequested / auth / configure).
        if (envelope.replyTo) {
          const pending = pendingRef.current.get(envelope.replyTo);
          if (pending) {
            pendingRef.current.delete(envelope.replyTo);
            clearTimeout(pending.timer);
            pending.resolve(envelope);
            return;
          }
          if (envelope.type === 'ack') return; // late/unsolicited ack
        }

        switch (envelope.type) {
          case 'hello':
            handleHello(envelope);
            break;
          case 'ready':
            clearHelloTimer();
            if (phaseRef.current !== 'ready') {
              phaseRef.current = 'ready'; // guard against double onReady before re-render
              setPhase('ready');
              propsRef.current.onReady?.();
            }
            break;
          case 'formSubmitted':
            propsRef.current.onSubmitted((envelope.payload ?? {}) as FormSubmittedPayload);
            break;
          case 'formCancelled':
            propsRef.current.onCancelled();
            break;
          case 'navigate':
            propsRef.current.onNavigate?.((envelope.payload ?? { path: '' }) as NavigatePayload);
            break;
          case 'openExternal': {
            const payload = envelope.payload as OpenExternalPayload | undefined;
            if (payload?.url) handleExternal(payload.url, 'bridge:openExternal');
            break;
          }
          case 'downloadRequest': {
            const payload = envelope.payload as DownloadRequestPayload | undefined;
            if (payload?.url) handleDownload(payload);
            break;
          }
          case 'authExpired':
            handleAuthExpired(envelope.payload as AuthExpiredPayload | undefined);
            break;
          case 'formOp':
            handleFormOp(envelope);
            break;
          case 'log':
            handlePortalLog(envelope.payload as LogPayload | undefined);
            break;
          case 'haptic':
          case 'ack':
            break; // optional / already handled above
          default:
            // Unknown type ⇒ ignore (forward compatibility, SPEC §1).
            logDev('ignoring unknown message type', envelope.type);
            break;
        }
      },
      [
        isAllowedOrigin,
        logDev,
        handleHello,
        clearHelloTimer,
        handleExternal,
        handleDownload,
        handleAuthExpired,
        handleFormOp,
        handlePortalLog,
      ],
    );

    // -----------------------------------------------------------------------
    // Manifest gate (SPEC §5) — runs before the WebView is rendered
    // -----------------------------------------------------------------------

    useEffect(() => {
      if (destroyedRef.current) return;
      let cancelled = false;

      if (!portalOrigin) {
        fail('loadFailed', `Invalid baseUrl: ${config.baseUrl}`);
        return;
      }
      if (portalOrigin.startsWith('http://') && !isLocalhostOrigin(portalOrigin)) {
        // DEV escape hatch: portal dev servers bound to a tenant hostname
        // (backend derives the tenant from the request host/referer) may run
        // plain http. Never honored in release builds.
        if (__DEV__ && config.allowInsecureHttp === true) {
          console.warn(
            `[AmthalPortal] DEV: allowing insecure portal base URL ${portalOrigin} ` +
              '(allowInsecureHttp) — release builds enforce HTTPS.',
          );
        } else {
          fail('loadFailed', 'Insecure baseUrl rejected: the portal must be served over HTTPS.');
          return;
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      fetch(manifestUrl(baseUrl), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
        .then((response) => {
          if (!response.ok) {
            const err = new Error(`manifest HTTP ${response.status}`) as Error & {
              httpStatus?: number;
            };
            err.httpStatus = response.status;
            throw err;
          }
          return response.json() as Promise<EmbedManifest>;
        })
        .then((manifest) => {
          if (cancelled || destroyedRef.current) return;
          if (manifest.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
            fail(
              'versionIncompatible',
              `Portal speaks bridge protocol ${manifest.bridgeProtocolVersion}; this SDK implements ${BRIDGE_PROTOCOL_VERSION}.`,
            );
            return;
          }
          const minPortal = propsRef.current.config.minPortalVersion;
          if (minPortal && compareVersions(manifest.portalVersion, minPortal) < 0) {
            fail(
              'versionIncompatible',
              `Portal ${manifest.portalVersion} is older than required ${minPortal}.`,
            );
            return;
          }
          if (manifest.minSdkVersion && compareVersions(SDK_VERSION, manifest.minSdkVersion) < 0) {
            fail(
              'versionIncompatible',
              `SDK ${SDK_VERSION} is older than the portal's minimum ${manifest.minSdkVersion}.`,
            );
            return;
          }
          logDev('manifest OK', manifest);
          setPhase('loading');
        })
        .catch((err: Error & { httpStatus?: number }) => {
          if (cancelled || destroyedRef.current) return;
          fail(
            'manifestFailed',
            err.name === 'AbortError'
              ? 'Timed out fetching the portal manifest (10 s).'
              : `Could not fetch the portal manifest: ${err.message}`,
            err.httpStatus,
          );
        })
        .finally(() => clearTimeout(timeout));

      return () => {
        cancelled = true;
        controller.abort();
        clearTimeout(timeout);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseUrl, portalOrigin, config.minPortalVersion, attempt]);

    // -----------------------------------------------------------------------
    // Prop-driven updates
    // -----------------------------------------------------------------------

    // auth prop changes → send `auth` (skip the initial value: it rides on init).
    const prevAuthRef = useRef<PortalAuthState | undefined>(auth);
    useEffect(() => {
      const prev = prevAuthRef.current;
      prevAuthRef.current = auth;
      authRef.current = auth;
      const changed =
        prev?.token !== auth?.token ||
        prev?.branchId !== auth?.branchId ||
        prev?.user !== auth?.user;
      // Only a real credential is worth an `auth` message; going from one anonymous shape to
      // another is not a session change.
      if (changed && auth?.token && helloReceivedRef.current && !destroyedRef.current) {
        sendAuth(auth);
      }
    }, [auth, sendAuth]);

    // locale / theme / fontScale changes → send `configure`.
    const prevConfigureRef = useRef<ConfigurePayload>({
      locale: config.locale,
      theme: config.theme,
      fontScale: config.fontScale,
    });
    useEffect(() => {
      const next: ConfigurePayload = {
        locale: config.locale,
        theme: config.theme,
        fontScale: config.fontScale,
      };
      const prev = prevConfigureRef.current;
      prevConfigureRef.current = next;
      const changed =
        prev.locale !== next.locale ||
        prev.theme !== next.theme ||
        prev.fontScale !== next.fontScale;
      if (changed && helloReceivedRef.current && !destroyedRef.current) {
        sendConfigure(next);
      }
    }, [config.locale, config.theme, config.fontScale, sendConfigure]);

    // Android hardware back (only intercepts when onCloseRequested is provided;
    // otherwise the platform default applies untouched).
    useEffect(() => {
      if (Platform.OS !== 'android') return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (destroyedRef.current) return false;
        const close = propsRef.current.onCloseRequested;
        if (!close) return false; // no handler ⇒ allow the default back action
        if (phaseRef.current !== 'ready') {
          close();
          return true;
        }
        handleBackPress().then((handledByWeb) => {
          if (!handledByWeb && !destroyedRef.current) {
            propsRef.current.onCloseRequested?.();
          }
        });
        return true; // consumed; async outcome decides whether to close
      });
      return () => subscription.remove();
    }, [handleBackPress]);

    // Teardown on unmount (SPEC §3): best-effort destroy + clear timers.
    useEffect(
      () => () => {
        destroy();
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    useImperativeHandle(
      ref,
      (): AmthalPortalFormHandle => ({
        updateAuth: (next) => sendAuth(next),
        configure: (c) => sendConfigure(c),
        handleBackPress,
        requestDismiss,
        destroy,
      }),
      [sendAuth, sendConfigure, handleBackPress, requestDismiss, destroy],
    );

    // -----------------------------------------------------------------------
    // WebView events
    // -----------------------------------------------------------------------

    const handleLoadEnd = useCallback(() => {
      if (destroyedRef.current || helloReceivedRef.current || phaseRef.current === 'error') return;
      // SPEC §3: bridgeTimeout if no hello within 15 s of the page finishing load.
      clearHelloTimer();
      helloTimerRef.current = setTimeout(() => {
        if (!helloReceivedRef.current) {
          fail('bridgeTimeout', 'The portal never opened the bridge (no hello within 15 s).');
        }
      }, TIMINGS.helloTimeoutMs);
    }, [clearHelloTimer, fail]);

    const handleLoadError = useCallback(
      (event: WebViewErrorEvent) => {
        const { code, description } = event.nativeEvent;
        const offline =
          code === -1009 || /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/i.test(description ?? '');
        fail(offline ? 'offline' : 'loadFailed', description || undefined);
      },
      [fail],
    );

    const handleHttpError = useCallback(
      (event: WebViewHttpErrorEvent) => {
        const { url, statusCode } = event.nativeEvent;
        // Only main-frame failures are fatal (onHttpError also fires for subresources).
        const mainUrl = currentUrlRef.current ?? sourceUri;
        if (url === mainUrl || url === sourceUri) {
          fail('httpError', `The portal returned HTTP ${statusCode}.`, statusCode);
        }
      },
      [fail, sourceUri],
    );

    const handleProcessTerminated = useCallback(() => {
      // SPEC §6: auto-reload once before surfacing webProcessTerminated.
      if (destroyedRef.current) return;
      if (!crashReloadedRef.current) {
        crashReloadedRef.current = true;
        helloReceivedRef.current = false;
        setPhase('loading');
        webviewRef.current?.reload();
        return;
      }
      fail('webProcessTerminated');
    }, [fail]);

    const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
      if (navState.url) currentUrlRef.current = navState.url;
    }, []);

    const handleShouldStartLoad = useCallback(
      (req: ShouldStartLoadRequest): boolean => {
        const { url } = req;
        if (url === 'about:blank' || url.startsWith('about:')) return true;

        // Only the MAIN frame is confined. A page legitimately loads third-party sub-frames
        // (reCAPTCHA, payment widgets, embedded maps) and cancelling one of those hands a
        // fragment of the page to the system browser — the user lands in Safari on
        // `google.com/recaptcha/api2/anchor` and the form is left behind.
        //
        // Two signals, because neither is reliable alone: `isTopFrame` is typed as required but
        // is absent on some platform/version combinations (and `undefined === false` is false,
        // so the old single check silently fell through to confinement), while
        // `mainDocumentURL` is iOS-only. A sub-frame is indicated by either one.
        const mainDocumentUrl = (req as { mainDocumentURL?: string }).mainDocumentURL;
        const isSubFrame =
          req.isTopFrame === false ||
          (typeof mainDocumentUrl === 'string' && mainDocumentUrl !== url);
        if (isSubFrame) {
          logDev('allowing sub-frame navigation', url);
          return true;
        }

        const origin = originOf(url);
        // SPEC §2.3 base path awareness: confine to basePath + /embed — never
        // compare against a literal '/embed' (the portal may deploy under a
        // baseHref such as https://host/portal).
        if (isAllowedOrigin(origin) && isEmbedPath(pathOf(url), basePath)) {
          currentUrlRef.current = url;
          return true;
        }
        // SPEC §2.3: everything else is cancelled and surfaced as external.
        logDev('cancelled navigation outside the portal embed scope', url);
        handleExternal(url, 'shouldStartLoad');
        return false;
      },
      [isAllowedOrigin, basePath, handleExternal, logDev],
    );

    const handleOpenWindow = useCallback(
      (event: WebViewOpenWindowEvent) => {
        handleExternal(event.nativeEvent.targetUrl, 'onOpenWindow');
      },
      [handleExternal],
    );

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    const base = dark ? darkPalette : lightPalette;
    // One place decides the accent, so the spinner, the retry button and anything added later
    // cannot drift apart — and an unbranded host degrades to its own foreground rather than to
    // somebody else's blue.
    const palette = {
      ...base,
      accent: normalizeHexColor(config.brandColor) ?? base.accentFallback,
    };

    if (phase === 'error' && error) {
      const errorView = renderError ? (
        renderError({ error, retry })
      ) : (
        <View style={[styles.center, { backgroundColor: palette.background }]}>
          <Text style={[styles.errorTitle, { color: palette.text }]}>
            {ERROR_TITLES[error.code]}
          </Text>
          {error.message && error.message !== ERROR_TITLES[error.code] ? (
            <Text style={[styles.errorDetail, { color: palette.subtext }]}>{error.message}</Text>
          ) : null}
          <Text style={[styles.errorCode, { color: palette.subtext }]}>({error.code})</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: palette.accent }]}
            onPress={retry}
            accessibilityRole="button"
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
      return <View style={[styles.container, style]}>{errorView}</View>;
    }

    const loadingView = renderLoading ? (
      renderLoading()
    ) : (
      <PortalSplash brandColor={palette.accent} dark={dark} />
    );
    return (
      <View style={[styles.container, style]}>
        {phase !== 'manifest' && portalOrigin ? (
          <WebView
            key={attempt}
            ref={webviewRef}
            source={{ uri: sourceUri }}
            // NOT the confinement boundary — `handleShouldStartLoad` below is.
            //
            // react-native-webview checks `originWhitelist` FIRST and, on a miss, hands the URL to
            // Linking.openURL without ever calling our handler. That check does not distinguish the
            // main frame from a sub-frame, so a narrow whitelist throws every third-party
            // sub-resource at the system browser: loading a portal form flung the user into Safari
            // on the reCAPTCHA iframe's google.com URL, and any analytics, font, map or payment
            // frame would do the same.
            //
            // So we let every http(s) URL past this check and confine in our own handler, which
            // knows about sub-frames and cancels (rather than externalises) an off-subtree main
            // frame. `allowedOrigins` still governs there.
            originWhitelist={['http://*', 'https://*']}
            style={[styles.webview, { backgroundColor: palette.background }]}
            // Bridge transport (SPEC §2)
            injectedJavaScriptBeforeContentLoaded={'window.__AMTHAL_EMBEDDED_RN__ = true; true;'}
            onMessage={handleMessage}
            // Lifecycle
            onLoadEnd={handleLoadEnd}
            onError={handleLoadError}
            onHttpError={handleHttpError}
            onNavigationStateChange={handleNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onContentProcessDidTerminate={handleProcessTerminated}
            onRenderProcessGone={handleProcessTerminated}
            onOpenWindow={handleOpenWindow}
            // Security / parity with the native SDKs (SPEC §2.3)
            javaScriptEnabled
            domStorageEnabled
            allowsBackForwardNavigationGestures={false}
            allowsLinkPreview={false}
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            mediaPlaybackRequiresUserAction
            pullToRefreshEnabled={false}
            bounces={false}
            overScrollMode="never"
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            hideKeyboardAccessoryView={false}
            setBuiltInZoomControls={false}
            webviewDebuggingEnabled={__DEV__}
          />
        ) : null}
        {phase === 'manifest' || phase === 'loading' ? (
          <View style={styles.overlay} pointerEvents="auto">
            {loadingView}
          </View>
        ) : null}
        {authWaiting ? (
          <View
            style={[styles.overlay, styles.center, { backgroundColor: palette.scrim }]}
            pointerEvents="auto"
          >
            <ActivityIndicator size="large" color={palette.accent} />
            <Text style={[styles.authWaitingLabel, { color: palette.text }]}>
              Refreshing your session…
            </Text>
          </View>
        ) : null}
      </View>
    );
  },
);

/**
 * Accept `#rgb`, `#rrggbb` and `#rrggbbaa` and reject anything else.
 *
 * The value comes from a host app, and on Android an unparseable colour string throws deep
 * inside the platform's colour processing rather than at the call site. Falling back to the
 * surface foreground is always legible; crashing someone's app over a typo in a brand colour
 * is not an acceptable trade.
 */
function normalizeHexColor(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex) ? hex : undefined;
}

// Neutral surfaces only. The accent is NOT defined here on purpose: this SDK ships to many
// tenants under their own brand, so a literal accent would paint one company's colour inside
// every other company's app. It comes from `PortalSdkConfig.brandColor`, and falls back to the
// surface's own foreground rather than to a colour we invented.
const lightPalette = {
  background: '#ffffff',
  scrim: 'rgba(255,255,255,0.88)',
  text: '#1a1a1a',
  subtext: '#6b7280',
  accentFallback: '#1a1a1a',
};

const darkPalette = {
  background: '#111418',
  scrim: 'rgba(17,20,24,0.88)',
  text: '#f3f4f6',
  subtext: '#9ca3af',
  accentFallback: '#f3f4f6',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorDetail: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  errorCode: {
    marginTop: 4,
    fontSize: 12,
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    // backgroundColor is applied at the call site from the tenant's brand colour.
  },
  retryLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  authWaitingLabel: {
    marginTop: 12,
    fontSize: 14,
  },
});
