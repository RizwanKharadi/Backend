import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSelector } from 'react-redux';
import { useNetwork, useOffline, useSync } from '../../store/hooks';
import { RootState } from '../../store';
import { formatRelativeTime } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';

/**
 * Shown when the phone cannot reach the API — app uses last synced data from cache.
 */
const OfflineBanner: React.FC = () => {
  const { t } = useTranslation();
  const network = useNetwork();
  const offline = useOffline();
  const manualOffline = useSelector((s: RootState) => s.settings.offlineMode);
  const { lastSyncTime, isOnline } = useSync();

  const deviceOnline =
    network.isConnected &&
    (network.isInternetReachable === null || network.isInternetReachable === true);

  const showBanner =
    manualOffline || !deviceOnline || offline.isOfflineMode || !isOnline;

  if (!showBanner) {
    return null;
  }

  const lastLabel = lastSyncTime
    ? formatRelativeTime(lastSyncTime)
    : t('offline.unknown');

  let sub = t('offline.cached', { lastSync: lastLabel });
  if (manualOffline) {
    sub = t('offline.manual');
  } else if (deviceOnline && !isOnline) {
    sub = t('offline.backendUnreachable');
  } else if (!deviceOnline) {
    sub = t('offline.noNetwork');
  }

  return (
    <View style={styles.wrap}>
      <Icon name="cloud-off-outline" size={18} color="#92400e" />
      <View style={styles.textBlock}>
        <Text style={styles.title}>{t('offline.title')}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef3c7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#fcd34d',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  textBlock: { flex: 1 },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
  },
  sub: {
    fontSize: 12,
    color: '#a16207',
    lineHeight: 17,
    marginTop: 2,
  },
});

export default OfflineBanner;
