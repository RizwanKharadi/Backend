import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { TextInput, Button, Text, IconButton, SegmentedButtons } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';

import { MainStackScreenProps } from '../../types/navigation';
import type { CreateVoucherData } from '../../types';
import VoucherFormHeader from '../../components/voucher/VoucherFormHeader';
import OptionalEntryRow from '../../components/voucher/OptionalEntryRow';
import VoucherSaveFooter from '../../components/voucher/VoucherSaveFooter';
import { voucherFormTheme } from '../../components/voucher/voucherFormTheme';
import { useCompany } from '../../store/hooks';
import { voucherService } from '../../services/voucherService';
import { describeTallyPush } from '../../utils/tallyPushMessage';

type Props = MainStackScreenProps<'CreateJournal'>;

interface JournalLine {
  ledgerName: string;
  amount: number;
  side: 'debit' | 'credit';
}

const CreateJournalVoucherScreen: React.FC<Props> = ({ navigation }) => {
  const { selectedCompany } = useCompany();
  const [isOptional, setIsOptional] = useState(false);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [voucherNumber, setVoucherNumber] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [autoNumbering, setAutoNumbering] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [ledgerName, setLedgerName] = useState('');
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<'debit' | 'credit'>('debit');

  useEffect(() => {
    if (!selectedCompany?.id) return;
    voucherService
      .getNextVoucherNumber('journal', selectedCompany.id)
      .then(() => setAutoNumbering(true))
      .catch(() => setAutoNumbering(false));
  }, [selectedCompany?.id]);

  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });

  const totalDebit = lines
    .filter((l) => l.side === 'debit')
    .reduce((s, l) => s + l.amount, 0);
  const totalCredit = lines
    .filter((l) => l.side === 'credit')
    .reduce((s, l) => s + l.amount, 0);

  const addLine = () => {
    const amt = parseFloat(amount);
    if (!ledgerName.trim() || !amt) {
      Alert.alert('Ledger', 'Enter ledger name and amount');
      return;
    }
    setLines((prev) => [...prev, { ledgerName: ledgerName.trim(), amount: amt, side }]);
    setLedgerName('');
    setAmount('');
    setSide('debit');
    setModalVisible(false);
  };

  const handleSave = async () => {
    if (!selectedCompany?.id) {
      Alert.alert('Company', 'Select a company first');
      return;
    }
    if (lines.length < 2) {
      Alert.alert('Ledgers', 'Add at least two ledger lines');
      return;
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      Alert.alert(
        'Not balanced',
        `Debit ₹${totalDebit.toLocaleString('en-IN')} must equal Credit ₹${totalCredit.toLocaleString('en-IN')}`
      );
      return;
    }

    const entries = lines.map((l) => ({
      ledger: l.ledgerName,
      debit: l.side === 'debit' ? l.amount : 0,
      credit: l.side === 'credit' ? l.amount : 0,
    }));

    const payload: CreateVoucherData = {
      voucherType: 'journal',
      date: date.toISOString().slice(0, 10),
      voucherNumber: voucherNumber.trim() || undefined,
      narration: narration.trim() || undefined,
      amount: totalDebit,
      companyId: selectedCompany.id,
      isOptional,
      entries,
      ledgerEntries: entries,
    };

    try {
      setSaving(true);
      const response = await voucherService.createVoucher(payload);
      const { title, message } = describeTallyPush(response.tallyPush, 'Journal entry');
      Alert.alert(title, message, [{ text: 'OK', onPress: () => navigation.popToTop() }]);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <VoucherFormHeader title="Journal Entry" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <OptionalEntryRow checked={isOptional} onToggle={() => setIsOptional(!isOptional)} />

        <TouchableOpacity onPress={() => setShowDatePicker(true)}>
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
          label="Voucher No. (optional)"
          value={voucherNumber}
          onChangeText={setVoucherNumber}
          mode="outlined"
          editable={!autoNumbering}
          left={<TextInput.Icon icon="ticket-confirmation" />}
          style={[styles.input, autoNumbering && styles.inputDisabled]}
        />
        {autoNumbering ? (
          <Text style={styles.hint}>Disabled due to autonumbering in Tally</Text>
        ) : null}

        <TouchableOpacity style={styles.linkRow} onPress={() => setModalVisible(true)}>
          <Text style={styles.sectionTitle}>Ledger</Text>
          <Text style={styles.addLink}>ADD</Text>
        </TouchableOpacity>

        {lines.map((l, i) => (
          <View key={`${l.ledgerName}-${i}`} style={styles.lineCard}>
            <View style={styles.lineHead}>
              <Text style={styles.lineName}>{l.ledgerName}</Text>
              <IconButton
                icon="delete-outline"
                size={20}
                iconColor={voucherFormTheme.danger}
                onPress={() => setLines((p) => p.filter((_, j) => j !== i))}
              />
            </View>
            <Text style={styles.lineMeta}>
              {l.side === 'debit' ? 'Debit' : 'Credit'} · ₹ {l.amount.toLocaleString('en-IN')}
            </Text>
          </View>
        ))}

        <View style={styles.balanceCard}>
          <View style={styles.balanceRow}>
            <Text style={styles.muted}>Total Debit</Text>
            <Text>₹ {totalDebit.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.muted}>Total Credit</Text>
            <Text>₹ {totalCredit.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.muted}>Difference</Text>
            <Text
              style={{
                color:
                  Math.abs(totalDebit - totalCredit) < 0.01
                    ? voucherFormTheme.success
                    : voucherFormTheme.danger,
                fontWeight: '700',
              }}
            >
              ₹ {Math.abs(totalDebit - totalCredit).toLocaleString('en-IN')}
            </Text>
          </View>
        </View>

        <Text style={styles.narrationLabel}>Narration</Text>
        <TextInput
          value={narration}
          onChangeText={(t) => setNarration(t.slice(0, 300))}
          mode="outlined"
          multiline
          numberOfLines={5}
          placeholder="Enter narration..."
          style={styles.narrationInput}
        />
        <Text style={styles.charCount}>{narration.length}/300</Text>
      </ScrollView>

      <VoucherSaveFooter onSave={handleSave} loading={saving} />

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Ledger</Text>
              <IconButton icon="close" onPress={() => setModalVisible(false)} />
            </View>

            <TextInput
              label="Ledger Name"
              value={ledgerName}
              onChangeText={setLedgerName}
              mode="outlined"
              left={<TextInput.Icon icon="book-open-variant" />}
              style={styles.input}
            />
            <TextInput
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              mode="outlined"
              left={<TextInput.Affix text="₹" />}
              style={styles.input}
            />

            <SegmentedButtons
              value={side}
              onValueChange={(v) => setSide(v as 'debit' | 'credit')}
              buttons={[
                { value: 'debit', label: 'Debit' },
                { value: 'credit', label: 'Credit' },
              ]}
              style={styles.segment}
            />

            <Button
              mode="text"
              onPress={() => {
                const amt = parseFloat(amount);
                if (!ledgerName.trim() || !amt) {
                  Alert.alert('Ledger', 'Enter ledger name and amount');
                  return;
                }
                setLines((prev) => [
                  ...prev,
                  { ledgerName: ledgerName.trim(), amount: amt, side },
                ]);
                setLedgerName('');
                setAmount('');
                setSide('debit');
              }}
              textColor={voucherFormTheme.primary}
            >
              + ADD LEDGER
            </Button>

            <Button
              mode="contained"
              onPress={addLine}
              buttonColor={voucherFormTheme.primary}
              style={styles.modalSave}
            >
              DONE
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
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  sectionTitle: { fontWeight: '700', fontSize: 16 },
  addLink: { color: voucherFormTheme.primary, fontWeight: '700', fontSize: 15 },
  lineCard: {
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: voucherFormTheme.border,
  },
  lineHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineName: { fontWeight: '600', flex: 1 },
  lineMeta: { color: voucherFormTheme.muted, fontSize: 13, marginTop: 4 },
  balanceCard: {
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: 12,
    padding: 14,
    marginVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: voucherFormTheme.border,
  },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  muted: { color: voucherFormTheme.muted },
  narrationLabel: { fontWeight: '700', fontSize: 16, marginBottom: 8, marginTop: 4 },
  narrationInput: { backgroundColor: voucherFormTheme.inputBg, minHeight: 120 },
  charCount: { textAlign: 'right', fontSize: 12, color: voucherFormTheme.muted, marginTop: 4 },
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
  segment: { marginBottom: 12 },
  modalSave: { marginTop: 8, borderRadius: 10 },
});

export default CreateJournalVoucherScreen;
