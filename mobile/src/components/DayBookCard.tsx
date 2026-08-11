/**
 * DayBookCard — premium blue gradient shortcut card to the Day Book, sitting
 * just under the header (overlaps it slightly via the screen's negative margin).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { useTranslation } from 'react-i18next';

const DAY_BOOK_GRADIENT: [string, string] = ['#1D4ED8', '#0B2F86'];

interface DayBookCardProps {
  onPress?: () => void;
}

const DayBookCard: React.FC<DayBookCardProps> = ({ onPress }) => {
  const { t } = useTranslation();
  return (
  <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={shadows.cardStrong}>
    <LinearGradient
      colors={DAY_BOOK_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.iconWrap}>
        <Icon name="book-open-page-variant" size={28} color={colors.white} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('reports.item.dayBook.title')}</Text>
        <Text style={styles.subtitle}>{t('reports.item.dayBook.chronological')}</Text>
      </View>
      <View style={styles.arrow}>
        <Icon name="chevron-right" size={22} color={colors.white} />
      </View>
    </LinearGradient>
  </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: spacing.md,
    minHeight: 96,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  text: { flex: 1 },
  title: { color: colors.white, fontSize: fontSize.title, fontWeight: fontWeight.bold },
  subtitle: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: fontSize.label,
    marginTop: 4,
    lineHeight: 18,
  },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(DayBookCard);
