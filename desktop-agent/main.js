const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const electronLog = require('electron-log');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const http = require('http');
const axios = require('axios');
const isDev = !app.isPackaged;
const { configureAgentLogging, getAgentLogPaths } = require('./src/utils/agentLogger');

// Import services
const TallyService = require('./src/services/TallyService');
const WebSocketClient = require('./src/services/WebSocketClient');
const SyncManager = require('./src/services/SyncManager');
const ConfigManager = require('./src/services/ConfigManager');
const SystemMonitor = require('./src/services/SystemMonitor');
const UpdateManager = require('./src/services/UpdateManager');

// Configure logging — files live in %USERPROFILE%\.finsync360-agent\logs\
configureAgentLogging();

// Initialize store
const store = new Store();

const AUTO_START_APP_NAME = 'TallyFin Desktop Agent';
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
}

class DesktopAgent {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.isQuitting = false;
    this.hasShownTrayBalloon = false;
    this.connectionRetryTimer = null;
    /** Shared promise so concurrent 401s do not each burn the refresh token. */
    this.refreshInFlight = null;
    
    // Initialize services
    this.tallyService = new TallyService();
    this.webSocketClient = new WebSocketClient();
    // One refresh path for the whole app. WebSocketClient used to post its own
    // refresh straight from the config store, so it and refreshStoredSession
    // raced with the same single-use token — which the server reads as a replay
    // and answers by killing the session.
    this.webSocketClient.sharedRefreshSession = () => this.refreshStoredSession();
    this.syncManager = new SyncManager();
    this.configManager = new ConfigManager();
    this.systemMonitor = new SystemMonitor();
    this.updateManager = new UpdateManager();
    
    this.setupApp();
  }

  getFriendlyFallbackPage(message) {
    const safeMessage = String(message || 'The app is starting in safe mode. Some features may be temporarily unavailable.')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `data:text/html;charset=UTF-8,${encodeURIComponent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>TallyFin Agent</title>
          <style>
            body {
              margin: 0;
              font-family: "Segoe UI", Arial, sans-serif;
              background: #f5f7fb;
              color: #1f2937;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
            }
            .card {
              max-width: 560px;
              padding: 24px;
              background: #ffffff;
              border-radius: 12px;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
            }
            h1 { margin: 0 0 10px; font-size: 22px; }
            p { margin: 0 0 10px; line-height: 1.5; }
            .muted { color: #6b7280; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>TallyFin  Agent is running</h1>
            <p>${safeMessage}</p>
            <p class="muted">You can keep working. The app will continue trying to reconnect automatically in the background.</p>
          </div>
        </body>
      </html>
    `)}`;
  }

  checkUrlLooksLikeRenderer(url) {
    return new Promise((resolve) => {
      const viteClientUrl = `${url.replace(/\/$/, '')}/@vite/client`;
      const req = http.get(viteClientUrl, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) {
            req.destroy();
            resolve(this.looksLikeViteClient(res.statusCode, body));
          }
        });
        res.on('end', () => resolve(this.looksLikeViteClient(res.statusCode, body)));
      });

      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });

      req.on('error', () => resolve(false));
    });
  }

  looksLikeViteClient(statusCode, content) {
    if (statusCode !== 200) return false;
    if (!content) return false;
    return content.includes('__vite__') || content.includes('/@react-refresh') || content.includes('import.meta.hot');
  }

  async resolveDevStartUrl() {
    const envUrl = process.env.ELECTRON_RENDERER_URL;
    const candidates = [];
    if (envUrl) {
      candidates.push(envUrl);
    }

    for (let port = 3001; port <= 3010; port += 1) {
      candidates.push(`http://localhost:${port}`);
    }

    for (const candidateUrl of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const isRenderer = await this.checkUrlLooksLikeRenderer(candidateUrl);
      if (isRenderer) {
        electronLog.info('Using renderer URL:', candidateUrl);
        return candidateUrl;
      }
    }

    return envUrl || 'http://localhost:3001';
  }

  setupApp() {
    // Set app user model ID for Windows
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.finsync360.desktop-agent');
    }

    // App event handlers
    app.whenReady().then(() => this.onReady());
    app.on('window-all-closed', () => this.onWindowAllClosed());
    app.on('activate', () => this.onActivate());
    app.on('before-quit', () => this.onBeforeQuit());
    app.on('second-instance', () => {
      if (this.mainWindow) {
        this.showMainWindow();
      } else {
        this.createMainWindow().catch((error) => {
          electronLog.error('Failed to restore window on second instance:', error);
        });
      }
    });

    // Auto updater events
    this.setupAutoUpdater();
    
    // IPC handlers
    this.setupIpcHandlers();
    this.setupServiceEventBridges();
  }

  async onReady() {
    try {
      electronLog.info('TallyFin Desktop Agent starting...');
      
      // Create main window
      await this.createMainWindow();
      
      // Create system tray
      this.createTray();
      
      // Initialize services
      await this.initializeServices();
      this.sendConnectionStatusUpdates();
      this.startConnectionRetryLoop();

      const agentPrefs = this.configManager.getConfig()?.agent || {};
      if (agentPrefs.startMinimized && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.hideToTray({ showBalloon: false });
      }

      electronLog.info('TallyFin Desktop Agent started successfully');
    } catch (error) {
      electronLog.error('Failed to start Desktop Agent:', error);
      this.showErrorDialog(
        'TallyFin Agent',
        'The app started with limited functionality. Please restart once and contact support if this continues.'
      );
    }
  }

  async createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      icon: path.join(__dirname, 'assets/icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js')
      },
      show: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
    });

    const ensureWindowVisible = () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
      if (isDev && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.openDevTools();
      }
    };

    // Register visibility handlers before loading URL to avoid race conditions.
    this.mainWindow.once('ready-to-show', ensureWindowVisible);
    this.mainWindow.webContents.once('did-finish-load', ensureWindowVisible);
    setTimeout(ensureWindowVisible, 3000);

    // Load the app
    const startUrl = isDev
      ? await this.resolveDevStartUrl()
      : `file://${path.join(__dirname, 'renderer/dist/index.html')}`;

    try {
      await this.mainWindow.loadURL(startUrl);
    } catch (error) {
      electronLog.error('Failed to load start URL, using fallback page:', error);
      await this.mainWindow.loadURL(
        this.getFriendlyFallbackPage(
          'We could not open the main screen right now. Background services will continue and the app will recover automatically when available.'
        )
      );
    }

    // Handle window events — title-bar X and − go to tray when enabled (sync keeps running)
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting && this.shouldMinimizeToTray()) {
        event.preventDefault();
        this.hideToTray();
      }
    });

    this.mainWindow.on('minimize', (event) => {
      if (!this.isQuitting && this.mainWindow && this.shouldMinimizeToTray()) {
        event.preventDefault();
        this.hideToTray();
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // Handle external links
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    this.mainWindow.webContents.on('render-process-gone', (event, details) => {
      electronLog.error('Renderer process gone:', details);
      this.showErrorDialog(
        'TallyFin Agent',
        'The screen was restarted after an internal issue. Your background sync continues to run.'
      );
    });
  }

  createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    this.tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show TallyFin Agent',
        click: () => this.showMainWindow()
      },
      { type: 'separator' },
      {
        label: 'Sync Status',
        submenu: [
          { label: 'Last Sync: Never', enabled: false },
          { label: 'Status: Disconnected', enabled: false },
          { type: 'separator' },
          { label: 'Force Sync', click: () => this.forceSync() }
        ]
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => this.showSettings()
      },
      {
        label: 'Check for Updates',
        click: () => this.updateManager.checkForUpdates(true)
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.quit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip('TallyFin Desktop Agent');
    
    this.tray.on('double-click', () => {
      this.showMainWindow();
    });
  }

  async initializeServices() {
    try {
      // Initialize configuration
      await this.configManager.initialize();
      this.applyAutoStartPreference();
      const appConfig = this.configManager.getConfig();
      if (isDev) {
        const inferredApiKey = this.readBackendDesktopAgentApiKey();
        if (inferredApiKey && inferredApiKey !== appConfig.server?.apiKey) {
          this.configManager.setConfig('server.apiKey', inferredApiKey);
          appConfig.server.apiKey = inferredApiKey;
          electronLog.info('Synchronized desktop agent API key from backend .env for local development');
        }
      }
      await this.tallyService.saveConfig(appConfig.tally || {});
      const wsRuntimeConfig = Object.fromEntries(
        Object.entries({
          serverUrl: appConfig.server?.url,
          apiKey: appConfig.server?.apiKey,
          token: appConfig.server?.token,
          companyId: appConfig.server?.companyId
        }).filter(([, value]) => value !== undefined)
      );
      this.syncManager.updateConfig(appConfig.sync || {});
      this.syncManager.updateConfig({
        selectedCompanies: appConfig.tally?.selectedCompanies || [],
        linkedCompanies: appConfig.server?.linkedCompanies || []
      });
      
      // Initialize Tally service
      try {
        await this.tallyService.initialize();
      } catch (error) {
        electronLog.warn('Tally service unavailable during startup, continuing in disconnected mode:', error.message);
      }
      
      // Initialize WebSocket client (connect only if already logged in)
      try {
        await this.webSocketClient.initialize(wsRuntimeConfig);
      } catch (error) {
        electronLog.warn('WebSocket service unavailable during startup, continuing in offline mode:', error.message);
      }
      
      // Initialize sync manager
      await this.syncManager.initialize();
      this.syncManager.setServices(this.tallyService, this.webSocketClient, null);
      
      // Start system monitoring
      this.systemMonitor.start();
      
      electronLog.info('All services initialized successfully');
    } catch (error) {
      electronLog.error('Failed to initialize services:', error);
      throw error;
    }
  }

  formatSubscriptionBlockMessage(access) {
    if (!access || access.allowed) {
      return null;
    }
    if (access.status === 'trial_expired') {
      return 'Error: Trial expired, purchase subscription to continue';
    }
    return access.reason || 'Subscription is not active. Purchase a subscription to continue.';
  }

  async fetchBillingStatus() {
    const config = this.configManager.getConfig();
    const apiUrl = this.resolveApiUrl(config);
    const token = config.server?.token;
    if (!apiUrl || !token) {
      return null;
    }
    const res = await axios.get(`${apiUrl}/billing/status`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000
    });
    const data = res.data?.data || null;
    if (data?.access) {
      data.displayMessage = this.formatSubscriptionBlockMessage(data.access);
    }
    return data;
  }

  /**
   * After Razorpay payment, refresh license in DB and reconnect WebSocket (clears stale device token).
   */
  async reconnectAfterBillingUpdate() {
    const access = await this.fetchSubscriptionAccess();
    if (!access.allowed) {
      return {
        connected: false,
        reason: access.displayMessage || access.reason || 'Subscription is not active yet'
      };
    }

    const config = this.configManager.getConfig();
    await this.resetDeviceLicenseForReconnect();

    try {
      await this.webSocketClient.disconnect();
    } catch (disconnectError) {
      electronLog.warn('WebSocket disconnect before reconnect:', disconnectError.message);
    }

    try {
      await this.webSocketClient.ensureConnected();
    } catch (connectError) {
      electronLog.warn('Reconnect after billing failed:', connectError.message);
      return {
        connected: false,
        reason: connectError.message || 'Could not connect to server'
      };
    }

    this.sendConnectionStatusUpdates();
    return { connected: this.webSocketClient.isConnected };
  }

  async fetchSubscriptionAccess() {
    try {
      const data = await this.fetchBillingStatus();
      if (!data) {
        return { allowed: false, status: 'logged_out', reason: 'Not logged in' };
      }
      const access = data.access || { allowed: false, reason: 'Unknown subscription status' };
      return {
        ...access,
        subscription: data.subscription || null,
        seatsUsed: data.seatsUsed,
        displayMessage: data.displayMessage || this.formatSubscriptionBlockMessage(access)
      };
    } catch (error) {
      const message = error?.response?.data?.message || error.message || 'Failed to load subscription';
      return { allowed: false, status: 'error', reason: message, displayMessage: message };
    }
  }

  startConnectionRetryLoop() {
    if (this.connectionRetryTimer) {
      clearInterval(this.connectionRetryTimer);
    }
    this.connectionRetryTimer = setInterval(async () => {
      if (this.isQuitting) {
        return;
      }
      const config = this.configManager.getConfig();
      if (!config.server?.token || this.webSocketClient.isConnected) {
        return;
      }
      await this.refreshStoredSession();
      const access = await this.fetchSubscriptionAccess();
      if (!access.allowed) {
        this.webSocketClient.lastConnectionError = access.displayMessage || access.reason;
        this.sendConnectionStatusUpdates();
        return;
      }
      const lastErr = String(this.webSocketClient.lastConnectionError || '');
      if (/401|license|subscription|trial|device|unauthorized/i.test(lastErr)) {
        await this.resetDeviceLicenseForReconnect();
      }
      await this.webSocketClient.ensureConnected();
      this.sendConnectionStatusUpdates();
    }, 30000);
  }

  async resetDeviceLicenseForReconnect() {
    const cfg = this.configManager.getConfig();
    const newConfig = {
      ...cfg,
      server: { ...cfg.server, deviceToken: '' }
    };
    this.configManager.setConfig(newConfig);
    await this.applyServerRuntimeConfig(newConfig);
    electronLog.info('Cleared stale device token — will re-activate on next WebSocket connect');
  }

  clearStoredSession(config) {
    return {
      ...config,
      server: {
        ...config.server,
        token: '',
        refreshToken: '',
        deviceToken: '',
        userEmail: '',
        companyId: '',
        linkedCompanies: []
      },
      tally: {
        ...config.tally,
        selectedCompanies: []
      }
    };
  }

  /**
   * Silently renew JWT using refresh token (customers should not need to re-login every 7 days).
   */
  async refreshStoredSession() {
    // Refresh tokens are single-use and rotate on every call, so two refreshes
    // racing would present the same token twice — which the server treats as a
    // replay and answers by killing the session. Several 401 handlers can fire
    // at once here, so they all share one in-flight attempt.
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefreshStoredSession().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  async doRefreshStoredSession() {
    const config = this.configManager.getConfig();
    const apiUrl = this.resolveApiUrl(config);
    const refreshToken = String(config.server?.refreshToken || '').trim();

    if (!apiUrl || !refreshToken) {
      return { success: false, reason: 'no_refresh_token' };
    }

    try {
      const response = await axios.post(
        `${apiUrl}/auth/refresh`,
        { refreshToken },
        { timeout: 15000 }
      );

      const token = response?.data?.data?.token;
      const newRefreshToken = response?.data?.data?.refreshToken;
      const userEmail = response?.data?.data?.user?.email || config.server?.userEmail || '';

      if (!token) {
        return { success: false, reason: 'no_token_in_response' };
      }

      const newConfig = {
        ...config,
        server: {
          ...config.server,
          token,
          refreshToken: newRefreshToken || refreshToken,
          userEmail
        }
      };

      this.configManager.setConfig(newConfig);
      await this.applyServerRuntimeConfig(newConfig);
      electronLog.info('Session renewed automatically via refresh token');
      return { success: true, userEmail };
    } catch (error) {
      const message = error?.response?.data?.message || error.message;
      electronLog.warn('Automatic session refresh failed', { message });
      return { success: false, reason: message || 'refresh_failed' };
    }
  }

  /**
   * Identifies this installation to the session store. agent.id already exists,
   * is stable across restarts and is preserved through a config reset, so a
   * reinstall does not read as a different device and lock the user out.
   */
  describeThisDevice(config = null) {
    const cfg = config || this.configManager.getConfig();
    return {
      deviceId: cfg.agent?.id || require('os').hostname(),
      deviceName: cfg.agent?.name || require('os').hostname(),
      platform: 'desktop',
      appVersion: app.getVersion()
    };
  }

  resolveApiUrl(config = null) {
    const cfg = config || this.configManager.getConfig();
    let apiUrl = cfg.server?.apiUrl;
    if (!apiUrl && cfg.server?.url) {
      try {
        const parsed = new URL(cfg.server.url);
        const protocol = parsed.protocol === 'wss:' ? 'https:' : parsed.protocol === 'ws:' ? 'http:' : parsed.protocol;
        apiUrl = `${protocol}//${parsed.host}/api`;
      } catch (error) {
        apiUrl = null;
      }
    }
    return apiUrl ? apiUrl.replace(/\/+$/, '') : null;
  }

  async hydrateLinkedCompaniesFromBackend() {
    const config = this.configManager.getConfig();
    const token = config.server?.token;
    if (!token) {
      return { success: false, message: 'Not logged in' };
    }

    const apiUrl = this.resolveApiUrl(config);
    if (!apiUrl) {
      return { success: false, message: 'API URL not configured' };
    }

    try {
      const res = await axios.get(`${apiUrl}/companies`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000
      });
      const companies = res.data?.data?.companies;
      if (!Array.isArray(companies) || companies.length === 0) {
        return { success: false, linkedCompanies: [], message: 'No companies on your account' };
      }

      const existing = Array.isArray(config.server?.linkedCompanies)
        ? config.server.linkedCompanies
        : [];

      const linkedCompanies = companies.map((company) => {
        const cloudCompanyId = String(company._id || company.id || '');
        const tallyPath = company.tallyIntegration?.companyPath
          ? String(company.tallyIntegration.companyPath).trim()
          : '';
        const prior = existing.find((e) => e.cloudCompanyId === cloudCompanyId);
        const tallyName = company.displayName || company.name || prior?.tallyName || 'Company';
        return {
          tallyGuid: tallyPath || prior?.tallyGuid || tallyName,
          tallyName,
          cloudCompanyId,
          linkedAt: prior?.linkedAt || company.updatedAt || company.createdAt || new Date().toISOString()
        };
      }).filter((entry) => entry.cloudCompanyId);

      const companyId = config.server?.companyId || linkedCompanies[0]?.cloudCompanyId || '';
      const selectedKeys = linkedCompanies
        .map((entry) => entry.tallyGuid)
        .filter(Boolean);

      const newConfig = {
        ...config,
        server: {
          ...config.server,
          companyId,
          linkedCompanies
        },
        tally: {
          ...config.tally,
          selectedCompanies: selectedKeys.length > 0 ? selectedKeys : config.tally?.selectedCompanies
        }
      };

      this.configManager.setConfig(newConfig);
      await this.applyServerRuntimeConfig(newConfig);

      electronLog.info(`Hydrated ${linkedCompanies.length} linked companies from backend`);
      return { success: true, linkedCompanies, companyId };
    } catch (error) {
      const message = error?.response?.data?.message || error.message || 'Failed to load companies';
      electronLog.warn('hydrateLinkedCompaniesFromBackend failed:', message);
      return { success: false, message };
    }
  }

  applyServerRuntimeConfig(newConfig) {
    this.tallyService.saveConfig(newConfig.tally || {});
    const wsPatch = {
      serverUrl: newConfig.server?.url,
      apiKey: newConfig.server?.apiKey,
      token: newConfig.server?.token,
      companyId: newConfig.server?.companyId
    };
    if (newConfig.server && 'deviceToken' in newConfig.server) {
      wsPatch.deviceToken = newConfig.server.deviceToken || '';
    }
    this.webSocketClient.updateConfig(
      Object.fromEntries(
        Object.entries(wsPatch).filter(([, value]) => value !== undefined)
      )
    );
    this.syncManager.updateConfig(newConfig.sync || {});
    this.syncManager.updateConfig({
      selectedCompanies: newConfig.tally?.selectedCompanies || [],
      linkedCompanies: newConfig.server?.linkedCompanies || []
    });
    if (newConfig.server?.token || newConfig.server?.apiKey) {
      this.webSocketClient.ensureConnected().catch((err) => {
        electronLog.warn('WebSocket ensureConnected after config update failed:', err.message);
      });
    }
    this.sendConnectionStatusUpdates();
  }

  readBackendDesktopAgentApiKey() {
    try {
      const backendEnvPath = path.join(__dirname, '..', 'backend', '.env');
      if (!fs.existsSync(backendEnvPath)) {
        return null;
      }

      const envContent = fs.readFileSync(backendEnvPath, 'utf8');
      const keyLine = envContent.split(/\r?\n/).find((line) => line.startsWith('DESKTOP_AGENT_API_KEY=') || line.startsWith('AGENT_API_KEY='));
      if (!keyLine) {
        return null;
      }

      const apiKey = keyLine.split('=').slice(1).join('=').trim();
      return apiKey || null;
    } catch (error) {
      electronLog.warn('Unable to read backend desktop agent API key for development:', error.message);
      return null;
    }
  }

  shouldMinimizeToTray() {
    const agentPrefs = this.configManager?.getConfig()?.agent || {};
    return agentPrefs.minimizeToTray !== false;
  }

  applyAutoStartPreference() {
    const autoStart = this.configManager?.getConfig()?.agent?.autoStart !== false;
    if (!app.isPackaged) {
      return;
    }

    try {
      app.setLoginItemSettings({
        openAtLogin: autoStart,
        path: process.execPath,
        name: AUTO_START_APP_NAME,
        args: []
      });
      electronLog.info(`Windows startup ${autoStart ? 'enabled' : 'disabled'}`);
    } catch (error) {
      electronLog.warn('Could not update startup preference:', error.message);
    }
  }

  setupAutoUpdater() {
    if (!app.isPackaged) {
      electronLog.info('Auto-updater disabled in development mode');
      return;
    }

    autoUpdater.logger = electronLog;

    autoUpdater.on('checking-for-update', () => {
      electronLog.info('Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      electronLog.info('Update available:', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      electronLog.info('Update not available:', info);
    });

    autoUpdater.on('error', (err) => {
      electronLog.error('Error in auto-updater:', err);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      let logMessage = `Download speed: ${progressObj.bytesPerSecond}`;
      logMessage += ` - Downloaded ${progressObj.percent}%`;
      logMessage += ` (${progressObj.transferred}/${progressObj.total})`;
      electronLog.info(logMessage);
    });

    autoUpdater.on('update-downloaded', (info) => {
      electronLog.info('Update downloaded:', info);
      autoUpdater.quitAndInstall();
    });
  }

  setupIpcHandlers() {
    // Configuration handlers
    ipcMain.handle('get-config', () => this.configManager.getConfig());
    ipcMain.handle('set-config', async (event, config) => {
      this.configManager.setConfig(config);
      const mergedConfig = this.configManager.getConfig();
      await this.applyServerRuntimeConfig(mergedConfig);
      this.applyAutoStartPreference();
      return true;
    });

      ipcMain.handle('server-login', async (event, credentials) => {
        const config = this.configManager.getConfig();
        const apiUrl = this.resolveApiUrl(config);

        if (!apiUrl) {
          throw new Error('Backend API URL is not configured. Please set the Server API URL in settings.');
        }

        try {
          // The backend permits one signed-in device per account. agent.id is
          // already stable across restarts and survives a config reset, so it
          // is the natural device identity here.
          const response = await axios.post(`${apiUrl}/auth/login`, {
            email: credentials.email,
            password: credentials.password,
            device: this.describeThisDevice(config),
            forceLogin: Boolean(credentials.forceLogin)
          }, {
            timeout: 15000
          });

          const token = response?.data?.data?.token;
          const refreshToken = response?.data?.data?.refreshToken || '';
          const userEmail = response?.data?.data?.user?.email || credentials.email;

          if (!token) {
            throw new Error('Login succeeded but token was not returned by the server.');
          }

          const newConfig = {
            ...config,
            server: {
              ...config.server,
              token,
              refreshToken,
              userEmail,
              deviceToken: ''
            }
          };

          this.configManager.setConfig(newConfig);
          await this.applyServerRuntimeConfig(newConfig);

          await this.webSocketClient.ensureConnected();
          await this.hydrateLinkedCompaniesFromBackend();

          return { success: true, token, userEmail };
        } catch (error) {
          if (error?.code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(error?.message || '')) {
            throw new Error(
              `Cannot reach backend at ${apiUrl}. Check that the server is online and the API URL is correct in Settings.`
            );
          }
          // Another device holds the session. Hand it back as data so the UI
          // can offer to sign that device out, instead of a dead-end error.
          if (error?.response?.status === 409 &&
              error?.response?.data?.code === 'SESSION_ACTIVE_ELSEWHERE') {
            return {
              success: false,
              sessionActiveElsewhere: true,
              activeDevice: error.response.data.activeDevice || null,
              message: error.response.data.message || 'This account is signed in on another device.'
            };
          }
          // Correct password but unverified address. Hand this back as data
          // rather than an error so the UI can open the OTP step.
          if (error?.response?.status === 403 && error?.response?.data?.requiresVerification) {
            return {
              success: false,
              requiresVerification: true,
              email: error.response.data.email || credentials.email,
              message: error.response.data.message || 'Please verify your email.'
            };
          }
          const message = error?.response?.data?.message || error.message || 'Login failed';
          throw new Error(message);
        }
      });

      ipcMain.handle('server-register', async (event, payload) => {
        const config = this.configManager.getConfig();
        const apiUrl = this.resolveApiUrl(config);

        if (!apiUrl) {
          throw new Error('Backend API URL is not configured.');
        }

        try {
          const response = await axios.post(`${apiUrl}/auth/register`, {
            name: payload.name,
            email: payload.email,
            phone: payload.phone,
            password: payload.password,
            companyName: payload.companyName || '',
            companyDetails: payload.companyDetails || {},
            tallyLicense: payload.tallyLicense || undefined
          }, {
            timeout: 15000
          });

          // Registration deliberately returns no session now: the account is
          // unusable until the emailed code is confirmed, so the renderer moves
          // to the OTP step and the config is written by server-verify-otp.
          if (response?.data?.requiresVerification) {
            return {
              success: true,
              requiresVerification: true,
              email: response.data.email || payload.email,
              message: response.data.message || 'Enter the code we emailed you.'
            };
          }

          const token = response?.data?.data?.token;
          const refreshToken = response?.data?.data?.refreshToken || '';
          const userEmail = response?.data?.data?.user?.email || payload.email;

          if (!token) {
            throw new Error('Registration succeeded but token was not returned.');
          }

          const newConfig = {
            ...config,
            server: {
              ...config.server,
              token,
              refreshToken,
              userEmail,
              deviceToken: '',
              companyId: '',
              linkedCompanies: []
            }
          };

          this.configManager.setConfig(newConfig);
          await this.applyServerRuntimeConfig(newConfig);

          await this.webSocketClient.ensureConnected();

          return { success: true, token, userEmail };
        } catch (error) {
          const message = error?.response?.data?.message || error.message || 'Registration failed';
          throw new Error(message);
        }
      });

      ipcMain.handle('server-forgot-password', async (event, email) => {
        const config = this.configManager.getConfig();
        const apiUrl = this.resolveApiUrl(config);

        if (!apiUrl) {
          throw new Error('Backend API URL is not configured.');
        }

        try {
          const response = await axios.post(`${apiUrl}/auth/forgot-password`, {
            email
          }, { timeout: 15000 });

          return {
            success: true,
            message: response?.data?.message,
            resetToken: response?.data?.resetToken || ''
          };
        } catch (error) {
          const message = error?.response?.data?.message || error.message || 'Could not request password reset';
          throw new Error(message);
        }
      });

      ipcMain.handle('server-reset-password', async (event, { resetTicket, password }) => {
        const config = this.configManager.getConfig();
        const apiUrl = this.resolveApiUrl(config);

        if (!apiUrl) {
          throw new Error('Backend API URL is not configured.');
        }

        try {
          // The old PUT /reset-password/:token form relied on the server
          // handing the token back to the caller, which was an account-takeover
          // hole. The ticket comes from verifying an emailed OTP instead.
          const response = await axios.post(`${apiUrl}/auth/reset-password`, {
            resetTicket,
            password,
            device: this.describeThisDevice(config)
          }, { timeout: 15000 });

          return {
            success: response?.data?.success !== false,
            message: response?.data?.message || 'Password updated'
          };
        } catch (error) {
          const message = error?.response?.data?.message || error.message || 'Could not reset password';
          throw new Error(message);
        }
      });

ipcMain.handle('server-verify-otp', async (event, { email, otp, purpose }) => {
        const config = this.configManager.getConfig();
        const apiUrl = this.resolveApiUrl(config);

        if (!apiUrl) {
          throw new Error('Backend API URL is not configured.');
        }

        try {
          const response = await axios.post(`${apiUrl}/auth/verify-otp`, {
            email,
            otp,
            purpose,
            device: this.describeThisDevice(config)
          }, { timeout: 15000 });

          const data = response?.data?.data || {};

          // Verifying a signup returns a session — store it exactly as login
          // does, so the agent is connected the moment the code is accepted.
          if (purpose === 'email_verification' && data.token) {
            const newConfig = {
              ...config,
              server: {
                ...config.server,
                token: data.token,
                refreshToken: data.refreshToken || '',
                userEmail: data.user?.email || email,
                deviceToken: '',
                companyId: '',
                linkedCompanies: []
              }
            };

            this.configManager.setConfig(newConfig);
            await this.applyServerRuntimeConfig(newConfig);
            await this.webSocketClient.ensureConnected();

            return { success: true, token: data.token, userEmail: data.user?.email || email };
          }

          return { success: true, resetTicket: data.resetTicket };
        } catch (error) {
          const message = error?.response?.data?.message || error.message || 'Could not verify that code';
          throw new Error(message);
        }
      });

      ipcMain.handle('server-resend-otp', async (event, { email, purpose }) => {
        const config = this.configManager.getConfig();
        const apiUrl = this.resolveApiUrl(config);

        if (!apiUrl) {
          throw new Error('Backend API URL is not configured.');
        }

        try {
          const response = await axios.post(`${apiUrl}/auth/resend-otp`, {
            email,
            purpose
          }, { timeout: 15000 });

          return {
            success: response?.data?.success !== false,
            message: response?.data?.message || 'Code sent'
          };
        } catch (error) {
          const message = error?.response?.data?.message || error.message || 'Could not send a new code';
          throw new Error(message);
        }
      });

      ipcMain.handle('unlink-tally-company', async (event, entry) => {
        const config = this.configManager.getConfig();
        const token = config.server?.token;
        const apiUrl = this.resolveApiUrl(config);

        if (!token || !apiUrl) {
          throw new Error('Log in first to manage companies.');
        }

        const cloudCompanyId = entry?.cloudCompanyId;
        const tallyGuid = entry?.tallyGuid;
        const tallyName = entry?.tallyName;

        if (cloudCompanyId) {
          try {
            await axios.delete(`${apiUrl}/companies/${cloudCompanyId}`, {
              headers: { Authorization: `Bearer ${token}` },
              timeout: 30000
            });
          } catch (error) {
            const status = error?.response?.status;
            if (status !== 404 && status !== 403) {
              electronLog.warn('Company delete on server failed:', error?.response?.data?.message || error.message);
            }
          }
        }

        const linkedCompanies = (config.server?.linkedCompanies || []).filter(
          (item) =>
            item.cloudCompanyId !== cloudCompanyId &&
            item.tallyGuid !== tallyGuid &&
            item.tallyName !== tallyName
        );

        const newConfig = {
          ...config,
          server: {
            ...config.server,
            companyId: linkedCompanies[0]?.cloudCompanyId || '',
            linkedCompanies
          },
          tally: {
            ...config.tally,
            selectedCompanies: linkedCompanies.map((c) => c.tallyGuid).filter(Boolean)
          }
        };

        this.configManager.setConfig(newConfig);
        await this.applyServerRuntimeConfig(newConfig);

        if (this.syncManager?.removeCompanySyncState) {
          await this.syncManager.removeCompanySyncState(tallyGuid || tallyName);
        }

        return { success: true, linkedCompanies };
      });

      ipcMain.handle('server-validate-session', async () => {
        const config = this.configManager.getConfig();
        const token = config.server?.token;
        const apiUrl = this.resolveApiUrl(config);

        if (!token || !apiUrl) {
          return { valid: false };
        }

        try {
          const response = await axios.get(`${apiUrl}/auth/profile`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000
          });

          if (response?.data?.success) {
            const user = response.data.data?.user;
            const userEmail = user?.email || config.server?.userEmail || '';
            if (userEmail && userEmail !== config.server?.userEmail) {
              const newConfig = {
                ...config,
                server: { ...config.server, userEmail }
              };
              this.configManager.setConfig(newConfig);
            }
            return { valid: true, userEmail, user };
          }
        } catch (error) {
          const status = error?.response?.status;
          const code = error?.response?.data?.code;
          const message = String(error?.response?.data?.message || error.message || '').toLowerCase();
          const canTryRefresh =
            status === 401 &&
            (code === 'ACCESS_TOKEN_EXPIRED' ||
              message.includes('session expired') ||
              message.includes('not authorized'));

          if (canTryRefresh) {
            const renewed = await this.refreshStoredSession();
            if (renewed.success) {
              const retryConfig = this.configManager.getConfig();
              try {
                const retry = await axios.get(`${apiUrl}/auth/profile`, {
                  headers: { Authorization: `Bearer ${retryConfig.server.token}` },
                  timeout: 15000
                });
                if (retry?.data?.success) {
                  return {
                    valid: true,
                    userEmail: retry.data.data?.user?.email || renewed.userEmail,
                    user: retry.data.data?.user,
                    renewed: true
                  };
                }
              } catch (retryErr) {
                electronLog.warn('Profile check after refresh failed', retryErr.message);
              }
            }
          }

          const invalid =
            status === 401 ||
            status === 404 ||
            message.includes('not exist') ||
            message.includes('not found') ||
            message.includes('invalid token') ||
            message.includes('unauthorized');

          if (invalid) {
            electronLog.warn('Stored session invalid — clearing local credentials', {
              status,
              message: error?.response?.data?.message || error.message
            });
            const cleared = this.clearStoredSession(config);
            this.configManager.setConfig(cleared);
            await this.applyServerRuntimeConfig(cleared);
            try {
              await this.webSocketClient.disconnect();
            } catch (disconnectError) {
              electronLog.warn('WebSocket disconnect during session clear:', disconnectError.message);
            }
          }
        }

        return { valid: false, needsLogin: true };
      });

      ipcMain.handle('server-logout', async () => {
        const config = this.configManager.getConfig();
        const newConfig = {
          ...config,
          server: {
            ...config.server,
            token: '',
            refreshToken: '',
            deviceToken: '',
            userEmail: '',
            companyId: '',
            linkedCompanies: []
          },
          tally: {
            ...config.tally,
            selectedCompanies: []
          }
        };

        this.configManager.setConfig(newConfig);
        await this.applyServerRuntimeConfig(newConfig);

        try {
          await this.webSocketClient.disconnect();
        } catch (disconnectError) {
          electronLog.warn('Error disconnecting WebSocket client during logout:', disconnectError.message);
        }

        return { success: true };
      });

      ipcMain.handle('link-tally-company', async (event, tallyCompany) => {
        const config = this.configManager.getConfig();
        const token = config.server?.token;
        const apiUrl = this.resolveApiUrl(config);

        if (!token) {
          throw new Error('Log in first to link a Tally company.');
        }
        if (!apiUrl) {
          throw new Error('Server API URL is not configured.');
        }
        if (!tallyCompany?.name) {
          throw new Error('Tally company name is required.');
        }

        const { mapLicenseInfoForServer } = require('./src/utils/tallySyncTsExportMapper');
        let tallyLicense = tallyCompany.tallyLicense;
        if (!tallyLicense && this.tallyService?.getLicenseInfo) {
          try {
            const info = await this.tallyService.getLicenseInfo();
            tallyLicense = mapLicenseInfoForServer(info);
          } catch (licenseErr) {
            electronLog.warn('Could not read Tally license during link', licenseErr.message);
          }
        }

        const response = await axios.post(`${apiUrl}/companies/link-tally`, {
          name: tallyCompany.name,
          guid: tallyCompany.guid,
          booksFrom: tallyCompany.booksFrom,
          startingFrom: tallyCompany.startingFrom,
          tallyLicense: tallyLicense || undefined
        }, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000
        });

        const company = response?.data?.data?.company;
        const cloudCompanyId = String(company?._id || company?.id || '');
        if (!cloudCompanyId) {
          throw new Error('Company was linked but no ID was returned.');
        }

        const tallyKey = String(tallyCompany.guid || tallyCompany.name).trim();
        const linkedCompanies = Array.isArray(config.server?.linkedCompanies)
          ? [...config.server.linkedCompanies]
          : [];
        const entry = {
          tallyGuid: tallyKey,
          tallyName: tallyCompany.name,
          cloudCompanyId,
          linkedAt: new Date().toISOString()
        };
        const existingIndex = linkedCompanies.findIndex(
          (item) => item.tallyGuid === tallyKey || item.tallyName === tallyCompany.name
        );
        if (existingIndex >= 0) {
          linkedCompanies[existingIndex] = entry;
        } else {
          linkedCompanies.push(entry);
        }

        const newConfig = {
          ...config,
          server: {
            ...config.server,
            companyId: cloudCompanyId,
            linkedCompanies
          },
          tally: {
            ...config.tally,
            selectedCompanies: [tallyKey]
          }
        };

        this.configManager.setConfig(newConfig);
        await this.applyServerRuntimeConfig(newConfig);

        await this.webSocketClient.ensureConnected();

        return { success: true, cloudCompanyId, company, linkedCompanies };
      });

    ipcMain.handle('tally-get-license-info', async () => this.getTallyLicensePayload());

    ipcMain.handle('tally-check-serial', async (event, serialNumber) => {
      return this.checkTallySerialWithBackend(serialNumber);
    });

    ipcMain.handle('tally-test-connection', async () => {
      await this.tallyService.testConnection();
      const tallyLicense = await this.getTallyLicensePayload();
      let serialCheck = null;
      if (tallyLicense?.serialNumber) {
        serialCheck = await this.checkTallySerialWithBackend(tallyLicense.serialNumber);
        if (serialCheck?.inUse) {
          this.showNotification(
            'Tally serial already registered',
            `This serial is registered with ${serialCheck.registeredEmail || 'another account'}`
          );
        }
      }
      return { success: true, tallyLicense, serialCheck };
    });

    ipcMain.handle('tally-get-companies', () => this.tallyService.getCompanies());

    ipcMain.handle('hydrate-linked-companies', async () => this.hydrateLinkedCompaniesFromBackend());

    ipcMain.handle('backend-get-companies', async () => {
      const cfg = this.configManager.getConfig();
      const token = cfg.server?.token;
      if (!token) {
        throw new Error('Log in first to load workspaces from FinSync.');
      }
      const apiUrl = this.resolveApiUrl(cfg);
      if (!apiUrl) {
        throw new Error('Server API URL is not configured.');
      }
      const res = await axios.get(`${apiUrl}/companies`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000
      });
      const list = res.data?.data?.companies;
      return Array.isArray(list) ? list : [];
    });
    ipcMain.handle('get-connection-state', () => ({
      server: {
        ...this.webSocketClient.getConnectionStatus(),
        companyId: this.webSocketClient.config?.companyId || '',
        registeredForImport: Boolean(
          this.webSocketClient.isConnected &&
          this.webSocketClient.config?.companyId
        )
      },
      tally: this.tallyService.getConnectionStatus(),
      offlineQueueSize: this.syncManager.offlineQueue?.length ?? 0
    }));
    
    // Sync handlers
    ipcMain.handle('sync-set-company-preferences', async (event, payload) =>
      this.syncManager.setCompanySyncPreferences(payload)
    );
    ipcMain.handle('sync-get-companies-preview', async () => {
      const cfg = this.configManager.getConfig();
      return this.syncManager.getLinkedCompaniesSyncPreview(cfg);
    });
    ipcMain.handle('sync-get-open-companies-preview', async () => {
      const cfg = this.configManager.getConfig();
      return this.syncManager.getOpenLinkedCompaniesSyncPreview(cfg);
    });
    ipcMain.handle('sync-start', async (event, options = {}) => {
      const access = await this.fetchSubscriptionAccess();
      if (!access.allowed) {
        throw new Error(access.displayMessage || access.reason || 'Subscription required');
      }

      const cfg = this.configManager.getConfig();
      const companiesBatch = options && Array.isArray(options.companies) ? options.companies : [];
      for (const row of companiesBatch) {
        if (row && (row.tallyGuid != null || row.tallyName)) {
          await this.syncManager.setCompanySyncPreferences(row);
        }
      }

      const hasLocal =
        (Array.isArray(cfg.server?.linkedCompanies) && cfg.server.linkedCompanies.length > 0) ||
        String(cfg.server?.companyId || '').trim();

      if (!hasLocal) {
        const hydrated = await this.hydrateLinkedCompaniesFromBackend();
        if (!hydrated.success) {
          throw new Error(
            hydrated.message || 'No linked company found. Add a company from the Add Company page first.'
          );
        }
      }

      await this.refreshStoredSession();
      if (!this.webSocketClient.isConnected) {
        await this.resetDeviceLicenseForReconnect();
      }
      await this.webSocketClient.ensureConnected();
      if (this.syncManager.isSyncing) {
        return { started: false, reason: 'Sync already in progress' };
      }
      this.syncManager.startSync(options).catch((err) => {
        electronLog.error('Sync session failed:', err);
      });
      return { started: true };
    });
    ipcMain.handle('sync-stop', () => this.syncManager.stopSync());
    ipcMain.handle('sync-status', () => this.syncManager.getStatus());
    ipcMain.handle('sync-reset-state', async () => {
      if (this.syncManager.isSyncing) {
        return { success: false, message: 'Stop sync first, then reset.' };
      }
      await this.syncManager.resetSyncState();
      return { success: true };
    });
    ipcMain.handle('sync-clear-offline-queue', async () => {
      return this.syncManager.clearOfflineQueue();
    });
    ipcMain.handle('get-log-paths', () => getAgentLogPaths());
    ipcMain.handle('open-logs-folder', async () => {
      const { logsDir } = getAgentLogPaths();
      await fs.promises.mkdir(logsDir, { recursive: true });
      await shell.openPath(logsDir);
      return { success: true, logsDir };
    });
    
    // System handlers
    ipcMain.handle('get-system-info', () => this.systemMonitor.getSystemInfo());
    ipcMain.handle('show-notification', (event, title, body) => {
      this.showNotification(title, body);
    });
    
    ipcMain.handle('billing-get-status', async () => {
      const config = this.configManager.getConfig();
      if (!config.server?.token) {
        throw new Error('Log in to view subscription status.');
      }
      const data = await this.fetchBillingStatus();
      if (!data) {
        throw new Error('Log in to view subscription status.');
      }
      return data;
    });

    ipcMain.handle('billing-subscribe', async (event, { billingCycle, seatLimit }) => {
      const config = this.configManager.getConfig();
      const apiUrl = this.resolveApiUrl(config);
      const token = config.server?.token;
      if (!apiUrl || !token) {
        throw new Error('Log in to subscribe.');
      }

      const authHeaders = { Authorization: `Bearer ${token}` };

      try {
        await axios.get(`${apiUrl}/auth/profile`, { headers: authHeaders, timeout: 15000 });
      } catch (authErr) {
        if (authErr?.response?.status === 401) {
          const renewed = await this.refreshStoredSession();
          if (renewed.success) {
            const latest = this.configManager.getConfig();
            authHeaders.Authorization = `Bearer ${latest.server.token}`;
            await axios.get(`${apiUrl}/auth/profile`, { headers: authHeaders, timeout: 15000 });
          } else {
            throw new Error(
              'Your session has expired. Please sign in again with your email and password.'
            );
          }
        } else {
          throw new Error(
            authErr?.response?.data?.message ||
              authErr.message ||
              'Could not verify login before checkout.'
          );
        }
      }

      try {
        const latestCfg = this.configManager.getConfig();
        const res = await axios.post(
          `${apiUrl}/billing/subscribe`,
          { billingCycle, seatLimit },
          {
            headers: { Authorization: `Bearer ${latestCfg.server?.token || token}` },
            timeout: 30000
          }
        );
        return res.data?.data;
      } catch (error) {
        const status = error?.response?.status;
        const message =
          error?.response?.data?.message ||
          error.message ||
          'Checkout failed';

        if (status === 401) {
          const renewed = await this.refreshStoredSession();
          if (renewed.success) {
            const latest = this.configManager.getConfig();
            const retry = await axios.post(
              `${apiUrl}/billing/subscribe`,
              { billingCycle, seatLimit },
              {
                headers: { Authorization: `Bearer ${latest.server.token}` },
                timeout: 30000
              }
            );
            return retry.data?.data;
          }
          throw new Error(
            'Your session has expired. Please sign in again with your email and password.'
          );
        }

        if (/razorpay|authentication failed|not configured/i.test(String(message))) {
          // The keys live in the backend's own .env on the server — not in the
          // agent, and not in any hosting provider's dashboard.
          throw new Error(
            `${message} Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the backend .env on the server, then restart it. Test keys only work in Test mode, Live keys in Live mode, and the values must not be wrapped in quotes.`
          );
        }

        throw new Error(message);
      }
    });

    ipcMain.handle('billing-sync', async () => {
      const config = this.configManager.getConfig();
      const apiUrl = this.resolveApiUrl(config);
      const token = config.server?.token;
      if (!apiUrl || !token) {
        throw new Error('Log in first.');
      }
      const res = await axios.post(
        `${apiUrl}/billing/sync`,
        {},
        { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
      );
      const data = res.data?.data;
      const reconnect = await this.reconnectAfterBillingUpdate();
      return { ...data, reconnect };
    });

    ipcMain.handle('billing-reconnect', async () => this.reconnectAfterBillingUpdate());

    ipcMain.handle('billing-open-url', async (event, url) => {
      if (url && typeof url === 'string') {
        await shell.openExternal(url);
      }
    });

    // Window handlers
    ipcMain.handle('minimize-to-tray', () => this.hideToTray());
    ipcMain.handle('quit-app', () => this.quit());
  }

  async getTallyLicensePayload() {
    const { mapLicenseInfoForServer } = require('./src/utils/tallySyncTsExportMapper');
    if (!this.tallyService?.getLicenseInfo) {
      return null;
    }
    try {
      const info = await this.tallyService.getLicenseInfo();
      return mapLicenseInfoForServer(info);
    } catch (error) {
      electronLog.warn('getTallyLicensePayload failed', error.message);
      return null;
    }
  }

  async checkTallySerialWithBackend(serialNumber) {
    const config = this.configManager.getConfig();
    const apiUrl = this.resolveApiUrl(config);
    const token = config.server?.token;
    if (!apiUrl || !token || !serialNumber) {
      return null;
    }
    try {
      const response = await axios.post(
        `${apiUrl}/tally-serial/check`,
        { serialNumber },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000
        }
      );
      return response.data?.data || null;
    } catch (error) {
      electronLog.warn('tally-serial check failed', error.message);
      return null;
    }
  }

  setupServiceEventBridges() {
    this.webSocketClient.on('agent-register-ack', (data) => {
      if (data?.tallySerialConflict?.inUse) {
        this.showNotification(
          'Tally serial already registered',
          `This Tally installation is linked to ${data.tallySerialConflict.registeredEmail || 'another email'}`
        );
      }
    });

    this.webSocketClient.on('connected', () => this.sendConnectionStatusUpdates());
    this.webSocketClient.on('disconnected', () => this.sendConnectionStatusUpdates());
    this.webSocketClient.on('connection-error', () => this.sendConnectionStatusUpdates());

    this.tallyService.on('connectionStatusChanged', () => this.sendConnectionStatusUpdates());

    this.syncManager.on('sync-started', (session) => this.sendSyncStatusUpdate({
      ...session,
      status: 'running',
      currentOperation: session.currentOperation || 'Synchronization started'
    }));
    this.syncManager.on('sync-progress', (progress) => this.sendSyncStatusUpdate({
      ...progress,
      status: 'running'
    }));
    this.syncManager.on('sync-completed', (session) => this.sendSyncStatusUpdate(
      this.buildTerminalSyncStatusPayload(session, session.status || 'completed')
    ));
    this.syncManager.on('sync-failed', (session) => this.sendSyncStatusUpdate(
      this.buildTerminalSyncStatusPayload(session, 'failed')
    ));
    this.syncManager.on('offline-queue-progress', (info) => this.sendSyncStatusUpdate({
      status: 'completed',
      currentOperation: info.currentOperation || 'Uploading queued batches…',
      queuePending: info.pending,
      progress: 100,
      progressPercent: 100
    }));
    this.syncManager.on('offline-queue-finished', (info) => this.sendSyncStatusUpdate({
      status: 'completed',
      currentOperation: info.failed
        ? `Sync finished — ${info.failed} queued batch(es) could not be sent`
        : 'Sync finished',
      queuePending: 0,
      progress: 100,
      progressPercent: 100
    }));
  }

  /** UI status when sync session ends — status must be last so it is never overwritten. */
  buildTerminalSyncStatusPayload(session, status) {
    const endTime = session?.endTime || new Date();
    return {
      sessionId: session?.id,
      processedItems: session?.processedItems ?? 0,
      totalItems: session?.totalItems ?? 0,
      errors: session?.errors || [],
      summary: session?.summary || {},
      lastSync: endTime,
      currentOperation:
        status === 'completed'
          ? 'Sync finished'
          : status === 'partial'
            ? 'Sync finished with errors — voucher sync may be incomplete'
            : 'Sync failed',
      progress: status === 'failed' ? 0 : 100,
      progressPercent: status === 'failed' ? 0 : 100,
      phaseKey: null,
      currentStage: null,
      phaseIndex: null,
      phaseCount: null,
      queuePending: this.syncManager?.offlineQueue?.length ?? 0,
      status
    };
  }

  sendSyncStatusUpdate(payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('sync-status-update', payload);
    }
  }

  sendConnectionStatusUpdates() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send('websocket-update', {
      isConnected: this.webSocketClient.isConnected,
      isReconnecting: this.webSocketClient.isReconnecting,
      lastError: this.webSocketClient.lastConnectionError || null
    });

    this.mainWindow.webContents.send('tally-connection-update', {
      isConnected: this.tallyService.isConnected
    });
  }

  hideToTray({ showBalloon = true } = {}) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.hide();
    if (process.platform === 'win32') {
      this.mainWindow.setSkipTaskbar(true);
    }
    if (process.platform === 'darwin') {
      app.dock.hide();
    }

    if (
      showBalloon &&
      !this.hasShownTrayBalloon &&
      this.tray &&
      typeof this.tray.displayBalloon === 'function'
    ) {
      this.tray.displayBalloon({
        title: 'TallyFin Agent',
        content:
          'Still running in the system tray. Tally sync continues in the background. Right-click the tray icon and choose Quit to exit.'
      });
      this.hasShownTrayBalloon = true;
    }
  }

  showMainWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      if (process.platform === 'win32') {
        this.mainWindow.setSkipTaskbar(false);
      }
      this.mainWindow.show();
      this.mainWindow.focus();

      if (process.platform === 'darwin') {
        app.dock.show();
      }
    }
  }

  showSettings() {
    this.showMainWindow();
    // Send message to renderer to show settings
    if (this.mainWindow) {
      this.mainWindow.webContents.send('show-settings');
    }
  }

  async forceSync() {
    try {
      await this.syncManager.forceSync();
      this.showNotification('Sync Started', 'Manual sync initiated successfully');
    } catch (error) {
      electronLog.error('Force sync failed:', error);
      this.showNotification('Sync Failed', 'Failed to start manual sync');
    }
  }

  showNotification(title, body) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send('show-notification', { title, body });
    }
  }

  showErrorDialog(title, content) {
    dialog.showErrorBox(title, content);
  }

  onWindowAllClosed() {
    // Keep running in tray — sync must continue in the background
  }

  onActivate() {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      this.createMainWindow();
    }
  }

  onBeforeQuit() {
    this.isQuitting = true;
  }

  async quit() {
    this.isQuitting = true;

    if (this.connectionRetryTimer) {
      clearInterval(this.connectionRetryTimer);
      this.connectionRetryTimer = null;
    }

    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    try {
      // Cleanup services
      await this.syncManager.stop();
      await this.webSocketClient.disconnect();
      await this.tallyService.disconnect();
      this.systemMonitor.stop();
      
      electronLog.info('TallyFin Desktop Agent shutting down...');
    } catch (error) {
      electronLog.error('Error during shutdown:', error);
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
      this.mainWindow = null;
    }
    
    app.quit();
    app.exit(0);
  }
}

// Create and start the desktop agent (single instance only)
let desktopAgent = null;
if (gotTheLock) {
  desktopAgent = new DesktopAgent();
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  electronLog.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  electronLog.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
