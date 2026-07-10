import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AmthalPortalForm,
  type AmthalPortalFormHandle,
  type FormSubmitResult,
  type PortalAuthState,
  type PortalErrorInfo,
} from '@amthal-group/portal-react-native';
import type { RootStackParamList } from '../navigation';
import { PORTAL_BASE_URL } from '../config';
import { useAuth } from '../AuthContext';
import { refreshToken } from '../api/auth';

type Props = NativeStackScreenProps<RootStackParamList, 'Form'>;

/**
 * FormScreen — the reference AmthalPortalForm integration.
 *
 * This is the screen to copy into your own app. It demonstrates every
 * callback: submission, cancellation, errors, auth refresh, close-confirm
 * (Android hardware back included), header titles from portal navigation,
 * and a custom loading state.
 */
export default function FormScreen({ navigation, route }: Props) {
  const { request, title } = route.params;
  const { auth, setAuth, signOut } = useAuth();
  const portalRef = useRef<AmthalPortalFormHandle>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  // ---------------------------------------------------------------------
  // Submission / cancellation
  // ---------------------------------------------------------------------

  const handleSubmitted = useCallback(
    (result: FormSubmitResult) => {
      // The SDK never auto-closes — the host decides what a submission means.
      Alert.alert(
        'Application submitted',
        result.applicationNo != null
          ? `Application no. ${result.applicationNo}`
          : `Product ${result.productID} submitted successfully.`,
        [
          {
            text: 'OK',
            // Navigate back to Home carrying the result so it can show a banner.
            onPress: () => navigation.navigate('Home', { lastResult: result }),
          },
        ],
      );
    },
    [navigation],
  );

  const handleCancelled = useCallback(() => {
    // The user used the form's own close/finish affordance — just leave.
    navigation.goBack();
  }, [navigation]);

  // ---------------------------------------------------------------------
  // Errors — switch on the SDK error code
  // ---------------------------------------------------------------------

  const handleError = useCallback(
    (error: PortalErrorInfo) => {
      switch (error.code) {
        case 'offline':
          Alert.alert('You are offline', 'Check your connection and tap "Try again".');
          break;
        case 'versionIncompatible':
          Alert.alert(
            'Update required',
            error.message ?? 'This app version is not compatible with the portal.',
          );
          break;
        case 'authExpired':
          // Only reached when onAuthExpired is not set or refresh failed.
          Alert.alert('Session expired', 'Please sign in again.', [
            { text: 'OK', onPress: signOut },
          ]);
          break;
        case 'manifestFailed':
        case 'bridgeTimeout':
        case 'httpError':
        case 'loadFailed':
        case 'webProcessTerminated':
        default:
          // The component already renders a retryable error state for these;
          // an Alert/toast is optional. Log for diagnostics:
          console.warn(`[portal] ${error.code}`, error.message, error.httpStatus ?? '');
          break;
      }
    },
    [signOut],
  );

  // ---------------------------------------------------------------------
  // Auth refresh — the portal's token expired mid-session
  // ---------------------------------------------------------------------

  const handleAuthExpired = useCallback(
    async (refresh: (next: PortalAuthState) => void) => {
      try {
        const fresh = await refreshToken(auth?.token ?? '');
        const next: PortalAuthState = { token: fresh.token, branchId: fresh.branchId };
        setAuth(next); // keep the app's auth store in sync
        refresh(next); // resume the portal; its overlay clears on web ack
      } catch {
        Alert.alert('Session expired', 'Please sign in again.', [
          { text: 'OK', onPress: signOut },
        ]);
      }
    },
    [auth, setAuth, signOut],
  );

  // ---------------------------------------------------------------------
  // Close requests — Android hardware back (via the component's built-in
  // BackHandler) lands here whenever the web form did NOT consume the press.
  // ---------------------------------------------------------------------

  const handleCloseRequested = useCallback(() => {
    Alert.alert('Leave this form?', 'Any unsaved changes will be lost.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  }, [navigation]);

  if (!auth) {
    // Signed out while this screen was open — the navigator will unmount us.
    return null;
  }

  return (
    <AmthalPortalForm
      ref={portalRef}
      style={styles.portal}
      config={{
        baseUrl: PORTAL_BASE_URL,
        locale: 'en',
        theme: 'system',
        minPortalVersion: '1.0.0',
        enableLogging: __DEV__,
      }}
      auth={auth}
      request={request}
      onReady={() => console.log('[portal] ready')}
      onSubmitted={handleSubmitted}
      onCancelled={handleCancelled}
      onError={handleError}
      onAuthExpired={handleAuthExpired}
      onCloseRequested={handleCloseRequested}
      // Keep the native header in sync with the portal's own title.
      onNavigate={(nav) => {
        if (nav.title) navigation.setOptions({ title: nav.title });
      }}
      // Return true to intercept external links yourself; false = system browser.
      onOpenExternal={(url) => {
        console.log('[portal] opening externally:', url);
        return false;
      }}
      renderLoading={() => (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingLabel}>Loading your form…</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  portal: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  loadingLabel: {
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
  },
});
