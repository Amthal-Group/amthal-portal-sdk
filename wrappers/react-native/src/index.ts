export { AmthalPortalForm } from './AmthalPortalForm';
export type { AmthalPortalFormProps, AmthalPortalFormHandle } from './AmthalPortalForm';
export * from './types';
export { SDK_VERSION } from './version';
// Form delegation (bridge SPEC §4.1) — types apps need to implement onFormOp.
export type {
  FormOp,
  FormOpRequestPayload,
  FormOpResponsePayload,
  SerializedFormEntry,
} from '@amthal-group/portal-bridge';

// The SDK's default wait screen, exported so a host can reuse it inside its own
// `renderLoading` (e.g. to add a logo) instead of rebuilding one from scratch.
export { PortalSplash, type PortalSplashProps } from './PortalSplash';
