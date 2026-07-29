import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { dashboardColors } from '../dashboard/dashboardTheme';
import { toLocalDateString } from '../../utils/formatters';

export interface DateRangeValue {
  from: Date;
  to: Date;
}

interface VoucherListDateFilterProps {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  accentColor?: string;
}

const PRESETS = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
] as const;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function applyPreset(preset: (typeof PRESETS)[number]['id']): DateRangeValue {
  const now = startOfDay(new Date());
  switch (preset) {
    case 'this_month':
      return {
        from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: now,
      };
    case 'last_month': {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const to = startOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { from, to };
    }
    case 'this_year':
      return {
        from: startOfDay(new Date(now.getFullYear(), 0, 1)),
        to: now,
      };
    default:
      return { from: now, to: now };
  }
}

const VoucherListDateFilter: React.FC<VoucherListDateFilterProps> = ({
  value,
  onChange,
  accentColor = dashboardColors.accent,
}) => {
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);

  const onPickerChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setPicker(null);
    }
    if (event.type === 'dismissed' || !date) {
      return;
    }
    const picked = startOfDay(date);
    if (picker === 'from') {
      const next = { from: picked, to: value.to };
      if (picked.getTime() > next.to.getTime()) {
        onChange({ from: picked, to: picked });
      } else {
        onChange(next);
      }
    } else if (picker === 'to') {
      const next = { from: value.from, to: picked };
      if (picked.getTime() < next.from.getTime()) {
        onChange({ from: picked, to: picked });
      } else {
        onChange(next);
      }
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.presetRow}>
        {PRESETS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.presetChip, { borderColor: `${accentColor}55` }]}
            onPress={() => onChange(applyPreset(p.id))}
          >
            <Text style={[styles.presetText, { color: accentColor }]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.dateCard}>
        <Text style={styles.cardTitle}>Date range</Text>
        <View style={styles.dateRow}>
          <TouchableOpacity
            style={styles.dateBtn}
            onPress={() => setPicker('from')}
          >
            <Icon name="calendar-start" size={20} color={accentColor} />
            <View style={styles.dateBtnText}>
              <Text style={styles.dateLabel}>From</Text>
              <Text style={styles.dateValue}>{formatDisplayDate(value.from)}</Text>
            </View>
          </TouchableOpacity>
          <Icon name="arrow-right" size={18} color={dashboardColors.muted} />
          <TouchableOpacity
            style={styles.dateBtn}
            onPress={() => setPicker('to')}
          >
            <Icon name="calendar-end" size={20} color={accentColor} />
            <View style={styles.dateBtnText}>
              <Text style={styles.dateLabel}>To</Text>
              <Text style={styles.dateValue}>{formatDisplayDate(value.to)}</Text>
            </View>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          {toLocalDateString(value.from)} → {toLocalDateString(value.to)}
        </Text>
      </View>

      {picker === 'from' ? (
        <DateTimePicker
          value={value.from}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickerChange}
          maximumDate={value.to}
        />
      ) : null}
      {picker === 'to' ? (
        <DateTimePicker
          value={value.to}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickerChange}
          minimumDate={value.from}
          maximumDate={new Date()}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: dashboardColors.cardBg,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  dateCard: {
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 10,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
  },
  dateBtnText: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
  },
  dateValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  hint: {
    fontSize: 11,
    color: dashboardColors.muted,
    marginTop: 10,
    textAlign: 'center',
  },
});

export default VoucherListDateFilter;
export { startOfDay, applyPreset as applyVoucherDatePreset };
