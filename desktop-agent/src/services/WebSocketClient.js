const WebSocket = require('ws');
const EventEmitter = require('events');
const electronLog = require('electron-log');
const crypto = require('crypto-js');
const nodeCrypto = require('crypto');
const { machineId } = require('node-machine-id');

class WebSocketClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.isConnected = false;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.syncInProgress = false;
    this.pendingReconnect = false;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    
    this.config = {
      serverUrl: 'ws://127.0.0.1:5000/tally-agent',
      apiKey: '',
      token: '',
      deviceToken: '',
      companyId: '',
      agentId: '',
      heartbeatInterval: 30000,
      heartbeatTimeout: 90000,
      maxMessageSize: 16 * 1024 * 1024, // larger voucher batches for full-sync throughput
      /** Target batch payload size before splitting (bytes). */
      voucherBatchTargetBytes: 6 * 1024 * 1024
    };
    
    this.logger = electronLog.scope('WebSocketClient');
    this.messageQueue = [];
    this.isProcessingQueue = false;
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.syncAckHandlers = new Map();
    /** Serializes sync-data uploads so the server is not flooded (avoids WS 1006 drops). */
    this.syncSendChain = Promise.resolve();
    this.activeSyncSends = 0;
    /** Delay rejecting in-flight sync acks on close — ack may arrive just before/after reconnect. */
    this.closeAckGraceTimer = null;
    this.closeAckGraceMs = 10000;
    /** Optional async () => extra fields merged into agent-register payload */
    this.registerPayloadProvider = null;
    this.lastConnectionError = null;
    /** After 401, force device re-activation on next connect attempt */
    this.forceDeviceReactivate = false;
  }

  reloadAuthFromAgentStore() {
    const Store = require('electron-store');
    const agentStore = new Store({ name: 'finsync360-agent-config' });
    const server = agentStore.get('server', {}) || {};
    if (server.url) {
      this.config.serverUrl = this.normalizeServerUrl(server.url);
    }
    if (server.token !== undefined) {
      this.config.token = server.token || '';
    }
    if (server.deviceToken !== undefined) {
      this.config.deviceToken = server.deviceToken || '';
    }
    if (server.apiKey) {
      this.config.apiKey = server.apiKey;
    }
    if (server.companyId) {
      this.config.companyId = server.companyId;
    }
  }

  async refreshAccessTokenFromStore() {
    const Store = require('electron-store');
    const axios = require('axios');
    const agentStore = new Store({ name: 'finsync360-agent-config' });
    const server = agentStore.get('server', {}) || {};
    const apiUrl = String(server.apiUrl || '').replace(/\/$/, '');
    const refreshToken = String(server.refreshToken || '').trim();

    if (!apiUrl || !refreshToken) {
      return false;
    }

    try {
      const response = await axios.post(
        `${apiUrl}/auth/refresh`,
        { refreshToken },
        { timeout: 15000 }
      );
      const token = response?.data?.data?.token;
      const newRefresh = response?.data?.data?.refreshToken;
      if (!token) {
        return false;
      }
      server.token = token;
      if (newRefresh) {
        server.refreshToken = newRefresh;
      }
      agentStore.set('server', server);
      this.config.token = token;
      this.logger.info('Refreshed access token before WebSocket connect');
      return true;
    } catch (error) {
      this.logger.warn('Could not refresh access token before WebSocket', {
        message: error?.response?.data?.message || error.message
      });
      return false;
    }
  }

  mapWebSocketErrorMessage(error) {
    const msg = String(error?.message || '');
    if (/401|unexpected server response/i.test(msg)) {
      return (
        'Server rejected the connection (auth). Sign out and sign in again, or open Subscription → Activate after payment.'
      );
    }
    return msg || 'WebSocket connection failed';
  }

  clearDeviceTokenInStore() {
    const Store = require('electron-store');
    const agentStore = new Store({ name: 'finsync360-agent-config' });
    const server = agentStore.get('server', {}) || {};
    server.deviceToken = '';
    agentStore.set('server', server);
    this.config.deviceToken = '';
    this.saveConfig({ deviceToken: '' });
    this.forceDeviceReactivate = true;
  }

  setRegisterPayloadProvider(fn) {
    this.registerPayloadProvider = typeof fn === 'function' ? fn : null;
  }

  hasAuth() {
    return Boolean(
      String(this.config.deviceToken || '').trim() ||
      String(this.config.token || '').trim() ||
      String(this.config.apiKey || '').trim()
    );
  }

  normalizeServerUrl(url) {
    if (typeof url !== 'string' || !url.trim()) {
      return url;
    }
    return url.replace('ws://localhost', 'ws://127.0.0.1').replace('wss://localhost', 'wss://127.0.0.1');
  }

  async initialize(runtimeConfig = {}) {
    this.logger.info('Initializing WebSocket Client...');

    try {
      await this.loadConfig();
      if (runtimeConfig && Object.keys(runtimeConfig).length > 0) {
        this.config = { ...this.config, ...runtimeConfig };
        if (runtimeConfig.serverUrl) {
          this.config.serverUrl = this.normalizeServerUrl(runtimeConfig.serverUrl);
        }
      }

      await this.generateAgentId();

      if (!this.hasAuth()) {
        this.logger.info('WebSocket connect deferred until login (no token or API key yet)');
        return;
      }

      await this.connect();
      this.logger.info('WebSocket Client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize WebSocket Client:', error);
      throw error;
    }
  }

  async loadConfig() {
    const Store = require('electron-store');

    // Prefer main agent config (token, server URL) — same store as ConfigManager
    const agentStore = new Store({ name: 'finsync360-agent-config' });
    const agentConfig = agentStore.store || {};
    if (agentConfig.server) {
      if (agentConfig.server.url) {
        this.config.serverUrl = this.normalizeServerUrl(agentConfig.server.url);
      }
      if (agentConfig.server.token) {
        this.config.token = agentConfig.server.token;
      }
      if (agentConfig.server.deviceToken) {
        this.config.deviceToken = agentConfig.server.deviceToken;
      }
      if (agentConfig.server.apiKey) {
        this.config.apiKey = agentConfig.server.apiKey;
      }
      if (agentConfig.server.companyId) {
        this.config.companyId = agentConfig.server.companyId;
      }
    }

    const wsStore = new Store();
    const savedConfig = wsStore.get('webSocketConfig', {});
    this.config = { ...this.config, ...savedConfig };
    this.config.serverUrl = this.normalizeServerUrl(this.config.serverUrl);

    this.logger.info('WebSocket configuration loaded', {
      serverUrl: this.config.serverUrl,
      hasToken: Boolean(this.config.token),
      hasApiKey: Boolean(this.config.apiKey)
    });
  }

  async saveConfig(newConfig) {
    const Store = require('electron-store');
    const store = new Store();
    
    this.config = { ...this.config, ...newConfig };
    store.set('webSocketConfig', this.config);
    
    this.logger.info('WebSocket configuration saved');
  }

  async generateAgentId() {
    if (!this.config.agentId) {
      try {
        const machineIdValue = await machineId();
        this.config.agentId = crypto.SHA256(machineIdValue).toString();
        await this.saveConfig(this.config);
        this.logger.info('Generated unique agent ID');
      } catch (error) {
        this.logger.error('Failed to generate agent ID:', error);
        // Fallback to random ID
        this.config.agentId = crypto.lib.WordArray.random(32).toString();
      }
    }
  }

  async activateDeviceLicense() {
    const Store = require('electron-store');
    const axios = require('axios');
    const os = require('os');
    const agentStore = new Store({ name: 'finsync360-agent-config' });
    const server = agentStore.get('server', {}) || {};
    const apiUrl = String(server.apiUrl || '').replace(/\/$/, '');
    const token = String(server.token || '').trim();

    if (!apiUrl || !token) {
      return null;
    }

    await this.generateAgentId();

    const response = await axios.post(
      `${apiUrl}/devices/activate`,
      {
        agentId: this.config.agentId,
        hostname: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        agentVersion: '1.0.0'
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000
      }
    );

    const deviceToken = response?.data?.data?.deviceToken;
    if (!deviceToken) {
      throw new Error('Device activation did not return a device token.');
    }

    this.config.deviceToken = deviceToken;
    server.deviceToken = deviceToken;
    agentStore.set('server', server);
    await this.saveConfig({ deviceToken });

    this.logger.info('Device license activated', {
      seatLimit: response?.data?.data?.seatLimit,
      seatsUsed: response?.data?.data?.seatsUsed
    });

    return deviceToken;
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    this.reloadAuthFromAgentStore();

    if (!this.hasAuth()) {
      this.logger.warn('Cannot connect to server: login required (missing token and API key)');
      return;
    }

    await this.refreshAccessTokenFromStore();
    this.reloadAuthFromAgentStore();

    const needsDeviceActivation =
      this.forceDeviceReactivate ||
      (this.config.token && !String(this.config.deviceToken || '').trim());

    if (needsDeviceActivation) {
      try {
        await this.activateDeviceLicense();
        this.forceDeviceReactivate = false;
      } catch (error) {
        const message = error?.response?.data?.message || error.message;
        this.lastConnectionError = message || 'Device activation failed';
        this.logger.error('Device activation failed before WebSocket connect:', message);
        throw new Error(this.lastConnectionError);
      }
    }

    if (!this.config.serverUrl) {
      this.logger.warn('Cannot connect to server: server URL is not configured');
      return;
    }

    this.logger.info('Connecting to TallyFin server...', {
      serverUrl: this.config.serverUrl,
      hasToken: Boolean(this.config.token),
      hasDeviceToken: Boolean(this.config.deviceToken),
      hasApiKey: Boolean(this.config.apiKey),
      companyId: this.config.companyId || '(empty)'
    });

    try {
      const url = new URL(this.config.serverUrl);
      url.searchParams.set('agentId', this.config.agentId);
      if (this.config.deviceToken) {
        url.searchParams.set('deviceToken', this.config.deviceToken);
      } else if (this.config.token) {
        url.searchParams.set('token', this.config.token);
      } else if (this.config.apiKey) {
        url.searchParams.set('apiKey', this.config.apiKey);
      }
      if (this.config.companyId) {
        url.searchParams.set('companyId', this.config.companyId);
      }
      
      this.ws = new WebSocket(url.toString(), {
        headers: {
          'User-Agent': 'TallyFin-Desktop-Agent/1.0.0'
        }
      });

      this.setupEventHandlers();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

      this.ws.once('open', () => {
        clearTimeout(timeout);
        this.logger.info('WebSocket connect params ready', {
          serverUrl: this.config.serverUrl,
          companyId: this.config.companyId || '(empty)'
        });
        resolve();
      });

        this.ws.once('error', (error) => {
          clearTimeout(timeout);
          const is401 = /401|unexpected server response/i.test(String(error?.message || ''));
          if (is401) {
            this.logger.warn('WebSocket 401 — clearing device token for re-activation on retry');
            this.clearDeviceTokenInStore();
          }
          this.lastConnectionError = this.mapWebSocketErrorMessage(error);
          reject(new Error(this.lastConnectionError));
        });
      });
    } catch (error) {
      this.lastConnectionError = error?.message || 'Failed to connect to server';
      this.logger.error('Failed to connect to server:', error);
      throw error;
    }
  }

  async sendAgentRegistration() {
    const base = {
      agentId: this.config.agentId,
      companyId: this.config.companyId,
      version: require('../../package.json').version,
      platform: process.platform,
      arch: process.arch
    };
    let extra = {};
    if (this.registerPayloadProvider) {
      try {
        extra = (await this.registerPayloadProvider()) || {};
      } catch (error) {
        this.logger.warn('registerPayloadProvider failed', { error: error.message });
      }
    }
    this.sendMessage('agent-register', { ...base, ...extra });
  }

  setupEventHandlers() {
    this.ws.on('open', () => {
      this.isConnected = true;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.lastConnectionError = null;

      if (this.closeAckGraceTimer) {
        clearTimeout(this.closeAckGraceTimer);
        this.closeAckGraceTimer = null;
      }
      
      this.logger.info('Connected to TallyFin server');
      this.emit('connected');
      
      // Start heartbeat
      this.startHeartbeat();
      
      // Process queued messages after the socket is fully open
      setImmediate(() => this.processMessageQueue());
      
      // Send agent registration (optionally enriched with Tally license info)
      this.sendAgentRegistration().catch((err) => {
        this.logger.warn('agent-register failed', { error: err.message });
      });
    });

    this.ws.on('close', (code, reason) => {
      this.isConnected = false;
      this.stopHeartbeat();

      const closeErr = new Error(`WebSocket closed (${code}): ${reason}`);
      const pending = this.syncAckHandlers.size;
      if (pending > 0) {
        this.logger.warn('WebSocket closed with pending sync acks — grace period before fail', {
          code,
          pending,
          graceMs: this.closeAckGraceMs
        });
        if (this.closeAckGraceTimer) {
          clearTimeout(this.closeAckGraceTimer);
        }
        this.closeAckGraceTimer = setTimeout(() => {
          this.closeAckGraceTimer = null;
          if (this.syncAckHandlers.size > 0) {
            this.rejectAllPendingSyncAcks(closeErr);
          }
        }, this.closeAckGraceMs);
      }
      
      this.logger.info(`Disconnected from server: ${code} - ${reason}`);
      this.emit('disconnected', { code, reason });
      
      // Attempt reconnection
      if (!this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      const is401 = /401|unexpected server response/i.test(String(error?.message || ''));
      if (is401) {
        this.clearDeviceTokenInStore();
      }
      this.lastConnectionError = this.mapWebSocketErrorMessage(error);
      this.logger.error('WebSocket error:', this.lastConnectionError);
      this.emit('connection-error', new Error(this.lastConnectionError));
    });

    this.ws.on('message', (data) => {
      // Any server traffic means the connection is alive (sync acks can take minutes).
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        this.logger.error('Failed to parse message:', error);
      }
    });

    this.ws.on('ping', () => {
      this.ws.pong();
    });

    this.ws.on('pong', () => {
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
    });
  }

  handleMessage(message) {
    this.logger.debug('Received message:', message.type);
    
    switch (message.type) {
      case 'agent-register-ack':
        this.logger.info('Received agent register acknowledgment', message.data || {});
        this.emit('agent-register-ack', message.data || {});
        break;

      case 'sync-data-ack':
        this.logger.info('Received sync data acknowledgment', message.data || {});
        this.resolveSyncAck(message.syncRequestId, true, message.data || {});
        this.emit('sync-data-ack', message.data || {});
        break;

      case 'sync-data-error':
        this.logger.error('Received sync data error from backend', message.data || {});
        this.resolveSyncAck(message.syncRequestId, false, message.data || {});
        this.emit('sync-data-error', message.data || {});
        break;

      case 'sync-data-batch-ack':
        this.logger.info('Received sync batch acknowledgment', message.data || {});
        this.resolveSyncAck(message.syncRequestId, true, message.data || {});
        this.emit('sync-data-batch-ack', message.data || {});
        break;

      case 'sync-data-batch-error':
        this.logger.error('Received sync batch error from backend', message.data || {});
        this.resolveSyncAck(message.syncRequestId, false, message.data || {});
        this.emit('sync-data-batch-error', message.data || {});
        break;

      case 'sync-request':
        this.handleSyncRequest(message.data);
        break;

      case 'fetch-voucher-detail':
        this.emit('fetch-voucher-detail', { ...(message.data || {}), requestId: message.requestId });
        break;

      case 'import-voucher':
        this.emit('import-voucher', {
          ...(message.data || {}),
          requestId: message.requestId || message.data?.requestId
        });
        break;

      case 'import-ledger':
        this.emit('import-ledger', {
          ...(message.data || {}),
          requestId: message.requestId || message.data?.requestId
        });
        break;

      case 'import-stock-item':
        this.emit('import-stock-item', {
          ...(message.data || {}),
          requestId: message.requestId || message.data?.requestId
        });
        break;
        
      case 'config-update':
        this.handleConfigUpdate(message.data);
        break;
        
      case 'ping':
        this.sendMessage('pong', { timestamp: Date.now() });
        break;
        
      case 'agent-command':
        this.handleAgentCommand(message.data);
        break;
        
      default:
        this.emit('message', message);
        break;
    }
  }

  handleSyncRequest(data) {
    this.logger.info('Received sync request:', data);
    this.emit('sync-request', data);
  }

  handleConfigUpdate(data) {
    this.logger.info('Received config update');
    this.emit('config-update', data);
  }

  handleAgentCommand(data) {
    this.logger.info('Received agent command:', data.command);
    this.emit('agent-command', data);
  }

  createSyncRequestId() {
    if (typeof nodeCrypto.randomUUID === 'function') {
      return nodeCrypto.randomUUID();
    }
    return nodeCrypto.randomBytes(16).toString('hex');
  }

  resolveSyncAck(syncRequestId, ok, data) {
    if (!syncRequestId) return;
    const entry = this.syncAckHandlers.get(syncRequestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.syncAckHandlers.delete(syncRequestId);
    if (ok) {
      entry.resolve(data || {});
    } else {
      entry.reject(new Error(data?.message || 'Sync rejected by server'));
    }
  }

  rejectAllPendingSyncAcks(err) {
    const entries = [...this.syncAckHandlers.entries()];
    for (const [id, entry] of entries) {
      if (!this.syncAckHandlers.has(id)) continue;
      clearTimeout(entry.timer);
      this.syncAckHandlers.delete(id);
      this.activeSyncSends = Math.max(0, this.activeSyncSends - 1);
      entry.reject(err);
    }
  }

  /**
   * Send one sync-data row and wait for sync-data-ack / sync-data-error from the server.
   * Uploads are serialized globally so the backend is not processing many rows in parallel.
   */
  sendSyncDataWithAck(innerData, options = {}) {
    const run = () => this._sendSyncPayloadWithAckOnce('sync-data', innerData, options);
    const chained = this.syncSendChain.then(run, run);
    this.syncSendChain = chained.catch(() => {});
    return chained;
  }

  /**
   * Upload many rows in one WebSocket round-trip (serialized like single-row sync).
   * @param {object} batchInner - { type, companyId, companyName, items: [] }
   */
  sendSyncDataBatchWithAck(batchInner, options = {}) {
    const serialize = options.serialize !== false;
    const run = () => this._sendSyncPayloadWithAckOnce('sync-data-batch', batchInner, options);
    if (serialize) {
      const chained = this.syncSendChain.then(run, run);
      this.syncSendChain = chained.catch(() => {});
      return chained;
    }
    this.activeSyncSends += 1;
    return run().finally(() => {
      this.activeSyncSends = Math.max(0, this.activeSyncSends - 1);
    });
  }

  _sendSyncDataWithAckOnce(innerData, options = {}) {
    return this._sendSyncPayloadWithAckOnce('sync-data', innerData, options);
  }

  _sendSyncPayloadWithAckOnce(messageType, innerData, options = {}) {
    const timeoutMs = options.timeoutMs != null ? options.timeoutMs : 120000;
    const syncRequestId = this.createSyncRequestId();

    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected — cannot sync'));
        return;
      }

      const timer = setTimeout(() => {
        const pending = this.syncAckHandlers.get(syncRequestId);
        if (!pending) return;
        this.syncAckHandlers.delete(syncRequestId);
        this.activeSyncSends = Math.max(0, this.activeSyncSends - 1);
        pending.reject(new Error(`Sync acknowledgement timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.syncAckHandlers.set(syncRequestId, {
        resolve: (d) => {
          clearTimeout(timer);
          resolve(d);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer
      });

      const message = {
        type: messageType,
        syncRequestId,
        data: innerData,
        timestamp: Date.now(),
        agentId: this.config.agentId
      };

      try {
        const messageStr = JSON.stringify(message);
        if (messageStr.length > this.config.maxMessageSize) {
          this.syncAckHandlers.delete(syncRequestId);
          clearTimeout(timer);
          reject(new Error(`Sync payload too large (${messageStr.length} bytes)`));
          return;
        }
        this.activeSyncSends += 1;
        this.ws.send(messageStr);
        this.logger.debug('Sent sync payload with ack waiter', {
          syncRequestId,
          messageType,
          rowType: innerData?.type,
          itemCount: Array.isArray(innerData?.items) ? innerData.items.length : 1
        });
      } catch (error) {
        this.syncAckHandlers.delete(syncRequestId);
        clearTimeout(timer);
        this.activeSyncSends = Math.max(0, this.activeSyncSends - 1);
        reject(error);
      }

      const finish = () => {
        this.activeSyncSends = Math.max(0, this.activeSyncSends - 1);
      };
      const entry = this.syncAckHandlers.get(syncRequestId);
      if (entry) {
        const prevResolve = entry.resolve;
        const prevReject = entry.reject;
        entry.resolve = (d) => {
          finish();
          prevResolve(d);
        };
        entry.reject = (e) => {
          finish();
          prevReject(e);
        };
      }
    });
  }

  sendMessage(type, data = {}) {
    const message = {
      type,
      data,
      timestamp: Date.now(),
      agentId: this.config.agentId
    };

    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      try {
        const messageStr = JSON.stringify(message);
        
        if (messageStr.length > this.config.maxMessageSize) {
          this.logger.error('Message too large:', messageStr.length);
          return false;
        }
        
        this.ws.send(messageStr);
        this.logger.debug('Sent message:', type);
        return true;
      } catch (error) {
        this.logger.error('Failed to send message:', error);
        return false;
      }
    } else {
      // Queue message for later
      this.messageQueue.push(message);
      this.logger.debug('Queued message:', type);
      return false;
    }
  }

  async processMessageQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.isProcessingQueue = true;
    
    while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift();
      
      try {
        const messageStr = JSON.stringify(message);
        this.ws.send(messageStr);
        this.logger.debug('Sent queued message:', message.type);
        
        // Small delay to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        this.logger.error('Failed to send queued message:', error);
        // Put message back at the front of the queue
        this.messageQueue.unshift(message);
        break;
      }
    }
    
    this.isProcessingQueue = false;
  }

  setSyncInProgress(inProgress) {
    const wasSyncing = this.syncInProgress;
    this.syncInProgress = Boolean(inProgress);
    if (wasSyncing && !this.syncInProgress && this.pendingReconnect && this.hasAuth()) {
      this.logger.info('Sync finished — applying deferred WebSocket reconnect');
      this.pendingReconnect = false;
      if (this.isConnected || this.ws) {
        this.disconnect();
      }
      setTimeout(() => {
        this.connect().catch((err) => this.logger.error('Deferred reconnect failed:', err));
      }, 400);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        
        // Set timeout for pong response
        this.heartbeatTimeout = setTimeout(() => {
          if (this.activeSyncSends > 0 || this.syncAckHandlers.size > 0) {
            this.logger.debug('Heartbeat timeout deferred — sync in progress');
            return;
          }
          this.logger.warn('Heartbeat timeout - connection may be lost');
          this.ws.terminate();
        }, this.config.heartbeatTimeout);
      }
    }, this.config.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  scheduleReconnect() {
    if (this.isReconnecting) {
      return;
    }

    if (!this.hasAuth()) {
      this.logger.debug('Skipping reconnect until user is authenticated');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );
    
    this.logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.logger.error('Reconnect attempt failed:', error);
        this.isReconnecting = false;
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          this.logger.error('Max reconnect attempts reached');
          this.emit('max-reconnect-attempts-reached');
        }
      }
    }, delay);
  }

  async disconnect() {
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close(1000, 'Agent shutdown');
      this.ws = null;
    }
    
    this.isConnected = false;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    
    this.logger.info('Disconnected from server');
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.messageQueue.length,
      serverUrl: this.config.serverUrl,
      agentId: this.config.agentId,
      lastError: this.lastConnectionError
    };
  }

  async ensureConnected() {
    if (this.isConnected) {
      return true;
    }
    if (!this.hasAuth()) {
      return false;
    }
    try {
      await this.connect();
      return this.isConnected;
    } catch (error) {
      this.lastConnectionError = error?.message || this.lastConnectionError || 'Connection failed';
      this.logger.error('ensureConnected failed:', error);
      this.emit('connection-error', error);
      return false;
    }
  }

  updateConfig(newConfig) {
    const prev = { ...this.config };
    if (newConfig.serverUrl) {
      newConfig.serverUrl = this.normalizeServerUrl(newConfig.serverUrl);
    }
    this.config = { ...this.config, ...newConfig };

    const mustReconnect =
      prev.serverUrl !== this.config.serverUrl ||
      prev.token !== this.config.token ||
      prev.deviceToken !== this.config.deviceToken ||
      prev.apiKey !== this.config.apiKey ||
      String(prev.companyId || '') !== String(this.config.companyId || '');

    const authBecameAvailable = !prev.token && !prev.apiKey && this.hasAuth();

    if ((mustReconnect || authBecameAvailable) && this.hasAuth()) {
      if (this.syncInProgress) {
        this.logger.info('Deferring WebSocket reconnect until sync completes');
        this.pendingReconnect = true;
        this.saveConfig(this.config);
        return;
      }
      this.logger.info('WebSocket config changed; connecting with updated credentials…');
      if (this.isConnected || this.ws) {
        this.disconnect();
      }
      setTimeout(() => {
        this.connect().catch((err) => this.logger.error('Reconnect failed:', err));
      }, 400);
    }

    this.saveConfig(this.config);
  }
}

module.exports = WebSocketClient;
