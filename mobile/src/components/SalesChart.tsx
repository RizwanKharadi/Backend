/**
 * SalesChart — full-width sales trend card with a 7D/30D/90D segmented
 * selector, a curved (bezier) area line chart with a blue->green gradient
 * fill, and a touch tooltip showing the exact value at a tapped point.
 *
 * Controlled component: the parent owns the active period + the series data
 * (so periods can be fetched live) and the headline value/growth.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { SalesPeriod, SalesSeries } from '../types/dashboard';
import { useTranslation } from 'react-i18next';

const PERIODS: { key: SalesPeriod; labelKey: string }[] = [
  { key: '7D', labelKey: 'dashboard.period.7d' },
  { key: '30D', labelKey: 'dashboard.period.30d' },
  { key: '90D', labelKey: 'dashboard.period.90d' },
];

interface SalesChartProps {
  value: string;
  activePeriod: SalesPeriod;
  series: SalesSeries;
  loading?: boolean;
  onPeriodChange: (period: SalesPeriod) => void;
  /** Outer horizontal padding of the screen so the chart fits exactly. */
  screenPadding?: number;
}

interface Tooltip {
  x: number;
  y: number;
  value: number;
}

function formatCompact(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
  if (value >= 1000) return `₹${Math.round(value / 1000)}K`;
  return `₹${Math.round(value)}`;
}

const SalesChart: React.FC<SalesChartProps> = ({
  value,
  activePeriod,
  series,
  loading,
  onPeriodChange,
  screenPadding = spacing.md,
}) => {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const chartWidth = Dimensions.get('window').width - screenPadding * 2 - spacing.md * 2;
  const hasData = series.values.length > 0;

  return (
    <View style={[styles.card, shadows.card]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>{t('dashboard.salesTrend')}</Text>
          <View style={styles.valueRow}>
            <Text style={styles.value}>{value}</Text>
          </View>
        </View>
      </View>

      <View style={styles.segment}>
        {PERIODS.map((p) => {
          const active = p.key === activePeriod;
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => {
                setTooltip(null);
                onPeriodChange(p.key);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {t(p.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.chartWrap, { height: 220 }]}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.green} />
          </View>
        ) : !hasData ? (
          <View style={styles.center}>
            <Icon name="chart-line" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyText}>{t('dashboard.noSalesData')}</Text>
          </View>
        ) : (
          <>
            <LineChart
              data={{
                labels: series.labels,
                datasets: [{ data: series.values }],
              }}
              width={chartWidth}
              height={200}
              withInnerLines
              withOuterLines={false}
              withVerticalLines={false}
              withShadow
              bezier
              fromZero
              formatYLabel={(y) => formatCompact(Number(y))}
              segments={4}
              chartConfig={{
                backgroundGradientFrom: colors.card,
                backgroundGradientTo: colors.card,
                decimalPlaces: 0,
                fillShadowGradientFrom: colors.info,
                fillShadowGradientFromOpacity: 0.25,
                fillShadowGradientTo: colors.green,
                fillShadowGradientToOpacity: 0.02,
                color: () => colors.green,
                labelColor: () => colors.textTertiary,
                propsForBackgroundLines: {
                  stroke: colors.divider,
                  strokeDasharray: '4 6',
                },
                propsForDots: {
                  r: '4',
                  strokeWidth: '2',
                  stroke: colors.white,
                  fill: colors.green,
                },
                propsForLabels: { fontSize: 10 },
              }}
              onDataPointClick={({ value: v, x, y }) =>
                setTooltip((prev) => (prev && prev.x === x ? null : { x, y, value: v }))
              }
              style={styles.chart}
            />

            {tooltip ? (
              <View
                style={[
                  styles.tooltip,
                  {
                    left: Math.max(8, Math.min(tooltip.x - 32, chartWidth - 64)),
                    top: Math.max(0, tooltip.y - 34),
                  },
                ]}
                pointerEvents="none"
              >
                <Text style={styles.tooltipText}>{formatCompact(tooltip.value)}</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  value: {
    color: colors.textPrimary,
    fontSize: fontSize.h3,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: 4,
    marginTop: spacing.md,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm - 4,
    alignItems: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.card,
    ...shadows.card,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
  },
  segmentTextActive: { color: colors.navy, fontWeight: fontWeight.bold },
  chartWrap: { marginTop: spacing.sm, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  emptyText: { color: colors.textTertiary, fontSize: fontSize.label },
  chart: { marginLeft: -spacing.xs, borderRadius: radius.md },
  tooltip: {
    position: 'absolute',
    backgroundColor: colors.navyDeep,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: radius.sm - 4,
  },
  tooltipText: {
    color: colors.white,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
});

export default React.memo(SalesChart);
