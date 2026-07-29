import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSelector } from 'react-redux';
import { useNetwork, useOffline, useSync } from '../../store/hooks';
import { RootState } from '../../store';
import { formatRelativeTime } from '../../utils/formatters';

/**
 * Shown when the phone cannot reach the API — app uses last synced data from cache.
 */
const OfflineBanner: React.FC = () => {
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

  const lastLabel = lastSyncTime ? formatRelativeTime(lastSyncTime) : 'unknown';

  let sub = `Showing last synced data (last update ${lastLabel}).`;
  if (manualOffline) {
    sub = 'Offline mode is turned on in Settings. Turn it off to load live data from the server.';
  } else if (deviceOnline && !isOnline) {
    sub =
      'Phone is online but the app cannot reach your backend. Check API_BASE_URL in mobile/.env — use your PC IP (e.g. http://192.168.1.x:5000/api) or run: adb reverse tcp:5000 tcp:5000';
  } else if (!deviceOnline) {
    sub = 'No network connection. Showing cached data until you are back online.';
  }

  return (
    <View style={styles.wrap}>
      <Icon name="cloud-off-outline" size={18} color="#92400e" />
      <View style={styles.textBlock}>
        <Text style={styles.title}>Offline mode</Text>
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
