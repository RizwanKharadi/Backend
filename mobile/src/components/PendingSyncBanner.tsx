/**
 * Surfaces records saved in the cloud but not yet in Tally.
 *
 * Registers deliberately exclude those records so app totals reconcile with
 * Tally. That fixes the numbers but would leave a created voucher invisible —
 * so this banner sits on the lists where the user would otherwise notice
 * something missing, and routes to the full list.
 *
 * Renders nothing when everything is in Tally, which is the normal case.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { PendingSyncSummary } from '../services/tallyService';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';

interface Props {
  summary: PendingSyncSummary | null;
  onPress: () => void;
}

function describe(summary: PendingSyncSummary): string {
  const parts: string[] = [];
  if (summary.vouchers) {
    parts.push(`${summary.vouchers} voucher${summary.vouchers > 1 ? 's' : ''}`);
  }
  if (summary.parties) {
    parts.push(`${summary.parties} ledger${summary.parties > 1 ? 's' : ''}`);
  }
  if (summary.items) {
    parts.push(`${summary.items} item${summary.items > 1 ? 's' : ''}`);
  }
  if (!parts.length) return 'Some records are';
  if (parts.length === 1) return `${parts[0]} is`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} are`;
}

const PendingSyncBanner: React.FC<Props> = ({ summary, onPress }) => {
  if (!summary || summary.total <= 0) return null;

  // Anything past its retry budget needs a person to look at it; everything
  // else will resolve on its own once the agent reconnects.
  const stuck = summary.needsAttention > 0;

  return (
    <TouchableOpacity
      style={[styles.wrap, stuck ? styles.wrapStuck : styles.wrapWaiting]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.iconWrap, stuck ? styles.iconStuck : styles.iconWaiting]}>
        <Icon
          name={stuck ? 'alert-circle-outline' : 'cloud-clock-outline'}
          size={20}
          color={stuck ? colors.danger : colors.warning}
        />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>
          {stuck ? 'Not in Tally — needs attention' : 'Waiting to reach Tally'}
        </Text>
        <Text style={styles.detail}>
          {describe(summary)} not in Tally yet, so {summary.total > 1 ? 'they are' : 'it is'} not
          counted in your totals.
        </Text>
      </View>
      <Icon name="chevron-right" size={22} color={colors.textTertiary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  wrapWaiting: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  wrapStuck: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  iconWaiting: { backgroundColor: '#FEF3C7' },
  iconStuck: { backgroundColor: '#FEE2E2' },
  body: { flex: 1 },
  title: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold as '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  detail: { fontSize: fontSize.label, color: colors.textSecondary, lineHeight: 16 },
});

export default PendingSyncBanner;
