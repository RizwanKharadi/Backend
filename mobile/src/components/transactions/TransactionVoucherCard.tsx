import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Voucher } from '../../types';
import { formatCurrencyAbs, formatDate } from '../../utils/formatters';
import { dashboardColors } from '../dashboard/dashboardTheme';
import { getTransactionTypeConfig } from '../../constants/transactionTypes';

interface TransactionVoucherCardProps {
  voucher: Voucher;
  accentColor: string;
  onPress: () => void;
}

const TransactionVoucherCard: React.FC<TransactionVoucherCardProps> = ({
  voucher,
  accentColor,
  onPress,
}) => {
  const config = getTransactionTypeConfig(
    (voucher.voucherType || '').toLowerCase().replace(/\s+/g, '_')
  );
  const icon = config?.icon || 'receipt-text-outline';
  const party = voucher.partyName?.trim() || 'Cash / walk-in';
  const number = voucher.voucherNumber || '—';
  const status = (voucher.status || 'posted').toLowerCase();

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
      <View style={[styles.iconWrap, { backgroundColor: `${accentColor}18` }]}>
        <Icon name={icon} size={22} color={accentColor} />
      </View>
      <View style={styles.body}>
        <Text style={styles.party} numberOfLines={1}>
          {party}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {number} · {formatDate(voucher.date || voucher.createdAt || '')}
        </Text>
        <View style={styles.tagRow}>
          <View style={[styles.typeTag, { backgroundColor: `${accentColor}14` }]}>
            <Text style={[styles.typeTagText, { color: accentColor }]}>
              {(voucher.voucherType || '').replace(/_/g, ' ')}
            </Text>
          </View>
          <View style={styles.statusTag}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        </View>
      </View>
      <View style={styles.end}>
        <Text style={[styles.amount, { color: accentColor }]}>
          {formatCurrencyAbs(voucher.amount || 0)}
        </Text>
        <Icon name="chevron-right" size={20} color={dashboardColors.muted} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    marginVertical: 12,
  },
  body: {
    flex: 1,
    marginHorizontal: 12,
    paddingVertical: 12,
  },
  party: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  meta: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 3,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  typeTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeTagText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'capitalize',
  },
  end: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    gap: 2,
  },
  amount: {
    fontSize: 14,
    fontWeight: '800',
  },
});

export default TransactionVoucherCard;
