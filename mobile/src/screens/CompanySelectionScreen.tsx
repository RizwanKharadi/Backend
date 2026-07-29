import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
  Pressable,
} from 'react-native';
import {
  Text,
  Button,
  ActivityIndicator,
  useTheme,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useDispatch, useSelector } from 'react-redux';
import Header from '../components/common/Header';
import { MainStackScreenProps } from '../types/navigation';
import { AppDispatch, RootState } from '../store';
import {
  fetchCompanies,
  setSelectedCompany,
} from '../store/slices/companySlice';
import { setSelectedCompany as setPersistedCompanyId } from '../store/slices/settingsSlice';
import { Company } from '../types';

type Props = MainStackScreenProps<'CompanySelection'>;

const CompanySelectionScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { companies, selectedCompany, isLoading } = useSelector(
    (state: RootState) => state.company
  );

  const [refreshing, setRefreshing] = useState(false);

  const selectedId = selectedCompany?.id
    ? String(selectedCompany.id)
    : '';

  const load = useCallback(async () => {
    try {
      await dispatch(fetchCompanies({})).unwrap();
    } catch (e: any) {
      Alert.alert('Could not load companies', e || 'Try again later');
    }
  }, [dispatch]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  React.useEffect(() => {
    load();
  }, [load]);

  const handleSelect = (item: Company) => {
    const id = String(item.id || (item as any)._id || '');
    dispatch(
      setSelectedCompany({
        ...item,
        id,
      })
    );
    dispatch(setPersistedCompanyId(id));
    navigation.goBack();
  };

  const renderItem = ({ item }: { item: Company }) => {
    const id = String(item.id || (item as any)._id || '');
    const tally = item.tallyIntegration;
    const subtitle = tally?.companyPath
      ? `Tally-linked${tally.lastSyncDate ? ' · synced' : ''}`
      : 'Placeholder or not linked to Tally yet';

    return (
      <Pressable
        onPress={() => handleSelect(item)}
        style={({ pressed }) => [
          styles.row,
          pressed && styles.rowPressed,
        ]}
      >
        <View style={styles.rowText}>
          <Text variant="titleMedium">{item.name || 'Unnamed company'}</Text>
          <Text variant="bodySmall" style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>
        <Icon
          name={selectedId === id ? 'check-circle' : 'circle-outline'}
          size={26}
          color={selectedId === id ? theme.colors.primary : '#9ca3af'}
        />
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <Header
        title="Company selection"
        subtitle="Choose which workspace to view"
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <View style={styles.inner}>
        <Text variant="bodyMedium" style={styles.help}>
          If you use desktop sync, pick the company that matches your Tally books. Data in the app is filtered by
          this workspace.
        </Text>

        {isLoading && companies.length === 0 ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={companies}
            keyExtractor={(item, index) =>
              String(item.id || (item as any)._id || index)
            }
            renderItem={renderItem}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <Text style={styles.empty}>
                No companies yet. Complete signup (optional workspace) or run desktop sync to create your Tally
                company in the cloud.
              </Text>
            }
          />
        )}

        <Button mode="outlined" onPress={onRefresh} loading={refreshing}>
          Refresh list
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flex: 1, padding: 16 },
  help: { marginBottom: 16, opacity: 0.85 },
  loader: { marginTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  rowPressed: { opacity: 0.92 },
  rowText: { flex: 1, paddingRight: 8 },
  subtitle: { marginTop: 4, opacity: 0.75 },
  empty: { textAlign: 'center', marginTop: 32, paddingHorizontal: 16, opacity: 0.7 },
});

export default CompanySelectionScreen;
