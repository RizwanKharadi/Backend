import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { formatCompactAmount } from '../../utils/formatters';
import { dashboardColors } from './dashboardTheme';
import { useTranslation } from 'react-i18next';

export interface CashPulseItem {
  id: string;
  label: string;
  amount: number;
  count: number;
  icon: string;
  color: string;
}

interface CashPulseRowProps {
  items: CashPulseItem[];
  onItemPress?: (id: string) => void;
}

const CashPulseRow: React.FC<CashPulseRowProps> = ({ items, onItemPress }) => {
  const { t } = useTranslation();
  if (!items.length) return null;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionTitle}>{t('dashboard.todaysPulse')}</Text>
      <View style={styles.row}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.chip}
            onPress={() => onItemPress?.(item.id)}
            activeOpacity={0.75}
          >
            <View style={[styles.iconCircle, { backgroundColor: `${item.color}15` }]}>
              <Icon name={item.icon} size={18} color={item.color} />
            </View>
            <Text style={styles.chipLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={styles.chipAmount}>{formatCompactAmount(item.amount)}</Text>
            <Text style={styles.chipCount}>{item.count} txn</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  chip: {
    flex: 1,
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: dashboardColors.muted,
    textAlign: 'center',
  },
  chipAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  chipCount: {
    fontSize: 10,
    color: dashboardColors.muted,
    marginTop: 2,
  },
});

export default CashPulseRow;
