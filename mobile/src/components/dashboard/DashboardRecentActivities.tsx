import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Voucher } from '../../types';
import { formatCurrencyAbs, formatRelativeTime } from '../../utils/formatters';
import { dashboardColors, voucherTypeColor } from './dashboardTheme';
import { useTranslation } from 'react-i18next';

interface DashboardRecentActivitiesProps {
  vouchers: Voucher[];
  loading?: boolean;
  onActivityPress: (voucherId: string) => void;
  onSeeAllPress?: () => void;
}

const DashboardRecentActivities: React.FC<DashboardRecentActivitiesProps> = ({
  vouchers,
  loading,
  onActivityPress,
  onSeeAllPress,
}) => {
  const { t } = useTranslation();
  return (
  <View style={styles.card}>
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.iconWrap}>
          <Icon name="history" size={20} color="#8b5cf6" />
        </View>
        <Text style={styles.title}>{t('dashboard.recentActivities')}</Text>
      </View>
      {onSeeAllPress ? (
        <TouchableOpacity onPress={onSeeAllPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>{t('common.viewAll')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>

    {loading ? (
      <ActivityIndicator style={styles.loader} color={dashboardColors.accent} />
    ) : vouchers.length === 0 ? (
      <View style={styles.empty}>
        <Icon name="timeline-clock-outline" size={36} color={dashboardColors.muted} />
        <Text style={styles.emptyText}>{t('dashboard.noRecentActivity')}</Text>
      </View>
    ) : (
      vouchers.map((v, index) => {
        const typeColor = voucherTypeColor(v.voucherType);
        return (
          <TouchableOpacity
            key={v.id}
            style={[styles.row, index < vouchers.length - 1 && styles.rowBorder]}
            onPress={() => onActivityPress(v.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.typeBadge, { backgroundColor: `${typeColor}18` }]}>
              <Icon name="receipt-text-outline" size={18} color={typeColor} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.voucherTitle} numberOfLines={1}>
                {v.partyName || v.voucherType || t('vouchers.fallbackName')}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {v.voucherNumber || v.voucherType} · {formatRelativeTime(v.date || v.createdAt)}
              </Text>
            </View>
            <View style={styles.rowEnd}>
              <Text style={styles.amount}>{formatCurrencyAbs(v.amount || 0)}</Text>
              <Icon name="chevron-right" size={18} color={dashboardColors.muted} />
            </View>
          </TouchableOpacity>
        );
      })
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
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#8b5cf618',
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingVertical: 28,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: dashboardColors.muted,
    textAlign: 'center',
    paddingHorizontal: 12,
    lineHeight: 20,
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
  meta: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 2,
  },
  rowEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  amount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
});

export default DashboardRecentActivities;
