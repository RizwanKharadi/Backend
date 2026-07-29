import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import { store } from '../store';
import { setNetworkState } from '../store/slices/networkSlice';
import { setOfflineMode } from '../store/slices/offlineSlice';
import { setOnlineStatus } from '../store/slices/syncSlice';
import { API_BASE_URL } from '../services/apiClient';

export function isDeviceOnlineFromState(): boolean {
  const n = store.getState().network;
  if (n.isConnected === false) return false;
  if (n.isInternetReachable === false) return false;
  return n.isConnected === true;
}

function applyConnectivity(
  isConnected: boolean,
  isInternetReachable: boolean | null,
  type: string
): void {
  const online =
    isConnected && (isInternetReachable === null || isInternetReachable === true);

  store.dispatch(
    setNetworkState({
      isConnected,
      isInternetReachable: isInternetReachable ?? isConnected,
      type: type || 'unknown',
    })
  );
  const manualOffline = store.getState().settings?.offlineMode;
  if (!manualOffline) {
    store.dispatch(setOfflineMode(!online));
    store.dispatch(setOnlineStatus(online));
  }
}

/** Ping backend /health — does not require auth */
export async function probeBackendReachability(): Promise<boolean> {
  const root = API_BASE_URL.replace(/\/api\/?$/i, '');
  try {
    const res = await axios.get(`${root}/health`, { timeout: 8000 });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export async function refreshConnectivityAndBackend(): Promise<boolean> {
  const deviceOnline = await refreshConnectivity();
  if (!deviceOnline) {
    return false;
  }
  const apiOk = await probeBackendReachability();
  const manualOffline = store.getState().settings?.offlineMode;
  if (!manualOffline) {
    store.dispatch(setOfflineMode(!apiOk));
    store.dispatch(setOnlineStatus(apiOk));
  }
  return apiOk;
}

export async function refreshConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  const connected = Boolean(state.isConnected);
  const reachable = state.isInternetReachable;
  applyConnectivity(connected, reachable, state.type || 'unknown');
  return connected && (reachable === null || reachable === true);
}

export function setupConnectivityListener(): () => void {
  void refreshConnectivity();

  return NetInfo.addEventListener((state) => {
    applyConnectivity(
      Boolean(state.isConnected),
      state.isInternetReachable,
      state.type || 'unknown'
    );
  });
}
