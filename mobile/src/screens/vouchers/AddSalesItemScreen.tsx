import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text, Divider } from 'react-native-paper';
import { MainStackScreenProps } from '../../types/navigation';
import type { SalesVoucherItemLine } from '../../types';
import VoucherFormHeader from '../../components/voucher/VoucherFormHeader';
import SearchableSelect, { SelectOption } from '../../components/voucher/SearchableSelect';
import { voucherFormTheme } from '../../components/voucher/voucherFormTheme';
import { inventoryService } from '../../services/inventoryService';
import { masterService } from '../../services/masterService';
import { useCompany } from '../../store/hooks';
import { lineTaxableAmount } from '../../utils/salesVoucherCalc';

type Props = MainStackScreenProps<'AddInvoiceItem'>;

const AddSalesItemScreen: React.FC<Props> = ({ navigation, route }) => {
  const { selectedCompany } = useCompany();
  const editIndex = route.params?.itemIndex;
  const existing = route.params?.item;

  const [itemName, setItemName] = useState(existing?.itemName || '');
  const [itemId, setItemId] = useState(existing?.itemId || '');
  const [godownName, setGodownName] = useState(existing?.godownName || 'Main Location');
  const [description, setDescription] = useState(existing?.description || '');
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [unit, setUnit] = useState(existing?.unit || 'No.');
  const [rate, setRate] = useState(String(existing?.rate ?? ''));
  const [discountPercent, setDiscountPercent] = useState(
    String(existing?.discountPercent ?? '')
  );
  const [itemOptions, setItemOptions] = useState<SelectOption[]>([]);
  const [godownOptions, setGodownOptions] = useState<SelectOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<SelectOption[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemUnitMap, setItemUnitMap] = useState<Record<string, string>>({});

  const handleScanBarcode = () => {
    navigation.navigate('BarcodeScanner', {
      title: 'Scan item barcode',
      onScanned: async (barcode: string) => {
        try {
          const res = await inventoryService.getItemByBarcode(barcode);
          const it = res.data;
          setItemName(it.name);
          setItemId(it.id);
          setUnit(it.unit || 'No.');
        } catch (e: any) {
          navigation.navigate('CreateItem', { barcode });
        }
      },
    });
  };

  useEffect(() => {
    (async () => {
      try {
        setLoadingItems(true);
        const [itemsRes, godownsRes, unitsRes] = await Promise.all([
          inventoryService.getItems({ limit: 300 }),
          masterService.getGodowns(),
          masterService.getUnits(),
        ]);

        const unitByItem: Record<string, string> = {};
        setItemOptions(
          itemsRes.data.map((it) => {
            const primaryUnit = it.unit || 'No.';
            unitByItem[it.id] = primaryUnit;
            return {
              id: it.id,
              label: it.name,
              subtitle: [it.code, primaryUnit].filter(Boolean).join(' · '),
            };
          })
        );
        setItemUnitMap(unitByItem);

        const godowns = godownsRes.data.map((g) => ({ id: g.id, label: g.name }));
        setGodownOptions(godowns);
        if (godowns.length > 0 && godownName === 'Main Location') {
          const hasMain = godowns.some((g) => g.label === 'Main Location');
          if (!hasMain) setGodownName(godowns[0].label);
        }

        setUnitOptions(unitsRes.data.map((u) => ({ id: u.id, label: u.name })));
        if (unitsRes.data.length > 0 && unit === 'No.') {
          const hasNo = unitsRes.data.some((u) => u.name === 'No.');
          if (!hasNo) setUnit(unitsRes.data[0].name);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingItems(false);
      }
    })();
  }, [selectedCompany?.id]);

  const lineAmount = useMemo(() => {
    const line: SalesVoucherItemLine = {
      itemId,
      itemName,
      quantity: parseFloat(quantity) || 0,
      unit,
      rate: parseFloat(rate) || 0,
      amount: 0,
      godownName,
      discountPercent: parseFloat(discountPercent) || 0,
    };
    return lineTaxableAmount(line);
  }, [itemId, itemName, quantity, unit, rate, godownName, discountPercent]);

  const buildResult = (): SalesVoucherItemLine | null => {
    if (!itemName.trim()) {
      Alert.alert('Item required', 'Select or enter an item name');
      return null;
    }
    const qty = parseFloat(quantity);
    const r = parseFloat(rate);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid quantity', 'Enter a valid quantity');
      return null;
    }
    if (!r || r <= 0) {
      Alert.alert('Invalid rate', 'Enter a valid rate');
      return null;
    }
    return {
      itemId,
      itemName: itemName.trim(),
      description: description.trim(),
      quantity: qty,
      unit: unit.trim() || 'No.',
      rate: r,
      amount: lineAmount,
      godownName: godownName.trim() || 'Main Location',
      discountPercent: parseFloat(discountPercent) || 0,
    };
  };

  const finish = (addAnother: boolean) => {
    const line = buildResult();
    if (!line) return;

    const voucherType = route.params.voucherType || 'sales';
    navigation.navigate({
      name: 'CreateItemVoucher',
      params: { savedItem: line, itemIndex: editIndex, voucherType } as never,
      merge: true,
    });

    if (addAnother) {
      setTimeout(() => {
        navigation.push('AddInvoiceItem', { voucherType });
      }, 100);
    }
  };

  return (
    <View style={styles.container}>
      <VoucherFormHeader
        title="Add Item"
        subtitle="Tax via Ledger on invoice"
        onBack={() => navigation.goBack()}
        rightIcon="barcode-scan"
        onRightPress={handleScanBarcode}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SearchableSelect
          label="Item Name"
          pickerTitle="Select stock item"
          value={itemName}
          options={itemOptions}
          onSelect={(o) => {
            setItemName(o.label);
            setItemId(o.id);
            const mapped = itemUnitMap[o.id];
            if (mapped) setUnit(mapped);
          }}
          placeholder="Tap to choose item"
          leftIcon="package-variant"
          loading={loadingItems}
        />

        <SearchableSelect
          label="Godown"
          pickerTitle="Select godown"
          value={godownName}
          options={godownOptions}
          onSelect={(o) => setGodownName(o.label)}
          placeholder="Tap to choose godown"
          leftIcon="warehouse"
        />

        <TextInput
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          multiline
          numberOfLines={2}
          style={styles.input}
        />

        <View style={styles.row}>
          <TextInput
            label="Quantity"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            mode="outlined"
            style={[styles.input, styles.half]}
          />
          <View style={styles.half}>
            <SearchableSelect
              label="Unit"
              pickerTitle="Select unit"
              value={unit}
              options={unitOptions}
              onSelect={(o) => setUnit(o.label)}
              placeholder="Unit"
            />
          </View>
        </View>

        <View style={styles.row}>
          <TextInput
            label="Rate"
            value={rate}
            onChangeText={setRate}
            keyboardType="decimal-pad"
            mode="outlined"
            style={[styles.input, styles.half]}
            left={<TextInput.Affix text="₹" />}
          />
          <TextInput
            label="Discount %"
            value={discountPercent}
            onChangeText={setDiscountPercent}
            keyboardType="decimal-pad"
            mode="outlined"
            style={[styles.input, styles.half]}
          />
        </View>

        <Text style={styles.taxHint}>
          GST / IGST is not calculated here. On the invoice screen, use Ledger → ADD to select tax
          ledgers (e.g. Input IGST, CGST, SGST).
        </Text>

        <Divider style={styles.divider} />
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Line amount</Text>
            <Text style={styles.summaryValue}>₹ {lineAmount.toLocaleString('en-IN')}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button mode="text" onPress={() => finish(true)} textColor={voucherFormTheme.primary}>
          + ADD MORE
        </Button>
        <Button
          mode="contained"
          onPress={() => finish(false)}
          buttonColor={voucherFormTheme.primary}
          style={styles.doneBtn}
          labelStyle={styles.doneLabel}
        >
          DONE
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: voucherFormTheme.pageBg },
  content: { padding: 16, paddingBottom: 120 },
  input: { marginBottom: 12, backgroundColor: voucherFormTheme.inputBg },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  taxHint: {
    fontSize: 13,
    color: voucherFormTheme.muted,
    lineHeight: 20,
    backgroundColor: '#FFF8E6',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFE082',
    marginBottom: 8,
  },
  divider: { marginVertical: 12 },
  summaryCard: {
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: voucherFormTheme.border,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 15, color: voucherFormTheme.muted },
  summaryValue: { fontSize: 20, fontWeight: '700', color: voucherFormTheme.primary },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: voucherFormTheme.border,
  },
  doneBtn: { borderRadius: 10, minWidth: 130 },
  doneLabel: { fontWeight: '700', fontSize: 15 },
});

export default AddSalesItemScreen;
