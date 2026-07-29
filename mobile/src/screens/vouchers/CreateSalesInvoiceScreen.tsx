import React, { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { MainStackScreenProps } from '../../types/navigation';
import { voucherFormTheme } from '../../components/voucher/voucherFormTheme';

/** Legacy route — forwards to CreateItemVoucher (sales). */
const CreateSalesInvoiceScreen: React.FC<MainStackScreenProps<'CreateSalesInvoice'>> = ({
  navigation,
  route,
}) => {
  useEffect(() => {
    const { partyId, partyName, partyGstin, placeOfSupply, savedItem, itemIndex } =
      route.params;
    navigation.replace('CreateItemVoucher', {
      voucherType: 'sales',
      partyId,
      partyName,
      partyGstin,
      placeOfSupply,
      savedItem,
      itemIndex,
    });
  }, [navigation, route.params]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={voucherFormTheme.primary} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default CreateSalesInvoiceScreen;
