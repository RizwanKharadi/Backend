import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import {
  TextInput,
  Button,
  Text,
  IconButton,
  Divider,
} from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';

import { MainStackScreenProps } from '../../types/navigation';
import type { SalesVoucherItemLine, SalesExtraLedgerLine, CreateVoucherData } from '../../types';
import VoucherFormHeader from '../../components/voucher/VoucherFormHeader';
import SearchableSelect, { SelectOption } from '../../components/voucher/SearchableSelect';
import OptionalEntryRow from '../../components/voucher/OptionalEntryRow';
import VoucherSaveFooter from '../../components/voucher/VoucherSaveFooter';
import { voucherFormTheme } from '../../components/voucher/voucherFormTheme';
import { useCompany } from '../../store/hooks';
import { voucherService } from '../../services/voucherService';
import { summarizeSalesInvoice, lineTaxableAmount } from '../../utils/salesVoucherCalc';
import {
  getItemVoucherConfig,
  accountLedgerParentForVoucher,
  tallyVoucherTypeParentsFor,
} from '../../utils/voucherCreateConfig';
import { masterService } from '../../services/masterService';

type Props = MainStackScreenProps<'CreateItemVoucher'>;

const CreateItemVoucherScreen: React.FC<Props> = ({ navigation, route }) => {
  const { selectedCompany } = useCompany();
  const config = getItemVoucherConfig(route.params.voucherType);
  const isOrderType = ['sales_order', 'purchase_order'].includes(config.voucherType);
  const { partyId, partyName, partyGstin, placeOfSupply: partyState } = route.params;

  const [isOptional, setIsOptional] = useState(false);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [accountLedgerName, setAccountLedgerName] = useState(config.defaultAccountLedger);
  const [tallyVoucherTypeName, setTallyVoucherTypeName] = useState(config.defaultTallyVoucherType);
  const [voucherNumber, setVoucherNumber] = useState('');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [items, setItems] = useState<SalesVoucherItemLine[]>([]);
  const [extraLedgers, setExtraLedgers] = useState<SalesExtraLedgerLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [autoNumbering, setAutoNumbering] = useState(true);

  const [ledgerModalVisible, setLedgerModalVisible] = useState(false);
  const [ledgerName, setLedgerName] = useState('');
  const [ledgerAmount, setLedgerAmount] = useState('');

  const [ledgerOptions, setLedgerOptions] = useState<SelectOption[]>([
    { id: '0', label: config.defaultAccountLedger },
  ]);
  const [vchTypeOptions, setVchTypeOptions] = useState<SelectOption[]>([
    { id: '0', label: config.defaultTallyVoucherType },
  ]);
  const [extraLedgerOptions, setExtraLedgerOptions] = useState<SelectOption[]>([]);

  const summary = summarizeSalesInvoice(items, extraLedgers);

  const loadMasters = useCallback(async () => {
    const accountParent = accountLedgerParentForVoucher(config.voucherType);
    const vchParents = tallyVoucherTypeParentsFor(config.voucherType);

    try {
      // Account-ledger picker pulls the FULL ledger list from TallyAccount (tallyaccounts),
      // so GST / Duties & Taxes / round-off etc. all appear — not just the Sales/Purchase
      // Account parent group from the Party collection. Sundry debtors/creditors stay out
      // because the separate Party field already covers them.
      const accountRes = await masterService.getLedgers({
        excludeSundry: true,
        limit: 2000,
      });
      const ledgerNames = new Set<string>([config.defaultAccountLedger]);
      for (const row of accountRes.data) ledgerNames.add(row.name);
      setLedgerOptions([...ledgerNames].map((n, i) => ({ id: `l-${i}`, label: n })));
    } catch {
      /* keep default account ledger */
    }
    void accountParent;

    try {
      const vchRes = await masterService.getVoucherTypes({
        parent: vchParents.length ? vchParents.join(',') : undefined,
      });
      const typeNames = new Set<string>([config.defaultTallyVoucherType]);
      for (const row of vchRes.data) typeNames.add(row.name);
      setVchTypeOptions([...typeNames].map((n, i) => ({ id: `t-${i}`, label: n })));
      if (vchRes.data.length > 0) {
        setTallyVoucherTypeName((prev) =>
          typeNames.has(prev) ? prev : vchRes.data[0].name
        );
      }
    } catch {
      /* keep default voucher type */
    }

    try {
      const extraLedgersRes = await masterService.getLedgers({
        excludeSundry: true,
        limit: 2000,
      });
      setExtraLedgerOptions(
        extraLedgersRes.data.map((r) => ({
          id: r.id,
          label: r.name,
          subtitle: r.parentGroup,
        }))
      );
    } catch {
      setExtraLedgerOptions([]);
    }
    try {
      const next = await voucherService.getNextVoucherNumber(
        config.voucherType,
        selectedCompany!.id
      );
      if (next?.data?.nextNumber) {
        setAutoNumbering(true);
        setVoucherNumber(next.data.nextNumber);
        if (isOrderType) {
          setReference(next.data.nextNumber);
        }
      }
    } catch {
      setAutoNumbering(false);
    }
  }, [selectedCompany?.id, config]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  useFocusEffect(
    useCallback(() => {
      const saved = route.params?.savedItem;
      const idx = route.params?.itemIndex;
      if (!saved) return;
      setItems((prev) => {
        if (idx != null && idx >= 0 && idx < prev.length) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      navigation.setParams({ savedItem: undefined, itemIndex: undefined });
    }, [route.params?.savedItem, route.params?.itemIndex, navigation])
  );

  const tallyCompanyName =
    (selectedCompany?.tallyIntegration as { companyName?: string })?.companyName ||
    selectedCompany?.name ||
    '';

  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });

  const handleSave = async () => {
    if (!selectedCompany?.id) {
      Alert.alert('Company', 'Please select a company first');
      return;
    }
    if (items.length === 0) {
      Alert.alert('Items', 'Add at least one item');
      return;
    }

    const resolvedNumber = voucherNumber.trim();
    const resolvedReference =
      reference.trim() || (isOrderType && resolvedNumber ? resolvedNumber : '');

    const payload: CreateVoucherData = {
      voucherType: config.voucherType,
      date: date.toISOString().slice(0, 10),
      party: partyId,
      partyName,
      voucherNumber: resolvedNumber || undefined,
      reference: resolvedReference || resolvedNumber || undefined,
      narration: narration.trim() || undefined,
      amount: summary.grossTotal,
      companyId: selectedCompany.id,
      salesLedgerName:
        config.voucherType === 'purchase' || config.voucherType === 'purchase_order'
          ? undefined
          : accountLedgerName,
      purchaseLedgerName:
        config.voucherType === 'purchase' || config.voucherType === 'purchase_order'
          ? accountLedgerName
          : undefined,
      tallyVoucherTypeName,
      tallyCompanyName,
      isOptional,
      placeOfSupply: partyState,
      partyGstin,
      items: items.map((line) => ({
        item: line.itemId,
        itemName: line.itemName,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        rate: line.rate,
        amount: line.amount || lineTaxableAmount(line),
        hsnCode: line.hsnCode,
        godownName: line.godownName,
        gst: { cgst: 0, sgst: 0, igst: 0 },
      })),
      ledgerEntries: extraLedgers.map((l) => ({
        ledger: l.ledgerName,
        amount: l.amount,
        credit: l.amount,
      })),
    };

    try {
      setSaving(true);
      const response = await voucherService.createVoucher(payload);
      const push = response.tallyPush;

      if (
        config.tallyPush &&
        (push?.status === 'completed' || push?.status === 'already_synced')
      ) {
        const tallyNo = push.voucherNumber ? `\nTally voucher: ${push.voucherNumber}` : '';
        const syncedLabel =
          push?.status === 'already_synced' ? 'already in Tally' : 'sent to Tally';
        Alert.alert('Saved & synced', `${config.screenTitle} saved and ${syncedLabel}.${tallyNo}`, [
          { text: 'OK', onPress: () => navigation.popToTop() },
        ]);
      } else if (config.tallyPush && push?.status === 'failed') {
        Alert.alert(
          'Saved locally',
          `Saved in cloud. Tally: ${push.message || 'Agent offline?'}`,
          [{ text: 'OK', onPress: () => navigation.popToTop() }]
        );
      } else {
        Alert.alert('Saved', `${config.screenTitle} saved.`, [
          { text: 'OK', onPress: () => navigation.popToTop() },
        ]);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addLedger = () => {
    const amt = parseFloat(ledgerAmount);
    if (!ledgerName.trim() || !amt) {
      Alert.alert('Ledger', 'Enter ledger name and amount');
      return;
    }
    setExtraLedgers((prev) => [...prev, { ledgerName: ledgerName.trim(), amount: amt }]);
    setLedgerName('');
    setLedgerAmount('');
    setLedgerModalVisible(false);
  };

  const goAddItem = () =>
    navigation.navigate('AddInvoiceItem', {
      voucherType: config.voucherType,
    });

  return (
    <View style={styles.container}>
      <VoucherFormHeader
        title={partyName}
        subtitle={config.screenTitle}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <OptionalEntryRow checked={isOptional} onToggle={() => setIsOptional(!isOptional)} />

        <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.9}>
          <TextInput
            label="Date"
            value={formatDate(date)}
            mode="outlined"
            editable={false}
            left={<TextInput.Icon icon="calendar" />}
            style={styles.input}
          />
        </TouchableOpacity>
        {showDatePicker ? (
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, d) => {
              setShowDatePicker(Platform.OS === 'ios');
              if (d) setDate(d);
            }}
          />
        ) : null}

        <TextInput
          label={config.partyFieldLabel}
          value={partyName}
          mode="outlined"
          editable={false}
          left={<TextInput.Icon icon="account" />}
          style={styles.input}
        />

        <SearchableSelect
          label={config.accountLedgerLabel}
          value={accountLedgerName}
          options={ledgerOptions}
          onSelect={(o) => setAccountLedgerName(o.label)}
          leftIcon="book-open-variant"
        />

        <SearchableSelect
          label="Tally Voucher Type"
          value={tallyVoucherTypeName}
          options={vchTypeOptions}
          onSelect={(o) => setTallyVoucherTypeName(o.label)}
          leftIcon="file-document-outline"
        />

        <TextInput
          label={isOrderType ? 'Order No.' : 'Voucher No. (optional)'}
          value={voucherNumber}
          onChangeText={(t) => {
            setVoucherNumber(t);
            if (isOrderType) setReference(t);
          }}
          mode="outlined"
          editable={!autoNumbering}
          left={<TextInput.Icon icon="ticket-confirmation" />}
          style={[styles.input, autoNumbering && styles.inputDisabled]}
        />
        {autoNumbering ? (
          <Text style={styles.hint}>
            {isOrderType
              ? 'Order no. is saved as Reference in Tally (same as this number). Tally assigns its own voucher no.'
              : 'Leave blank to use Tally autonumbering on sync. Reference matches voucher no. when synced.'}
          </Text>
        ) : null}

        {!isOrderType ? (
          <TextInput
            label="Reference (optional)"
            value={reference}
            onChangeText={setReference}
            mode="outlined"
            style={styles.input}
          />
        ) : null}

        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Items ({items.length})</Text>
            {items.length > 0 ? (
              <Button compact textColor={voucherFormTheme.primary} onPress={goAddItem}>
                ADD MORE
              </Button>
            ) : null}
          </View>

          {items.length === 0 ? (
            <Button
              mode="outlined"
              icon="plus"
              onPress={goAddItem}
              style={styles.outlineBtn}
              textColor={voucherFormTheme.primary}
            >
              {config.addItemLabel}
            </Button>
          ) : (
            items.map((line, index) => (
              <View key={`${line.itemName}-${index}`} style={styles.itemCard}>
                <View style={styles.itemCardHead}>
                  <Text style={styles.itemTitle}>{line.itemName}</Text>
                  <View style={styles.itemActions}>
                    <Button
                      compact
                      onPress={() =>
                        navigation.navigate('AddInvoiceItem', {
                          voucherType: config.voucherType,
                          itemIndex: index,
                          item: line,
                        })
                      }
                    >
                      EDIT
                    </Button>
                    <IconButton
                      icon="delete-outline"
                      iconColor={voucherFormTheme.danger}
                      size={20}
                      onPress={() => setItems((p) => p.filter((_, i) => i !== index))}
                    />
                  </View>
                </View>
                <Text style={styles.itemMeta}>
                  {line.quantity} {line.unit} × ₹ {line.rate.toLocaleString('en-IN')}
                </Text>
                <Text style={styles.itemAmount}>
                  ₹ {(line.amount || lineTaxableAmount(line)).toLocaleString('en-IN')}
                </Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.ledgerHint}>
          Add tax ledgers (IGST, CGST, SGST) and other charges under Ledger.
        </Text>
        <TouchableOpacity style={styles.linkRow} onPress={() => setLedgerModalVisible(true)}>
          <Text style={styles.sectionTitle}>Ledger</Text>
          <Text style={styles.addLink}>ADD</Text>
        </TouchableOpacity>
        {extraLedgers.map((l, i) => (
          <View key={`${l.ledgerName}-${i}`} style={styles.ledgerRow}>
            <Text>{l.ledgerName}</Text>
            <Text>₹ {l.amount.toLocaleString('en-IN')}</Text>
          </View>
        ))}

        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.muted}>Net Total</Text>
            <Text>₹ {summary.netTotal.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.muted}>Tax & ledgers</Text>
            <Text>₹ {summary.totalTax.toLocaleString('en-IN')}</Text>
          </View>
          <View style={[styles.summaryRow, styles.grossRow]}>
            <Text style={styles.grossLabel}>Gross Total</Text>
            <Text style={styles.grossValue}>₹ {summary.grossTotal.toLocaleString('en-IN')}</Text>
          </View>
        </View>

        <TextInput
          label="Narration"
          value={narration}
          onChangeText={(t) => setNarration(t.slice(0, 300))}
          mode="outlined"
          multiline
          numberOfLines={3}
          style={styles.input}
        />
        <Text style={styles.charCount}>{narration.length}/300</Text>
      </ScrollView>

      <VoucherSaveFooter onSave={handleSave} loading={saving} />

      <Modal visible={ledgerModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Ledger</Text>
              <IconButton icon="close" onPress={() => setLedgerModalVisible(false)} />
            </View>
            <Text style={styles.modalHint}>
              All account ledgers from Tally (tax, charges, etc.). Party ledgers (Sundry Debtors /
              Creditors) are excluded.
            </Text>
            <SearchableSelect
              label="Ledger Name"
              pickerTitle="Select ledger"
              value={ledgerName}
              options={extraLedgerOptions}
              onSelect={(o) => setLedgerName(o.label)}
              placeholder="Tax or charge ledger"
              leftIcon="book-open-variant"
            />
            <TextInput
              label="Amount"
              value={ledgerAmount}
              onChangeText={setLedgerAmount}
              keyboardType="decimal-pad"
              mode="outlined"
              left={<TextInput.Affix text="₹" />}
              style={styles.input}
            />
            <Button mode="contained" onPress={addLedger} buttonColor={voucherFormTheme.primary}>
              ADD LEDGER
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: voucherFormTheme.pageBg },
  content: { padding: 16, paddingBottom: 24 },
  input: { marginBottom: 12, backgroundColor: voucherFormTheme.inputBg },
  inputDisabled: { opacity: 0.65 },
  hint: { fontSize: 12, color: voucherFormTheme.muted, marginTop: -8, marginBottom: 12, marginLeft: 4 },
  sectionCard: {
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: voucherFormTheme.radius,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: voucherFormTheme.border,
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontWeight: '700', fontSize: 16, color: voucherFormTheme.text },
  outlineBtn: { borderColor: voucherFormTheme.primary, marginTop: 4 },
  itemCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: voucherFormTheme.border,
  },
  itemCardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  itemTitle: { fontWeight: '600', flex: 1, color: voucherFormTheme.text },
  itemActions: { flexDirection: 'row', alignItems: 'center' },
  itemMeta: { color: voucherFormTheme.muted, fontSize: 13, marginTop: 4 },
  itemAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: voucherFormTheme.primary,
    marginTop: 6,
  },
  ledgerHint: {
    fontSize: 13,
    color: voucherFormTheme.muted,
    marginBottom: 4,
    lineHeight: 18,
  },
  modalHint: { fontSize: 12, color: voucherFormTheme.muted, marginBottom: 8 },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: voucherFormTheme.border,
    marginTop: 4,
  },
  addLink: { color: voucherFormTheme.primary, fontWeight: '700', fontSize: 15 },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: voucherFormTheme.cardBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  summaryCard: {
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: voucherFormTheme.radius,
    padding: 14,
    marginVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: voucherFormTheme.border,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  muted: { color: voucherFormTheme.muted },
  grossRow: { marginTop: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: voucherFormTheme.border },
  grossLabel: { fontWeight: '700', color: voucherFormTheme.primary },
  grossValue: { fontWeight: '700', color: voucherFormTheme.primary, fontSize: 17 },
  charCount: { textAlign: 'right', fontSize: 12, color: voucherFormTheme.muted, marginTop: -8, marginBottom: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28,
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
});

export default CreateItemVoucherScreen;
