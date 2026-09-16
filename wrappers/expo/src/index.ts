/**
 * @amthal-group/portal-expo
 *
 * Presents the **native** Amthal Portal SDK (a hardened WKWebView in
 * `AmthalPortalViewController`) inside a device-native `UISheetPresentationController`,
 * driven from React Native. Unlike `@amthal-group/portal-react-native` (which
 * renders inline via react-native-webview), this hands presentation to the
 * native SDK so the sheet chrome, hardening, and interstitials are all native.
 *
 * @example
 * const session = presentPortalSheet({
 *   config: { baseUrl, locale: 'en', theme: 'system' },
 *   auth: { token, branchId },
 *   request: { kind: 'newApplication', type: 'external', productID: 42 },
 *   sheet: { detents: ['large', 'medium'], grabber: true },
 *   onSubmitted: (r) => console.log('submitted', r.applicationNo),
 *   onError: (e) => console.warn(e.code, e.message),
 *   onClosed: () => console.log('sheet closed'),
 * });
 * // later: session.updateAuth({ token: fresh }); session.dismiss();
 */
import PortalNative, { isPortalSheetAvailable } from './AmthalPortalNativeModule';
import type { NativeAuth } from './AmthalPortalNativeModule';
import type {
  PortalAuthState,
  PresentPortalSheetOptions,
  PortalSheetSession,
} from './types';

export * from './types';

function toNativeAuth(auth: PortalAuthState): NativeAuth {
  return {
    token: auth.token,
    branchId: auth.branchId ?? undefined,
    userJSON: auth.user !== undefined ? JSON.stringify(auth.user) : undefined,
  };
}

/**
 * Present the portal in a native modal sheet. Returns a handle for updating
 * auth / config and dismissing. Event listeners are torn down automatically
 * when the sheet closes.
 */
const NO_SESSION: PortalSheetSession = {
  updateAuth: () => undefined,
  configure: () => undefined,
  dismiss: () => undefined,
};

export { isPortalSheetAvailable };

export function presentPortalSheet(options: PresentPortalSheetOptions): PortalSheetSession {
  // Apple platforms only. Reported through onError rather than thrown, so a cross-platform app
  // that calls this without a platform check gets a handled error on Android instead of an
  // unhandled exception, and the same handler already wired for every other failure sees it.
  if (!isPortalSheetAvailable()) {
    queueMicrotask(() =>
      options.onError?.({
        code: 'loadFailed',
        message:
          'The native portal sheet is available on iOS only. On Android, render the inline ' +
          '<AmthalPortalForm /> from @amthal-group/portal-react-native instead.',
      }),
    );
    return NO_SESSION;
  }

  // Form delegation is not wired through the native sheet yet (SPEC §4.1).
  // Failing fast beats silently letting the portal hit its own endpoints
  // with an identity that belongs on a different API plane.
  if (options.onFormOp) {
    queueMicrotask(() =>
      options.onError?.({
        code: 'loadFailed',
        message:
          'presentPortalSheet does not support form delegation (onFormOp) yet — use the inline AmthalPortalForm instead.',
      }),
    );
    return NO_SESSION;
  }

  const subscriptions: Array<{ remove: () => void }> = [];
  let closed = false;

  const teardown = () => {
    for (const sub of subscriptions) sub.remove();
    subscriptions.length = 0;
  };

  if (options.onReady) subscriptions.push(PortalNative.addListener('onReady', options.onReady));
  if (options.onSubmitted) subscriptions.push(PortalNative.addListener('onSubmitted', options.onSubmitted));
  if (options.onCancelled) {
    subscriptions.push(PortalNative.addListener('onCancelled', () => options.onCancelled!()));
  }
  if (options.onError) subscriptions.push(PortalNative.addListener('onError', options.onError));
  if (options.onAuthExpired) {
    subscriptions.push(
      PortalNative.addListener('onAuthExpired', (e: { reason?: string }) => options.onAuthExpired!(e.reason)),
    );
  }
  if (options.onNavigate) subscriptions.push(PortalNative.addListener('onNavigate', options.onNavigate));

  // Always listen for close so we can tear down (and notify the host).
  subscriptions.push(
    PortalNative.addListener('onClosed', () => {
      if (closed) return;
      closed = true;
      try {
        options.onClosed?.();
      } finally {
        teardown();
      }
    }),
  );

  PortalNative.present({
    config: options.config,
    request: options.request as NativePresentRequest,
    auth: toNativeAuth(options.auth),
    sheet: options.sheet,
  }).catch((error: unknown) => {
    // Presentation itself failed (bad args, no presenter, already presented).
    const message = error instanceof Error ? error.message : String(error);
    options.onError?.({ code: 'loadFailed', message });
    if (!closed) {
      closed = true;
      teardown();
    }
  });

  return {
    updateAuth: (auth) => PortalNative.updateAuth(toNativeAuth(auth)),
    configure: (configure) => PortalNative.configure(configure),
    dismiss: () => PortalNative.dismiss(),
  };
}

// `PortalFormRequest` from the bridge already matches the native request shape
// (kind + type/productID/…); this alias keeps the cast above readable.
type NativePresentRequest = import('./AmthalPortalNativeModule').NativePresentOptions['request'];
