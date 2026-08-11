import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import TransactionsHeader from '../components/transactions/TransactionsHeader';
import { dashboardColors } from '../components/dashboard/dashboardTheme';
import {
  TRANSACTION_TYPES,
  TRANSACTION_GROUP_META,
  TransactionGroup,
  TransactionTypeConfig,
} from '../constants/transactionTypes';
import { MainStackParamList, MainTabScreenProps } from '../types/navigation';
import { useCompany } from '../store/hooks';
import { voucherService } from '../services/voucherService';
import { Voucher } from '../types';
import { formatCompactAmount } from '../utils/formatters';
import { useTranslation } from 'react-i18next';
import {
  matchesVoucherType,
  monthStartToToday,
  sumVoucherAmounts,
} from '../utils/voucherHelpers';

type StackNav = NativeStackNavigationProp<MainStackParamList>;
type Props = MainTabScreenProps<'Transactions'>;

const MIN_RELOAD_MS = 45_000;

const VoucherTypesScreen: React.FC<Props> = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<StackNav>();
  const { selectedCompany } = useCompany();

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [monthVouchers, setMonthVouchers] = useState<Voucher[]>([]);
  const lastLoadRef = useRef(0);

  const stackNav = navigation.getParent() ?? navigation;
  const monthRange = useMemo(() => monthStartToToday(), []);

  const loadMonthVouchers = useCallback(
    async (force = false) => {
      if (!selectedCompany?.id) {
        setMonthVouchers([]);
        return;
      }
      const now = Date.now();
      if (!force && now - lastLoadRef.current < MIN_RELOAD_MS) return;

      setLoadingMonth(true);
      try {
        const res = await voucherService.getVouchers({
          companyId: selectedCompany.id,
          fromDate: monthRange.fromDate,
          toDate: monthRange.toDate,
          limit: 500,
          page: 1,
        });
        setMonthVouchers(res.data || []);
        lastLoadRef.current = Date.now();
      } catch {
        setMonthVouchers([]);
      } finally {
        setLoadingMonth(false);
      }
    },
    [selectedCompany?.id, monthRange.fromDate, monthRange.toDate]
  );

  useFocusEffect(
    useCallback(() => {
      loadMonthVouchers(false);
    }, [loadMonthVouchers])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMonthVouchers(true);
    setRefreshing(false);
  };

  const countFor = (id: string): number =>
    monthVouchers.filter((v) => matchesVoucherType(v, id)).length;

  const amountFor = (id: string): number =>
    sumVoucherAmounts(monthVouchers.filter((v) => matchesVoucherType(v, id)));

  const openType = (item: TransactionTypeConfig) => {
    stackNav.navigate('FilteredVouchers', {
      voucherType: item.id,
      title: item.title,
    });
  };

  const openDayBook = () => {
    stackNav.navigate('DayBook', {});
  };

  const renderCard = (item: TransactionTypeConfig) => {
    const count = countFor(item.id);
    const amount = amountFor(item.id);

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.typeCard}
        onPress={() => openType(item)}
        activeOpacity={0.82}
      >
        <View style={[styles.cardAccent, { backgroundColor: item.color }]} />
        <View style={[styles.typeIconWrap, { backgroundColor: `${item.color}18` }]}>
          <Icon name={item.icon} size={26} color={item.color} />
        </View>
        <Text style={styles.typeTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.typeSubtitle} numberOfLines={1}>
          {item.subtitle}
        </Text>
        {loadingMonth ? (
          <ActivityIndicator size="small" color={item.color} style={styles.cardLoader} />
        ) : (
          <>
            <Text style={[styles.typeAmount, { color: item.color }]}>
              {amount > 0 ? formatCompactAmount(amount) : '—'}
            </Text>
            <Text style={styles.typeCount}>
              {count} this month
            </Text>
          </>
        )}
        <Icon
          name="chevron-right"
          size={18}
          color={dashboardColors.muted}
          style={styles.cardChevron}
        />
      </TouchableOpacity>
    );
  };

  const renderGroup = (group: TransactionGroup) => {
    const items = TRANSACTION_TYPES.filter((t) => t.group === group);
    const meta = TRANSACTION_GROUP_META[group];
    return (
      <View key={group} style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIcon, { backgroundColor: `${meta.color}18` }]}>
            <Icon name={meta.icon} size={16} color={meta.color} />
          </View>
          <Text style={styles.sectionTitle}>{meta.label}</Text>
        </View>
        <View style={styles.grid}>{items.map(renderCard)}</View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TransactionsHeader
        subtitle={
          selectedCompany?.name
            ? `${selectedCompany.name} · ${monthRange.fromDate} to today`
            : 'Browse by voucher type'
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={dashboardColors.accent}
          />
        }
      >
        <TouchableOpacity
          style={styles.dayBookHero}
          onPress={openDayBook}
          activeOpacity={0.85}
        >
          <View style={styles.dayBookGlow} />
          <View style={styles.dayBookInner}>
            <View style={styles.dayBookIcon}>
              <Icon name="book-open-page-variant" size={32} color="#fff" />
            </View>
            <View style={styles.dayBookText}>
              <Text style={styles.dayBookTitle}>{t('reports.item.dayBook.title')}</Text>
              <Text style={styles.dayBookDesc}>
                {t('reports.item.dayBook.chronological')}
              </Text>
            </View>
            <Icon name="chevron-right" size={28} color="rgba(255,255,255,0.85)" />
          </View>
        </TouchableOpacity>

        {!selectedCompany?.id ? (
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              {t('vouchers.selectCompanyTotals')}
            </Text>
          </View>
        ) : null}

        <Text style={styles.periodHint}>
          Amounts below are from {monthRange.fromDate} through today
        </Text>

        {renderGroup('inflow')}
        {renderGroup('outflow')}
        {renderGroup('ledger')}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 12,
  },
  dayBookHero: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#1e40af',
  },
  dayBookGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#3b82f6',
    opacity: 0.35,
    transform: [{ translateX: 80 }, { scale: 1.4 }],
  },
  dayBookInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
  },
  dayBookIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  dayBookText: {
    flex: 1,
  },
  dayBookTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  dayBookDesc: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    marginTop: 4,
  },
  hintBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  hintText: {
    fontSize: 13,
    color: '#92400e',
    textAlign: 'center',
  },
  periodHint: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginBottom: 16,
    fontWeight: '500',
  },
  section: {
    marginBottom: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  typeCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
    padding: 14,
    paddingLeft: 16,
    minHeight: 132,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  typeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  typeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    paddingRight: 20,
  },
  typeSubtitle: {
    fontSize: 11,
    color: dashboardColors.muted,
    marginTop: 2,
  },
  typeAmount: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 10,
  },
  typeCount: {
    fontSize: 11,
    color: dashboardColors.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  cardLoader: {
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  cardChevron: {
    position: 'absolute',
    top: 14,
    right: 10,
  },
  bottomSpacer: {
    height: 16,
  },
});

export default VoucherTypesScreen;
