import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PortalFormRequest } from '@amthal-group/portal-react-native';
import type { RootStackParamList } from '../navigation';
import { useAuth } from '../AuthContext';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

interface DemoEntry {
  key: string;
  title: string;
  subtitle: string;
  request: PortalFormRequest;
}

const DEMOS: DemoEntry[] = [
  {
    key: 'new-external',
    title: 'New External Application',
    subtitle: 'kind: newApplication · type: external · product 42',
    request: { kind: 'newApplication', type: 'external', productID: 42 },
  },
  {
    key: 'new-internal',
    title: 'New Internal Application',
    subtitle: 'kind: newApplication · type: internal · product 7',
    request: { kind: 'newApplication', type: 'internal', productID: 7 },
  },
  {
    key: 'existing-readonly',
    title: 'Open Existing Application (read-only)',
    subtitle: 'kind: existingApplication · batch 1001 · header 5005',
    request: {
      kind: 'existingApplication',
      type: 'external',
      productID: 42,
      batchID: 1001,
      headerID: 5005,
      readOnly: true,
    },
  },
];

export default function HomeScreen({ navigation, route }: Props) {
  const { signOut } = useAuth();
  const lastResult = route.params?.lastResult;

  return (
    <View style={styles.container}>
      {lastResult ? (
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>Last submission</Text>
          <Text style={styles.bannerText}>
            product {lastResult.productID}
            {lastResult.applicationNo != null ? ` · application ${lastResult.applicationNo}` : ''}
            {lastResult.batchID != null ? ` · batch ${lastResult.batchID}` : ''}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={DEMOS}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('Form', { request: item.request, title: item.title })}
          >
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <TouchableOpacity style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutLabel}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  banner: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#dcfce7',
    borderRadius: 8,
    padding: 12,
  },
  bannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
  },
  bannerText: {
    marginTop: 2,
    fontSize: 14,
    color: '#14532d',
  },
  list: {
    padding: 16,
  },
  row: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  rowSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
  },
  separator: {
    height: 10,
  },
  signOut: {
    alignItems: 'center',
    padding: 16,
  },
  signOutLabel: {
    color: '#dc2626',
    fontSize: 15,
    fontWeight: '600',
  },
});
