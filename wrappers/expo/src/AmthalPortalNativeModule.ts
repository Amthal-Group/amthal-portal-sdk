import { NativeModule, requireNativeModule } from 'expo-modules-core';

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

export default requireNativeModule<AmthalPortalNativeModule>('AmthalPortalNative');
