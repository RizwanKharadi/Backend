import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import {
  VOUCHER_TYPE_PICKER,
  VoucherTypePickerOption,
  isItemVoucherType,
  isMoneyVoucherType,
  partyTypeForVoucher,
} from '../../utils/voucherCreateConfig';

type Props = MainStackScreenProps<'CreateNewVoucher'>;

const CreateNewVoucherScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { selectedCompany } = useCompany();
  const [voucherType, setVoucherType] = useState(route.params?.initialType || '');
  const [party, setParty] = useState<Party | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);
  /** Bumped after a type is picked so the party picker opens on its own. */
  const [partyOpenToken, setPartyOpenToken] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const partyStepY = useRef(0);

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
      if (res.data.length) setPartyOpenToken((t) => t + 1);
    } catch (e: any) {
      Alert.alert(t('masters.parties'), e?.message || t('masters.couldNotLoadParties'));
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
    // Bring step 2 into view so the next action is never off-screen.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: Math.max(partyStepY.current - 12, 0), animated: true })
    );
  };

  const handleContinue = () => {
    if (!voucherType) {
      Alert.alert(t('vouchers.newVoucherFlow.selectType'), t('vouchers.newVoucherFlow.selectTypeMessage'));
      return;
    }

    if (voucherType === 'journal') {
      navigation.navigate('CreateJournal');
      return;
    }

    if (!party) {
      Alert.alert(t('vouchers.newVoucherFlow.selectParty'), t('vouchers.newVoucherFlow.selectPartyMessage'));
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

  const continueLabel = !voucherType
    ? 'SELECT A VOUCHER TYPE'
    : needsParty && !party
    ? 'SELECT A PARTY'
    : `CONTINUE${selectedOption ? ` — ${selectedOption.label.toUpperCase()}` : ''}`;

  return (
    <View style={styles.container}>
      <VoucherFormHeader title={t('vouchers.newVoucherFlow.title')} onBack={() => navigation.goBack()} />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Step 1 — voucher type */}
        <View style={styles.stepHead}>
          <View style={[styles.stepBadge, styles.stepBadgeActive]}>
            <Text style={styles.stepBadgeText}>1</Text>
          </View>
          <View style={styles.stepHeadText}>
            <Text style={styles.stepTitle}>{t('vouchers.newVoucherFlow.whatCreate')}</Text>
            <Text style={styles.stepSub}>{t('vouchers.newVoucherFlow.tapType')}</Text>
          </View>
        </View>

        <VoucherTypeGrid selectedId={voucherType} onSelect={handleTypeSelect} />

        {/* Step 2 — party */}
        <View onLayout={(e) => (partyStepY.current = e.nativeEvent.layout.y)}>
          {needsParty ? (
            <>
              <View style={styles.stepHead}>
                <View style={[styles.stepBadge, voucherType && styles.stepBadgeActive]}>
                  <Text style={styles.stepBadgeText}>2</Text>
                </View>
                <View style={styles.stepHeadText}>
                  <Text style={styles.stepTitle}>{t('vouchers.newVoucherFlow.whoParty')}</Text>
                  <Text style={styles.stepSub}>
                    {voucherType
                      ? 'Search and pick the customer or supplier'
                      : 'Pick a voucher type first'}
                  </Text>
                </View>
              </View>

              {voucherType ? (
                <>
                  <SearchableSelect
                    label={t('vouchers.form.party')}
                    pickerTitle="Select party"
                    value={party?.name || ''}
                    options={partyOptions}
                    onSelect={(o) => {
                      const found = parties.find((p) => p.id === o.id);
                      if (found) setParty(found);
                    }}
                    placeholder={t('vouchers.newVoucherFlow.tapSearch')}
                    leftIcon="account"
                    loading={loadingParties}
                    openToken={partyOpenToken}
                  />
                  {loadingParties ? (
                    <ActivityIndicator style={styles.loader} color={voucherFormTheme.primary} />
                  ) : (
                    <TouchableOpacity
                      style={styles.inlineLink}
                      activeOpacity={0.7}
                      onPress={() => navigation.navigate('CreateLedger')}
                    >
                      <Icon name="plus-circle-outline" size={18} color={voucherFormTheme.primary} />
                      <Text style={styles.inlineLinkText}>Party not listed? Add a new ledger</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <View style={styles.lockedBox}>
                  <Icon name="lock-outline" size={18} color={voucherFormTheme.muted} />
                  <Text style={styles.lockedText}>
                    {t('vouchers.newVoucherFlow.chooseTypeFirst')}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.lockedBox}>
              <Icon name="information-outline" size={18} color={voucherFormTheme.primary} />
              <Text style={styles.lockedText}>
                Journal needs no party — continue to enter debit and credit lines.
              </Text>
            </View>
          )}
        </View>

        {voucherType ? (
          <Text style={styles.hint}>
            Saves to cloud and imports into TallyPrime when the desktop agent is connected.
          </Text>
        ) : null}

        {/* Masters — secondary, kept out of the main flow */}
        <View style={styles.mastersBlock}>
          <Text style={styles.mastersTitle}>Need something new in Tally?</Text>
          <TouchableOpacity
            style={styles.masterRow}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('CreateLedger')}
          >
            <View style={[styles.masterIcon, { backgroundColor: '#E8F2FF' }]}>
              <Icon name="book-account-outline" size={22} color={voucherFormTheme.primary} />
            </View>
            <View style={styles.masterText}>
              <Text style={styles.masterRowTitle}>{t('masters.ledger.newTitle')}</Text>
              <Text style={styles.masterRowSub}>{t('masters.ledger.newSub')}</Text>
            </View>
            <Icon name="chevron-right" size={22} color={voucherFormTheme.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.masterRow}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('CreateItem')}
          >
            <View style={[styles.masterIcon, { backgroundColor: '#ECFDF5' }]}>
              <Icon name="package-variant-closed" size={22} color="#059669" />
            </View>
            <View style={styles.masterText}>
              <Text style={styles.masterRowTitle}>{t('masters.item.newTitle')}</Text>
              <Text style={styles.masterRowSub}>{t('masters.item.newSub')}</Text>
            </View>
            <Icon name="chevron-right" size={22} color={voucherFormTheme.muted} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <VoucherSaveFooter
        onSave={handleContinue}
        disabled={!voucherType || (needsParty && !party)}
        label={continueLabel}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: voucherFormTheme.pageBg },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  stepHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: voucherFormTheme.border,
  },
  stepBadgeActive: { backgroundColor: voucherFormTheme.primary },
  stepBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  stepHeadText: { flex: 1 },
  stepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: voucherFormTheme.text,
  },
  stepSub: {
    fontSize: 12,
    color: voucherFormTheme.muted,
    marginTop: 1,
  },
  loader: { marginVertical: 8 },
  inlineLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  inlineLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: voucherFormTheme.primary,
  },
  lockedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: voucherFormTheme.cardBg,
    borderWidth: 1,
    borderColor: voucherFormTheme.border,
    borderRadius: 10,
    padding: 12,
  },
  lockedText: {
    flex: 1,
    fontSize: 13,
    color: voucherFormTheme.muted,
    lineHeight: 18,
  },
  hint: {
    fontSize: 13,
    color: voucherFormTheme.muted,
    lineHeight: 20,
    marginTop: 12,
    backgroundColor: '#E8F2FF',
    padding: 12,
    borderRadius: 10,
  },
  mastersBlock: {
    marginTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: voucherFormTheme.border,
    paddingTop: 16,
  },
  mastersTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: voucherFormTheme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  masterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: voucherFormTheme.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: voucherFormTheme.border,
    padding: 12,
    marginBottom: 10,
  },
  masterIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterText: { flex: 1 },
  masterRowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: voucherFormTheme.text,
  },
  masterRowSub: {
    fontSize: 12,
    color: voucherFormTheme.muted,
  },
});

export default CreateNewVoucherScreen;
