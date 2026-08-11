/**
 * TransactionHeader — gradient header matching the dashboard, but titled for
 * the Transactions screen: logo + glass actions, big title, company dropdown,
 * and a tappable date-range row. Includes a faint financial illustration.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path, Rect, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BrandLogo from './BrandLogo';
import { colors, gradients } from '../theme/colors';
import { radius, spacing, hitSlop } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { useTranslation } from 'react-i18next';

interface TransactionHeaderProps {
  title: string;
  companyName: string;
  dateLabel: string;
  unreadCount?: number;
  onCompanyPress?: () => void;
  onDatePress?: () => void;
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

const FinanceArt: React.FC = () => (
  <Svg width={150} height={150} viewBox="0 0 150 150" style={styles.art}>
    <Defs>
      <SvgGrad id="txnArt" x1="0" y1="1" x2="1" y2="0">
        <Stop offset="0" stopColor="#2BE65A" stopOpacity={0.55} />
        <Stop offset="1" stopColor="#9FE7B4" stopOpacity={0.9} />
      </SvgGrad>
    </Defs>
    <Rect x="20" y="14" width="74" height="92" rx="10" fill="#ffffff" opacity={0.12} />
    <Path d="M34 40 H80 M34 54 H80 M34 68 H66" stroke="#ffffff" strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" />
    <Rect x="58" y="78" width="9" height="22" rx="2" fill="url(#txnArt)" />
    <Rect x="72" y="66" width="9" height="34" rx="2" fill="url(#txnArt)" />
    <Rect x="86" y="50" width="9" height="50" rx="2" fill="url(#txnArt)" />
    <Rect x="100" y="34" width="9" height="66" rx="2" fill="url(#txnArt)" />
    <Path d="M60 84 L78 70 L92 54 L120 26" fill="none" stroke="#34F06A" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M110 26 L122 26 L122 38" fill="none" stroke="#34F06A" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const TransactionHeader: React.FC<TransactionHeaderProps> = ({
  title,
  companyName,
  dateLabel,
  unreadCount = 0,
  onCompanyPress,
  onDatePress,
  onNotificationsPress,
  onProfilePress,
  onSettingsPress,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={gradients.header}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.wrapper, { paddingTop: insets.top + spacing.sm }]}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <FinanceArt />

      <View style={styles.topRow}>
        <View style={styles.logoRow}>
          <BrandLogo size={38} />
          <View>
            <Text style={styles.logoWord}>{t('common.appName')}</Text>
            <Text style={styles.tagline}>{t('common.tagline')}</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <GlassButton
            icon="bell-outline"
            label={t('notifications.title')}
            onPress={onNotificationsPress}
            badge={unreadCount}
          />
          <GlassButton icon="account-outline" label={t('profile.title')} onPress={onProfilePress} />
          <GlassButton icon="cog-outline" label={t('settings.title')} onPress={onSettingsPress} />
        </View>
      </View>

      <Text style={styles.title}>{title}</Text>

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

      <TouchableOpacity
        style={styles.dateRow}
        onPress={onDatePress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Date range ${dateLabel}, change range`}
      >
        <Icon name="calendar-blank-outline" size={15} color={colors.textOnDarkMuted} />
        <Text style={styles.dateText} numberOfLines={1}>
          {dateLabel}
        </Text>
        <Icon name="swap-horizontal" size={16} color="#9FE7B4" />
      </TouchableOpacity>
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
  art: { position: 'absolute', right: 4, top: 64 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
  logoMarkText: { color: colors.textOnDark, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
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

export default React.memo(TransactionHeader);
