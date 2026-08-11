import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, List, Chip, Text, useTheme } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Types
import { Voucher } from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';

interface VoucherCardProps {
  voucher: Voucher;
  onPress: (voucherId: string) => void;
}

const VoucherCard: React.FC<VoucherCardProps> = ({ voucher, onPress }) => {
  const theme = useTheme();

  const getVoucherTypeIcon = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'sales': return 'cash-register';
      case 'purchase': return 'cart';
      case 'payment': return 'credit-card';
      case 'receipt': return 'receipt';
      case 'journal': return 'book-open';
      case 'sales_order': return 'clipboard-text';
      case 'purchase_order': return 'clipboard-check';
      case 'debit_note': return 'minus-circle';
      case 'credit_note': return 'plus-circle';
      default: return 'file-document';
    }
  };

  const getVoucherStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'approved':
      case 'posted':
      case 'paid': return theme.colors.primary;
      case 'pending':
      case 'partially_paid': return theme.colors.tertiary;
      case 'rejected':
      case 'cancelled': return theme.colors.error;
      case 'draft': return theme.colors.outline;
      default: return theme.colors.onSurfaceVariant;
    }
  };

  return (
    <TouchableOpacity onPress={() => onPress(voucher.id)}>
      <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
        <List.Item
          title={`${voucher.voucherNumber} - ${voucher.voucherType}`}
          description={`${voucher.narration || 'No description'} • ${formatDate(voucher.date)}`}
          left={() => (
            <View style={styles.iconContainer}>
              <Icon
                name={getVoucherTypeIcon(voucher.voucherType)}
                size={24}
                color={theme.colors.primary}
              />
            </View>
          )}
          right={() => (
            <View style={styles.rightContainer}>
              <Text
                variant="titleMedium"
                style={[styles.amount, { color: theme.colors.onSurface }]}
              >
                {formatCurrency(voucher.amount)}
              </Text>
              <Chip
                mode="outlined"
                compact
                style={[styles.statusChip, { borderColor: getVoucherStatusColor(voucher.status) }]}
                textStyle={[styles.statusChipText, { color: getVoucherStatusColor(voucher.status) }]}
              >
                {voucher.status}
              </Chip>
            </View>
          )}
        />
      </Surface>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 8,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  rightContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 60,
  },
  amount: {
    fontWeight: '600',
    marginBottom: 4,
  },
  statusChip: {
    height: 24,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: '500',
  },
});

export default VoucherCard;