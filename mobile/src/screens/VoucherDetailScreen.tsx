import React, { useEffect, useMemo, useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  Pressable,
  Linking,
  StatusBar,
} from 'react-native';
import {
  Surface,
  Text,
  List,
  Button,
  useTheme,
} from 'react-native-paper';
import { useSelector, useDispatch } from 'react-redux';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import RNPrint from 'react-native-print';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import LoadingScreen from '../components/common/LoadingScreen';
import { RootState, AppDispatch } from '../store';
import {
  fetchVoucherById,
  hydrateVoucherFromTally,
  deleteVoucher,
  pushVoucherToTally,
} from '../store/slices/voucherSlice';
import {
  supportsTallyPush,
  canPushVoucherToTally,
  buildPushToTallyOptions,
} from '../utils/voucherCreateConfig';
import { MainStackScreenProps } from '../types/navigation';
import type { Voucher, VoucherEntry, TallyVoucherEntryMode } from '../types';
import { buildVoucherInvoiceHtml } from '../utils/voucherInvoiceHtml';
import { formatCurrencyAbs, formatDateTime } from '../utils/formatters';
import { useTranslation } from 'react-i18next';
import {
  rupeesToWords,
  formatDDMMYYYY,
  formatTableAmount,
  formatReference,
  voucherDisplayType,
  resolveVoucherDisplayMode,
  resolveVoucherDisplayAmount,
  entryModeLabel,
  tallyByToPrefix,
  sortAsVoucherEntries,
  filterLedgerEntriesForDisplay,
  entryDisplayAmount,
} from '../utils/voucherDocument';

type Props = MainStackScreenProps<'VoucherDetail'>;

const HEADER_BLUE = '#0D47A1';
const TABLE_HEADER_BG = '#ECEFF1';

const VoucherDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { voucherId } = route.params;
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { selectedVoucher, isLoading } = useSelector((state: RootState) => state.voucher);
  const selectedCompany = useSelector((state: RootState) => state.company.selectedCompany);
  const [pushingToTally, setPushingToTally] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const summary = await dispatch(fetchVoucherById(voucherId));
      if (cancelled) return;
      const v = summary.payload as Voucher | undefined;
      const needsDetail =
        v &&
        (v.isSummaryOnly ||
          (((v.items?.length ?? 0) === 0 && (v.entries?.length ?? 0) === 0) &&
            !v.detailCached));
      if (needsDetail) {
        const hydrated = await dispatch(hydrateVoucherFromTally(voucherId));
        if (!cancelled && hydrateVoucherFromTally.fulfilled.match(hydrated)) {
          await dispatch(fetchVoucherById(voucherId));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, voucherId]);

  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle('light-content');
      if (Platform.OS === 'android') {
        StatusBar.setBackgroundColor(HEADER_BLUE);
      }
      return () => {
        StatusBar.setBarStyle('dark-content');
        if (Platform.OS === 'android') {
          StatusBar.setBackgroundColor('#ffffff');
        }
      };
    }, [])
  );

  const buildDocumentHtml = (voucher: Voucher): string =>
    buildVoucherInvoiceHtml(voucher, {
      companyName: selectedCompany?.name,
      companyAddress: selectedCompany?.address,
      // The API has used both spellings across versions; the renderer picks the
      // first non-empty, so pass whichever this build happens to have.
      companyGst:
        selectedCompany?.gstNumber ||
        (selectedCompany as { gstin?: string } | null)?.gstin,
      companyPan:
        selectedCompany?.panNumber ||
        (selectedCompany as { pan?: string } | null)?.pan,
      companyState:
        (selectedCompany as { state?: string } | null)?.state ||
        (selectedCompany?.address as { state?: string } | undefined)?.state,
      companyPhone: selectedCompany?.phone,
      companyEmail: selectedCompany?.email,
    });

  const sanitizeFileName = (name: string): string =>
    name
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-\.]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 120);

  const writeHtmlAndShare = async (filePrefix: string) => {
    if (!selectedVoucher) return;
    const htmlContent = buildDocumentHtml(selectedVoucher);
    const safeVoucherNumber = sanitizeFileName(String(selectedVoucher.voucherNumber || 'voucher'));
    const safeType = sanitizeFileName(voucherDisplayType(selectedVoucher));
    const fileName = `${filePrefix}_${safeType}_${safeVoucherNumber}.html`;
    const filePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
    await RNFS.writeFile(filePath, htmlContent, 'utf8');
    const shareOptions = {
      title: `${voucherDisplayType(selectedVoucher)} — ${selectedVoucher.voucherNumber}`,
      message: `${voucherDisplayType(selectedVoucher)} ${selectedVoucher.voucherNumber}`,
      url: Platform.OS === 'android' ? `file://${filePath}` : filePath,
      type: 'text/html',
      filename: fileName,
    };
    await Share.open(shareOptions);
  };

  const handleShare = async () => {
    try {
      await writeHtmlAndShare('voucher');
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err?.message?.toLowerCase().includes('user did not share')) return;
      console.error('Share error:', error);
      Alert.alert(t('common.error'), t('vouchers.detail.shareFailed'));
    }
  };

  const handlePdfExport = async () => {
    if (!selectedVoucher) return;
    try {
      const htmlContent = buildDocumentHtml(selectedVoucher);
      const jobName = `${voucherDisplayType(selectedVoucher)}_${selectedVoucher.voucherNumber}`;
      await RNPrint.print({
        html: htmlContent,
        jobName: sanitizeFileName(jobName),
        isLandscape: false,
      });
    } catch (error) {
      console.error('PDF export error:', error);
      Alert.alert(
        t('vouchers.detail.saveAsPdf'),
        t('vouchers.detail.printDialogFailed'),
        [
          { text: t('vouchers.detail.shareHtml'), onPress: () => writeHtmlAndShare('voucher_pdf').catch(() => {}) },
          { text: t('common.ok') },
        ]
      );
    }
  };

  const handlePrint = async () => {
    if (!selectedVoucher) return;
    try {
      const htmlContent = buildDocumentHtml(selectedVoucher);
      await RNPrint.print({
        html: htmlContent,
        jobName: sanitizeFileName(`Print_${selectedVoucher.voucherNumber}`),
      });
    } catch (error) {
      console.error('Print error:', error);
      Alert.alert(t('common.error'), t('vouchers.detail.printFailed'));
    }
  };

  const handleWhatsApp = async () => {
    if (!selectedVoucher) return;
    const lines = [
      `${voucherDisplayType(selectedVoucher)} — Voucher No: ${selectedVoucher.voucherNumber}`,
      `Date: ${formatDDMMYYYY(selectedVoucher.date)}`,
      selectedVoucher.partyName ? `Party: ${selectedVoucher.partyName}` : '',
      `Amount: ${formatCurrencyAbs(resolveVoucherDisplayAmount(selectedVoucher))}`,
    ].filter(Boolean);
    const text = encodeURIComponent(lines.join('\n'));
    const url = `whatsapp://send?text=${text}`;
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert(t('vouchers.detail.whatsapp'), t('vouchers.detail.whatsappUnavailable'));
  };

  const handlePushToTally = () => {
    if (!selectedVoucher) return;
    const check = canPushVoucherToTally(selectedVoucher);
    if (!check.ok) {
      Alert.alert(t('vouchers.detail.cannotPush'), check.reason || t('vouchers.detail.cannotPushReason'));
      return;
    }

    Alert.alert(
      t('vouchers.detail.pushTitle'),
      t('vouchers.detail.pushMessage', {
        type: voucherDisplayType(selectedVoucher),
        number: selectedVoucher.voucherNumber,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('vouchers.detail.push'),
          onPress: async () => {
            setPushingToTally(true);
            try {
              await dispatch(
                pushVoucherToTally({
                  voucherId,
                  options: buildPushToTallyOptions(selectedVoucher, selectedCompany ?? undefined),
                })
              ).unwrap();
              Alert.alert(t('vouchers.detail.synced'), t('vouchers.detail.syncedMessage'));
            } catch (err: unknown) {
              Alert.alert(
                t('vouchers.detail.pushFailed'),
                typeof err === 'string' ? err : t('vouchers.detail.pushFailedHint')
              );
            } finally {
              setPushingToTally(false);
            }
          },
        },
      ]
    );
  };

  const onDelete = () => {
    Alert.alert(t('vouchers.detail.deleteTitle'), t('vouchers.detail.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          dispatch(deleteVoucher(voucherId))
            .unwrap()
            .then(() => navigation.goBack())
            .catch((err: unknown) =>
              Alert.alert(
                t('common.error'),
                typeof err === 'string' ? err : t('vouchers.delete.failed')
              )
            );
        },
      },
    ]);
  };

  const termsBody = useMemo(() => {
    if (!selectedVoucher?.terms) return '';
    const t = selectedVoucher.terms;
    return [t.paymentTerms, t.deliveryTerms, t.otherTerms].filter(Boolean).join('\n\n');
  }, [selectedVoucher]);

  if (isLoading || !selectedVoucher) {
    return <LoadingScreen message={t('vouchers.detail.loading')} />;
  }

  const v = selectedVoucher;
  const displayMode = resolveVoucherDisplayMode(v);
  const items = v.items || [];
  const isAsVoucher = displayMode === 'as_voucher';
  const isAccountingInvoice = displayMode === 'accounting_invoice';
  const isAccountingVoucherView = String(v.tallyPersistedView || '')
    .toLowerCase()
    .includes('accounting voucher view');
  const showItemsSection =
    !isAccountingVoucherView && (!isAccountingInvoice || items.length > 0);
  const displayAmount = resolveVoucherDisplayAmount(v);
  const ledgerRowsRaw = filterLedgerEntriesForDisplay(
    v.entries,
    v.partyName,
    isAsVoucher,
    v
  );
  const ledgerRows = isAsVoucher ? sortAsVoucherEntries(ledgerRowsRaw) : ledgerRowsRaw;
  const ledgerDebitTotal = v.entries.reduce((s, e) => s + (e.debitAmount || 0), 0);
  const ledgerCreditTotal = v.entries.reduce((s, e) => s + (e.creditAmount || 0), 0);
  const dueStr = v.dueDate ? formatDDMMYYYY(v.dueDate) : formatDDMMYYYY(v.date);
  const showPushToTally = supportsTallyPush(v.voucherType) && !v.tallyId;
  const pushCheck = canPushVoucherToTally(v);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.heroSafe}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Pressable onPress={() => navigation.goBack()} style={styles.iconHit} hitSlop={12}>
              <Icon name="arrow-left" size={24} color="#fff" />
            </Pressable>
            <View style={styles.heroTitles}>
              <Text style={styles.heroMainTitle}>{voucherDisplayType(v)}</Text>
              <Text style={styles.heroSubtitle}>
                Voucher No: {v.voucherNumber} · {entryModeLabel(displayMode, v.tallyPersistedView)}
              </Text>
            </View>
            <View style={styles.heroActions}>
              <Pressable onPress={() => Alert.alert(t('common.edit'), t('vouchers.detail.editUnavailable'))} style={styles.iconHit}>
                <Icon name="pencil" size={22} color="#fff" />
              </Pressable>
              <Pressable onPress={onDelete} style={styles.iconHit}>
                <Icon name="delete-outline" size={22} color="#fff" />
              </Pressable>
              <Pressable onPress={handleShare} style={styles.iconHit}>
                <Icon name="share-variant" size={22} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.heroDates}>
            <View style={styles.heroDateCol}>
              <Text style={styles.heroDateLabel}>{t('vouchers.detail.invoiceDate')}</Text>
              <Text style={styles.heroDateValue}>{formatDDMMYYYY(v.date)}</Text>
            </View>
            <View style={styles.heroDateCol}>
              <Text style={styles.heroDateLabel}>{t('vouchers.detail.dueDate')}</Text>
              <Text style={styles.heroDateValue}>{dueStr}</Text>
            </View>
          </View>

          <Text style={styles.partyLine}>
            Party Name: {v.partyName?.trim() ? v.partyName : '—'}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {showItemsSection ? (
          <Surface style={styles.card} elevation={1}>
            <Text style={styles.sectionLabel}>{t('vouchers.detail.items')}</Text>
            <View style={[styles.tableHead, { backgroundColor: TABLE_HEADER_BG }]}>
              <Text style={[styles.th, styles.colItem]}>{t('vouchers.detail.items')}</Text>
              <Text style={[styles.th, styles.colQty]}>{t('vouchers.detail.qty')}</Text>
              <Text style={[styles.th, styles.colRate]}>{t('vouchers.detail.rate')}</Text>
              <Text style={[styles.th, styles.colAmt]}>{t('vouchers.detail.amount')}</Text>
            </View>
            {items.length === 0 ? (
              <Text style={styles.emptyRow}>{t('vouchers.detail.noLineItems')}</Text>
            ) : (
              items.map((item) => (
                <View key={item.id} style={styles.itemBlock}>
                  <View style={styles.tableRow}>
                    <Text style={[styles.td, styles.colItem]} numberOfLines={3}>
                      {item.itemName}
                    </Text>
                    <Text style={[styles.td, styles.colQty]} numberOfLines={2}>
                      {formatTableAmount(item.quantity)} {item.unit || 'Nos'}
                    </Text>
                    <Text style={[styles.td, styles.colRate]} numberOfLines={2}>
                      {formatTableAmount(item.rate)}
                    </Text>
                    <Text style={[styles.td, styles.colAmt, styles.tdAmount]} numberOfLines={2}>
                      {formatTableAmount(item.amount)}
                    </Text>
                  </View>
                  {item.hsnCode ? (
                    <Text style={styles.hsnSub}>HSN/SAC: {item.hsnCode}</Text>
                  ) : null}
                  {item.gst &&
                  (item.gst.cgst || item.gst.sgst || item.gst.igst || item.gst.cess) ? (
                    <Text style={styles.gstSub}>
                      {[item.gst.cgst ? `CGST: ${item.gst.cgst}%` : '', item.gst.sgst ? `SGST: ${item.gst.sgst}%` : '', item.gst.igst ? `IGST: ${item.gst.igst}%` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </Surface>
        ) : null}

        <Surface style={styles.card} elevation={1}>
          <Text style={styles.sectionLabel}>
            {isAsVoucher ? 'PARTICULARS' : isAccountingInvoice ? 'PARTICULARS' : 'LEDGER'}
          </Text>
          {isAsVoucher ? (
            <>
              <View style={[styles.tableHead, styles.ledgerHead, { backgroundColor: TABLE_HEADER_BG }]}>
                <Text style={[styles.th, styles.asVoucherColParticulars]}>{t('vouchers.detail.particulars')}</Text>
                <Text style={[styles.th, styles.ledgerColDr]}>{t('vouchers.journal.debit')}</Text>
                <Text style={[styles.th, styles.ledgerColCr]}>{t('vouchers.journal.credit')}</Text>
              </View>
              {ledgerRows.length === 0 ? (
                <Text style={styles.emptyRow}>{t('vouchers.detail.noLedgerEntries')}</Text>
              ) : (
                ledgerRows.map((entry) => {
                  const prefix = tallyByToPrefix(entry);
                  const subLines = entry.subLines || [];
                  return (
                    <View key={entry.id} style={styles.asVoucherEntryBlock}>
                      <View style={[styles.ledgerRow, styles.asVoucherLedgerRow]}>
                        <View style={styles.asVoucherColParticulars}>
                          <Text style={styles.asVoucherMainLine} numberOfLines={2}>
                            <Text style={styles.asVoucherPrefix}>{prefix} </Text>
                            {entry.accountName}
                          </Text>
                          {subLines.map((sub, idx) => (
                            <Text key={`${entry.id}-sub-${idx}`} style={styles.asVoucherSubLine} numberOfLines={2}>
                              {sub.text}
                            </Text>
                          ))}
                          {entry.narration && !subLines.some((s) => s.isNarration) ? (
                            <Text style={styles.asVoucherSubLine} numberOfLines={2}>
                              {entry.narration}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={[styles.td, styles.ledgerColDr, styles.tdAmount]}>
                          {entry.debitAmount > 0 ? formatTableAmount(entry.debitAmount) : ''}
                        </Text>
                        <Text style={[styles.td, styles.ledgerColCr, styles.tdAmount]}>
                          {entry.creditAmount > 0 ? formatTableAmount(entry.creditAmount) : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
              {ledgerRows.length > 0 ? (
                <>
                  <View style={styles.asVoucherDoubleRule} />
                  <View style={styles.ledgerTotalsRow}>
                    <Text style={[styles.td, styles.asVoucherColParticulars, styles.ledgerTotalLabel]}>
                      {t('reports.total')}
                    </Text>
                    <Text style={[styles.td, styles.ledgerColDr, styles.tdAmount]}>
                      {formatTableAmount(ledgerDebitTotal)}
                    </Text>
                    <Text style={[styles.td, styles.ledgerColCr, styles.tdAmount]}>
                      {formatTableAmount(ledgerCreditTotal)}
                    </Text>
                  </View>
                  <View style={styles.asVoucherDoubleRule} />
                </>
              ) : null}
            </>
          ) : (
            <>
              <View style={[styles.tableHead, styles.ledgerHead, { backgroundColor: TABLE_HEADER_BG }]}>
                <Text style={[styles.th, styles.ledgerColName]}>
                  {isAccountingInvoice ? 'PARTICULARS' : 'LEDGER'}
                </Text>
                <Text style={[styles.th, styles.ledgerColAmt]}>{t('vouchers.detail.amount')}</Text>
              </View>
              {ledgerRows.length === 0 ? (
                <Text style={styles.emptyRow}>{t('vouchers.detail.noLedgerEntries')}</Text>
              ) : (
                ledgerRows.map((entry) => {
                  const amt = entryDisplayAmount(entry);
                  return (
                    <View key={entry.id} style={styles.ledgerRow}>
                      <Text style={[styles.td, styles.ledgerColName]} numberOfLines={2}>
                        {entry.accountName}
                      </Text>
                      <Text style={[styles.td, styles.ledgerColAmt, styles.tdAmount]}>
                        {formatTableAmount(amt)}
                      </Text>
                    </View>
                  );
                })
              )}
            </>
          )}
        </Surface>

        <Surface style={styles.card} elevation={1}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('vouchers.detail.totalAmount')}</Text>
            <Text style={[styles.totalValue, { color: theme.colors.primary }]}>
              {formatCurrencyAbs(displayAmount)}
            </Text>
          </View>
          <Text style={styles.wordsLabel}>{t('vouchers.detail.totalInWords')}</Text>
          <Text style={styles.wordsValue}>{rupeesToWords(displayAmount)}</Text>
        </Surface>

        <Surface style={styles.card} elevation={1}>
          <Text style={styles.sectionLabel}>{t('vouchers.detail.terms')}</Text>
          <Text style={styles.termsText}>{termsBody.trim() || '—'}</Text>
          <Text style={[styles.sectionLabel, styles.notesHeading]}>{t('vouchers.detail.notes')}</Text>
          <Text style={styles.notesText}>{v.narration?.trim() || '—'}</Text>
        </Surface>

        <Surface style={styles.card} elevation={1}>
          <Text style={styles.sectionLabel}>{t('vouchers.detail.tallySync')}</Text>
          {v.tallyId ? (
            <>
              <List.Item
                title={t('vouchers.detail.syncedToTally')}
                description={v.tallyId}
                titleNumberOfLines={1}
                descriptionNumberOfLines={3}
                left={(p) => <List.Icon {...p} icon="check-circle" color="#2E7D32" />}
              />
              {v.lastSyncedAt ? (
                <List.Item
                  title={t('vouchers.detail.lastSynced')}
                  description={formatDateTime(v.lastSyncedAt)}
                  left={(p) => <List.Icon {...p} icon="clock-check" />}
                />
              ) : null}
            </>
          ) : showPushToTally ? (
            <>
              <Text style={styles.tallyHint}>
                This voucher is saved in the cloud but not in Tally yet. Push when TallyPrime and the
                desktop agent are running.
              </Text>
              {v.tallySyncError ? (
                <Text style={styles.tallyError}>Last error: {v.tallySyncError}</Text>
              ) : null}
              {!pushCheck.ok ? (
                <Text style={styles.tallyWarn}>{pushCheck.reason}</Text>
              ) : null}
              <Button
                mode="contained"
                icon="cloud-upload"
                onPress={handlePushToTally}
                loading={pushingToTally}
                disabled={pushingToTally || !pushCheck.ok}
                style={styles.pushTallyBtn}
                buttonColor={HEADER_BLUE}
              >
                {t('vouchers.detail.pushTitle')}
              </Button>
            </>
          ) : (
            <Text style={styles.tallyHint}>
              {supportsTallyPush(v.voucherType)
                ? 'Not linked to Tally.'
                : 'This voucher type is not imported to Tally from the app.'}
            </Text>
          )}
        </Surface>

        <List.Accordion title={t('vouchers.detail.moreDetails')} style={styles.accordion}>
          <List.Item title={t('vouchers.detail.status')} description={v.status} left={(p) => <List.Icon {...p} icon="information" />} />
          <List.Item title={t('vouchers.detail.reference')} description={formatReference(v.reference)} left={(p) => <List.Icon {...p} icon="link" />} />
          <List.Item
            title={t('vouchers.detail.created')}
            description={formatDateTime(v.createdAt)}
            left={(p) => <List.Icon {...p} icon="calendar-plus" />}
          />
          <List.Item
            title={t('vouchers.detail.lastUpdated')}
            description={formatDateTime(v.updatedAt)}
            left={(p) => <List.Icon {...p} icon="calendar-edit" />}
          />
        </List.Accordion>

        <View style={styles.actionBar}>
          <Pressable style={styles.actionCell} onPress={handlePrint}>
            <Icon name="printer" size={22} color={theme.colors.primary} />
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>{t('vouchers.detail.print')}</Text>
          </Pressable>
          <Pressable style={styles.actionCell} onPress={handleShare}>
            <Icon name="share-variant" size={22} color={theme.colors.primary} />
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>{t('vouchers.detail.share')}</Text>
          </Pressable>
          <Pressable style={styles.actionCell} onPress={handlePdfExport}>
            <Icon name="file-pdf-box" size={22} color={theme.colors.primary} />
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>{t('vouchers.detail.pdf')}</Text>
          </Pressable>
          <Pressable style={styles.actionCell} onPress={handleWhatsApp}>
            <Icon name="whatsapp" size={22} color="#25D366" />
            <Text style={[styles.actionText, { color: '#25D366' }]}>{t('vouchers.detail.whatsapp')}</Text>
          </Pressable>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  heroSafe: {
    backgroundColor: HEADER_BLUE,
  },
  hero: {
    backgroundColor: HEADER_BLUE,
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  heroTitles: {
    flex: 1,
    marginHorizontal: 8,
  },
  heroMainTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    marginTop: 2,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconHit: {
    padding: 8,
  },
  heroDates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  heroDateCol: {
    flex: 1,
  },
  heroDateLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    marginBottom: 2,
  },
  heroDateValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  partyLine: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#78909C',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tableHead: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginBottom: 4,
  },
  ledgerHead: {
    marginBottom: 0,
  },
  th: {
    fontSize: 11,
    fontWeight: '700',
    color: '#546E7A',
  },
  colItem: { flex: 2.2, paddingRight: 4 },
  colQty: { flex: 1.1 },
  colRate: { flex: 1 },
  colAmt: { flex: 1.1, textAlign: 'right' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  td: {
    fontSize: 13,
    color: '#263238',
  },
  tdAmount: {
    fontWeight: '600',
    color: '#1565C0',
    textAlign: 'right',
  },
  itemBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
    paddingBottom: 6,
    marginBottom: 4,
  },
  hsnSub: {
    fontSize: 11,
    color: '#78909C',
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  gstSub: {
    fontSize: 11,
    color: '#78909C',
    paddingHorizontal: 4,
  },
  emptyRow: {
    padding: 12,
    color: '#90A4AE',
    fontSize: 14,
  },
  ledgerRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
    alignItems: 'center',
  },
  asVoucherLedgerRow: {
    alignItems: 'flex-start',
    borderBottomWidth: 0,
  },
  ledgerColName: { flex: 1.6, paddingRight: 8 },
  asVoucherColParticulars: { flex: 1.6, paddingRight: 8 },
  asVoucherEntryBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  asVoucherMainLine: {
    fontSize: 14,
    fontWeight: '600',
    color: '#263238',
    marginBottom: 2,
  },
  asVoucherPrefix: {
    fontWeight: '700',
    color: '#1565C0',
  },
  asVoucherSubLine: {
    fontSize: 12,
    color: '#607D8B',
    marginLeft: 4,
    marginTop: 2,
    lineHeight: 16,
  },
  asVoucherDoubleRule: {
    height: 3,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#90A4AE',
    marginVertical: 4,
  },
  ledgerColAmt: { flex: 1, textAlign: 'right' },
  ledgerColDr: { flex: 0.9, textAlign: 'right' },
  ledgerColCr: { flex: 0.9, textAlign: 'right' },
  ledgerTotalsRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: '#B0BEC5',
    marginTop: 4,
    backgroundColor: '#F5F5F5',
  },
  ledgerTotalLabel: {
    fontWeight: '700',
    color: '#37474F',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#37474F',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  wordsLabel: {
    fontSize: 13,
    color: '#78909C',
    marginBottom: 4,
  },
  wordsValue: {
    fontSize: 14,
    color: '#455A64',
    lineHeight: 20,
  },
  termsText: {
    fontSize: 14,
    color: '#455A64',
    lineHeight: 20,
    marginBottom: 8,
  },
  notesHeading: {
    marginTop: 4,
  },
  notesText: {
    fontSize: 14,
    color: '#455A64',
    lineHeight: 20,
  },
  accordion: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  actionBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  actionCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  bottomSpacing: {
    height: 16,
  },
  tallyHint: {
    fontSize: 13,
    color: '#546E7A',
    lineHeight: 20,
    marginBottom: 10,
  },
  tallyError: {
    fontSize: 13,
    color: '#C62828',
    marginBottom: 8,
  },
  tallyWarn: {
    fontSize: 13,
    color: '#E65100',
    marginBottom: 8,
  },
  pushTallyBtn: {
    marginTop: 4,
  },
});

export default VoucherDetailScreen;
