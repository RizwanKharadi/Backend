import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  VOUCHER_TYPE_PICKER,
  VoucherTypePickerOption,
} from '../../utils/voucherCreateConfig';
import { voucherFormTheme } from './voucherFormTheme';

interface VoucherTypeGridProps {
  selectedId: string;
  onSelect: (option: VoucherTypePickerOption) => void;
}

const VoucherTypeGrid: React.FC<VoucherTypeGridProps> = ({ selectedId, onSelect }) => (
  <View style={styles.grid}>
    {VOUCHER_TYPE_PICKER.map((opt) => {
      const selected = opt.id === selectedId;
      return (
        <TouchableOpacity
          key={opt.id}
          style={[styles.card, selected && styles.cardSelected]}
          onPress={() => onSelect(opt)}
          activeOpacity={0.75}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${opt.color}18` }]}>
            <Icon name={opt.icon} size={26} color={opt.color} />
          </View>
          <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={2}>
            {opt.label}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {opt.subtitle}
          </Text>
          {selected ? (
            <View style={styles.check}>
              <Icon name="check-circle" size={20} color={voucherFormTheme.primary} />
            </View>
          ) : null}
        </TouchableOpacity>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  card: {
    width: '48%',
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: voucherFormTheme.border,
    minHeight: 118,
  },
  cardSelected: {
    borderColor: voucherFormTheme.primary,
    backgroundColor: '#F0F7FF',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: voucherFormTheme.text,
    marginBottom: 4,
  },
  labelSelected: { color: voucherFormTheme.primary },
  sub: { fontSize: 11, color: voucherFormTheme.muted, lineHeight: 15 },
  check: { position: 'absolute', top: 8, right: 8 },
});

export default VoucherTypeGrid;
