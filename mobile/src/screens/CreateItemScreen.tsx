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

type Props = MainStackScreenProps<'CreateItem'>;

const CreateItemScreen: React.FC<Props> = ({ navigation, route }) => {
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
      Alert.alert('Company', 'Select a company first');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name', 'Enter stock item name');
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

      const push = res.tallyPush;
      if (push?.status === 'completed') {
        Alert.alert('Saved & synced', 'Stock item created in cloud and Tally.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else if (push?.status === 'failed') {
        Alert.alert('Saved locally', `Saved in cloud. Tally: ${push.message || 'Agent offline?'}`, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert('Saved', 'Item saved.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Create Stock Item" showBack onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Barcode is saved as Item Code in the app and as Part No. in TallyPrime. Use the same value when
          scanning later.
        </Text>
        <TextInput label="Name *" value={name} onChangeText={setName} mode="outlined" style={styles.input} />
        <TextInput
          label="Item code / barcode (optional)"
          value={barcode}
          onChangeText={setBarcode}
          mode="outlined"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <SearchableSelect
          label="Unit *"
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
        >
          Save & sync to Tally
        </Button>
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
