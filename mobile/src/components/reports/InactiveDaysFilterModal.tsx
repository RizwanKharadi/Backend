import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const INACTIVE_DAY_OPTIONS = [
  { id: '30', label: '> 30 days', days: 30 },
  { id: '60', label: '> 60 days', days: 60 },
  { id: '90', label: '> 90 days', days: 90 },
  { id: '120', label: '> 120 days', days: 120 },
  { id: '180', label: '> 180 days', days: 180 },
  { id: 'never_sold', label: 'Never Sold', days: null },
  { id: 'custom', label: 'Custom', days: null },
] as const;

export type InactiveDaysFilterId = (typeof INACTIVE_DAY_OPTIONS)[number]['id'];

type Props = {
  visible: boolean;
  selectedId: InactiveDaysFilterId;
  customDays?: string;
  onClose: () => void;
  onSelect: (id: InactiveDaysFilterId, customDays?: number) => void;
};

const InactiveDaysFilterModal: React.FC<Props> = ({
  visible,
  selectedId,
  customDays: customDaysProp,
  onClose,
  onSelect,
}) => {
  const [customInput, setCustomInput] = useState(customDaysProp || '45');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.menu} onPress={(e) => e.stopPropagation()}>
          {INACTIVE_DAY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={styles.row}
              onPress={() => {
                if (opt.id === 'custom') {
                  const n = Math.max(1, parseInt(customInput, 10) || 45);
                  onSelect('custom', n);
                } else {
                  onSelect(opt.id);
                }
                onClose();
              }}
            >
              <Text style={styles.label}>{opt.label}</Text>
              {selectedId === opt.id ? (
                <Icon name="check" size={22} color="#1565C0" />
              ) : (
                <View style={styles.checkPlaceholder} />
              )}
            </TouchableOpacity>
          ))}
          {selectedId === 'custom' || INACTIVE_DAY_OPTIONS.some((o) => o.id === 'custom') ? (
            <View style={styles.customRow}>
              <Text style={styles.customLabel}>Days</Text>
              <TextInput
                style={styles.customInput}
                value={customInput}
                onChangeText={setCustomInput}
                keyboardType="number-pad"
                placeholder="e.g. 45"
              />
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export const inactiveFilterLabel = (
  id: InactiveDaysFilterId,
  customDays?: number,
  entity: 'customer' | 'item' = 'customer'
): string => {
  if (id === 'never_sold') return 'Never Sold';
  if (id === 'custom' && customDays) return `Inactive since ${customDays} days`;
  const opt = INACTIVE_DAY_OPTIONS.find((o) => o.id === id);
  if (opt?.days) return `Inactive since ${opt.days} days`;
  return entity === 'item' ? 'Inactive items' : 'Inactive customers';
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 100,
    paddingRight: 8,
  },
  menu: {
    backgroundColor: '#fff',
    borderRadius: 4,
    minWidth: 220,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  label: { fontSize: 16, color: '#222' },
  checkPlaceholder: { width: 22 },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  customLabel: { fontSize: 14, color: '#666' },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 16,
  },
});

export default InactiveDaysFilterModal;
