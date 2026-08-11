/**
 * ReportCard — glass card for a single report in a 2-column grid.
 * Icon, title, description, optional badge ("Most used" / "Soon") and a chevron.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { useTranslation } from 'react-i18next';

interface ReportCardProps {
  icon: string;
  color: string;
  title: string;
  description: string;
  badge?: string;
  soon?: boolean;
  onPress?: () => void;
}

const ReportCard: React.FC<ReportCardProps> = ({
  icon,
  color,
  title,
  description,
  badge,
  soon,
  onPress,
}) => {
  const { t } = useTranslation();
  return (
  <TouchableOpacity
    style={[styles.card, shadows.card]}
    activeOpacity={0.88}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${title}. ${description}`}
  >
    <View style={styles.topRow}>
      <View style={[styles.iconChip, { backgroundColor: hexToRgba(color, 0.14) }]}>
        <Icon name={icon} size={20} color={color} />
      </View>
      {soon ? (
        <View style={styles.soonBadge}>
          <Text style={styles.soonText}>{t('reports.soon')}</Text>
        </View>
      ) : null}
    </View>

    <Text style={styles.title} numberOfLines={1}>
      {title}
    </Text>
    <Text style={styles.description} numberOfLines={2}>
      {description}
    </Text>

    <View style={styles.footer}>
      {badge ? (
        <View style={styles.usedBadge}>
          <Icon name="star" size={11} color={colors.warning} />
          <Text style={styles.usedText}>{badge}</Text>
        </View>
      ) : (
        <View />
      )}
      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </View>
  </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 150,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soonBadge: {
    backgroundColor: colors.background,
    borderRadius: radius.sm - 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  soonText: { color: colors.textSecondary, fontSize: 10, fontWeight: fontWeight.bold },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    marginTop: spacing.sm,
  },
  description: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    marginTop: 3,
    lineHeight: 16,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  usedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: hexToRgba(colors.warning, 0.12),
    borderRadius: radius.sm - 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  usedText: { color: colors.warning, fontSize: 10, fontWeight: fontWeight.bold },
});

export default React.memo(ReportCard);
