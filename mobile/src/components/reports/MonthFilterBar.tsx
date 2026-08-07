/**
 * Month chips for report drill-down voucher lists.
 *
 * These lists come from a report period (This Month, This Year…) and can run to
 * hundreds of rows, which makes finding one voucher hard. A month chip narrows
 * the list to a single month; "All" returns to the report's own period.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface MonthRange {
  /** YYYY-MM-DD, inclusive */
  fromDate: string;
  toDate: string;
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Last `count` whole months, newest first. */
export function recentMonthOptions(count = 12) {
  const now = new Date();
  const out: { key: string; label: string; range: MonthRange }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    out.push({
      key: `${year}-${month}`,
      // Year only when it is not the current one, to keep chips short.
      label:
        year === now.getFullYear()
          ? MONTH_LABELS[month]
          : `${MONTH_LABELS[month]} ${String(year).slice(2)}`,
      range: {
        fromDate: ymd(new Date(year, month, 1)),
        toDate: ymd(new Date(year, month + 1, 0)),
      },
    });
  }
  return out;
}

interface MonthFilterBarProps {
  /** null = no month selected; the report's own period applies. */
  value: MonthRange | null;
  onChange: (range: MonthRange | null) => void;
  accentColor?: string;
  monthCount?: number;
}

const MonthFilterBar: React.FC<MonthFilterBarProps> = ({
  value,
  onChange,
  accentColor = '#1565C0',
  monthCount = 12,
}) => {
  const months = useMemo(() => recentMonthOptions(monthCount), [monthCount]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.wrap}
    >
      <TouchableOpacity
        style={[
          styles.chip,
          !value && { backgroundColor: accentColor, borderColor: accentColor },
        ]}
        onPress={() => onChange(null)}
        accessibilityRole="button"
        accessibilityState={{ selected: !value }}
      >
        <Text style={[styles.text, !value && styles.textActive]}>All</Text>
      </TouchableOpacity>

      {months.map((m) => {
        const active =
          !!value &&
          value.fromDate === m.range.fromDate &&
          value.toDate === m.range.toDate;
        return (
          <TouchableOpacity
            key={m.key}
            style={[
              styles.chip,
              active && { backgroundColor: accentColor, borderColor: accentColor },
            ]}
            onPress={() => onChange(active ? null : m.range)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.text, active && styles.textActive]}>{m.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    flexGrow: 0,
  },
  row: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d7dde5',
    backgroundColor: '#fff',
  },
  text: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  textActive: { color: '#fff' },
});

export default React.memo(MonthFilterBar);
