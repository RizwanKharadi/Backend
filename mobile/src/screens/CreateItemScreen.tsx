import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import Header from '../components/common/Header';
import SearchableSelect, { SelectOption } from '../components/voucher/SearchableSelect';
import { MainStackScreenProps } from '../types/navigation';
import { useCompany } from '../store/hooks';
import { inventoryService } from '../services/inventoryService';
import { masterService } from '../services/masterService';
import { voucherFormTheme } from '../components/voucher/voucherFormTheme';
import { describeTallyPush } from '../utils/tallyPushMessage';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'CreateItem'>;

const CreateItemScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { selectedCompany } = useCompany();
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState(route.params?.barcode || '');
  const [unit, setUnit] = useState('Nos');
  const [unitOptions, setUnitOptions] = useState<SelectOption[]>([{ id: 'u-0', label: 'Nos' }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    masterService.getUnits().then((res) => {
      const names = new Set<string>(['Nos']);
      for (const u of res.data) {
        if (u.name) names.add(u.name);
      }
      setUnitOptions([...names].map((n, i) => ({ id: `u-${i}`, label: n })));
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!selectedCompany?.id) {
      Alert.alert(t('vouchers.form.companyTitle'), t('vouchers.form.selectCompanyFirst'));
      return;
    }
    if (!name.trim()) {
      Alert.alert(t('masters.nameTitle'), t('masters.item.enterName'));
      return;
    }

    try {
      setSaving(true);
      const res = await inventoryService.createItem({
        name: name.trim(),
        ...(barcode.trim()
          ? { barcode: barcode.trim(), code: barcode.trim().toUpperCase() }
          : {}),
        category: 'General',
        unit: unit.trim() || 'Nos',
        rate: 0,
        openingStock: 0,
        reorderLevel: 0,
        companyId: selectedCompany.id,
        type: 'product',
        pushToTally: true,
        units: { primary: { name: unit.trim() || 'Nos' } },
      } as Parameters<typeof inventoryService.createItem>[0]);

      const { title, message } = describeTallyPush(res.tallyPush, 'Stock item');
      Alert.alert(title, message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      Alert.alert(t('common.error'), e.message || t('vouchers.form.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title={t('masters.item.title')} showBack onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Barcode is saved as Item Code in the app and as Part No. in TallyPrime. Use the same value when
          scanning later.
        </Text>
        <TextInput label={t('masters.nameRequired')} value={name} onChangeText={setName} mode="outlined" style={styles.input} />
        <TextInput
          label={t('masters.item.code')}
          value={barcode}
          onChangeText={setBarcode}
          mode="outlined"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <SearchableSelect
          label={t('masters.item.unit')}
          pickerTitle="Select unit"
          value={unit}
          options={unitOptions}
          onSelect={(o) => setUnit(o.label)}
        />
        <Button
          mode="contained"
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          buttonColor={voucherFormTheme.primary}
          style={styles.saveBtn}
        >{t('masters.saveAndSync')}</Button>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },
  hint: { marginBottom: 12, color: '#666' },
  input: { marginBottom: 10, backgroundColor: '#fff' },
  saveBtn: { marginTop: 16 },
});

export default CreateItemScreen;
