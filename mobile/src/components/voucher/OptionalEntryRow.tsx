import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Checkbox } from 'react-native-paper';
import { voucherFormTheme } from './voucherFormTheme';
import { useTranslation } from 'react-i18next';

interface OptionalEntryRowProps {
  checked: boolean;
  onToggle: () => void;
}

const OptionalEntryRow: React.FC<OptionalEntryRowProps> = ({ checked, onToggle }) => {
  const { t } = useTranslation();
  return (
  <View style={styles.row}>
    <View style={styles.textWrap}>
      <Text style={styles.label}>{t('vouchers.form.optionalEntry')}</Text>
      <Pressable onPress={() => {}} hitSlop={8}>
        <Text style={styles.learn}>{t('vouchers.form.learnMore')}</Text>
      </Pressable>
    </View>
    <Checkbox
      status={checked ? 'checked' : 'unchecked'}
      onPress={onToggle}
      color={voucherFormTheme.primary}
    />
  </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: voucherFormTheme.radius,
    paddingLeft: 14,
    paddingRight: 4,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: voucherFormTheme.border,
  },
  textWrap: { flex: 1, paddingVertical: 10 },
  label: { fontSize: 14, color: voucherFormTheme.text, lineHeight: 20 },
  learn: { fontSize: 13, color: voucherFormTheme.primary, fontWeight: '600', marginTop: 2 },
});

export default OptionalEntryRow;
