import type { FormSubmitResult, PortalFormRequest } from '@amthal-group/portal-react-native';

export type RootStackParamList = {
  Login: undefined;
  Home: { lastResult?: FormSubmitResult } | undefined;
  Form: { request: PortalFormRequest; title: string };
};
