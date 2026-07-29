import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardColors } from './dashboardTheme';

export type MetricCardVariant = 'hero' | 'compact' | 'wide';

interface DashboardMetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: string;
  accentColor: string;
  onPress?: () => void;
  loading?: boolean;
  variant?: MetricCardVariant;
  badge?: string;
  badgeTone?: 'warning' | 'error' | 'info';
}

const DashboardMetricCard: React.FC<DashboardMetricCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  accentColor,
  onPress,
  loading,
  variant = 'compact',
  badge,
  badgeTone = 'warning',
}) => {
  const isHero = variant === 'hero';
  const isWide = variant === 'wide';

  const badgeColors = {
    warning: { bg: '#fef3c7', text: '#b45309' },
    error: { bg: '#fee2e2', text: '#b91c1c' },
    info: { bg: '#dbeafe', text: '#1d4ed8' },
  };
  const badgeStyle = badgeColors[badgeTone];

  const content = (
    <>
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: `${accentColor}20` }]}>
          <Icon name={icon} size={isHero ? 28 : 22} color={accentColor} />
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: badgeStyle.bg }]}>
            <Text style={[styles.badgeText, { color: badgeStyle.text }]}>{badge}</Text>
          </View>
        ) : onPress ? (
          <Icon name="chevron-right" size={20} color={dashboardColors.muted} />
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator
          size="small"
          color={accentColor}
          style={isHero ? styles.heroLoader : styles.compactLoader}
        />
      ) : (
        <>
          <Text style={[styles.title, isHero && styles.titleHero]} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[styles.value, isHero && styles.valueHero, isWide && styles.valueWide]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {value}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, isHero && styles.subtitleHero]} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </>
      )}
    </>
  );

  const cardStyle = [
    styles.card,
    isHero && styles.cardHero,
    isWide && styles.cardWide,
    isHero
      ? { borderTopColor: accentColor }
      : { borderLeftColor: accentColor },
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={onPress}
        activeOpacity={0.82}
        disabled={loading}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{content}</View>;
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
    flex: 1,
    minWidth: 0,
  },
  cardHero: {
    padding: 20,
    marginBottom: 4,
    borderLeftWidth: 0,
    borderTopWidth: 4,
    borderTopColor: dashboardColors.accent,
  },
  cardWide: {
    minHeight: 108,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  titleHero: {
    fontSize: 13,
    marginBottom: 6,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  valueHero: {
    fontSize: 34,
    marginTop: 2,
  },
  valueWide: {
    fontSize: 18,
    lineHeight: 24,
  },
  subtitle: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 4,
    lineHeight: 16,
  },
  subtitleHero: {
    fontSize: 13,
    marginTop: 6,
  },
  heroLoader: {
    marginVertical: 20,
    alignSelf: 'flex-start',
  },
  compactLoader: {
    marginVertical: 12,
    alignSelf: 'flex-start',
  },
});

export default DashboardMetricCard;
