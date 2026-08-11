import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { formatCompactAmount } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';
import { dashboardColors } from './dashboardTheme';

interface MetricCardProps {
  title: string;
  amount: number;
  subtitle: string;
  icon: string;
  iconColor: string;
  onPress?: () => void;
  loading?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  amount,
  subtitle,
  icon,
  iconColor,
  onPress,
  loading,
}) => {
  const inner = (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: `${iconColor}18` }]}>
        <Icon name={icon} size={22} color={iconColor} />
      </View>
      {loading ? (
        <>
          <View style={styles.skLine} />
          <View style={styles.skLineSm} />
        </>
      ) : (
        <>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.amount}>{formatCompactAmount(amount)}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.75}>
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.container}>{inner}</View>;
};

interface ReceivablesPayablesRowProps {
  receivables: number;
  receivableParties: number;
  salesMtd: number;
  salesCount: number;
  loading?: boolean;
  onReceivablesPress?: () => void;
  onSalesPress?: () => void;
}

export const ReceivablesPayablesRow: React.FC<ReceivablesPayablesRowProps> = ({
  receivables,
  receivableParties,
  salesMtd,
  salesCount,
  loading,
  onReceivablesPress,
  onSalesPress,
}) => {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <MetricCard
        title={t('dashboard.receivablesTitle')}
        amount={receivables}
        subtitle={t('dashboard.partyCount', { count: receivableParties })}
        icon="account-cash-outline"
        iconColor={dashboardColors.positive}
        onPress={onReceivablesPress}
        loading={loading}
      />
      <MetricCard
        title={t('dashboard.salesMtd')}
        amount={salesMtd}
        subtitle={t('dashboard.voucherCount', { count: salesCount })}
        icon="trending-up"
        iconColor={dashboardColors.accent}
        onPress={onSalesPress}
        loading={loading}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  container: {
    flex: 1,
  },
  card: {
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
    padding: 16,
    minHeight: 120,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  amount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 4,
  },
  skLine: {
    height: 20,
    width: '70%',
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    marginTop: 8,
  },
  skLineSm: {
    height: 12,
    width: '50%',
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    marginTop: 8,
  },
});

export default ReceivablesPayablesRow;
