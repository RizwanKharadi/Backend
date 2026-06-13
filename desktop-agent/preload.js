const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Configuration API
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  serverLogin: (credentials) => ipcRenderer.invoke('server-login', credentials),
  serverRegister: (payload) => ipcRenderer.invoke('server-register', payload),
  serverForgotPassword: (email) => ipcRenderer.invoke('server-forgot-password', email),
  serverResetPassword: (payload) => ipcRenderer.invoke('server-reset-password', payload),
  serverLogout: () => ipcRenderer.invoke('server-logout'),
  validateSession: () => ipcRenderer.invoke('server-validate-session'),
  backendGetCompanies: () => ipcRenderer.invoke('backend-get-companies'),
  hydrateLinkedCompanies: () => ipcRenderer.invoke('hydrate-linked-companies'),
  linkTallyCompany: (tallyCompany) => ipcRenderer.invoke('link-tally-company', tallyCompany),
  unlinkTallyCompany: (entry) => ipcRenderer.invoke('unlink-tally-company', entry),
  billingGetStatus: () => ipcRenderer.invoke('billing-get-status'),
  billingSubscribe: (payload) => ipcRenderer.invoke('billing-subscribe', payload),
  billingSync: () => ipcRenderer.invoke('billing-sync'),
  billingReconnect: () => ipcRenderer.invoke('billing-reconnect'),
  billingOpenUrl: (url) => ipcRenderer.invoke('billing-open-url', url),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // Tally Service API
  tallyTestConnection: () => ipcRenderer.invoke('tally-test-connection'),
  tallyGetLicenseInfo: () => ipcRenderer.invoke('tally-get-license-info'),
  tallyCheckSerial: (serialNumber) => ipcRenderer.invoke('tally-check-serial', serialNumber),
  tallyGetCompanies: () => ipcRenderer.invoke('tally-get-companies'),
  getConnectionState: () => ipcRenderer.invoke('get-connection-state'),
  
  // Sync API
  syncSetCompanyPreferences: (payload) =>
    ipcRenderer.invoke('sync-set-company-preferences', payload),
  syncGetCompaniesPreview: () => ipcRenderer.invoke('sync-get-companies-preview'),
  syncGetOpenCompaniesPreview: () => ipcRenderer.invoke('sync-get-open-companies-preview'),
  syncStart: (options) => ipcRenderer.invoke('sync-start', options || {}),
  syncStop: () => ipcRenderer.invoke('sync-stop'),
  syncStatus: () => ipcRenderer.invoke('sync-status'),
  syncResetState: () => ipcRenderer.invoke('sync-reset-state'),
  syncClearOfflineQueue: () => ipcRenderer.invoke('sync-clear-offline-queue'),
  getLogPaths: () => ipcRenderer.invoke('get-log-paths'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  
  // System API
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  
  // Window API
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  
  // Event listeners
  onShowSettings: (callback) => {
    ipcRenderer.on('show-settings', callback);
    return () => ipcRenderer.removeListener('show-settings', callback);
  },
  
  onShowNotification: (callback) => {
    ipcRenderer.on('show-notification', (event, data) => callback(data));
    return () => ipcRenderer.removeListener('show-notification', callback);
  },
  
  onSyncStatusUpdate: (callback) => {
    ipcRenderer.on('sync-status-update', (event, data) => callback(data));
    return () => ipcRenderer.removeListener('sync-status-update', callback);
  },
  
  onTallyConnectionUpdate: (callback) => {
    ipcRenderer.on('tally-connection-update', (event, data) => callback(data));
    return () => ipcRenderer.removeListener('tally-connection-update', callback);
  },
  
  onWebSocketUpdate: (callback) => {
    ipcRenderer.on('websocket-update', (event, data) => callback(data));
    return () => ipcRenderer.removeListener('websocket-update', callback);
  },
  
  // Remove all listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('show-settings');
    ipcRenderer.removeAllListeners('show-notification');
    ipcRenderer.removeAllListeners('sync-status-update');
    ipcRenderer.removeAllListeners('tally-connection-update');
    ipcRenderer.removeAllListeners('websocket-update');
  }
});

// Expose version info
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  app: () => require('./package.json').version
});

// Expose platform info
contextBridge.exposeInMainWorld('platform', {
  os: () => process.platform,
  arch: () => process.arch,
  isWindows: () => process.platform === 'win32',
  isMac: () => process.platform === 'darwin',
  isLinux: () => process.platform === 'linux'
});
