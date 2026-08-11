import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Surface,
  Title,
  TextInput,
  Button,
  Card,
  Chip,
  ActivityIndicator,
  useTheme,
  IconButton,
  Divider,
  Menu,
  Paragraph,
  SegmentedButtons,
} from 'react-native-paper';
import { useDispatch } from 'react-redux';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import DateTimePicker from '@react-native-community/datetimepicker';

// Components
import Header from '../components/common/Header';

// Store
import { AppDispatch } from '../store';
import { createVoucher } from '../store/slices/voucherSlice';
import { useCompany } from '../store/hooks';

// Services
import { voucherService } from '../services/voucherService';

// Types
import { MainStackScreenProps } from '../types/navigation';
import { VoucherType, CreateVoucherData, VoucherEntry } from '../types';
import { formatCurrency } from '../utils/formatters';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'CreateVoucher'>;

interface CreateVoucherForm {
  voucherNumber?: string;
  voucherType: VoucherType;
  date: string;
  reference?: string;
  narration?: string;
  entries: Array<{
    accountName: string;
    debitAmount: number;
    creditAmount: number;
    narration?: string;
  }>;
}

const CreateVoucherScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { t } = useTranslation();
  const companyState = useCompany();
  const selectedCompanyId = companyState?.selectedCompany?.id;
  
  const voucherType = (route.params?.type as VoucherType) || 'journal';
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([
    'sales',
    'purchase',
    'receipt',
    'payment',
    'journal',
    'contra',
    'debit_note',
    'credit_note',
  ]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [accountsMenuOpen, setAccountsMenuOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextVoucherNumber, setNextVoucherNumber] = useState<string>('');

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
    setValue,
  } = useForm<CreateVoucherForm>({
    defaultValues: {
      voucherNumber: '',
      voucherType: voucherType,
      date: new Date().toISOString().split('T')[0],
      reference: '',
      narration: '',
      entries: [{ accountName: '', debitAmount: 0, creditAmount: 0, narration: '' }],
    },
  });

  const voucherTypeLabels: Record<VoucherType, string> = {
    sales: t('vouchers.kind.sales'),
    purchase: t('vouchers.kind.purchase'),
    receipt: t('vouchers.kind.receipt'),
    payment: t('vouchers.kind.payment'),
    journal: t('vouchers.kind.journal'),
    contra: t('vouchers.kind.contra'),
    debit_note: t('vouchers.kind.debitNote'),
    credit_note: t('vouchers.kind.creditNote'),
  };

  const voucherTypeDescriptions: Record<VoucherType, string> = {
    sales: t('vouchers.kindDescription.sales'),
    purchase: t('vouchers.kindDescription.purchase'),
    receipt: t('vouchers.kindDescription.receipt'),
    payment: t('vouchers.kindDescription.payment'),
    journal: t('vouchers.kindDescription.journal'),
    contra: t('vouchers.kindDescription.contra'),
    debit_note: t('vouchers.kindDescription.debitNote'),
    credit_note: t('vouchers.kindDescription.creditNote'),
  };

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'entries',
  });

  const watchEntries = watch('entries');
  const watchVoucherType = watch('voucherType');

  const voucherTypeOptions = voucherTypes.map((type) => ({
    value: type,
    label: voucherTypeLabels[type] || type,
  }));

  const selectedVoucherTypeDescription = voucherTypeDescriptions[watchVoucherType];

  // Load voucher types and next number on mount
  useEffect(() => {
    if (selectedCompanyId) {
      loadInitialData();
    }
  }, [selectedCompanyId]);

  // Load accounts when company changes
  useEffect(() => {
    loadAccounts();
  }, []);

  // Get next voucher number when voucher type changes
  useEffect(() => {
    if (watchVoucherType && companyState?.selectedCompany?.id) {
      getNextVoucherNumber();
    }
  }, [watchVoucherType, companyState?.selectedCompany?.id]);

  const loadInitialData = async () => {
    try {
      if (!selectedCompanyId) {
        return;
      }

      setLoading(true);
      const response = await voucherService.getVoucherTypes(selectedCompanyId);
      if (response.success && response.data) {
        setVoucherTypes(response.data.map((vt) => vt.type as VoucherType));
      }
    } catch (error) {
      console.error('Failed to load voucher types:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      // For now, using mock data. In production, fetch from accountService
      setAccounts([
        { id: '1', name: 'Cash Account' },
        { id: '2', name: 'Bank Account' },
        { id: '3', name: 'Sales Account' },
        { id: '4', name: 'Purchase Account' },
        { id: '5', name: 'Sundry Debtors' },
        { id: '6', name: 'Sundry Creditors' },
        { id: '7', name: 'GST Input' },
        { id: '8', name: 'GST Output' },
      ]);
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const getNextVoucherNumber = async () => {
    try {
      const companyId = companyState?.selectedCompany?.id;
      if (!companyId) return;

      const response = await voucherService.getNextVoucherNumber(watchVoucherType, companyId);
      if (response.success && response.data) {
        setNextVoucherNumber(response.data.nextNumber);
        setValue('voucherNumber', response.data.nextNumber);
      }
    } catch (error) {
      console.error('Failed to get next voucher number:', error);
    }
  };

  const handleDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (date) {
      setSelectedDate(date);
      setValue('date', date.toISOString().split('T')[0]);
    }
  };

  const calculateTotals = () => {
    let totalDebit = 0;
    let totalCredit = 0;

    watchEntries.forEach((entry) => {
      totalDebit += entry.debitAmount || 0;
      totalCredit += entry.creditAmount || 0;
    });

    return { totalDebit, totalCredit };
  };

  const isBalanced = () => {
    const { totalDebit, totalCredit } = calculateTotals();
    return Math.abs(totalDebit - totalCredit) < 0.01;
  };

  const onSubmit = async (data: CreateVoucherForm) => {
    try {
      if (!selectedCompanyId) {
        Alert.alert(t('errors.validation.title'), t('vouchers.createScreen.needCompany'));
        return;
      }

      // Validate entries
      if (data.entries.length === 0) {
        Alert.alert(t('errors.validation.title'), t('vouchers.createScreen.needEntry'));
        return;
      }

      const hasInvalidEntries = data.entries.some(
        (entry) => !entry.accountName || (entry.debitAmount === 0 && entry.creditAmount === 0),
      );

      if (hasInvalidEntries) {
        Alert.alert(t('errors.validation.title'), t('vouchers.createScreen.needFields'));
        return;
      }

      // Validate balance
      if (!isBalanced()) {
        Alert.alert(t('errors.validation.title'), t('vouchers.createScreen.mustBalance'));
        return;
      }

      // Create voucher data
      const createVoucherData: CreateVoucherData = {
        voucherNumber: data.voucherNumber || nextVoucherNumber,
        voucherType: data.voucherType,
        date: data.date,
        reference: data.reference,
        narration: data.narration,
        amount: calculateTotals().totalDebit,
        entries: data.entries.map((entry) => ({
          id: Math.random().toString(),
          accountId: entry.accountName,
          accountName: entry.accountName,
          debitAmount: entry.debitAmount,
          creditAmount: entry.creditAmount,
          narration: entry.narration,
        })),
        companyId: selectedCompanyId,
        createdBy: 'current-user-id', // Should come from auth state
      };

      // Dispatch create action
      const result = await dispatch(createVoucher(createVoucherData)).unwrap();

      Alert.alert(t('common.success'), t('vouchers.createScreen.success'), [
        {
          text: t('common.ok'),
          onPress: () => {
            navigation.goBack();
          },
        },
      ]);

      reset();
    } catch (error: any) {
      Alert.alert(t('common.error'), error || t('vouchers.createScreen.failed'));
    }
  };

  const { totalDebit, totalCredit } = calculateTotals();
  const balanced = isBalanced();

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Header
        title={t('vouchers.create')}
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Voucher Type Selection */}
        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>{t('vouchers.createScreen.voucherType')}</Title>
          <Controller
            control={control}
            name="voucherType"
            rules={{ required: 'Voucher type is required' }}
            render={({ field: { onChange, value } }) => (
              <SegmentedButtons
                value={value}
                onValueChange={onChange}
                buttons={voucherTypeOptions}
              />
            )}
          />

          {selectedVoucherTypeDescription ? (
            <Paragraph style={styles.typeDescription}>
              {selectedVoucherTypeDescription}
            </Paragraph>
          ) : null}
        </Surface>

        {/* Basic Details */}
        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>{t('vouchers.createScreen.voucherDetails')}</Title>

          {/* Voucher Number */}
          <Controller
            control={control}
            name="voucherNumber"
            render={({ field: { onChange, value } }) => (
              <TextInput
                label={t('vouchers.createScreen.voucherNumber')}
                value={value}
                onChangeText={onChange}
                mode="outlined"
                style={styles.input}
                editable={false}
                right={<TextInput.Icon icon="lock" />}
              />
            )}
          />

          {/* Date */}
          <View style={styles.dateContainer}>
            <Controller
              control={control}
              name="date"
              rules={{ required: 'Date is required' }}
              render={({ field: { onChange, value } }) => (
                <TextInput
                  label={t('vouchers.createScreen.dateRequired')}
                  value={value}
                  editable={false}
                  mode="outlined"
                  style={[styles.input, styles.dateInput]}
                  right={
                    <TextInput.Icon
                      icon="calendar"
                      onPress={() => setShowDatePicker(true)}
                    />
                  }
                />
              )}
            />
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
            />
          )}

          {/* Reference */}
          <Controller
            control={control}
            name="reference"
            render={({ field: { onChange, value } }) => (
              <TextInput
                label={t('vouchers.createScreen.referenceLabel')}
                value={value}
                onChangeText={onChange}
                mode="outlined"
                style={styles.input}
                placeholder={t('vouchers.createScreen.referencePlaceholder')}
              />
            )}
          />

          {/* Narration */}
          <Controller
            control={control}
            name="narration"
            render={({ field: { onChange, value } }) => (
              <TextInput
                label={t('vouchers.item.narration')}
                value={value}
                onChangeText={onChange}
                mode="outlined"
                style={styles.input}
                multiline
                numberOfLines={3}
                placeholder={t('vouchers.createScreen.narrationPlaceholder')}
              />
            )}
          />
        </Surface>

        {/* Entries Section */}
        <Surface style={styles.card} elevation={2}>
          <View style={styles.entriesHeader}>
            <Title style={styles.cardTitle}>
              {['sales', 'purchase'].includes(watchVoucherType)
                ? t('vouchers.createScreen.invoiceEntries')
                : ['receipt', 'payment'].includes(watchVoucherType)
                ? t('vouchers.createScreen.paymentEntries')
                : t('vouchers.createScreen.journalEntries')}
            </Title>
            <Button
              icon="plus"
              mode="contained"
              onPress={() =>
                append({ accountName: '', debitAmount: 0, creditAmount: 0, narration: '' })
              }
            >
              {t('vouchers.createScreen.addEntry')}
            </Button>
          </View>
          {['sales', 'purchase'].includes(watchVoucherType) && (
            <Paragraph style={styles.typeDescription}>
              {t('vouchers.createScreen.invoiceHint')}
            </Paragraph>
          )}

          {fields.map((field, index) => (
            <Card key={field.id} style={styles.entryCard}>
              <Card.Content>
                <View style={styles.entryHeader}>
                  <Title style={styles.entryTitle}>{t('vouchers.createScreen.entryNumber', { number: index + 1 })}</Title>
                  {fields.length > 1 && (
                    <IconButton
                      icon="delete"
                      iconColor={theme.colors.error}
                      size={20}
                      onPress={() => remove(index)}
                    />
                  )}
                </View>

                {/* Account Selection */}
                <Controller
                  control={control}
                  name={`entries.${index}.accountName`}
                  rules={{ required: 'Account is required' }}
                  render={({ field: { onChange, value } }) => (
                    <Menu
                      visible={accountsMenuOpen === index}
                      onDismiss={() => setAccountsMenuOpen(null)}
                      anchor={
                        <TextInput
                          label={t('vouchers.createScreen.accountRequired')}
                          value={value}
                          onFocus={() => setAccountsMenuOpen(index)}
                          mode="outlined"
                          style={styles.input}
                          editable={false}
                          right={<TextInput.Icon icon="chevron-down" />}
                        />
                      }
                    >
                      {accounts.map((account) => (
                        <Menu.Item
                          key={account.id}
                          onPress={() => {
                            onChange(account.name);
                            setAccountsMenuOpen(null);
                          }}
                          title={account.name}
                        />
                      ))}
                    </Menu>
                  )}
                />

                {errors.entries?.[index]?.accountName && (
                  <Paragraph style={styles.errorText}>
                    {errors.entries[index]?.accountName?.message}
                  </Paragraph>
                )}

                {/* Debit and Credit Amounts */}
                <View style={styles.amountRow}>
                  <Controller
                    control={control}
                    name={`entries.${index}.debitAmount`}
                    render={({ field: { onChange, value } }) => (
                      <TextInput
                        label={t('vouchers.journal.debit')}
                        value={value?.toString()}
                        onChangeText={(text) => onChange(parseFloat(text) || 0)}
                        mode="outlined"
                        keyboardType="decimal-pad"
                        style={[styles.input, styles.amountInput]}
                        left={<TextInput.Affix text="₹" />}
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name={`entries.${index}.creditAmount`}
                    render={({ field: { onChange, value } }) => (
                      <TextInput
                        label={t('vouchers.journal.credit')}
                        value={value?.toString()}
                        onChangeText={(text) => onChange(parseFloat(text) || 0)}
                        mode="outlined"
                        keyboardType="decimal-pad"
                        style={[styles.input, styles.amountInput]}
                        left={<TextInput.Affix text="₹" />}
                      />
                    )}
                  />
                </View>

                {/* Entry Narration */}
                <Controller
                  control={control}
                  name={`entries.${index}.narration`}
                  render={({ field: { onChange, value } }) => (
                    <TextInput
                      label={t('vouchers.item.narration')}
                      value={value}
                      onChangeText={onChange}
                      mode="outlined"
                      style={styles.input}
                      placeholder={t('vouchers.createScreen.entryNarrationPlaceholder')}
                    />
                  )}
                />
              </Card.Content>
            </Card>
          ))}

          {/* Totals Summary */}
          <Card style={[styles.totalsCard, { backgroundColor: balanced ? theme.colors.surfaceVariant : theme.colors.errorContainer }]}>
            <Card.Content>
              <View style={styles.totalsRow}>
                <Paragraph style={styles.totalsLabel}>{t('vouchers.createScreen.totalDebitLabel')}</Paragraph>
                <Title style={styles.totalsValue}>{formatCurrency(totalDebit)}</Title>
              </View>
              <Divider style={styles.totalsDivider} />
              <View style={styles.totalsRow}>
                <Paragraph style={styles.totalsLabel}>{t('vouchers.createScreen.totalCreditLabel')}</Paragraph>
                <Title style={styles.totalsValue}>{formatCurrency(totalCredit)}</Title>
              </View>
              <Divider style={styles.totalsDivider} />
              <View style={styles.totalsRow}>
                <Paragraph style={[styles.totalsLabel, { fontWeight: 'bold' }]}>{t('vouchers.createScreen.differenceLabel')}</Paragraph>
                <Title
                  style={[
                    styles.totalsValue,
                    {
                      color: balanced ? theme.colors.primary : theme.colors.error,
                    },
                  ]}
                >
                  {formatCurrency(Math.abs(totalDebit - totalCredit))}
                </Title>
              </View>
            </Card.Content>
          </Card>

          {!balanced && (
            <Chip
              icon="alert"
              style={[styles.balanceWarning, { backgroundColor: theme.colors.errorContainer }]}
              textStyle={{ color: theme.colors.error }}
            >
              {t('vouchers.createScreen.mustBalanceChip')}
            </Chip>
          )}
        </Surface>

        {/* Submit Buttons */}
        <View style={styles.buttonContainer}>
          <Button
            mode="outlined"
            onPress={() => {
              reset();
            }}
            style={styles.button}
            disabled={isSubmitting || loading}
          >
            {t('vouchers.createScreen.clear')}
          </Button>
          <Button
            mode="contained"
            onPress={handleSubmit(onSubmit)}
            style={styles.button}
            loading={isSubmitting || loading}
            disabled={!balanced || isSubmitting || loading}
          >
            {t('vouchers.create')}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 12,
  },
  card: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  input: {
    marginBottom: 12,
  },
  dateContainer: {
    marginBottom: 12,
  },
  dateInput: {
    marginBottom: 0,
  },
  entriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  entryCard: {
    marginBottom: 12,
    borderRadius: 8,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  entryTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  amountInput: {
    flex: 1,
  },
  errorText: {
    color: '#B3261E',
    fontSize: 12,
    marginTop: -8,
    marginBottom: 8,
  },
  totalsCard: {
    marginTop: 12,
    borderRadius: 8,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  totalsLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  totalsValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  typeDescription: {
    marginTop: 10,
    fontSize: 14,
    color: '#555',
  },
  totalsDivider: {
    marginVertical: 4,
  },
  balanceWarning: {
    marginTop: 12,
    alignSelf: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 16,
    marginBottom: 20,
  },
  button: {
    flex: 1,
  },
});

export default CreateVoucherScreen;
