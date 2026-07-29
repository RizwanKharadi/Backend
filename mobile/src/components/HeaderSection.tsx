/**
 * HeaderSection — gradient hero header for the TallyFin dashboard.
 * Navy -> green linear gradient, 40px bottom radius, faint logo watermark,
 * greeting + company + sync/subscription badges and circular glass actions.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BrandLogo from './BrandLogo';
import { colors, gradients } from '../theme/colors';
import { radius, spacing, hitSlop } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { HeaderData } from '../types/dashboard';

interface HeaderSectionProps {
  data: HeaderData;
  onCompanyPress?: () => void;
  onNotificationsPress?: () => void;
  onProfilePress?: () => void;
  onSettingsPress?: () => void;
  onSubscriptionPress?: () => void;
}

interface GlassButtonProps {
  icon: string;
  label: string;
  onPress?: () => void;
  badgeCount?: number;
}

const GlassButton: React.FC<GlassButtonProps> = ({
  icon,
  label,
  onPress,
  badgeCount,
}) => (
  <TouchableOpacity
    style={styles.glassBtn}
    onPress={onPress}
    activeOpacity={0.75}
    hitSlop={hitSlop}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Icon name={icon} size={20} color={colors.textOnDark} />
    {badgeCount && badgeCount > 0 ? (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
      </View>
    ) : null}
  </TouchableOpacity>
);

const HeaderSection: React.FC<HeaderSectionProps> = ({
  data,
  onCompanyPress,
  onNotificationsPress,
  onProfilePress,
  onSettingsPress,
  onSubscriptionPress,
}) => {
  const insets = useSafeAreaInsets();
  const subscriptionActive = data.subscription.type === 'active';

  return (
    <LinearGradient
      colors={gradients.header}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.wrapper, { paddingTop: insets.top + spacing.sm }]}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />

      {/* Faint logo watermark */}
      <Icon
        name="finance"
        size={220}
        color={colors.white}
        style={styles.watermark}
      />

      <View style={styles.topRow}>
        <View style={styles.logoRow}>
          <BrandLogo size={38} />
          <View>
            <Text style={styles.logoWord}>TallyFin</Text>
            <Text style={styles.tagline}>Har Hisaab Aasan Hai</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <GlassButton
            icon="bell-outline"
            label="Notifications"
            onPress={onNotificationsPress}
            badgeCount={data.unreadNotifications}
          />
          <GlassButton
            icon="account-outline"
            label="Profile"
            onPress={onProfilePress}
          />
          <GlassButton
            icon="cog-outline"
            label="Settings"
            onPress={onSettingsPress}
          />
        </View>
      </View>

      <Text style={styles.greeting}>
        {data.greeting}, {data.userName} 👋
      </Text>

      <TouchableOpacity
        style={styles.companyRow}
        onPress={onCompanyPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Company ${data.companyName}, change company`}
      >
        <Text style={styles.companyName} numberOfLines={1}>
          {data.companyName}
        </Text>
        <Icon name="chevron-down" size={20} color={colors.textOnDarkMuted} />
      </TouchableOpacity>

      <View style={styles.badgeRow}>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.dot,
              { backgroundColor: data.sync.online ? colors.greenBright : colors.warning },
            ]}
          />
          <Text style={styles.statusPillText}>{data.sync.label}</Text>
        </View>

        <TouchableOpacity
          style={[
            styles.statusPill,
            subscriptionActive ? styles.subActivePill : styles.subTrialPill,
          ]}
          onPress={onSubscriptionPress}
          activeOpacity={0.8}
        >
          <Icon
            name={subscriptionActive ? 'check-decagram' : 'clock-outline'}
            size={13}
            color={subscriptionActive ? colors.greenBright : colors.warning}
          />
          <Text
            style={[
              styles.statusPillText,
              { color: subscriptionActive ? colors.greenBright : '#FFD479' },
            ]}
          >
            {data.subscription.label}
          </Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl + spacing.xl, // room for hero cards to overlap
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    right: -40,
    top: 10,
    opacity: 0.06,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMarkText: {
    color: colors.textOnDark,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
  logoWord: {
    color: colors.textOnDark,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    lineHeight: 20,
  },
  tagline: {
    color: '#9FE7B4',
    fontSize: 9,
    letterSpacing: 0.6,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  glassBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.warning,
    borderWidth: 1,
    borderColor: colors.navySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.navyDeep,
    fontSize: 9,
    fontWeight: fontWeight.bold,
  },
  greeting: {
    color: '#CFE0F5',
    fontSize: fontSize.body,
    marginTop: spacing.lg,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xxs,
  },
  companyName: {
    color: colors.textOnDark,
    fontSize: fontSize.h3,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.2,
    maxWidth: '88%',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  subTrialPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  subActivePill: {
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
    borderColor: 'rgba(34, 197, 94, 0.45)',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusPillText: {
    color: '#EAF1FB',
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
});

export default React.memo(HeaderSection);
