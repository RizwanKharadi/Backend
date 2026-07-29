import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { voucherFormTheme } from './voucherFormTheme';

interface VoucherSaveFooterProps {
  onSave: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}

const VoucherSaveFooter: React.FC<VoucherSaveFooterProps> = ({
  onSave,
  loading,
  disabled,
  label = 'SAVE',
}) => (
  <View style={styles.footer}>
    <Button
      mode="contained"
      onPress={onSave}
      loading={loading}
      disabled={disabled || loading}
      style={styles.btn}
      labelStyle={styles.btnLabel}
      buttonColor={voucherFormTheme.primary}
    >
      {label}
    </Button>
  </View>
);

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 20,
    backgroundColor: voucherFormTheme.cardBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: voucherFormTheme.border,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  btn: { borderRadius: 10 },
  btnLabel: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
});

export default VoucherSaveFooter;
