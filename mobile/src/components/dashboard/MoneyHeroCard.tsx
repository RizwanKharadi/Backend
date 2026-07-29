import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { LineChart } from 'react-native-chart-kit';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  formatIndianCompact,
  calcPercentChange,
} from '../../utils/formatters';
import { dashboardColors } from './dashboardTheme';

const chartWidth = Dimensions.get('window').width - 72;

interface MoneyHeroCardProps {
  thisMonth: number;
  lastMonth: number;
  loading?: boolean;
}

const MoneyHeroCard: React.FC<MoneyHeroCardProps> = ({
  thisMonth,
  lastMonth,
  loading,
}) => {
  const change = calcPercentChange(thisMonth, lastMonth);
  const isPositive = change === null || change >= 0;

  const sparkData = buildSparkline(lastMonth, thisMonth);

  if (loading) {
    return (
      <View style={[styles.card, styles.skeleton]}>
        <View style={styles.skeletonLineWide} />
        <View style={styles.skeletonLine} />
        <View style={styles.skeletonChart} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>This month</Text>
      <Text style={styles.amount}>{formatIndianCompact(thisMonth)}</Text>
      <Text style={styles.subtitle}>Total voucher activity (MTD)</Text>

      {change !== null ? (
        <View style={styles.changeRow}>
          <Icon
            name={isPositive ? 'trending-up' : 'trending-down'}
            size={16}
            color={isPositive ? dashboardColors.positive : dashboardColors.negative}
          />
          <Text
            style={[
              styles.changeText,
              { color: isPositive ? dashboardColors.positive : dashboardColors.negative },
            ]}
          >
            {isPositive ? '+' : ''}
            {change.toFixed(1)}% vs last month
          </Text>
        </View>
      ) : (
        <Text style={styles.noChange}>No comparison data yet</Text>
      )}

      {thisMonth > 0 || lastMonth > 0 ? (
        <LineChart
          data={{
            labels: [],
            datasets: [{ data: sparkData, color: () => dashboardColors.accent, strokeWidth: 2 }],
          }}
          width={chartWidth}
          height={72}
          withDots={false}
          withInnerLines={false}
          withOuterLines={false}
          withVerticalLabels={false}
          withHorizontalLabels={false}
          chartConfig={{
            backgroundColor: dashboardColors.cardBg,
            backgroundGradientFrom: dashboardColors.cardBg,
            backgroundGradientTo: dashboardColors.cardBg,
            decimalPlaces: 0,
            color: () => dashboardColors.accent,
            labelColor: () => dashboardColors.muted,
            propsForBackgroundLines: { strokeWidth: 0 },
          }}
          bezier
          style={styles.chart}
        />
      ) : null}
    </View>
  );
};

function buildSparkline(last: number, current: number): number[] {
  const a = Math.max(last, 0);
  const b = Math.max(current, 0);
  if (a === 0 && b === 0) return [0, 0, 0, 0, 0];
  return [
    a * 0.55,
    a * 0.72,
    a * 0.88,
    a,
    (a + b) / 2,
    b * 0.92,
    b,
  ].map((v) => Math.max(v, 0.01));
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  amount: {
    fontSize: 36,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: dashboardColors.muted,
    marginTop: 2,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
  },
  changeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  noChange: {
    fontSize: 13,
    color: dashboardColors.muted,
    marginTop: 10,
  },
  chart: {
    marginTop: 8,
    marginLeft: -16,
    borderRadius: 8,
  },
  skeleton: {
    minHeight: 160,
  },
  skeletonLineWide: {
    height: 14,
    width: '40%',
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    marginBottom: 12,
  },
  skeletonLine: {
    height: 32,
    width: '60%',
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    marginBottom: 16,
  },
  skeletonChart: {
    height: 72,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
  },
});

export default MoneyHeroCard;
