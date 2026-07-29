import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
} from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGreeting, formatRelativeTime } from '../../utils/formatters';
import { dashboardColors } from './dashboardTheme';
import GuideTarget from '../guide/GuideTarget';

interface DashboardHeaderProps {
  userName?: string;
  companyName?: string;
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  trialLabel?: string | null;
  unreadNotifications?: number;
  onCompanyPress?: () => void;
  onSettingsPress?: () => void;
  onProfilePress?: () => void;
  onNotificationsPress?: () => void;
  onSyncPress?: () => void;
  onTrialPress?: () => void;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  userName,
  companyName,
  isOnline,
  isSyncing,
  lastSyncTime,
  trialLabel,
  unreadNotifications = 0,
  onCompanyPress,
  onSettingsPress,
  onProfilePress,
  onNotificationsPress,
  onSyncPress,
  onTrialPress,
}) => {
  const insets = useSafeAreaInsets();

  const syncColor = !isOnline
    ? dashboardColors.negative
    : isSyncing
      ? dashboardColors.warning
      : dashboardColors.positive;

  const syncLabel = isSyncing
    ? 'Syncing…'
    : !isOnline
      ? 'Offline'
      : `Synced ${formatRelativeTime(lastSyncTime)}`;

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top + 8 }]}>
      <StatusBar barStyle="light-content" backgroundColor={dashboardColors.headerTop} />

      <View style={styles.topRow}>
        <View style={styles.greetingBlock}>
          <Text style={styles.greeting}>{getGreeting(userName)}</Text>
          <GuideTarget targetId="company-picker" style={styles.companyRow}>
            <TouchableOpacity
              style={styles.companyRowInner}
              onPress={onCompanyPress}
              activeOpacity={0.7}
              disabled={!onCompanyPress}
            >
              <Text style={styles.companyName} numberOfLines={1}>
                {companyName || 'Select company'}
              </Text>
              {onCompanyPress ? (
                <Icon name="chevron-down" size={18} color={dashboardColors.headerTextMuted} />
              ) : null}
            </TouchableOpacity>
          </GuideTarget>
        </View>

        <View style={styles.iconRow}>
          <GuideTarget targetId="sync-button" style={styles.guideIconTarget}>
            <TouchableOpacity onPress={onSyncPress} style={styles.iconBtn}>
              <Icon
                name={isSyncing ? 'sync' : isOnline ? 'cloud-check' : 'cloud-off-outline'}
                size={22}
                color={dashboardColors.headerText}
              />
            </TouchableOpacity>
          </GuideTarget>
          {onNotificationsPress ? (
            <TouchableOpacity onPress={onNotificationsPress} style={styles.iconBtn}>
              <Icon name="bell-outline" size={22} color={dashboardColors.headerText} />
              {unreadNotifications > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ) : null}
          {onProfilePress ? (
            <TouchableOpacity onPress={onProfilePress} style={styles.iconBtn}>
              <Icon name="account-circle-outline" size={22} color={dashboardColors.headerText} />
            </TouchableOpacity>
          ) : null}
          {onSettingsPress ? (
            <GuideTarget targetId="settings-button" style={styles.guideIconTarget}>
              <TouchableOpacity onPress={onSettingsPress} style={styles.iconBtn}>
                <Icon name="cog-outline" size={22} color={dashboardColors.headerText} />
              </TouchableOpacity>
            </GuideTarget>
          ) : null}
        </View>
      </View>

      <View style={styles.pillRow}>
        <View style={[styles.pill, { borderColor: syncColor }]}>
          <View style={[styles.dot, { backgroundColor: syncColor }]} />
          <Text style={styles.pillText}>{syncLabel}</Text>
        </View>
        {trialLabel ? (
          <TouchableOpacity
            style={[styles.pill, styles.trialPill]}
            onPress={onTrialPress}
            activeOpacity={0.7}
          >
            <Icon name="clock-outline" size={14} color={dashboardColors.warning} />
            <Text style={[styles.pillText, styles.trialText]}>{trialLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: dashboardColors.headerTop,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greetingBlock: {
    flex: 1,
    marginRight: 12,
  },
  greeting: {
    color: dashboardColors.headerTextMuted,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  companyRow: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  guideIconTarget: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  companyName: {
    color: dashboardColors.headerText,
    fontSize: 20,
    fontWeight: '700',
    maxWidth: '92%',
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    padding: 6,
    marginLeft: 2,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: dashboardColors.negative,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.4)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  trialPill: {
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    color: dashboardColors.headerText,
    fontSize: 12,
    fontWeight: '600',
  },
  trialText: {
    color: dashboardColors.warning,
  },
});

export default DashboardHeader;
