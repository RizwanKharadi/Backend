/**
 * InventoryHeader — gradient header for the Inventory command center.
 * Logo + glass actions, big title, company dropdown, an "as of" date row, and
 * a faint warehouse illustration.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path, Rect, G } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BrandLogo from './BrandLogo';
import { colors, gradients } from '../theme/colors';
import { radius, spacing, hitSlop } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';

interface InventoryHeaderProps {
  companyName: string;
  dateLabel: string;
  unreadCount?: number;
  onCompanyPress?: () => void;
  onNotificationsPress?: () => void;
  onProfilePress?: () => void;
  onSettingsPress?: () => void;
}

const GlassButton: React.FC<{
  icon: string;
  label: string;
  onPress?: () => void;
  badge?: number;
}> = ({ icon, label, onPress, badge }) => (
  <TouchableOpacity
    style={styles.glassBtn}
    onPress={onPress}
    activeOpacity={0.75}
    hitSlop={hitSlop}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Icon name={icon} size={20} color={colors.textOnDark} />
    {badge && badge > 0 ? (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
      </View>
    ) : null}
  </TouchableOpacity>
);

const WarehouseArt: React.FC = () => (
  <Svg width={170} height={150} viewBox="0 0 170 150" style={styles.art}>
    <G opacity={0.9}>
      <Path d="M30 96 L92 64 L154 96 L154 138 L30 138 Z" fill="#ffffff" opacity={0.1} />
      <Path d="M30 96 L92 64 L154 96 L92 128 Z" fill="#2BE65A" opacity={0.22} />
      <Rect x="74" y="104" width="36" height="34" rx="2" fill="#ffffff" opacity={0.18} />
      <Path d="M92 104 L92 138 M74 110 L110 110" stroke="#ffffff" strokeOpacity={0.4} strokeWidth={2} />
      <Rect x="44" y="38" width="20" height="20" rx="3" fill="#9FE7B4" opacity={0.5} />
      <Rect x="118" y="46" width="18" height="18" rx="3" fill="#2BE65A" opacity={0.45} />
      <Rect x="138" y="30" width="14" height="14" rx="3" fill="#9FE7B4" opacity={0.4} />
    </G>
  </Svg>
);

const InventoryHeader: React.FC<InventoryHeaderProps> = ({
  companyName,
  dateLabel,
  unreadCount = 0,
  onCompanyPress,
  onNotificationsPress,
  onProfilePress,
  onSettingsPress,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={gradients.header}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.wrapper, { paddingTop: insets.top + spacing.sm }]}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <WarehouseArt />

      <View style={styles.topRow}>
        <View style={styles.logoRow}>
          <BrandLogo size={38} />
          <View>
            <Text style={styles.logoWord}>TallyFin</Text>
            <Text style={styles.tagline}>Track · Analyze · Grow</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <GlassButton icon="bell-outline" label="Notifications" onPress={onNotificationsPress} badge={unreadCount} />
          <GlassButton icon="account-outline" label="Profile" onPress={onProfilePress} />
          <GlassButton icon="cog-outline" label="Settings" onPress={onSettingsPress} />
        </View>
      </View>

      <Text style={styles.title}>Inventory</Text>

      <TouchableOpacity
        style={styles.companyRow}
        onPress={onCompanyPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Company ${companyName}, change company`}
      >
        <Text style={styles.companyName} numberOfLines={1}>
          {companyName}
        </Text>
        <Icon name="chevron-down" size={20} color={colors.textOnDarkMuted} />
      </TouchableOpacity>

      <View style={styles.dateRow}>
        <Icon name="calendar-blank-outline" size={15} color={colors.textOnDarkMuted} />
        <Text style={styles.dateText} numberOfLines={1}>
          {dateLabel}
        </Text>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl + spacing.xl,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
    overflow: 'hidden',
  },
  art: { position: 'absolute', right: 2, top: 60 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  logoWord: { color: colors.textOnDark, fontSize: fontSize.title, fontWeight: fontWeight.bold, lineHeight: 20 },
  tagline: { color: '#9FE7B4', fontSize: 9, letterSpacing: 0.6, marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: spacing.xs },
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
  badgeText: { color: colors.navyDeep, fontSize: 9, fontWeight: fontWeight.bold },
  title: {
    color: colors.textOnDark,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
    marginTop: spacing.lg,
  },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginTop: spacing.xxs },
  companyName: {
    color: colors.textOnDark,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    maxWidth: '82%',
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  dateText: { color: colors.textOnDarkMuted, fontSize: fontSize.label, fontWeight: fontWeight.medium },
});

export default React.memo(InventoryHeader);
