const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const electronLog = require('electron-log');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const http = require('http');
const isDev = require('electron-is-dev');

// Import services
const TallyService = require('./src/services/TallyService');
const WebSocketClient = require('./src/services/WebSocketClient');
const SyncManager = require('./src/services/SyncManager');
const ConfigManager = require('./src/services/ConfigManager');
const SystemMonitor = require('./src/services/SystemMonitor');
const UpdateManager = require('./src/services/UpdateManager');

// Configure logging
electronLog.transports.file.level = 'info';
electronLog.transports.console.level = 'debug';

// Initialize store
const store = new Store();

class DesktopAgent {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.isQuitting = false;
    
    // Initialize services
    this.tallyService = new TallyService();
    this.webSocketClient = new WebSocketClient();
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
          <title>FinSync360 Agent</title>
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
            <h1>FinSync360 Agent is running</h1>
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

    // Auto updater events
    this.setupAutoUpdater();
    
    // IPC handlers
    this.setupIpcHandlers();
    this.setupServiceEventBridges();
  }

  async onReady() {
    try {
      electronLog.info('FinSync360 Desktop Agent starting...');
      
      // Create main window
      await this.createMainWindow();
      
      // Create system tray
      this.createTray();
      
      // Initialize services
      await this.initializeServices();
      this.sendConnectionStatusUpdates();
      
      // Check for updates
      if (!isDev) {
        this.updateManager.checkForUpdates();
      }
      
      electronLog.info('FinSync360 Desktop Agent started successfully');
    } catch (error) {
      electronLog.error('Failed to start Desktop Agent:', error);
      this.showErrorDialog(
        'FinSync360 Agent',
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

    // Handle window events
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.mainWindow.hide();
        
        if (process.platform === 'darwin') {
          app.dock.hide();
        }
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
        'FinSync360 Agent',
        'The screen was restarted after an internal issue. Your background sync continues to run.'
      );
    });
  }

  createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    this.tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show FinSync360 Agent',
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
        click: () => this.updateManager.checkForUpdates()
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.quit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip('FinSync360 Desktop Agent');
    
    this.tray.on('double-click', () => {
      this.showMainWindow();
    });
  }

  async initializeServices() {
    try {
      // Initialize configuration
      await this.configManager.initialize();
      const appConfig = this.configManager.getConfig();
      if (isDev && !appConfig.server?.apiKey) {
        const inferredApiKey = this.readBackendDesktopAgentApiKey();
        if (inferredApiKey) {
          this.configManager.setConfig('server.apiKey', inferredApiKey);
          appConfig.server.apiKey = inferredApiKey;
          electronLog.info('Loaded desktop agent API key from backend .env for local development');
        }
      }
      await this.tallyService.saveConfig(appConfig.tally || {});
      this.webSocketClient.updateConfig(
        Object.fromEntries(
          Object.entries({
            serverUrl: appConfig.server?.url,
            apiKey: appConfig.server?.apiKey
          }).filter(([, value]) => value !== undefined)
        )
      );
      this.syncManager.updateConfig(appConfig.sync || {});
      
      // Initialize Tally service
      try {
        await this.tallyService.initialize();
      } catch (error) {
        electronLog.warn('Tally service unavailable during startup, continuing in disconnected mode:', error.message);
      }
      
      // Initialize WebSocket client
      try {
        await this.webSocketClient.initialize();
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

  setupAutoUpdater() {
    if (!app.isPackaged) {
      electronLog.info('Auto-updater disabled in development mode');
      return;
    }

    autoUpdater.logger = electronLog;
    autoUpdater.checkForUpdatesAndNotify();

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

      // Keep runtime services aligned with updated config values.
      const mergedConfig = this.configManager.getConfig();
      await this.tallyService.saveConfig(mergedConfig.tally || {});
      this.webSocketClient.updateConfig(
        Object.fromEntries(
          Object.entries({
            serverUrl: mergedConfig.server?.url,
            apiKey: mergedConfig.server?.apiKey
          }).filter(([, value]) => value !== undefined)
        )
      );
      this.syncManager.updateConfig(mergedConfig.sync || {});

      this.sendConnectionStatusUpdates();
      return true;
    });
    
    // Tally service handlers
    ipcMain.handle('tally-test-connection', async () => {
      try {
        const result = await this.tallyService.testConnection();
        this.sendConnectionStatusUpdates();
        return result;
      } catch (error) {
        this.sendConnectionStatusUpdates();
        throw error;
      }
    });
    ipcMain.handle('tally-get-companies', () => this.tallyService.getCompanies());
    ipcMain.handle('get-connection-state', () => ({
      server: this.webSocketClient.getConnectionStatus(),
      tally: this.tallyService.getConnectionStatus()
    }));
    
    // Sync handlers
    ipcMain.handle('sync-start', () => this.syncManager.startSync());
    ipcMain.handle('sync-stop', () => this.syncManager.stopSync());
    ipcMain.handle('sync-status', () => this.syncManager.getStatus());
    
    // System handlers
    ipcMain.handle('get-system-info', () => this.systemMonitor.getSystemInfo());
    ipcMain.handle('show-notification', (event, title, body) => {
      this.showNotification(title, body);
    });
    
    // Window handlers
    ipcMain.handle('minimize-to-tray', () => this.mainWindow.hide());
    ipcMain.handle('quit-app', () => this.quit());
  }

  setupServiceEventBridges() {
    this.webSocketClient.on('connected', () => this.sendConnectionStatusUpdates());
    this.webSocketClient.on('disconnected', () => this.sendConnectionStatusUpdates());
    this.webSocketClient.on('connection-error', () => this.sendConnectionStatusUpdates());

    this.tallyService.on('connectionStatusChanged', () => this.sendConnectionStatusUpdates());

    this.syncManager.on('sync-started', (session) => this.sendSyncStatusUpdate({
      status: 'running',
      currentOperation: 'Synchronization started',
      ...session
    }));
    this.syncManager.on('sync-progress', (progress) => this.sendSyncStatusUpdate({
      status: 'running',
      ...progress
    }));
    this.syncManager.on('sync-completed', (session) => this.sendSyncStatusUpdate({
      status: 'completed',
      ...session
    }));
    this.syncManager.on('sync-failed', (session) => this.sendSyncStatusUpdate({
      status: 'failed',
      ...session
    }));
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
      isReconnecting: this.webSocketClient.isReconnecting
    });

    this.mainWindow.webContents.send('tally-connection-update', {
      isConnected: this.tallyService.isConnected
    });
  }

  showMainWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
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
    // On macOS, keep app running even when all windows are closed
    if (process.platform !== 'darwin') {
      this.quit();
    }
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
    
    try {
      // Cleanup services
      await this.syncManager.stop();
      await this.webSocketClient.disconnect();
      await this.tallyService.disconnect();
      this.systemMonitor.stop();
      
      electronLog.info('FinSync360 Desktop Agent shutting down...');
    } catch (error) {
      electronLog.error('Error during shutdown:', error);
    }
    
    app.quit();
  }
}

// Create and start the desktop agent
const desktopAgent = new DesktopAgent();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  electronLog.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  electronLog.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
