import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { MainStackScreenProps } from '../../types/navigation';
import VoucherFormHeader from '../../components/voucher/VoucherFormHeader';
import SearchableSelect, { SelectOption } from '../../components/voucher/SearchableSelect';
import VoucherTypeGrid from '../../components/voucher/VoucherTypeGrid';
import VoucherSaveFooter from '../../components/voucher/VoucherSaveFooter';
import { voucherFormTheme } from '../../components/voucher/voucherFormTheme';
import { partyService, Party } from '../../services/partyService';
import { useCompany } from '../../store/hooks';
import {
  VOUCHER_TYPE_PICKER,
  VoucherTypePickerOption,
  isItemVoucherType,
  isMoneyVoucherType,
  partyTypeForVoucher,
} from '../../utils/voucherCreateConfig';

type Props = MainStackScreenProps<'CreateNewVoucher'>;

const CreateNewVoucherScreen: React.FC<Props> = ({ navigation, route }) => {
  const { selectedCompany } = useCompany();
  const [voucherType, setVoucherType] = useState(route.params?.initialType || '');
  const [party, setParty] = useState<Party | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);

  const selectedOption = VOUCHER_TYPE_PICKER.find((o) => o.id === voucherType);
  const needsParty = selectedOption?.needsParty !== false && voucherType !== 'journal';

  const loadParties = useCallback(async () => {
    if (!selectedCompany?.id || !voucherType || voucherType === 'journal') return;
    try {
      setLoadingParties(true);
      const res = await partyService.getParties({
        limit: 300,
        type: partyTypeForVoucher(voucherType),
      });
      setParties(res.data);
    } catch (e: any) {
      Alert.alert('Parties', e?.message || 'Could not load parties');
      setParties([]);
    } finally {
      setLoadingParties(false);
    }
  }, [selectedCompany?.id, voucherType]);

  useEffect(() => {
    if (!voucherType || voucherType === 'journal') {
      setParties([]);
      setParty(null);
      return;
    }
    loadParties();
  }, [loadParties, voucherType]);

  const partyOptions: SelectOption[] = parties.map((p) => ({
    id: p.id,
    label: p.name,
    subtitle: [p.gstin, p.state, p.type].filter(Boolean).join(' · '),
  }));

  const handleTypeSelect = (opt: VoucherTypePickerOption) => {
    setVoucherType(opt.id);
    setParty(null);
  };

  const handleContinue = () => {
    if (!voucherType) {
      Alert.alert('Select type', 'Choose a voucher type to continue');
      return;
    }

    if (voucherType === 'journal') {
      navigation.navigate('CreateJournal');
      return;
    }

    if (!party) {
      Alert.alert('Select party', 'Please choose a party');
      return;
    }

    const partyParams = {
      partyId: party.id,
      partyName: party.name,
      partyGstin: party.gstin,
      placeOfSupply: party.state,
    };

    if (isItemVoucherType(voucherType)) {
      navigation.navigate('CreateItemVoucher', {
        voucherType,
        ...partyParams,
      });
      return;
    }

    if (isMoneyVoucherType(voucherType)) {
      navigation.navigate('CreateReceiptPayment', {
        voucherType,
        ...partyParams,
      });
      return;
    }

    navigation.navigate('CreateVoucher', { type: voucherType });
  };

  return (
    <View style={styles.container}>
      <VoucherFormHeader title="Create New" onBack={() => navigation.goBack()} />

      {/* Masters — fixed outside scroll, labels above cards */}
      <View style={styles.mastersOuter}>
        <Text style={styles.mastersSectionTitle}>Tally masters</Text>
        <Text style={styles.mastersSectionSub}>
          Add a ledger or stock item in Tally via desktop agent
        </Text>
        <View style={styles.mastersRow}>
          <TouchableOpacity
            style={styles.masterCard}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('CreateLedger')}
          >
            <View style={[styles.masterIcon, { backgroundColor: '#E8F2FF' }]}>
              <Icon name="book-account-outline" size={28} color={voucherFormTheme.primary} />
            </View>
            <Text style={styles.masterCardTitle}>New Ledger</Text>
            <Text style={styles.masterCardSub}>Customer / supplier</Text>
            <Icon name="chevron-right" size={22} color={voucherFormTheme.muted} style={styles.masterChevron} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.masterCard}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('CreateItem')}
          >
            <View style={[styles.masterIcon, { backgroundColor: '#ECFDF5' }]}>
              <Icon name="package-variant-closed" size={28} color="#059669" />
            </View>
            <Text style={styles.masterCardTitle}>New Stock Item</Text>
            <Text style={styles.masterCardSub}>Product / service</Text>
            <Icon name="chevron-right" size={22} color={voucherFormTheme.muted} style={styles.masterChevron} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Voucher entry</Text>
        <View style={styles.dividerLine} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>Choose voucher type</Text>
        <VoucherTypeGrid selectedId={voucherType} onSelect={handleTypeSelect} />

        {voucherType && voucherType !== 'journal' ? (
          <>
            <Text style={styles.lead}>Select party</Text>
            <SearchableSelect
              label="Party"
              pickerTitle="Select party"
              value={party?.name || ''}
              options={partyOptions}
              onSelect={(o) => {
                const found = parties.find((p) => p.id === o.id);
                if (found) setParty(found);
              }}
              placeholder="Tap to choose party"
              leftIcon="account"
              loading={loadingParties}
            />
            {loadingParties ? (
              <ActivityIndicator style={styles.loader} color={voucherFormTheme.primary} />
            ) : null}
          </>
        ) : null}

        {voucherType &&
        ['sales', 'purchase', 'sales_order', 'purchase_order', 'receipt', 'payment', 'journal'].includes(
          voucherType
        ) ? (
          <Text style={styles.hint}>
            Saves to cloud and imports into TallyPrime when the desktop agent is connected.
          </Text>
        ) : null}
      </ScrollView>

      <VoucherSaveFooter
        onSave={handleContinue}
        disabled={!voucherType || (needsParty && !party)}
        label="CONTINUE"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: voucherFormTheme.pageBg },
  mastersOuter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: voucherFormTheme.cardBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: voucherFormTheme.border,
  },
  mastersSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: voucherFormTheme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  mastersSectionSub: {
    fontSize: 13,
    color: voucherFormTheme.muted,
    marginBottom: 12,
    lineHeight: 18,
  },
  mastersRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  masterCard: {
    flex: 1,
    backgroundColor: voucherFormTheme.pageBg,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: voucherFormTheme.border,
    minHeight: 120,
  },
  masterIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  masterCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: voucherFormTheme.text,
    marginBottom: 2,
  },
  masterCardSub: {
    fontSize: 12,
    color: voucherFormTheme.muted,
  },
  masterChevron: {
    position: 'absolute',
    right: 10,
    top: 12,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: voucherFormTheme.border,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '600',
    color: voucherFormTheme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  lead: {
    fontSize: 15,
    fontWeight: '700',
    color: voucherFormTheme.text,
    marginBottom: 10,
  },
  loader: { marginVertical: 8 },
  hint: {
    fontSize: 13,
    color: voucherFormTheme.muted,
    lineHeight: 20,
    marginTop: 4,
    backgroundColor: '#E8F2FF',
    padding: 12,
    borderRadius: 10,
  },
});

export default CreateNewVoucherScreen;
