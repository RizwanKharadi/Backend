import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../components/common/Header';
import { billingService, BillingCycle } from '../services/billingService';
import { MainStackScreenProps } from '../types/navigation';
import { formatDate as sharedFormatDate } from '../utils/formatters';
import { useTranslation } from 'react-i18next';
import { dashboardColors } from '../components/dashboard/dashboardTheme';

type Props = MainStackScreenProps<'Billing'>;

type BillingStatus = {
  access?: { allowed?: boolean; reason?: string; status?: string };
  subscription?: {
    status?: string;
    seatLimit?: number;
    trialEndsAt?: string;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    billingCycle?: string;
    planId?: string;
  };
  seatsUsed?: number;
  seatsAvailable?: number;
  mobileIncluded?: boolean;
  razorpay?: { subscriptionId?: string };
};

function formatDate(value?: string | null): string {
  return (value && sharedFormatDate(value)) || '—';
}

function statusLabel(status?: string): string {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusColor(status?: string): string {
  switch (status) {
    case 'active':
      return '#059669';
    case 'trial':
      return '#2563eb';
    case 'past_due':
    case 'trial_expired':
      return '#d97706';
    case 'cancelled':
    case 'suspended':
      return '#dc2626';
    default:
      return '#64748b';
  }
}

const BillingScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [seatLimit, setSeatLimit] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await billingService.getStatus()) as BillingStatus;
      setStatus(data);
      if (data?.subscription?.seatLimit) {
        setSeatLimit(data.subscription.seatLimit);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { message?: string } } };
      Alert.alert(
        t('common.error'),
        err?.response?.data?.message || err?.message || t('billing.loadFailed')
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const subscribe = async () => {
    try {
      const checkout = await billingService.subscribe(billingCycle, seatLimit);
      if (checkout?.shortUrl) {
        await Linking.openURL(checkout.shortUrl);
        Alert.alert(
          t('billing.completePayment'),
          t('billing.completePaymentHint'),
          [{ text: t('common.ok') }]
        );
      }
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { message?: string } } };
      Alert.alert(t('common.error'), err?.response?.data?.message || err?.message || t('billing.checkoutFailed'));
    }
  };

  const syncFromRazorpay = async () => {
    try {
      await billingService.syncSubscription();
      await load();
      Alert.alert(t('billing.updated'), t('billing.syncedFromRazorpay'));
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { message?: string } } };
      Alert.alert(t('billing.syncFailed'), err?.response?.data?.message || err?.message || t('billing.couldNotSync'));
    }
  };

  const access = status?.access;
  const sub = status?.subscription;
  const planStatus = sub?.status || access?.status || 'unknown';
  const isActive = access?.allowed === true;

  const periodStart = sub?.currentPeriodStart;
  const periodEnd =
    planStatus === 'trial' ? sub?.trialEndsAt : sub?.currentPeriodEnd || sub?.trialEndsAt;
  const expiryLabel =
    planStatus === 'trial' ? 'Trial ends' : planStatus === 'active' ? 'Plan renews / expires' : 'Period end';

  return (
    <View style={styles.container}>
      <Header
        title={t('billing.title')}
        subtitle={t('billing.subtitle')}
        showBack
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator style={styles.loader} color={dashboardColors.accent} />
        ) : (
          <>
            <View style={[styles.hero, { borderColor: statusColor(planStatus) }]}>
              <View style={styles.heroTop}>
                <View
                  style={[styles.statusPill, { backgroundColor: `${statusColor(planStatus)}18` }]}
                >
                  <View style={[styles.statusDot, { backgroundColor: statusColor(planStatus) }]} />
                  <Text style={[styles.statusPillText, { color: statusColor(planStatus) }]}>
                    {statusLabel(planStatus)}
                  </Text>
                </View>
                {isActive ? (
                  <Icon name="check-circle" size={22} color="#059669" />
                ) : (
                  <Icon name="alert-circle-outline" size={22} color="#d97706" />
                )}
              </View>
              <Text style={styles.heroTitle}>
                {isActive ? 'Your plan is active' : 'Subscription required'}
              </Text>
              <Text style={styles.heroSub}>
                {isActive
                  ? 'Mobile app access is included with your organization subscription.'
                  : access?.reason || 'Subscribe to sync Tally data and use all features.'}
              </Text>
            </View>

            <View style={styles.grid}>
              <View style={styles.infoCard}>
                <Icon name="calendar-start" size={22} color={dashboardColors.accent} />
                <Text style={styles.infoLabel}>{t('billing.startDate')}</Text>
                <Text style={styles.infoValue}>{formatDate(periodStart)}</Text>
              </View>
              <View style={styles.infoCard}>
                <Icon name="calendar-end" size={22} color={dashboardColors.accent} />
                <Text style={styles.infoLabel}>{expiryLabel}</Text>
                <Text style={styles.infoValue}>{formatDate(periodEnd)}</Text>
              </View>
              <View style={styles.infoCard}>
                <Icon name="desktop-classic" size={22} color={dashboardColors.accent} />
                <Text style={styles.infoLabel}>{t('billing.deviceSeats')}</Text>
                <Text style={styles.infoValue}>
                  {status?.seatsUsed ?? 0} / {sub?.seatLimit ?? 0} used
                </Text>
              </View>
              <View style={styles.infoCard}>
                <Icon name="repeat" size={22} color={dashboardColors.accent} />
                <Text style={styles.infoLabel}>{t('billing.billingCycle')}</Text>
                <Text style={styles.infoValue}>
                  {(sub?.billingCycle || '—').toString().toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.detailCard}>
              <Text style={styles.detailTitle}>{t('billing.planDetails')}</Text>
              <DetailRow label={t('billing.planId')} value={sub?.planId || t('common.none')} />
              <DetailRow
                label={t('billing.mobileIncluded')}
                value={status?.mobileIncluded !== false ? t('common.yes') : t('common.no')}
              />
              <DetailRow
                label={t('billing.razorpaySubscription')}
                value={
                  status?.razorpay?.subscriptionId
                    ? t('billing.linked')
                    : t('billing.notLinked')
                }
              />
              {status?.razorpay?.subscriptionId ? (
                <Text style={styles.mono} numberOfLines={1}>
                  {status.razorpay.subscriptionId}
                </Text>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Button mode="contained" onPress={syncFromRazorpay} style={styles.btn} icon="sync">
                {t('billing.activateAfterPayment')}
              </Button>
              <Button mode="outlined" onPress={load} style={styles.btn}>
                {t('billing.refreshStatus')}
              </Button>
            </View>

            <View style={styles.upgradeCard}>
              <Text style={styles.upgradeTitle}>{t('billing.upgradeTitle')}</Text>
              <View style={styles.cycleRow}>
                {(['monthly', 'yearly'] as BillingCycle[]).map((cycle) => (
                  <TouchableOpacity
                    key={cycle}
                    style={[styles.cycleChip, billingCycle === cycle && styles.cycleChipActive]}
                    onPress={() => setBillingCycle(cycle)}
                  >
                    <Text
                      style={[
                        styles.cycleChipText,
                        billingCycle === cycle && styles.cycleChipTextActive,
                      ]}
                    >
                      {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.seatsLabel}>Tally PCs (device seats): {seatLimit}</Text>
              <View style={styles.seatRow}>
                <Button mode="outlined" compact onPress={() => setSeatLimit((s) => Math.max(1, s - 1))}>
                  −
                </Button>
                <Text style={styles.seatCount}>{seatLimit}</Text>
                <Button mode="outlined" compact onPress={() => setSeatLimit((s) => Math.min(50, s + 1))}>
                  +
                </Button>
              </View>
              <Button mode="contained" onPress={subscribe} icon="credit-card-outline" style={styles.btn}>{t('billing.payWithRazorpay')}</Button>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dashboardColors.pageBg },
  scroll: { padding: 16, paddingBottom: 32 },
  loader: { marginTop: 40 },
  hero: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderLeftWidth: 4,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: 13, fontWeight: '700' },
  heroTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginTop: 14 },
  heroSub: { fontSize: 14, color: dashboardColors.muted, marginTop: 8, lineHeight: 20 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  infoCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    flexGrow: 1,
    minWidth: '46%',
  },
  infoLabel: { fontSize: 12, color: dashboardColors.muted, marginTop: 8 },
  infoValue: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 4 },
  detailCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  detailTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  detailLabel: { fontSize: 14, color: dashboardColors.muted },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  mono: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  actions: { marginBottom: 16 },
  btn: { marginTop: 10 },
  upgradeCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  upgradeTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  cycleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  cycleChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cycleChipActive: { backgroundColor: '#eff6ff', borderColor: dashboardColors.accent },
  cycleChipText: { fontSize: 14, fontWeight: '600', color: dashboardColors.muted },
  cycleChipTextActive: { color: dashboardColors.accent },
  seatsLabel: { fontSize: 13, color: dashboardColors.muted, marginBottom: 8 },
  seatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 8 },
  seatCount: { fontSize: 18, fontWeight: '700', minWidth: 32, textAlign: 'center' },
});

export default BillingScreen;
