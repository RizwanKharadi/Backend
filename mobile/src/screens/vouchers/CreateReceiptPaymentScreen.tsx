import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';

import { MainStackScreenProps } from '../../types/navigation';
import type { CreateVoucherData } from '../../types';
import VoucherFormHeader from '../../components/voucher/VoucherFormHeader';
import SearchableSelect, { SelectOption } from '../../components/voucher/SearchableSelect';
import OptionalEntryRow from '../../components/voucher/OptionalEntryRow';
import VoucherSaveFooter from '../../components/voucher/VoucherSaveFooter';
import { voucherFormTheme } from '../../components/voucher/voucherFormTheme';
import { useCompany } from '../../store/hooks';
import { voucherService } from '../../services/voucherService';
import { DEFAULT_BANK_CASH_LEDGERS, PAYMENT_MODES } from '../../utils/voucherCreateConfig';
import { describeTallyPush } from '../../utils/tallyPushMessage';
import { formatDateShortYear, currencySymbol } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'CreateReceiptPayment'>;

const CreateReceiptPaymentScreen: React.FC<Props> = ({ navigation, route }) => {
  const { voucherType, partyId, partyName } = route.params;
  const isReceipt = voucherType === 'receipt';
  const { t } = useTranslation();
  const title = isReceipt ? t('vouchers.type.receipt') : t('vouchers.type.payment');
  const { selectedCompany } = useCompany();

  const [isOptional, setIsOptional] = useState(false);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [bankCashName, setBankCashName] = useState('');
  const [voucherNumber, setVoucherNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [billReference, setBillReference] = useState('');
  const [narration, setNarration] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoNumbering, setAutoNumbering] = useState(true);

  const [bankOptions, setBankOptions] = useState<SelectOption[]>(
    DEFAULT_BANK_CASH_LEDGERS.map((n, i) => ({ id: `b-${i}`, label: n }))
  );
  const paymentModeOptions: SelectOption[] = PAYMENT_MODES.map((m, i) => ({
    id: `pm-${i}`,
    label: m,
  }));

  const loadBankLedgers = useCallback(async () => {
    const names = new Set<string>(DEFAULT_BANK_CASH_LEDGERS);
    try {
      const res = await voucherService.getVouchers({
        companyId: selectedCompany?.id,
        voucherType,
        limit: 50,
      });
      for (const v of res.data) {
        for (const e of v.entries || []) {
          const n = e.accountName || '';
          if (n && n.toLowerCase() !== partyName.toLowerCase()) {
            names.add(n);
          }
        }
      }
    } catch {
      /* defaults */
    }
    setBankOptions([...names].map((n, i) => ({ id: `b-${i}`, label: n })));
  }, [selectedCompany?.id, voucherType, partyName]);

  useEffect(() => {
    loadBankLedgers();
  }, [loadBankLedgers]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    voucherService
      .getNextVoucherNumber(voucherType, selectedCompany.id)
      .then(() => setAutoNumbering(true))
      .catch(() => setAutoNumbering(false));
  }, [selectedCompany?.id, voucherType]);

  const formatDate = (d: Date) => formatDateShortYear(d);

  const handleSave = async () => {
    if (!selectedCompany?.id) {
      Alert.alert(t('vouchers.form.companyTitle'), t('vouchers.form.selectCompanyFirst'));
      return;
    }
    const amt = parseFloat(amount);
    if (!bankCashName.trim()) {
      Alert.alert(t('vouchers.form.bankCash'), t('vouchers.form.bankCashRequired'));
      return;
    }
    if (!amt || amt <= 0) {
      Alert.alert(t('vouchers.form.amountTitle'), t('vouchers.form.amountInvalid'));
      return;
    }

    const entries = isReceipt
      ? [
          { ledger: bankCashName, debit: amt, credit: 0 },
          { ledger: partyName, debit: 0, credit: amt },
        ]
      : [
          { ledger: partyName, debit: amt, credit: 0 },
          { ledger: bankCashName, debit: 0, credit: amt },
        ];

    const tallyCompanyName =
      (selectedCompany?.tallyIntegration as { companyName?: string })?.companyName ||
      selectedCompany?.name ||
      '';

    const payload: CreateVoucherData = {
      voucherType,
      date: date.toISOString().slice(0, 10),
      party: partyId,
      partyName,
      voucherNumber: voucherNumber.trim() || undefined,
      reference: billReference.trim() || undefined,
      narration: narration.trim() || undefined,
      amount: amt,
      companyId: selectedCompany.id,
      tallyCompanyName,
      bankLedgerName: bankCashName.trim(),
      paymentMode: paymentMode.trim() || undefined,
      isOptional,
      entries,
      ledgerEntries: entries,
    };

    try {
      setSaving(true);
      const response = await voucherService.createVoucher(payload);
      const pushInfo = describeTallyPush(response.tallyPush, t('vouchers.form.voucherOfType', { type: title }));
      Alert.alert(pushInfo.title, pushInfo.message, [
        { text: t('common.ok'), onPress: () => navigation.popToTop() },
      ]);
    } catch (e: any) {
      Alert.alert(t('common.error'), e.message || t('vouchers.form.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <VoucherFormHeader
        title={partyName}
        subtitle={title}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <OptionalEntryRow checked={isOptional} onToggle={() => setIsOptional(!isOptional)} />

        <TouchableOpacity onPress={() => setShowDatePicker(true)}>
          <TextInput
            label={t('vouchers.form.date')}
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
          label={t('vouchers.form.party')}
          value={partyName}
          mode="outlined"
          editable={false}
          left={<TextInput.Icon icon="account" />}
          style={styles.input}
        />

        <SearchableSelect
          label={t('vouchers.form.bankCash')}
          value={bankCashName}
          options={bankOptions}
          onSelect={(o) => setBankCashName(o.label)}
          leftIcon="wallet"
          placeholder={t('vouchers.form.bankCash')}
        />

        <TextInput
          label={t('vouchers.form.voucherNumber')}
          value={voucherNumber}
          onChangeText={setVoucherNumber}
          mode="outlined"
          editable={!autoNumbering}
          left={<TextInput.Icon icon="ticket-confirmation" />}
          style={[styles.input, autoNumbering && styles.inputDisabled]}
        />
        {autoNumbering ? (
          <Text style={styles.hint}>{t('vouchers.form.autoNumbering')}</Text>
        ) : null}

        <TextInput
          label={t('vouchers.form.amountWithSymbol', { symbol: currencySymbol() })}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          mode="outlined"
          left={<TextInput.Icon icon="currency-inr" />}
          style={styles.input}
        />

        <SearchableSelect
          label={t('vouchers.form.paymentMode')}
          value={paymentMode}
          options={paymentModeOptions}
          onSelect={(o) => setPaymentMode(o.label)}
          leftIcon="hand-coin"
          placeholder={t('vouchers.form.paymentMode')}
        />

        <TextInput
          label={t('vouchers.form.billReference')}
          value={billReference}
          onChangeText={setBillReference}
          mode="outlined"
          placeholder={t('vouchers.form.billReferenceHint')}
          style={styles.input}
        />
        <Text style={styles.hint}>
          Optional — links receipt/payment to an outstanding bill in Tally (Agst Ref).
        </Text>

        <TextInput
          label={t('vouchers.item.narration')}
          value={narration}
          onChangeText={(t) => setNarration(t.slice(0, 300))}
          mode="outlined"
          multiline
          numberOfLines={4}
          style={styles.input}
        />
        <Text style={styles.charCount}>{narration.length}/300</Text>
      </ScrollView>

      <VoucherSaveFooter onSave={handleSave} loading={saving} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: voucherFormTheme.pageBg },
  content: { padding: 16, paddingBottom: 24 },
  input: { marginBottom: 12, backgroundColor: voucherFormTheme.inputBg },
  inputDisabled: { opacity: 0.65 },
  hint: { fontSize: 12, color: voucherFormTheme.muted, marginTop: -8, marginBottom: 12, marginLeft: 4 },
  billsSection: { marginVertical: 8 },
  sectionTitle: { fontWeight: '700', fontSize: 16, color: voucherFormTheme.muted, marginBottom: 10 },
  billsBtn: { borderColor: voucherFormTheme.primary, borderRadius: 10 },
  charCount: { textAlign: 'right', fontSize: 12, color: voucherFormTheme.muted, marginTop: -8 },
});

export default CreateReceiptPaymentScreen;
