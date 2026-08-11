import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { LineChart } from 'react-native-chart-kit';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardColors } from './dashboardTheme';
import { formatCompactAmount } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';

const chartWidth = Dimensions.get('window').width - 64;

interface DashboardSalesTrendProps {
  labels: string[];
  values: number[];
  loading?: boolean;
}

const DashboardSalesTrend: React.FC<DashboardSalesTrendProps> = ({
  labels,
  values,
  loading,
}) => {
  const { t } = useTranslation();
  const hasData = values.some((v) => v > 0);
  const total = useMemo(() => values.reduce((s, v) => s + v, 0), [values]);

  const chartData = useMemo(() => {
    const safe = values.map((v) => Math.max(v, 0));
    if (!safe.some((v) => v > 0)) {
      return [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
    }
    return safe;
  }, [values]);

  const displayLabels =
    labels.length === chartData.length
      ? labels
      : chartData.map((_, i) => `D${i + 1}`);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconWrap}>
            <Icon name="chart-areaspline" size={20} color={dashboardColors.accent} />
          </View>
          <View>
            <Text style={styles.title}>{t('dashboard.salesTrend')}</Text>
            <Text style={styles.subtitle}>{t('dashboard.salesTrendSubtitle')}</Text>
          </View>
        </View>
        {!loading && hasData ? (
          <View style={styles.totalPill}>
            <Text style={styles.totalLabel}>{t('dashboard.weekTotal')}</Text>
            <Text style={styles.totalValue}>{formatCompactAmount(total)}</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator
          color={dashboardColors.accent}
          style={styles.loader}
        />
      ) : hasData ? (
        <LineChart
          data={{
            labels: displayLabels,
            datasets: [
              {
                data: chartData,
                color: () => dashboardColors.accent,
                strokeWidth: 2.5,
              },
            ],
          }}
          width={chartWidth}
          height={180}
          yAxisLabel="₹"
          yAxisSuffix=""
          chartConfig={{
            backgroundColor: dashboardColors.cardBg,
            backgroundGradientFrom: dashboardColors.cardBg,
            backgroundGradientTo: dashboardColors.cardBg,
            decimalPlaces: 0,
            color: () => dashboardColors.accent,
            labelColor: () => dashboardColors.muted,
            propsForDots: {
              r: '4',
              strokeWidth: '2',
              stroke: dashboardColors.accent,
            },
            propsForBackgroundLines: {
              stroke: '#e2e8f0',
              strokeDasharray: '4',
            },
          }}
          bezier
          style={styles.chart}
          fromZero
        />
      ) : (
        <View style={styles.empty}>
          <Icon name="chart-line-variant" size={40} color={dashboardColors.muted} />
          <Text style={styles.emptyText}>
            {t('dashboard.salesAfterSync')}
          </Text>
        </View>
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
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${dashboardColors.accent}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 2,
  },
  totalPill: {
    alignItems: 'flex-end',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
  },
  totalValue: {
    fontSize: 15,
    fontWeight: '800',
    color: dashboardColors.accent,
    marginTop: 2,
  },
  chart: {
    marginLeft: -8,
    borderRadius: 12,
  },
  loader: {
    paddingVertical: 48,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 14,
    color: dashboardColors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default DashboardSalesTrend;
