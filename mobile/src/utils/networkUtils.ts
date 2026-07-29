import {
  setupConnectivityListener,
  refreshConnectivity,
  refreshConnectivityAndBackend,
} from './connectivity';

/**
 * Setup network listener — updates Redux network / offline / sync online flags.
 */
export const setupNetworkListener = (): void => {
  const unsubscribe = setupConnectivityListener();
  (global as any).networkUnsubscribe = unsubscribe;
  void refreshConnectivityAndBackend();
};

export { refreshConnectivity as getNetworkState };

export const isOnline = async (): Promise<boolean> => {
  const { refreshConnectivity: refresh } = await import('./connectivity');
  return refresh();
};

export const cleanupNetworkListener = (): void => {
  const unsubscribe = (global as any).networkUnsubscribe;
  if (unsubscribe) {
    unsubscribe();
    delete (global as any).networkUnsubscribe;
  }
};
