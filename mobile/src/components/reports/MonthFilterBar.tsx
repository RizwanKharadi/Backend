/**
 * Month chips for report drill-down voucher lists.
 *
 * These lists come from a report period (This Month, This Year…) and can run to
 * hundreds of rows, which makes finding one voucher hard. A month chip narrows
 * the list to a single month; "All" returns to the report's own period.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
      style={styles.wrap}
    >
      {/*
        The chips live in a plain row View, not directly in contentContainerStyle.
        Laid out by the scroll container they were being sized to share the
        visible width, so every label ellipsised ("A...", "J..l") instead of the
        row overflowing and scrolling. An inner row sizes to its content, so each
        chip keeps its natural width and the overflow becomes scroll.
      */}
      <View style={styles.row}>
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
      </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#c7d0da',
    backgroundColor: '#fff',
    flexShrink: 0,
    marginRight: 8,
  },
  text: {
    // 12px muted grey was legible in a mock and not on a phone — the month
    // names read as smudges. Bigger, darker, and no ellipsising.
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
    flexShrink: 0,
  },
  textActive: { color: '#fff' },
});

export default React.memo(MonthFilterBar);
