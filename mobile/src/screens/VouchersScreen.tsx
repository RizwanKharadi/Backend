import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import {
  Surface,
  List,
  Chip,
  FAB,
  Searchbar,
  Text,
  Button,
  Menu,
  IconButton,
  Divider,
  useTheme,
  ActivityIndicator,
} from 'react-native-paper';
import { useDispatch } from 'react-redux';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Components
import Header from '../components/common/Header';

// Store
import { AppDispatch } from '../store';
import { useVoucher } from '../store/hooks';
import { fetchVouchers, deleteVoucher, clearError, setFilters } from '../store/slices/voucherSlice';

// Types
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ReportsStackParamList } from '../types/navigation';
import { Voucher } from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';
import { useTranslation } from 'react-i18next';

interface VoucherFilters {
  type: string;
  status: string;
  dateRange: string;
  search: string;
}

type Props = NativeStackScreenProps<ReportsStackParamList, 'VouchersList'>;

const VouchersScreen: React.FC<Props> = ({ navigation }) => {
  const rootNavigation = navigation.getParent()?.getParent() ?? navigation.getParent();
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { t } = useTranslation();

  const { vouchers, error, pagination, isLoading } = useVoucher();

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<string | null>(null);
  const [filters, setLocalFilters] = useState<VoucherFilters>({
    type: 'all',
    status: 'all',
    dateRange: 'all',
    search: '',
  });

  useEffect(() => {
    loadVouchers();
  }, [dispatch, filters]);

  useEffect(() => {
    if (error) {
      Alert.alert(t('common.error'), error);
      dispatch(clearError());
    }
  }, [error, dispatch, t]);

  const loadVouchers = useCallback(async () => {
    try {
      await dispatch(fetchVouchers({ refresh: true })).unwrap();
    } catch (error) {
      console.error('Failed to load vouchers:', error);
    }
  }, [dispatch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadVouchers();
    setRefreshing(false);
  }, [loadVouchers]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setLocalFilters(prev => ({ ...prev, search: query }));
    dispatch(setFilters({ ...filters, search: query }));
  }, [dispatch, filters]);

  const handleLoadMore = useCallback(async () => {
    if (isLoading || refreshing || !pagination.hasMore) {
      return;
    }

    setLoadingMore(true);
    try {
      await dispatch(fetchVouchers({ page: pagination.page + 1 })).unwrap();
    } catch (error) {
      console.error('Failed to load more vouchers:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [dispatch, isLoading, refreshing, pagination.hasMore, pagination.page]);

  const renderFooter = () => {
    if (!loadingMore) {
      return null;
    }

    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator animating size="small" />
      </View>
    );
  };

  const handleVoucherPress = useCallback((voucherId: string) => {
    rootNavigation?.navigate('VoucherDetail', { voucherId });
  }, [rootNavigation]);

  const handleDeleteVoucher = useCallback(async (voucherId: string) => {
    Alert.alert(
      t('vouchers.delete.title'),
      t('vouchers.delete.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await dispatch(deleteVoucher(voucherId)).unwrap();
              Alert.alert(t('common.success'), t('vouchers.delete.success'));
            } catch (error) {
              Alert.alert(t('common.error'), t('vouchers.delete.failed'));
            }
          },
        },
      ]
    );
  }, [dispatch, t]);

  const getVoucherTypeIcon = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'sales': return 'cash-register';
      case 'purchase': return 'cart';
      case 'payment': return 'credit-card';
      case 'receipt': return 'receipt';
      case 'journal': return 'book-open';
      default: return 'file-document';
    }
  };

  const getVoucherStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'approved': return theme.colors.primary;
      case 'pending': return theme.colors.tertiary;
      case 'rejected': return theme.colors.error;
      case 'draft': return theme.colors.outline;
      default: return theme.colors.onSurfaceVariant;
    }
  };

  const renderVoucherItem = ({ item }: { item: Voucher }) => (
    <Surface style={[styles.voucherCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
      <List.Item
        title={`${item.voucherNumber} - ${item.voucherType}`}
        description={`${item.narration || t('common.noDescription')} • ${formatDate(item.date)}`}
        left={() => (
          <View style={styles.iconContainer}>
            <Icon
              name={getVoucherTypeIcon(item.voucherType)}
              size={24}
              color={theme.colors.primary}
            />
          </View>
        )}
        right={() => (
          <View style={styles.rightContainer}>
            <Text
              variant="titleMedium"
              style={[styles.amount, { color: theme.colors.onSurface }]}
            >
              {formatCurrency(item.amount)}
            </Text>
            <Chip
              mode="outlined"
              compact
              style={[styles.statusChip, { borderColor: getVoucherStatusColor(item.status) }]}
              textStyle={[styles.statusChipText, { color: getVoucherStatusColor(item.status) }]}
            >
              {item.status}
            </Chip>
            <Menu
              visible={menuVisible && selectedVoucher === item.id}
              onDismiss={() => {
                setMenuVisible(false);
                setSelectedVoucher(null);
              }}
              anchor={
                <IconButton
                  icon="dots-vertical"
                  size={20}
                  onPress={() => {
                    setSelectedVoucher(item.id);
                    setMenuVisible(true);
                  }}
                />
              }
            >
              <Menu.Item
                onPress={() => {
                  setMenuVisible(false);
                  setSelectedVoucher(null);
                  handleVoucherPress(item.id);
                }}
                title={t('common.viewDetails')}
                leadingIcon="eye"
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(false);
                  setSelectedVoucher(null);
                  rootNavigation?.navigate('CreateVoucher', { type: 'edit', voucherId: item.id });
                }}
                title={t('common.edit')}
                leadingIcon="pencil"
              />
              <Divider />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(false);
                  setSelectedVoucher(null);
                  handleDeleteVoucher(item.id);
                }}
                title={t('common.delete')}
                leadingIcon="delete"
                titleStyle={{ color: theme.colors.error }}
              />
            </Menu>
          </View>
        )}
        onPress={() => handleVoucherPress(item.id)}
        style={styles.listItem}
      />
    </Surface>
  );

  return (
    <View style={styles.container}>
      <Header
        title={t('vouchers.title')}
        subtitle={t('vouchers.count', {
          count: pagination.total || vouchers.length,
        })}
        showBack
        showSync
        onBackPress={() => navigation.goBack()}
        onSettingsPress={() => rootNavigation?.navigate('Settings')}
        onSyncPress={() => rootNavigation?.navigate('Sync')}
      />

      <View style={styles.content}>
        {/* Search and Filters */}
        <Surface style={[styles.searchContainer, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <Searchbar
            placeholder={t('vouchers.searchPlaceholder')}
            onChangeText={handleSearch}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
          <Button
            mode="outlined"
            onPress={() => setShowFilters(!showFilters)}
            icon="filter"
            compact
            style={styles.filterButton}
          >
            {t('vouchers.filters')}
          </Button>
        </Surface>

        {/* Vouchers List */}
        <FlatList
          data={vouchers}
          renderItem={renderVoucherItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon
                name="receipt-outline"
                size={64}
                color={theme.colors.onSurfaceVariant}
              />
              <Text
                variant="headlineSmall"
                style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
              >
                {t('vouchers.emptyTitle')}
              </Text>
              <Text
                variant="bodyMedium"
                style={[styles.emptySubtitle, { color: theme.colors.onSurfaceVariant }]}
              >
                {searchQuery
                  ? t('vouchers.emptySearchHint')
                  : t('vouchers.emptyCreateHint')}
              </Text>
              {!searchQuery && (
                <Button
                  mode="contained"
                  onPress={() => rootNavigation?.navigate('CreateNewVoucher')}
                  icon="plus"
                  style={styles.emptyButton}
                >
                  {t('vouchers.create')}
                </Button>
              )}
            </View>
          }
        />
      </View>

      {/* Floating Action Button */}
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => rootNavigation?.navigate('CreateNewVoucher')}
        label={t('vouchers.newVoucher')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  searchbar: {
    flex: 1,
    elevation: 0,
  },
  searchInput: {
    fontSize: 16,
  },
  filterButton: {
    minWidth: 80,
  },
  listContainer: {
    paddingBottom: 100,
  },
  footerLoader: {
    paddingVertical: 16,
  },
  voucherCard: {
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  listItem: {
    paddingVertical: 8,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
  },
  rightContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  amount: {
    fontWeight: '600',
  },
  statusChip: {
    height: 24,
  },
  statusChipText: {
    fontSize: 12,
    lineHeight: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
    marginBottom: 24,
  },
  emptyButton: {
    minWidth: 160,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
});

export default VouchersScreen;
