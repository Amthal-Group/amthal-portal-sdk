import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

import type { FormSubmitResult, PortalErrorInfo } from './types';

/** Event map emitted by the native module. */
export type PortalNativeEventsMap = {
  onReady: (event: { portalVersion: string }) => void;
  onSubmitted: (event: FormSubmitResult) => void;
  onCancelled: (event: Record<string, never>) => void;
  onError: (event: PortalErrorInfo) => void;
  onAuthExpired: (event: { reason?: string }) => void;
  onNavigate: (event: { path: string; title?: string }) => void;
  onClosed: (event: Record<string, never>) => void;
};

/** Auth as it crosses to native (user object is pre-stringified to userJSON). */
export interface NativeAuth {
  token: string;
  branchId?: string | null;
  userJSON?: string;
}

/** `present` options as the native module expects them. */
export interface NativePresentOptions {
  config: {
    baseUrl: string;
    locale?: string;
    theme?: string;
    fontScale?: number;
    minPortalVersion?: string;
    allowedOrigins?: string[];
    enableLogging?: boolean;
    allowInsecureHttp?: boolean;
  };
  request: {
    kind?: string;
    type?: string;
    productID?: number;
    batchID?: string;
    headerID?: string;
    readOnly?: boolean;
    path?: string;
  };
  auth: NativeAuth;
  sheet?: {
    detents?: Array<'large' | 'medium'>;
    grabber?: boolean;
    cornerRadius?: number;
  };
}

declare class AmthalPortalNativeModule extends NativeModule<PortalNativeEventsMap> {
  present(options: NativePresentOptions): Promise<void>;
  updateAuth(auth: NativeAuth): void;
  configure(configure: { locale?: string; theme?: string; fontScale?: number }): void;
  dismiss(): void;
}

/**
 * The native sheet exists only on Apple platforms — the module declares iOS as its only platform,
 * and on Android the inline `AmthalPortalForm` from `@amthal-group/portal-react-native` is the
 * supported host.
 *
 * `requireNativeModule` throws during module evaluation when the native side is absent, so on
 * Android merely IMPORTING this package took the whole app down before any of its own code ran —
 * including apps that import it correctly and only ever call it behind a platform check. The
 * optional variant returns null instead, which moves the failure to the point of use where it can
 * be reported through the caller's own error handling.
 */
export const PortalNativeOptional =
  requireOptionalNativeModule<AmthalPortalNativeModule>('AmthalPortalNative');

/** Whether the native sheet can be presented on this platform and build. */
export function isPortalSheetAvailable(): boolean {
  return PortalNativeOptional != null;
}

export default PortalNativeOptional as AmthalPortalNativeModule;
