import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { dashboardColors, voucherTypeColor } from './dashboardTheme';
import { useTranslation } from 'react-i18next';

interface VoucherMixChartProps {
  byType: Record<string, number>;
  loading?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  payment: 'Payment',
  receipt: 'Receipt',
  journal: 'Journal',
  contra: 'Contra',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
};

function normalizeKey(type: string): string {
  return type.toLowerCase().replace(/\s+/g, '_');
}

function labelFor(type: string): string {
  const key = normalizeKey(type);
  return TYPE_LABELS[key] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const VoucherMixChart: React.FC<VoucherMixChartProps> = ({ byType, loading }) => {
  const { t } = useTranslation();
  const segments = useMemo(() => {
    const entries = Object.entries(byType || {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, c]) => s + c, 0);
    return entries.slice(0, 5).map(([type, count]) => ({
      type,
      label: labelFor(type),
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      color: voucherTypeColor(type),
    }));
  }, [byType]);

  const total = segments.reduce((s, seg) => s + seg.count, 0);

  if (loading) {
    return (
      <View style={[styles.card, styles.skeleton]}>
        <View style={styles.skTitle} />
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.skBar} />
        ))}
      </View>
    );
  }

  if (!total) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('dashboard.voucherMix')}</Text>
        <Text style={styles.empty}>{t('dashboard.noVouchersSynced')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('dashboard.voucherMix')}</Text>
        <Text style={styles.total}>{t('dashboard.totalCount', { count: total })}</Text>
      </View>

      <View style={styles.barTrack}>
        {segments.map((seg) => (
          <View
            key={seg.type}
            style={[styles.barSegment, { flex: seg.pct, backgroundColor: seg.color }]}
          />
        ))}
      </View>

      <View style={styles.legend}>
        {segments.map((seg) => (
          <View key={seg.type} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
            <Text style={styles.legendLabel}>{seg.label}</Text>
            <Text style={styles.legendPct}>{seg.pct.toFixed(0)}%</Text>
            <Text style={styles.legendCount}>({seg.count})</Text>
          </View>
        ))}
      </View>
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
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  total: {
    fontSize: 13,
    fontWeight: '600',
    color: dashboardColors.muted,
  },
  barTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
    marginBottom: 14,
  },
  barSegment: {
    minWidth: 4,
  },
  legend: {
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
  },
  legendPct: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    minWidth: 36,
    textAlign: 'right',
  },
  legendCount: {
    fontSize: 12,
    color: dashboardColors.muted,
    minWidth: 36,
  },
  empty: {
    fontSize: 14,
    color: dashboardColors.muted,
    lineHeight: 20,
  },
  skeleton: {
    minHeight: 140,
  },
  skTitle: {
    height: 16,
    width: '45%',
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    marginBottom: 16,
  },
  skBar: {
    height: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    marginBottom: 10,
  },
});

export default VoucherMixChart;
