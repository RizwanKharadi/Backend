import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Voucher } from '../../types';
import { formatCurrencyAbs, formatRelativeTime } from '../../utils/formatters';
import { dashboardColors, voucherTypeColor } from './dashboardTheme';
import { useTranslation } from 'react-i18next';

interface RecentVouchersListProps {
  vouchers: Voucher[];
  loading?: boolean;
  onVoucherPress: (voucherId: string) => void;
  onSeeAllPress?: () => void;
}

const RecentVouchersList: React.FC<RecentVouchersListProps> = ({
  vouchers,
  loading,
  onVoucherPress,
  onSeeAllPress,
}) => {
  const { t } = useTranslation();
  return (
  <View style={styles.card}>
    <View style={styles.header}>
      <Text style={styles.title}>{t('dashboard.recentVouchers')}</Text>
      {onSeeAllPress ? (
        <TouchableOpacity onPress={onSeeAllPress}>
          <Text style={styles.seeAll}>{t('dashboard.seeAll')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>

    {loading ? (
      <ActivityIndicator style={styles.loader} color={dashboardColors.accent} />
    ) : vouchers.length === 0 ? (
      <View style={styles.empty}>
        <Icon name="receipt-text-outline" size={32} color={dashboardColors.muted} />
        <Text style={styles.emptyText}>{t('dashboard.noVouchersYet')}</Text>
      </View>
    ) : (
      vouchers.map((v, index) => (
        <TouchableOpacity
          key={v.id}
          style={[styles.row, index < vouchers.length - 1 && styles.rowBorder]}
          onPress={() => onVoucherPress(v.id)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.typeBadge,
              { backgroundColor: `${voucherTypeColor(v.voucherType)}18` },
            ]}
          >
            <Icon
              name="receipt"
              size={18}
              color={voucherTypeColor(v.voucherType)}
            />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.voucherTitle} numberOfLines={1}>
              {v.voucherNumber || v.voucherType}
            </Text>
            <Text style={styles.party} numberOfLines={1}>
              {v.partyName || v.voucherType}
            </Text>
          </View>
          <View style={styles.rowEnd}>
            <Text style={styles.amount}>{formatCurrencyAbs(v.amount || 0)}</Text>
            <Text style={styles.time}>{formatRelativeTime(v.date || v.createdAt)}</Text>
          </View>
        </TouchableOpacity>
      ))
    )}
  </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
    color: dashboardColors.accent,
  },
  loader: {
    paddingVertical: 24,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: dashboardColors.muted,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  typeBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: {
    flex: 1,
    marginRight: 8,
  },
  voucherTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  party: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 2,
  },
  rowEnd: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  time: {
    fontSize: 11,
    color: dashboardColors.muted,
    marginTop: 2,
  },
});

export default RecentVouchersList;
