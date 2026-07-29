import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FAB } from 'react-native-paper';
import { voucherFormTheme } from '../voucher/voucherFormTheme';

interface CreateVoucherFabProps {
  onPress: () => void;
}

const CreateVoucherFab: React.FC<CreateVoucherFabProps> = ({ onPress }) => (
  <View style={styles.fabWrap}>
    <FAB
      icon="plus"
      label="Create voucher"
      style={styles.fab}
      color="#fff"
      onPress={onPress}
      customSize={56}
    />
  </View>
);

const styles = StyleSheet.create({
  fabWrap: {
    position: 'absolute',
    right: 16,
    bottom: 20,
  },
  fab: {
    backgroundColor: voucherFormTheme.primary,
    borderRadius: 28,
  },
});

export default CreateVoucherFab;
