/**
 * KpiCard — a Business Overview metric card with an accent icon chip, value,
 * delta, and a mini SVG sparkline (area + line) tinted to the accent color.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { KpiAccent, KpiCardData } from '../types/dashboard';

const SPARK_W = 150;
const SPARK_H = 38;

const accentMap: Record<KpiAccent, string> = {
  green: colors.kpiGreen,
  orange: colors.kpiOrange,
  purple: colors.kpiPurple,
  red: colors.kpiRed,
};

/** Build a smooth (quadratic-midpoint) line + closed area path from values. */
function buildSparkPaths(values: number[]) {
  if (values.length < 2) {
    return { line: '', area: '' };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 4;
  const stepX = SPARK_W / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * stepX,
    y: padY + (SPARK_H - padY * 2) * (1 - (v - min) / range),
  }));

  let line = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    line += ` Q${prev.x},${prev.y} ${midX},${(prev.y + cur.y) / 2}`;
    line += ` T${cur.x},${cur.y}`;
  }
  const area = `${line} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`;
  return { line, area };
}

interface KpiCardProps {
  data: KpiCardData;
  onPress?: () => void;
}

const KpiCard: React.FC<KpiCardProps> = ({ data, onPress }) => {
  const accent = accentMap[data.accent];
  const spark = data.spark ?? [];
  const hasSpark = spark.length >= 2;
  const { line, area } = useMemo(() => buildSparkPaths(spark), [spark]);
  const gradId = `spark-${data.id}`;
  const neutral = data.deltaPositive === undefined;

  return (
    <TouchableOpacity
      style={[styles.card, shadows.card]}
      activeOpacity={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${data.label} ${data.value}, ${data.deltaLabel}`}
    >
      <View style={[styles.chip, { backgroundColor: hexToRgba(accent, 0.14) }]}>
        <Icon name={data.icon} size={18} color={accent} />
      </View>

      <Text style={styles.label}>{data.label}</Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {data.value}
      </Text>

      <View style={styles.deltaRow}>
        {neutral ? null : (
          <Icon
            name={data.deltaPositive ? 'menu-up' : 'menu-down'}
            size={16}
            color={data.deltaPositive ? colors.success : colors.danger}
          />
        )}
        <Text
          style={[
            styles.delta,
            {
              color: neutral
                ? colors.textSecondary
                : data.deltaPositive
                ? colors.success
                : colors.danger,
            },
          ]}
        >
          {data.deltaLabel}
        </Text>
      </View>

      {hasSpark ? (
        <Svg
          width="100%"
          height={SPARK_H}
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          style={styles.spark}
        >
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent} stopOpacity={0.28} />
              <Stop offset="1" stopColor={accent} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill={`url(#${gradId})`} />
          <Path d={line} fill="none" stroke={accent} strokeWidth={2} />
        </Svg>
      ) : (
        <View style={styles.sparkSpacer} />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  chip: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
  value: {
    color: colors.textPrimary,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  delta: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
  spark: {
    marginTop: spacing.xs,
    marginHorizontal: -spacing.sm,
    width: SPARK_W,
  },
  sparkSpacer: {
    height: spacing.md,
  },
});

export default React.memo(KpiCard);
