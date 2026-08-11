import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, SegmentedButtons, Text } from 'react-native-paper';
import Header from '../components/common/Header';
import { MainStackScreenProps } from '../types/navigation';
import { useCompany } from '../store/hooks';
import { partyService } from '../services/partyService';
import { voucherFormTheme } from '../components/voucher/voucherFormTheme';
import { describeTallyPush } from '../utils/tallyPushMessage';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'CreateLedger'>;

const PARENT_OPTIONS = [
  { value: 'Sundry Debtors', label: 'Sundry Debtors' },
  { value: 'Sundry Creditors', label: 'Sundry Creditors' },
];

const CreateLedgerScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const { selectedCompany } = useCompany();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('Sundry Debtors');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('India');
  const [partyType, setPartyType] = useState<'customer' | 'supplier'>('customer');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedCompany?.id) {
      Alert.alert(t('vouchers.form.companyTitle'), t('vouchers.form.selectCompanyFirst'));
      return;
    }
    if (!name.trim()) {
      Alert.alert(t('masters.nameTitle'), t('masters.ledger.enterName'));
      return;
    }
    if (!mobile.trim()) {
      Alert.alert(t('masters.ledger.mobile'), t('masters.ledger.enterMobile'));
      return;
    }

    const city = state.trim() || 'N/A';
    try {
      setSaving(true);
      const res = await partyService.createParty({
        name: name.trim(),
        type: partyType,
        tallyParent: parent,
        pushToTally: true,
        contact: { phone: mobile.trim() },
        addresses: [
          {
            line1: address.trim() || name.trim(),
            city,
            state: state.trim() || city,
            pincode: pincode.trim() || '000000',
            country: country.trim() || 'India',
            type: 'both',
          },
        ],
      });

      const { title, message } = describeTallyPush(res.tallyPush, 'Ledger');
      Alert.alert(title, message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      Alert.alert(t('common.error'), e.message || t('vouchers.form.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title={t('masters.ledger.title')} showBack onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Creates a ledger in Tally (All Masters import) and stores it as a party.</Text>

        <SegmentedButtons
          value={partyType}
          onValueChange={(v) => {
            setPartyType(v as 'customer' | 'supplier');
            setParent(v === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors');
          }}
          buttons={[
            { value: 'customer', label: t('masters.ledger.customer') },
            { value: 'supplier', label: t('masters.ledger.supplier') },
          ]}
          style={styles.segment}
        />

        <TextInput label={t('masters.nameRequired')} value={name} onChangeText={setName} mode="outlined" style={styles.input} />
        <TextInput label={t('masters.ledger.parent')} value={parent} onChangeText={setParent} mode="outlined" style={styles.input} />
        <TextInput label={t('masters.ledger.mobileRequired')} value={mobile} onChangeText={setMobile} mode="outlined" keyboardType="phone-pad" style={styles.input} />
        <TextInput label={t('masters.ledger.address')} value={address} onChangeText={setAddress} mode="outlined" multiline style={styles.input} />
        <TextInput label={t('masters.ledger.pincode')} value={pincode} onChangeText={setPincode} mode="outlined" keyboardType="number-pad" style={styles.input} />
        <TextInput label={t('masters.ledger.state')} value={state} onChangeText={setState} mode="outlined" style={styles.input} />
        <TextInput label={t('masters.ledger.country')} value={country} onChangeText={setCountry} mode="outlined" style={styles.input} />

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
  segment: { marginBottom: 12 },
  input: { marginBottom: 10, backgroundColor: '#fff' },
  saveBtn: { marginTop: 16 },
});

export default CreateLedgerScreen;
