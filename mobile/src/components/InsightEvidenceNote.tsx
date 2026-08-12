/**
 * Says what an insight is actually based on.
 *
 * Every number on the insight screens is computed from synced Tally data, but
 * they are not equally well supported: a delay prediction backed by forty settled
 * bills and one backed by nothing look identical once rendered as "12 days". This
 * banner carries that difference, so a figure resting on no evidence cannot be
 * mistaken for a confident one.
 *
 * Deliberately not hidden when evidence is strong — a quiet "based on 40 settled
 * bills" is what makes the cautious version credible when it appears.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Paragraph, useTheme } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

export type EvidenceBasis = 'party_history' | 'company_average' | 'no_history';

interface Props {
  /** 0-1, as returned in confidence_score / confidence. */
  confidence?: number | null;
  /** Which data the figure came from, when the endpoint reports it. */
  basis?: EvidenceBasis | string | null;
  /** Settled bills or sales lines behind it. */
  sampleSize?: number | null;
  /** Overrides the generated text entirely. */
  message?: string | null;
}

const InsightEvidenceNote: React.FC<Props> = ({ confidence, basis, sampleSize, message }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const weak =
    basis === 'no_history' ||
    (typeof confidence === 'number' && confidence < 0.4) ||
    (typeof sampleSize === 'number' && sampleSize > 0 && sampleSize < 3);

  let text = message ?? '';
  if (!text) {
    if (basis === 'no_history') {
      text = t('ml.evidence.noHistory');
    } else if (basis === 'company_average') {
      text = t('ml.evidence.companyAverage');
    } else if (typeof sampleSize === 'number' && sampleSize > 0) {
      text = t('ml.evidence.settledBills', { count: sampleSize });
    } else {
      return null;
    }
  }

  const tone = weak ? theme.colors.error : theme.colors.onSurfaceVariant;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.surfaceVariant, borderLeftColor: tone },
      ]}
    >
      <Icon
        name={weak ? 'alert-circle-outline' : 'information-outline'}
        size={16}
        color={tone}
        style={styles.icon}
      />
      <Paragraph style={[styles.text, { color: tone }]}>{text}</Paragraph>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 12,
  },
  icon: { marginRight: 8, marginTop: 2 },
  text: { flex: 1, fontSize: 12, lineHeight: 17 },
});

export default InsightEvidenceNote;
