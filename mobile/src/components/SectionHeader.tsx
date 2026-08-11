/**
 * SectionHeader — accent icon chip + title, with an optional "View all" action.
 * Used for Money In / Money Out / Books & Entries.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { useTranslation } from 'react-i18next';

interface SectionHeaderProps {
  title: string;
  icon: string;
  accentColor: string;
  onViewAll?: () => void;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  icon,
  accentColor,
  onViewAll,
}) => {
  const { t } = useTranslation();
  return (
  <View style={styles.row}>
    <View style={styles.left}>
      <View style={[styles.chip, { backgroundColor: hexToRgba(accentColor, 0.14) }]}>
        <Icon name={icon} size={16} color={accentColor} />
      </View>
      <Text style={styles.title}>{title}</Text>
    </View>
    {onViewAll ? (
      <TouchableOpacity onPress={onViewAll} activeOpacity={0.7} accessibilityRole="button">
        <Text style={[styles.viewAll, { color: accentColor }]}>{t('common.viewAll')}<Text style={styles.chev}>›</Text>
        </Text>
      </TouchableOpacity>
    ) : null}
  </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  chip: {
    width: 28,
    height: 28,
    borderRadius: radius.sm - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.textPrimary, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  viewAll: { fontSize: fontSize.label, fontWeight: fontWeight.medium },
  chev: { fontSize: fontSize.bodyLg },
});

export default React.memo(SectionHeader);
