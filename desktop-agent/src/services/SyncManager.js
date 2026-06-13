const EventEmitter = require('events');
const cron = require('node-cron');
const electronLog = require('electron-log');
const fs = require('fs-extra');
const path = require('path');
const { getVoucherSyncLogger } = require('../utils/agentLogger');

class SyncManager extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.isSyncing = false;
    this.isProcessingOfflineQueue = false;
    this.syncJobs = new Map();
    this.offlineQueue = [];
    this.syncHistory = [];
    this.syncState = { companies: {} };
    this.maxHistoryEntries = 1000;
    this.maxQueueSize = 10000;
    this.progressEmitIntervalMs = 180;
    this.lastProgressEmitAt = 0;
    this.offlineQueueSaveTimer = null;
    this.offlineQueueSaveDelayMs = 1000;
    
    this.config = {
      autoSync: false,
      syncInterval: '0 * * * *', // Every hour
      batchSize: 100,
      /** Bump when performance defaults change so loadConfig can migrate stored configs. */
      syncPipelineVersion: 2,
      /** Vouchers per WebSocket batch upload (larger safe defaults for faster full sync). */
      voucherUploadBatchSize: 200,
      voucherBatchTargetBytes: 6 * 1024 * 1024,
      /** Serial voucher batch uploads — parallel uploads caused Railway WebSocket 1006 drops. */
      voucherUploadConcurrency: 1,
      vouchers: {
        windowDaysInitial: 15,
        windowDaysMax: 30,
        windowDaysMin: 3,
        voucherSplitThreshold: 400,
        fullSyncMaxYears: 5,
        secPerWindowEstimate: 25,
        /** Fetch the next Tally window while the previous one uploads (overlaps Tally I/O with network). */
        prefetchNextWindow: true
      },
      maxWindowRetries: 3,
      windowRetryDelayMs: 2000,
      maxRetries: 3,
      retryDelay: 5000,
      offlineMode: false,
      syncTypes: {
        masters: true,
        parties: true,
        vouchers: true,
        reports: true,
        companies: false,
        gstRegistrations: true
      },
      /** Skip masters/parties/vouchers on scheduled sync when Tally alter IDs are unchanged. */
      skipSyncWhenUnchanged: true,
      /** Parallel Tally fetches per entity type */
      syncConcurrency: 3,
      reports: {
        fullRefreshIntervalHours: 24,
        incrementalPeriods: ['this_month'],
        skipOutstandingOnIncremental: true,
        outstandingMinIntervalHours: 24
      },
      masterUploadBatchSize: 150,
      tallySyncTs: {
        paginatedMasters: true,
        paginatedVouchersFallback: true,
        recordsPerPage: 500
      }
    };
    
    this.logger = electronLog.scope('SyncManager');
    this.voucherSyncLog = getVoucherSyncLogger();
    this.dataDir = path.join(require('os').homedir(), '.finsync360-agent');
    
    // Services will be injected
    this.tallyService = null;
    this.webSocketClient = null;
    this.apiClient = null;
  }

  async initialize() {
    this.logger.info('Initializing Sync Manager...');
    
    try {
      // Ensure data directory exists
      await fs.ensureDir(this.dataDir);
      
      // Load configuration
      await this.loadConfig();
      
      // Load offline queue
      await this.loadOfflineQueue();
      
      // Load sync history
      await this.loadSyncHistory();

      // Load per-company sync state/cursors
      await this.loadSyncState();
      
      // Setup scheduled sync
      if (this.config.autoSync) {
        this.setupScheduledSync();
      }
      
      this.logger.info('Sync Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Sync Manager:', error);
      throw error;
    }
  }

  setServices(tallyService, webSocketClient, apiClient) {
    this.tallyService = tallyService;
    this.webSocketClient = webSocketClient;
    this.apiClient = apiClient;

    if (webSocketClient?.setRegisterPayloadProvider) {
      const { mapLicenseInfoForServer } = require('../utils/tallySyncTsExportMapper');
      webSocketClient.setRegisterPayloadProvider(async () => {
        if (!tallyService?.getLicenseInfo) return {};
        const info = await tallyService.getLicenseInfo();
        const tallyLicense = mapLicenseInfoForServer(info);
        return tallyLicense ? { tallyLicense } : {};
      });
    }

    // Setup event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for WebSocket connection changes
    this.webSocketClient.on('connected', () => {
      if (this.isSyncing) {
        return;
      }
      this.pruneStaleOfflineQueue();
      if (this.offlineQueue.length === 0) {
        return;
      }
      this.logger.info('WebSocket connected - processing offline queue', {
        pending: this.offlineQueue.length
      });
      this.processOfflineQueue().catch((err) =>
        this.logger.error('Offline queue flush failed', err)
      );
    });

    this.webSocketClient.on('disconnected', () => {
      this.logger.info('WebSocket disconnected - enabling offline mode');
      this.config.offlineMode = true;
    });

    // Listen for sync requests from server
    this.webSocketClient.on('sync-request', (data) => {
      this.handleSyncRequest(data);
    });

    this.webSocketClient.on('fetch-voucher-detail', (data) => {
      this.handleFetchVoucherDetail(data).catch((err) =>
        this.logger.error('fetch-voucher-detail failed', err)
      );
    });

    this.webSocketClient.on('import-voucher', (data) => {
      this.handleImportVoucher(data).catch((err) =>
        this.logger.error('import-voucher failed', err)
      );
    });

    this.webSocketClient.on('import-ledger', (data) => {
      this.handleImportLedger(data).catch((err) =>
        this.logger.error('import-ledger failed', err)
      );
    });

    this.webSocketClient.on('import-stock-item', (data) => {
      this.handleImportStockItem(data).catch((err) =>
        this.logger.error('import-stock-item failed', err)
      );
    });

    this.webSocketClient.on('agent-register-ack', (data) => {
      this.logger.info('Backend acknowledged agent registration', data || {});
    });

    this.webSocketClient.on('sync-data-ack', (data) => {
      this.logger.info('Backend acknowledged sync payload', data || {});
    });

    this.webSocketClient.on('sync-data-error', (data) => {
      this.logger.error('Backend reported sync payload failure', data || {});
    });

    // Listen for Tally connection changes
    this.tallyService.on('connectionStatusChanged', (isConnected) => {
      if (isConnected && this.config.autoSync) {
        this.logger.info('Tally connected - starting sync');
        this.startSync();
      }
    });
  }

  getReportPeriodKeysForSync(companyState = {}) {
    const {
      REPORT_PERIOD_KEYS,
      INCREMENTAL_REPORT_PERIOD_KEYS
    } = require('../utils/reportPeriods');

    const hours = Number(this.config?.reports?.fullRefreshIntervalHours) || 24;
    const incremental =
      Array.isArray(this.config?.reports?.incrementalPeriods) &&
      this.config.reports.incrementalPeriods.length > 0
        ? this.config.reports.incrementalPeriods
        : INCREMENTAL_REPORT_PERIOD_KEYS;

    const lastFull = companyState.lastFullReportsSyncAt
      ? new Date(companyState.lastFullReportsSyncAt).getTime()
      : 0;
    const stale = !lastFull || Date.now() - lastFull > hours * 60 * 60 * 1000;

    if (stale) {
      return { keys: REPORT_PERIOD_KEYS, mode: 'full' };
    }
    return { keys: incremental, mode: 'incremental' };
  }

  shouldSyncOutstandingReceivable(companyState, reportMode) {
    if (reportMode !== 'incremental') {
      return true;
    }
    if (this.config?.reports?.skipOutstandingOnIncremental === false) {
      return true;
    }
    const minHours = Number(this.config?.reports?.outstandingMinIntervalHours) || 24;
    const last = companyState.lastOutstandingSyncAt
      ? new Date(companyState.lastOutstandingSyncAt).getTime()
      : 0;
    return !last || Date.now() - last > minHours * 60 * 60 * 1000;
  }

  getMasterBatchSize(entityType) {
    const byType = {
      party: 100,
      item: 100,
      tally_account: 500,
      voucher_type: 400,
      godown: 400,
      unit: 400,
      gst_registration: 200
    };
    if (byType[entityType]) return byType[entityType];
    return Math.max(1, Number(this.config.masterUploadBatchSize) || 80);
  }

  buildMasterBatchPayloads(entityType, rows, companyName) {
    const companyId = this.resolveUploadCompanyId(companyName);
    const maxItems = this.getMasterBatchSize(entityType);
    const payloads = [];

    for (let i = 0; i < rows.length; i += maxItems) {
      const slice = rows.slice(i, i + maxItems);
      payloads.push({
        type: entityType,
        action: 'upsert',
        companyId,
        companyName,
        items: slice.map((row) => ({ ...row, companyName }))
      });
    }

    return payloads;
  }

  async syncMasterBatchToServer(entityType, rows, companyName) {
    if (!rows?.length) {
      return { processed: 0, failed: 0, errors: [] };
    }

    const batches = this.buildMasterBatchPayloads(entityType, rows, companyName);
    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const batch of batches) {
      if (!this.isRunning) break;
      try {
        const timeoutMs = entityType === 'party' ? 120000 : 90000;
        const ack = await this.pushSyncBatchPayload(batch, { timeoutMs });
        const ok = Number(ack?.processed ?? batch.items.length);
        processed += ok;
        failed += Math.max(0, batch.items.length - ok);
      } catch (error) {
        failed += batch.items.length;
        errors.push({ message: error.message });
        this.logger.error(`${entityType} batch upload failed`, {
          companyName,
          batchSize: batch.items.length,
          error: error.message
        });
      }
    }

    return { processed, failed, errors };
  }

  async syncReportsBatchToServer(reports, companyName) {
    if (!reports?.length) return { processed: 0, failed: 0 };

    const companyId = this.resolveUploadCompanyId(companyName);
    const batch = {
      type: 'report',
      action: 'upsert',
      companyId,
      companyName,
      items: reports.map((r) => ({ ...r, companyName }))
    };

    try {
      const ack = await this.pushSyncBatchPayload(batch, { timeoutMs: 120000 });
      const processed = Number(ack?.processed ?? reports.length);
      return { processed, failed: Math.max(0, reports.length - processed) };
    } catch (error) {
      this.logger.warn('Report batch failed — falling back to single uploads', {
        companyName,
        error: error.message
      });
      let processed = 0;
      let failed = 0;
      for (const report of reports) {
        try {
          await this.syncReportToServer(report, companyName);
          processed += 1;
        } catch (e) {
          failed += 1;
        }
      }
      return { processed, failed };
    }
  }

  getSyncConcurrency() {
    const n = Number(this.config?.syncConcurrency);
    return Math.min(12, Math.max(1, Number.isFinite(n) && n > 0 ? Math.floor(n) : 5));
  }

  /**
   * UI groups → internal flags (items, ledgers, etc.).
   */
  normalizeSyncTypes(raw = {}) {
    const legacyMasters =
      raw.items !== false ||
      raw.voucherTypes !== false ||
      raw.godowns !== false ||
      raw.units !== false;
    const legacyParties = raw.parties !== false || raw.ledgers !== false;

    const masters =
      raw.masters !== undefined ? raw.masters !== false : legacyMasters;
    const parties =
      raw.parties !== undefined ? raw.parties !== false : legacyParties;

    return {
      masters,
      parties,
      vouchers: raw.vouchers !== false,
      reports: raw.reports !== false,
      companies: raw.companies === true,
      gstRegistrations: raw.gstRegistrations !== false,
      items: masters,
      voucherTypes: masters,
      godowns: masters,
      units: masters,
      ledgers: parties
    };
  }

  /**
   * Pipeline: masters → parties (+ all ledgers) → vouchers → reports.
   */
  buildPhaseList() {
    const types = this.config.syncTypes;
    const order = ['companies', 'masters', 'gstRegistrations', 'parties', 'vouchers', 'reports'];
    return order.filter((k) => types[k]);
  }

  phaseLocalToOverall(phaseList, phaseKey, local01) {
    const idx = phaseList.indexOf(phaseKey);
    if (idx < 0 || !phaseList.length) return 0;
    const clamped = Math.max(0, Math.min(1, local01));
    return Math.min(100, Math.round(((idx + clamped) / phaseList.length) * 100));
  }

  voucherWindowDateFraction(range, windowEndIso) {
    const fromMs = new Date(`${range.fromDateIso}T00:00:00.000Z`).getTime();
    const toMs = new Date(`${range.toDateIso}T00:00:00.000Z`).getTime();
    const curMs = new Date(`${windowEndIso}T00:00:00.000Z`).getTime();
    const span = Math.max(1, toMs - fromMs);
    return Math.min(1, Math.max(0, (curMs - fromMs) / span));
  }

  emitPhaseProgress(syncSession, phaseKey, localWithinPhase01, payload = {}) {
    const phaseList = syncSession.phaseList || this.buildPhaseList();
    const progressPercent = this.phaseLocalToOverall(phaseList, phaseKey, localWithinPhase01);
    const phaseIndex = phaseList.indexOf(phaseKey);
    this.emitProgress(syncSession, {
      ...payload,
      phaseKey,
      phaseList,
      phaseIndex: phaseIndex >= 0 ? phaseIndex : 0,
      phaseCount: phaseList.length,
      progressPercent,
      type: phaseKey
    });
  }

  async mapPool(items, concurrency, iterator) {
    if (!Array.isArray(items) || items.length === 0) return;
    const limit = Math.min(concurrency, items.length);
    let nextIndex = 0;

    const worker = async () => {
      while (this.isRunning) {
        const i = nextIndex++;
        if (i >= items.length) break;
        await iterator(items[i], i);
      }
    };

    await Promise.all(Array.from({ length: limit }, () => worker()));
  }

  async loadConfig() {
    const Store = require('electron-store');
    const store = new Store();
    
    const defaults = this.config;
    const savedConfig = store.get('syncConfig', {});
    this.config = { ...defaults, ...savedConfig };
    // Saved configs persist the whole object, so nested defaults must be re-merged.
    this.config.vouchers = { ...defaults.vouchers, ...(savedConfig.vouchers || {}) };
    if (savedConfig.syncTypes) {
      this.config.syncTypes = this.normalizeSyncTypes({
        ...this.config.syncTypes,
        ...savedConfig.syncTypes
      });
    }

    // Migrate configs saved before the v2 performance defaults: stored values that still
    // match the old conservative defaults are upgraded; deliberate custom values are kept.
    if ((Number(savedConfig.syncPipelineVersion) || 1) < 2) {
      if (!savedConfig.voucherUploadBatchSize || Number(savedConfig.voucherUploadBatchSize) <= 40) {
        this.config.voucherUploadBatchSize = defaults.voucherUploadBatchSize;
      }
      const savedVouchers = savedConfig.vouchers || {};
      if (!savedVouchers.windowDaysMax || Number(savedVouchers.windowDaysMax) <= 7) {
        this.config.vouchers.windowDaysMax = defaults.vouchers.windowDaysMax;
        this.config.vouchers.windowDaysInitial = defaults.vouchers.windowDaysInitial;
      }
      this.config.syncPipelineVersion = 2;
      await this.saveConfig();
      this.logger.info('Migrated sync config to pipeline v2 performance defaults', {
        voucherUploadBatchSize: this.config.voucherUploadBatchSize,
        windowDaysInitial: this.config.vouchers.windowDaysInitial,
        windowDaysMax: this.config.vouchers.windowDaysMax
      });
    }

    this.logger.info('Sync configuration loaded', {
      syncTypes: this.config.syncTypes
    });
  }

  async saveConfig() {
    const Store = require('electron-store');
    const store = new Store();
    
    store.set('syncConfig', this.config);
    this.logger.info('Sync configuration saved');
  }

  async loadOfflineQueue() {
    const queueFile = path.join(this.dataDir, 'offline-queue.json');
    
    try {
      if (await fs.pathExists(queueFile)) {
        const data = await fs.readJson(queueFile);
        this.offlineQueue = Array.isArray(data) ? data : [];
        this.logger.info(`Loaded ${this.offlineQueue.length} items from offline queue`);
      }
    } catch (error) {
      this.logger.error('Failed to load offline queue:', error);
      this.offlineQueue = [];
    }
  }

  async saveOfflineQueue() {
    const queueFile = path.join(this.dataDir, 'offline-queue.json');
    
    try {
      await fs.writeJson(queueFile, this.offlineQueue);
    } catch (error) {
      this.logger.error('Failed to save offline queue:', error);
    }
  }

  scheduleOfflineQueueSave() {
    if (this.offlineQueueSaveTimer) {
      return;
    }

    this.offlineQueueSaveTimer = setTimeout(async () => {
      this.offlineQueueSaveTimer = null;
      await this.saveOfflineQueue();
    }, this.offlineQueueSaveDelayMs);
  }

  async flushOfflineQueueSave() {
    if (this.offlineQueueSaveTimer) {
      clearTimeout(this.offlineQueueSaveTimer);
      this.offlineQueueSaveTimer = null;
    }
    await this.saveOfflineQueue();
  }

  /**
   * Remove all pending WebSocket upload batches (stale retries after a successful sync).
   */
  async clearOfflineQueue() {
    const removed = this.offlineQueue.length;
    this.offlineQueue = [];
    await this.flushOfflineQueueSave();
    this.logger.info(`Cleared offline queue (${removed} batch(es) removed)`);
    this.emit('offline-queue-finished', { pending: 0, failed: 0, cleared: removed });
    return { success: true, removed };
  }

  async loadSyncHistory() {
    const historyFile = path.join(this.dataDir, 'sync-history.json');
    
    try {
      if (await fs.pathExists(historyFile)) {
        const data = await fs.readJson(historyFile);
        this.syncHistory = Array.isArray(data) ? data : [];
        this.logger.info(`Loaded ${this.syncHistory.length} sync history entries`);
      }
    } catch (error) {
      this.logger.error('Failed to load sync history:', error);
      this.syncHistory = [];
    }
  }

  async saveSyncHistory() {
    const historyFile = path.join(this.dataDir, 'sync-history.json');
    
    try {
      // Keep only the latest entries
      if (this.syncHistory.length > this.maxHistoryEntries) {
        this.syncHistory = this.syncHistory.slice(-this.maxHistoryEntries);
      }
      
      await fs.writeJson(historyFile, this.syncHistory);
    } catch (error) {
      this.logger.error('Failed to save sync history:', error);
    }
  }

  async loadSyncState() {
    const stateFile = path.join(this.dataDir, 'sync-state.json');

    try {
      if (await fs.pathExists(stateFile)) {
        const data = await fs.readJson(stateFile);
        if (data && typeof data === 'object') {
          this.syncState = {
            companies: data.companies && typeof data.companies === 'object' ? data.companies : {}
          };
        }
      }
    } catch (error) {
      this.logger.error('Failed to load sync state:', error);
      this.syncState = { companies: {} };
    }
  }

  async saveSyncState() {
    const stateFile = path.join(this.dataDir, 'sync-state.json');

    try {
      await fs.writeJson(stateFile, this.syncState, { spaces: 2 });
    } catch (error) {
      this.logger.error('Failed to save sync state:', error);
    }
  }

  async resetSyncState() {
    this.logger.info('Resetting voucher/report sync progress; keeping per-company sync start preferences');
    this.voucherSyncLog?.info('VOUCHER_SYNC_STATE_RESET', {
      message: 'Cursor cleared — next sync will run full historical voucher range from sync start date'
    });
    const companies = this.syncState?.companies && typeof this.syncState.companies === 'object'
      ? this.syncState.companies
      : {};
    const next = {};
    for (const [key, st] of Object.entries(companies)) {
      next[key] = {
        companyName: st.companyName || '',
        companyGuid: st.companyGuid || '',
        initialFullSyncCompleted: false,
        lastVoucherSyncDate: null,
        lastReportSyncDate: null,
        lastFullSyncCompletedAt: null,
        lastReportRunAt: null,
        lastFullReportsSyncAt: null,
        lastOutstandingSyncAt: null,
        lastVoucherAlterId: 0,
        lastTallyMastersAlterId: st.lastTallyMastersAlterId ?? 0,
        lastTallyVouchersAlterId: st.lastTallyVouchersAlterId ?? 0,
        voucherSyncCursorIso: null,
        preferredVoucherExport: null,
        lastRunAt: null,
        syncTimezone: st.syncTimezone,
        syncFromMonth: st.syncFromMonth,
        syncFromYear: st.syncFromYear,
        historicalSyncFromIso: st.historicalSyncFromIso
      };
    }
    this.syncState = { companies: next };
    await this.saveSyncState();
  }

  async removeCompanySyncState(tallyKey) {
    const key = String(tallyKey || '').trim().toLowerCase();
    if (!key || !this.syncState?.companies?.[key]) {
      return { success: true };
    }
    delete this.syncState.companies[key];
    await this.saveSyncState();
    return { success: true };
  }

  getCompanySyncKey(company) {
    return String(company?.guid || company?.name || '').trim().toLowerCase();
  }

  /**
   * Candidate identifiers for a company — GUID, name, and cloud company id (all lowercased).
   * The backend hydration can rewrite tallyGuid between logins (companyPath vs raw GUID vs
   * name), so the sync-state key drifts. Matching on ANY identifier keeps the saved
   * sync-from-date attached to the company instead of asking for it again every morning.
   */
  getCompanyIdentityKeys(company) {
    const keys = [];
    const push = (v) => {
      const s = String(v == null ? '' : v).trim().toLowerCase();
      if (s && !keys.includes(s)) keys.push(s);
    };
    push(company?.guid);
    push(company?.companyGuid);
    push(company?.name);
    push(company?.companyName);
    // Map a Tally company to its linked cloud id (and vice-versa) via config.linkedCompanies.
    const linked = Array.isArray(this.config.linkedCompanies) ? this.config.linkedCompanies : [];
    const guidL = String(company?.guid || '').trim().toLowerCase();
    const nameL = String(company?.name || '').trim().toLowerCase();
    const cloudL = String(company?.cloudCompanyId || '').trim().toLowerCase();
    for (const entry of linked) {
      const eGuid = String(entry?.tallyGuid || '').trim().toLowerCase();
      const eName = String(entry?.tallyName || '').trim().toLowerCase();
      const eCloud = String(entry?.cloudCompanyId || '').trim().toLowerCase();
      const matches =
        (guidL && (eGuid === guidL || eCloud === guidL)) ||
        (nameL && eName === nameL) ||
        (cloudL && eCloud === cloudL);
      if (matches) {
        push(entry?.tallyGuid);
        push(entry?.tallyName);
        push(entry?.cloudCompanyId);
      }
    }
    return keys;
  }

  /**
   * Find the existing sync-state entry for a company by ANY of its identifiers.
   * Returns { key, state } or null. Used so prefs survive identifier drift.
   */
  findCompanySyncStateEntry(company) {
    const candidates = this.getCompanyIdentityKeys(company);
    for (const key of candidates) {
      if (this.syncState.companies[key]) {
        return { key, state: this.syncState.companies[key] };
      }
    }
    return null;
  }

  getCompanySyncState(company) {
    const key = this.getCompanySyncKey(company);
    if (!key) {
      return {
        initialFullSyncCompleted: false,
        lastVoucherSyncDate: null
      };
    }

    // Reuse an existing entry stored under a drifted identifier, migrating it to the
    // current canonical key so all future lookups (and the UI preview) line up.
    const existing = this.findCompanySyncStateEntry(company);
    if (existing && existing.key !== key) {
      this.syncState.companies[key] = existing.state;
      delete this.syncState.companies[existing.key];
      this.logger.info('Migrated sync-state entry to current company key', {
        from: existing.key,
        to: key,
        companyName: company?.name || ''
      });
    }

    if (!this.syncState.companies[key]) {
      this.syncState.companies[key] = {
        companyName: company?.name || '',
        companyGuid: company?.guid || '',
        cloudCompanyId: this.resolveCloudCompanyIdForCompany(company) || '',
        initialFullSyncCompleted: false,
        lastVoucherSyncDate: null,
        lastReportSyncDate: null,
        lastFullSyncCompletedAt: null,
        lastReportRunAt: null,
        lastFullReportsSyncAt: null,
        lastOutstandingSyncAt: null,
        lastVoucherAlterId: 0,
        lastTallyMastersAlterId: 0,
        lastTallyVouchersAlterId: 0,
        voucherSyncCursorIso: null,
        preferredVoucherExport: null,
        lastRunAt: null,
        syncTimezone: null,
        syncFromMonth: null,
        syncFromYear: null,
        historicalSyncFromIso: null
      };
    } else {
      // Keep identifiers fresh so later drift still resolves to this entry.
      const st = this.syncState.companies[key];
      if (company?.name && !st.companyName) st.companyName = company.name;
      if (company?.guid && !st.companyGuid) st.companyGuid = company.guid;
      if (!st.cloudCompanyId) {
        const cloud = this.resolveCloudCompanyIdForCompany(company);
        if (cloud) st.cloudCompanyId = cloud;
      }
    }

    return this.syncState.companies[key];
  }

  /**
   * Tally company → linked cloud company id (for upload routing + stable identity).
   */
  resolveCloudCompanyIdForCompany(company) {
    const linked = Array.isArray(this.config.linkedCompanies) ? this.config.linkedCompanies : [];
    const guidL = String(company?.guid || '').trim().toLowerCase();
    const nameL = String(company?.name || '').trim().toLowerCase();
    for (const entry of linked) {
      const eGuid = String(entry?.tallyGuid || '').trim().toLowerCase();
      const eName = String(entry?.tallyName || '').trim().toLowerCase();
      if ((guidL && eGuid === guidL) || (nameL && eName === nameL)) {
        if (entry?.cloudCompanyId) return String(entry.cloudCompanyId);
      }
    }
    return '';
  }

  /**
   * Read Tally alter IDs and compare with last stored values (tally-sync-ts).
   */
  async evaluateTallyAlterIds(company) {
    const state = this.getCompanySyncState(company);
    const current = await this.tallyService.getLastAlterIds(company.name);
    const mastersLastId = Number(current.mastersLastId) || 0;
    const vouchersLastId = Number(current.vouchersLastId) || 0;
    const storedMasters = Number(state.lastTallyMastersAlterId) || 0;
    const storedVouchers = Number(state.lastTallyVouchersAlterId) || 0;

    const hasBaseline =
      state.initialFullSyncCompleted &&
      (storedMasters > 0 || storedVouchers > 0);
    const unchanged =
      hasBaseline &&
      mastersLastId === storedMasters &&
      vouchersLastId === storedVouchers;

    return {
      company,
      current: { mastersLastId, vouchersLastId },
      stored: { mastersLastId: storedMasters, vouchersLastId: storedVouchers },
      unchanged
    };
  }

  persistTallyAlterIds(company, alterIds) {
    if (!company || !alterIds) return;
    const state = this.getCompanySyncState(company);
    state.lastTallyMastersAlterId = Number(alterIds.mastersLastId) || 0;
    state.lastTallyVouchersAlterId = Number(alterIds.vouchersLastId) || 0;
    state.lastRunAt = new Date().toISOString();
  }

  async persistAlterIdsForCompanies(companies, evaluations = []) {
    for (const company of companies) {
      const match = evaluations.find(
        (e) => this.getCompanySyncKey(e.company) === this.getCompanySyncKey(company)
      );
      const ids = match?.current || (await this.tallyService.getLastAlterIds(company.name));
      this.persistTallyAlterIds(company, ids);
    }
    await this.saveSyncState();
  }

  /**
   * For scheduled sync: skip heavy master/party/voucher pulls when Tally reports no changes.
   */
  async applyScheduledAlterIdSkip(options = {}) {
    if (options.trigger !== 'scheduled' || this.config.skipSyncWhenUnchanged === false) {
      return { skipped: false, evaluations: [] };
    }

    let allCompanies = [];
    try {
      allCompanies = await this.tallyService.getCompanies();
    } catch (error) {
      this.logger.warn('Could not load companies for alter-ID check', error);
      return { skipped: false, evaluations: [] };
    }

    const companies = this.getSelectedCompanies(allCompanies);
    if (!companies.length) {
      return { skipped: false, evaluations: [] };
    }

    const evaluations = [];
    for (const company of companies) {
      try {
        evaluations.push(await this.evaluateTallyAlterIds(company));
      } catch (error) {
        this.logger.warn('Alter-ID check failed', {
          company: company.name,
          error: error.message
        });
        evaluations.push({ company, unchanged: false });
      }
    }

    const allUnchanged =
      evaluations.length > 0 && evaluations.every((e) => e.unchanged);

    if (allUnchanged) {
      this.logger.info(
        'Scheduled sync: Tally alter IDs unchanged — skipping masters, parties, vouchers, GST'
      );
      const saved = { ...this.config.syncTypes };
      this.config.syncTypes = {
        ...saved,
        masters: false,
        parties: false,
        vouchers: false,
        gstRegistrations: false
      };
      return { skipped: true, evaluations, savedSyncTypes: saved };
    }

    return { skipped: false, evaluations };
  }

  /**
   * Normalize month/year from desktop UI (month 1–12).
   */
  normalizeSyncPreferencesMonthYear(month, year) {
    const m = Number(month);
    const y = Number(year);
    if (!Number.isFinite(m) || m < 1 || m > 12) return null;
    if (!Number.isFinite(y) || y < 1990 || y > 2100) return null;
    const mm = String(m).padStart(2, '0');
    return { month: m, year: y, iso: `${y}-${mm}-01` };
  }

  /**
   * Persist per-company sync preferences (timezone + historical start month/year).
   */
  async setCompanySyncPreferences(payload) {
    const { tallyGuid, tallyName, timezone, year, month } = payload || {};
    const stub = { guid: tallyGuid, name: tallyName };
    const key = this.getCompanySyncKey(stub);
    if (!key) {
      return { success: false, message: 'Missing company name or GUID' };
    }
    const norm = this.normalizeSyncPreferencesMonthYear(month, year);
    if (!norm) {
      return { success: false, message: 'Invalid sync start month or year' };
    }
    // getCompanySyncState migrates any drifted entry onto the canonical key first,
    // so re-saving the date does not strand the previously stored preferences.
    const state = this.getCompanySyncState(stub);
    const alreadySet =
      Number(state.syncFromMonth) === norm.month &&
      Number(state.syncFromYear) === norm.year;
    state.syncTimezone =
      typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'Asia/Kolkata';
    state.syncFromMonth = norm.month;
    state.syncFromYear = norm.year;
    state.historicalSyncFromIso = norm.iso;
    // Only reset full-sync progress when the start date actually CHANGED. Re-saving the
    // same date (e.g. the UI re-submitting on every login) must not wipe sync progress.
    if (!alreadySet) {
      state.initialFullSyncCompleted = false;
      state.lastVoucherSyncDate = null;
      state.lastVoucherAlterId = 0;
      state.voucherSyncCursorIso = null;
    }
    if (tallyName) state.companyName = String(tallyName);
    if (tallyGuid != null && String(tallyGuid).trim()) state.companyGuid = String(tallyGuid).trim();
    const cloud = this.resolveCloudCompanyIdForCompany(stub) || payload?.cloudCompanyId;
    if (cloud && !state.cloudCompanyId) state.cloudCompanyId = String(cloud);

    await this.saveSyncState();
    return { success: true, historicalSyncFromIso: norm.iso };
  }

  getResolvedHistoricalFromIso(company, companyState) {
    const prefs = companyState || this.getCompanySyncState(company);
    if (prefs?.syncFromMonth != null && prefs?.syncFromYear != null) {
      const norm = this.normalizeSyncPreferencesMonthYear(prefs.syncFromMonth, prefs.syncFromYear);
      if (norm) return norm.iso;
    }
    return null;
  }

  /**
   * Full voucher sync "from" date: user-chosen first-of-month, else Tally booksFrom, with max-years cap
   * only when user did not explicitly pick a start month/year.
   */
  resolveFullSyncFromDateIso(company, companyState) {
    const today = new Date();
    const fallback = '2000-01-01';
    const userFrom = this.getResolvedHistoricalFromIso(company, companyState);
    let fromIso =
      userFrom ||
      (company?.booksFrom && /^\d{4}-\d{2}-\d{2}$/.test(company.booksFrom)
        ? company.booksFrom
        : fallback);

    if (!userFrom) {
      const maxYears = Math.max(1, Number(this.config.vouchers?.fullSyncMaxYears) || 5);
      const capFromIso = this.formatDateIso(this.addDays(today, -(maxYears * 365)));
      if (fromIso < capFromIso) {
        fromIso = capFromIso;
      }
    }

    const booksFrom =
      company?.booksFrom && /^\d{4}-\d{2}-\d{2}$/.test(company.booksFrom)
        ? company.booksFrom
        : null;
    if (userFrom && booksFrom && userFrom < booksFrom) {
      this.logger.warn('Sync start is before Tally Books From — older vouchers may not exist in Tally', {
        companyName: company?.name,
        userFrom,
        booksFrom
      });
    }

    return fromIso;
  }

  previewRowMatchesCompany(previewRow, company) {
    const g = String(company?.guid || '').trim().toLowerCase();
    const n = String(company?.name || '').trim().toLowerCase();
    const pg = String(previewRow?.tallyGuid || '').trim().toLowerCase();
    const pn = String(previewRow?.tallyName || '').trim().toLowerCase();
    return (g && pg && g === pg) || (n && pn && n === pn);
  }

  /**
   * Linked companies + saved prefs for desktop UI (Add Company, Sync now, etc.).
   */
  getLinkedCompaniesSyncPreview(appConfig) {
    const linked = Array.isArray(appConfig?.server?.linkedCompanies)
      ? appConfig.server.linkedCompanies
      : [];
    return linked.map((entry) => {
      const stub = {
        guid: entry.tallyGuid,
        name: entry.tallyName,
        cloudCompanyId: entry.cloudCompanyId
      };
      // Match prefs by ANY identifier so a hydrated/drifted tallyGuid still finds the
      // saved sync-from-date (otherwise the UI keeps demanding it every login).
      const found = this.findCompanySyncStateEntry(stub);
      const st = found?.state || null;
      const hasCompletePrefs = !!(
        st?.syncFromMonth &&
        st?.syncFromYear &&
        st?.syncTimezone
      );
      return {
        tallyGuid: entry.tallyGuid,
        tallyName: entry.tallyName,
        cloudCompanyId: entry.cloudCompanyId,
        syncTimezone: st?.syncTimezone ?? null,
        syncFromMonth: st?.syncFromMonth ?? null,
        syncFromYear: st?.syncFromYear ?? null,
        historicalSyncFromIso: st?.historicalSyncFromIso ?? null,
        initialFullSyncCompleted: st?.initialFullSyncCompleted ?? false,
        hasCompletePrefs
      };
    });
  }

  /**
   * Sync preview scoped to companies currently open in Tally that are also linked.
   * Used by Start Sync validation so a closed linked company does not block sync.
   */
  async getOpenLinkedCompaniesSyncPreview(appConfig) {
    const fullPreview = this.getLinkedCompaniesSyncPreview(appConfig);
    let allCompanies = [];
    try {
      allCompanies = await this.tallyService.getCompanies();
    } catch (error) {
      this.logger.warn('Could not load Tally companies for open sync preview', error);
      return fullPreview;
    }

    const openLinked = this.getSelectedCompanies(allCompanies);
    if (!openLinked.length) {
      return [];
    }

    return fullPreview.filter((row) =>
      openLinked.some((company) => this.previewRowMatchesCompany(row, company))
    );
  }

  getVoucherWindowConfig() {
    const v = this.config.vouchers || {};
    /**
     * Tally can cap rows per export, but getVouchersCustomColWithSplit recursively splits
     * windows that hit voucherSplitThreshold or maxVoucherResponseBytes — so wide windows
     * are safe and dramatically cut request count for sparse history.
     */
    const max = Math.min(60, Math.max(3, Number(v.windowDaysMax) || 30));
    const initial = Math.min(max, Math.max(3, Number(v.windowDaysInitial) || 15));
    return {
      initial,
      max,
      min: Math.max(1, Math.min(initial, Number(v.windowDaysMin) || 7))
    };
  }

  /**
   * Rough ETA for UI/logging (Tally + upload per date window).
   */
  estimateVoucherSyncDuration(range) {
    const fromMs = new Date(`${range.fromDateIso}T00:00:00.000Z`).getTime();
    const toMs = new Date(`${range.toDateIso}T00:00:00.000Z`).getTime();
    const days = Math.max(1, Math.ceil((toMs - fromMs) / 86400000) + 1);
    const { initial } = this.getVoucherWindowConfig();
    const windows = Math.max(1, Math.ceil(days / initial));
    const secPerWindow =
      range.mode === 'incremental'
        ? 12
        : Math.max(15, Number(this.config.vouchers?.secPerWindowEstimate) || 35);
    const estimatedSeconds = windows * secPerWindow;
    return {
      days,
      windows,
      estimatedMinutes: Math.max(1, Math.ceil(estimatedSeconds / 60)),
      mode: range.mode
    };
  }

  addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  formatDateIso(date) {
    return date.toISOString().split('T')[0];
  }

  isTimeoutError(error) {
    if (!error) return false;
    return error.code === 'ETIMEDOUT' || /timed out/i.test(String(error.message || ''));
  }

  getOutstandingReceivableDateRange(company) {
    const today = new Date();
    const toDateIso = this.formatDateIso(today);
    const companyState = this.getCompanySyncState(company);
    const fromDateIso = this.resolveFullSyncFromDateIso(company, companyState);
    return { fromDateIso, toDateIso };
  }

  getVoucherSyncRange(company, companyState) {
    const today = new Date();
    const toDateIso = this.formatDateIso(today);

    // One-time full sync: from user-chosen month/year (first of month), else Books From, with max-years cap.
    if (!companyState.initialFullSyncCompleted) {
      const userFrom = this.getResolvedHistoricalFromIso(company, companyState);
      const rawBooks =
        company?.booksFrom && /^\d{4}-\d{2}-\d{2}$/.test(company.booksFrom)
          ? company.booksFrom
          : '2000-01-01';
      const uncappedPreferred = userFrom || rawBooks;
      let fromDateIso = this.resolveFullSyncFromDateIso(company, companyState);
      const resumeCursor = companyState.voucherSyncCursorIso;
      if (resumeCursor && /^\d{4}-\d{2}-\d{2}$/.test(resumeCursor) && resumeCursor > fromDateIso && resumeCursor <= toDateIso) {
        fromDateIso = resumeCursor;
        this.logger.info('Resuming full voucher sync from saved cursor', {
          companyName: company?.name,
          voucherSyncCursorIso: resumeCursor
        });
      }
      const maxYears = Math.max(1, Number(this.config.vouchers?.fullSyncMaxYears) || 5);
      const capFromIso = this.formatDateIso(this.addDays(today, -(maxYears * 365)));
      const cappedToMaxYears = uncappedPreferred < capFromIso;

      this.logger.info('Planning full voucher sync', {
        companyName: company?.name,
        userHistoricalFrom: userFrom,
        booksFromTally: company?.booksFrom,
        effectiveFromIso: fromDateIso,
        toDateIso,
        cappedToMaxYears: !userFrom && uncappedPreferred < capFromIso,
        maxYears: userFrom ? null : maxYears
      });
      return {
        mode: 'full',
        fromDateIso,
        toDateIso
      };
    }

    // Incremental/partial sync after initial full sync.
    // Keep a small overlap (2 days) to avoid missing late edits in Tally.
    const lastSynced = companyState.lastVoucherSyncDate && /^\d{4}-\d{2}-\d{2}$/.test(companyState.lastVoucherSyncDate)
      ? new Date(`${companyState.lastVoucherSyncDate}T00:00:00.000Z`)
      : null;
    const fallbackDays = Number(this.config?.dateRange?.vouchers || 30);

    let fromDate;
    if (lastSynced) {
      fromDate = this.addDays(lastSynced, -2);
    } else {
      fromDate = this.addDays(today, -Math.max(1, fallbackDays));
    }

    this.logger.info('Planning incremental voucher sync', {
      companyName: company?.name,
      lastVoucherSyncDate: companyState.lastVoucherSyncDate,
      fromDate: this.formatDateIso(fromDate),
      toDate: toDateIso
    });

    return {
      mode: 'incremental',
      fromDateIso: this.formatDateIso(fromDate),
      toDateIso
    };
  }

  async fetchVouchersInChunks(companyName, fromDateIso, toDateIso) {
    const results = [];
    const minWindowDays = 1;
    let windowDays = 45;
    const toDate = new Date(`${toDateIso}T00:00:00.000Z`);
    let cursor = new Date(`${fromDateIso}T00:00:00.000Z`);
    const maxWindowRetries = Math.max(1, Number(this.config.maxWindowRetries) || 3);
    const windowRetryDelayMs = Number(this.config.windowRetryDelayMs) || 2000;

    while (cursor <= toDate) {
      let windowDone = false;
      let attempt = 0;

      while (!windowDone && attempt < maxWindowRetries) {
        const windowStart = new Date(cursor);
        const windowEnd = this.addDays(windowStart, windowDays - 1) < toDate
          ? this.addDays(windowStart, windowDays - 1)
          : new Date(toDate);
        const windowStartIso = this.formatDateIso(windowStart);
        const windowEndIso = this.formatDateIso(windowEnd);

        attempt += 1;
        try {
          const fetchResult = await this.tallyService.getVouchers(companyName, windowStartIso, windowEndIso);
          const vouchers = fetchResult.vouchers || [];
          results.push(...vouchers);

          if (windowDays < 90) {
            windowDays = Math.min(90, windowDays + 10);
          }
          cursor = this.addDays(windowEnd, 1);
          windowDone = true;
        } catch (error) {
          if (this.isTimeoutError(error) && windowDays > minWindowDays) {
            windowDays = Math.max(minWindowDays, Math.floor(windowDays / 2));
            await new Promise((r) => setTimeout(r, windowRetryDelayMs * attempt));
            continue;
          }
          if (attempt < maxWindowRetries) {
            await new Promise((r) => setTimeout(r, windowRetryDelayMs * attempt));
            continue;
          }
          throw error;
        }
      }
    }

    return results;
  }

  async processVouchersInChunks(companyName, fromDateIso, toDateIso, onChunk, options = {}) {
    const winCfg = this.getVoucherWindowConfig();
    const minWindowDays = winCfg.min;
    const maxWindowDays = winCfg.max;
    let windowDays = winCfg.initial;
    const toDate = new Date(`${toDateIso}T00:00:00.000Z`);
    const maxWindowRetries = Math.max(1, Number(this.config.maxWindowRetries) || 3);
    const windowRetryDelayMs = Number(this.config.windowRetryDelayMs) || 2000;
    const failedWindows = [];
    let consecutiveEmptyWindows = 0;
    const preferredExport = options.preferredVoucherExport || null;
    const prefetchEnabled = this.config.vouchers?.prefetchNextWindow !== false;

    /**
     * Fetch one window with shrink-on-timeout retries. Window span is decided here so the
     * adaptive windowDays state stays consistent; only one fetch runs at a time, but it may
     * overlap with the previous window's upload (Tally is localhost, upload is the WAN).
     */
    const fetchWindow = async (windowStartDate) => {
      let fetchAttempt = 0;
      for (;;) {
        const windowStart = new Date(windowStartDate);
        const windowEnd = this.addDays(windowStart, windowDays - 1) < toDate
          ? this.addDays(windowStart, windowDays - 1)
          : new Date(toDate);
        const windowStartIso = this.formatDateIso(windowStart);
        const windowEndIso = this.formatDateIso(windowEnd);

        fetchAttempt += 1;
        this.voucherSyncLog.info('VOUCHER_WINDOW_FETCH_START', {
          companyName,
          windowStartIso,
          windowEndIso,
          windowDays,
          attempt: fetchAttempt,
          maxAttempts: maxWindowRetries,
          detailLevel: options.detailLevel || 'summary'
        });
        try {
          const fetchResult = await this.tallyService.getVouchers(companyName, windowStartIso, windowEndIso, {
            preferredMethod: preferredExport,
            voucherSplitThreshold: Number(this.config.vouchers?.voucherSplitThreshold) || 150,
            maxVoucherResponseBytes: Number(this.config.vouchers?.maxVoucherResponseBytes) || 15_000_000,
            detailLevel: options.detailLevel || 'summary'
          });
          let vouchers = fetchResult.vouchers || [];
          const companyState = options.companyState;
          const rangeMode = options.rangeMode || 'full';
          if (companyState && rangeMode === 'incremental') {
            const watermark = Number(companyState.lastVoucherAlterId) || 0;
            if (watermark > 0) {
              const before = vouchers.length;
              vouchers = vouchers.filter((v) => {
                const aid = Number(v.alterId) || 0;
                return aid > watermark;
              });
              if (before !== vouchers.length) {
                this.logger.info('ALTERID incremental filter', {
                  companyName,
                  watermark,
                  before,
                  after: vouchers.length
                });
              }
            }
          }
          if (companyState && vouchers.length > 0) {
            let maxAlter = Number(companyState.lastVoucherAlterId) || 0;
            for (const v of vouchers) {
              const a = Number(v.alterId) || 0;
              if (a > maxAlter) maxAlter = a;
            }
            companyState.lastVoucherAlterId = maxAlter;
          }
          if (fetchResult.exportMethod && options.onExportMethod) {
            options.onExportMethod(fetchResult.exportMethod);
          }

          this.voucherSyncLog.info('VOUCHER_WINDOW_FETCH_RESULT', {
            companyName,
            windowStartIso,
            windowEndIso,
            count: vouchers.length,
            exportMethod: fetchResult.exportMethod || preferredExport,
            attempt: fetchAttempt,
            rangeMode: options.rangeMode || 'full',
            alterIdWatermark:
              options.companyState && options.rangeMode === 'incremental'
                ? Number(options.companyState.lastVoucherAlterId) || 0
                : null
          });
          this.logger.info('Fetched voucher window from Tally', {
            companyName,
            windowStartIso,
            windowEndIso,
            count: vouchers.length,
            exportMethod: fetchResult.exportMethod || preferredExport,
            attempt: fetchAttempt
          });

          if (vouchers.length === 0) {
            consecutiveEmptyWindows += 1;
            if (consecutiveEmptyWindows >= 2 && windowDays < maxWindowDays) {
              windowDays = Math.min(maxWindowDays, windowDays * 2);
              this.logger.info('Empty voucher windows — widening next fetch window', {
                companyName,
                nextWindowDays: windowDays
              });
              consecutiveEmptyWindows = 0;
            }
          } else {
            consecutiveEmptyWindows = 0;
            if (windowDays < maxWindowDays) {
              windowDays = Math.min(maxWindowDays, windowDays + 15);
            }
          }

          return { vouchers, windowStartIso, windowEndIso, windowEnd };
        } catch (error) {
          this.voucherSyncLog.warn('VOUCHER_WINDOW_FETCH_ERROR', {
            companyName,
            windowStartIso,
            windowEndIso,
            attempt: fetchAttempt,
            maxAttempts: maxWindowRetries,
            windowDays,
            message: error.message,
            stack: error.stack || null,
            code: error.code || null
          });
          if (this.isTimeoutError(error) && windowDays > minWindowDays && fetchAttempt < maxWindowRetries) {
            const nextWindow = Math.max(minWindowDays, Math.floor(windowDays / 2));
            this.voucherSyncLog.warn('VOUCHER_WINDOW_TIMEOUT_SHRINK', {
              companyName,
              windowStartIso,
              windowEndIso,
              currentWindowDays: windowDays,
              nextWindowDays: nextWindow,
              attempt: fetchAttempt
            });
            this.logger.warn('Voucher window timed out — shrinking window and retrying', {
              companyName,
              windowStart: windowStartIso,
              windowEnd: windowEndIso,
              currentWindowDays: windowDays,
              nextWindowDays: nextWindow,
              attempt: fetchAttempt
            });
            windowDays = nextWindow;
            await new Promise((r) => setTimeout(r, windowRetryDelayMs * fetchAttempt));
            continue;
          }

          if (fetchAttempt < maxWindowRetries) {
            this.logger.warn('Voucher fetch failed — retrying', {
              companyName,
              windowStartIso,
              windowEndIso,
              attempt: fetchAttempt,
              message: error.message
            });
            await new Promise((r) => setTimeout(r, windowRetryDelayMs * fetchAttempt));
            continue;
          }

          failedWindows.push({
            windowStartIso,
            windowEndIso,
            error: error.message
          });
          this.voucherSyncLog.error('VOUCHER_WINDOW_FETCH_FAILED', {
            companyName,
            windowStartIso,
            windowEndIso,
            attempts: maxWindowRetries,
            message: error.message,
            stack: error.stack || null
          });
          throw new Error(
            `Voucher fetch failed for ${windowStartIso} → ${windowEndIso} after ${maxWindowRetries} attempts: ${error.message}`
          );
        }
      }
    };

    let cursor = new Date(`${fromDateIso}T00:00:00.000Z`);
    let pendingFetch = null;

    while (pendingFetch || cursor <= toDate) {
      const current = pendingFetch ? await pendingFetch : await fetchWindow(cursor);
      pendingFetch = null;

      // Start pulling the next window from Tally while this one uploads.
      const nextCursor = this.addDays(current.windowEnd, 1);
      if (prefetchEnabled && nextCursor <= toDate && this.isRunning) {
        pendingFetch = fetchWindow(nextCursor);
        pendingFetch.catch(() => {}); // surfaced when awaited at the top of the loop
      }

      const { vouchers, windowStartIso, windowEndIso } = current;
      let uploadDone = false;
      let uploadAttempt = 0;
      while (!uploadDone && uploadAttempt < maxWindowRetries) {
        uploadAttempt += 1;
        try {
          await onChunk(vouchers, { windowStartIso, windowEndIso });
          uploadDone = true;
        } catch (error) {
          this.voucherSyncLog.warn('VOUCHER_WINDOW_UPLOAD_ERROR', {
            companyName,
            windowStartIso,
            windowEndIso,
            attempt: uploadAttempt,
            maxAttempts: maxWindowRetries,
            count: vouchers.length,
            message: error.message,
            stack: error.stack || null
          });
          if (this.isRetryableSyncTransportError(error) && uploadAttempt < maxWindowRetries) {
            this.voucherSyncLog.info('VOUCHER_WINDOW_UPLOAD_RETRY', {
              companyName,
              windowStartIso,
              windowEndIso,
              attempt: uploadAttempt + 1,
              maxAttempts: maxWindowRetries
            });
            await new Promise((r) => setTimeout(r, windowRetryDelayMs * uploadAttempt));
            await this.webSocketClient?.ensureConnected().catch(() => {});
            continue;
          }

          failedWindows.push({
            windowStartIso,
            windowEndIso,
            error: error.message
          });
          this.voucherSyncLog.error('VOUCHER_WINDOW_UPLOAD_FAILED', {
            companyName,
            windowStartIso,
            windowEndIso,
            attempts: maxWindowRetries,
            message: error.message,
            stack: error.stack || null
          });
          // Drain the in-flight prefetch so its rejection (if any) is not unhandled.
          if (pendingFetch) {
            await pendingFetch.then(() => {}, () => {});
          }
          throw new Error(
            `Voucher upload failed for ${windowStartIso} → ${windowEndIso} after ${maxWindowRetries} attempts: ${error.message}`
          );
        }
      }

      cursor = nextCursor;
    }

    return { failedWindows };
  }

  emitProgress(syncSession, payload) {
    const now = Date.now();
    if (now - this.lastProgressEmitAt < this.progressEmitIntervalMs && !payload.force) {
      return;
    }
    this.lastProgressEmitAt = now;

    const phaseList = syncSession.phaseList || this.buildPhaseList();
    const progressPercent =
      typeof payload.progressPercent === 'number'
        ? Math.min(100, Math.max(0, Math.round(payload.progressPercent)))
        : null;

    let total = Math.max(syncSession.totalItems, syncSession.processedItems);
    if (!payload.force && total === syncSession.processedItems) {
      total = syncSession.processedItems + 1;
    }

    const legacyPercent =
      syncSession.totalItems > 0
        ? Math.round((syncSession.processedItems / Math.max(syncSession.totalItems, 1)) * 100)
        : 0;

    const resolvedPercent = progressPercent != null ? progressPercent : legacyPercent;

    this.emit('sync-progress', {
      ...payload,
      sessionId: syncSession.id,
      currentStage: payload.type || syncSession.currentStage || payload.currentStage || null,
      processed: syncSession.processedItems,
      total,
      progressPercent: resolvedPercent,
      phaseKey: payload.phaseKey || null,
      phaseList
    });
  }

  setupScheduledSync() {
    if (this.syncJobs.has('scheduled')) {
      this.syncJobs.get('scheduled').destroy();
    }

    const job = cron.schedule(this.config.syncInterval, () => {
      if (!this.isSyncing && this.tallyService.isConnected) {
        this.logger.info('Starting scheduled sync');
        this.startSync({ trigger: 'scheduled' });
      }
    }, {
      scheduled: false
    });

    this.syncJobs.set('scheduled', job);
    job.start();
    
    this.logger.info(`Scheduled sync configured: ${this.config.syncInterval}`);
  }

  async startSync(options = {}) {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress');
      return false;
    }

    const trigger = options.trigger || 'manual';
    const wsCompanyId = String(this.webSocketClient?.config?.companyId || '').trim();
    const linkedCompanies = Array.isArray(this.config.linkedCompanies)
      ? this.config.linkedCompanies.filter((entry) => entry?.cloudCompanyId)
      : [];

    if (!wsCompanyId && linkedCompanies.length === 0) {
      this.logger.warn(
        'Cannot start sync: no company linked yet. Add a Tally company from the Add Company page.'
      );
      return false;
    }

    if (!this.webSocketClient?.isConnected) {
      this.logger.warn('Cannot start sync because server connection is not active');
      return false;
    }

    this.isSyncing = true;
    this.isRunning = true;
    
    const syncSession = {
      id: this.generateSyncId(),
      trigger,
      startTime: new Date(),
      endTime: null,
      status: 'running',
      currentStage: null,
      totalItems: 0,
      processedItems: 0,
      errors: [],
      summary: {},
      phaseList: this.buildPhaseList()
    };

    this.config.syncTypes = this.normalizeSyncTypes(this.config.syncTypes);

    let alterIdContext = { evaluations: [], savedSyncTypes: null };
    try {
      alterIdContext = await this.applyScheduledAlterIdSkip({ trigger });
      if (alterIdContext.skipped) {
        syncSession.phaseList = this.buildPhaseList();
      }
    } catch (alterErr) {
      this.logger.warn('Alter-ID skip check failed; running full sync', alterErr);
    }

    this.logger.info(`Starting sync session: ${syncSession.id}`, { trigger });
    this.logger.info('Sync types enabled', { syncTypes: this.config.syncTypes, phaseList: syncSession.phaseList });
    this.lastProgressEmitAt = 0;
    this.emit('sync-started', syncSession);

    let syncCompaniesForAlterIds = [];

    try {
      // Sync companies first (optional; usually disabled)
      if (this.config.syncTypes.companies) {
        await this.syncCompanies(syncSession);
      }

      if (this.config.syncTypes.masters) {
        await this.syncMasters(syncSession);
      }

      if (this.config.syncTypes.gstRegistrations) {
        await this.syncGstRegistrations(syncSession);
      }

      if (this.config.syncTypes.parties) {
        await this.syncPartiesAndLedgers(syncSession);
      }

      if (this.config.syncTypes.vouchers) {
        await this.syncVouchers(syncSession);
      }

      if (this.config.syncTypes.reports) {
        await this.syncReports(syncSession);
      }

      try {
        const allCompanies = await this.tallyService.getCompanies();
        syncCompaniesForAlterIds = this.getSelectedCompanies(allCompanies);
        await this.persistAlterIdsForCompanies(
          syncCompaniesForAlterIds,
          alterIdContext.evaluations || []
        );
      } catch (persistErr) {
        this.logger.warn('Failed to persist Tally alter IDs after sync', persistErr);
      }

      const hasSessionErrors = (syncSession.errors || []).length > 0;
      const voucherIncomplete = syncSession.voucherPhaseIncomplete === true;
      syncSession.status = hasSessionErrors || voucherIncomplete ? 'partial' : 'completed';
      syncSession.endTime = new Date();
      this.emitProgress(syncSession, {
        type: 'done',
        currentOperation:
          syncSession.status === 'partial'
            ? 'Sync finished with errors — voucher sync may be incomplete'
            : 'Sync finished',
        progressPercent: 100,
        force: true
      });
      
      this.logger.info(`Sync session ${syncSession.status}: ${syncSession.id}`);
      this.emit('sync-completed', syncSession);

    } catch (error) {
      syncSession.status = 'failed';
      syncSession.endTime = new Date();
      syncSession.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date()
      });

      this.logger.error(`Sync session failed: ${syncSession.id}`, error);
      this.emit('sync-failed', syncSession);
    } finally {
      if (alterIdContext.savedSyncTypes) {
        this.config.syncTypes = this.normalizeSyncTypes(alterIdContext.savedSyncTypes);
      }
      this.isSyncing = false;
      
      // Add to history
      this.syncHistory.push(syncSession);
      await this.saveSyncHistory();

      this.pruneStaleOfflineQueue(syncSession);
      if (
        this.offlineQueue.length > 0 &&
        this.webSocketClient?.isConnected &&
        !this.isSyncing
      ) {
        this.processOfflineQueue().catch((err) =>
          this.logger.error('Post-sync offline queue flush failed', err)
        );
      }
    }

    return true;
  }

  async stopSync() {
    if (!this.isSyncing) {
      return;
    }

    this.isRunning = false;
    this.logger.info('Stopping sync...');

    if (this.webSocketClient?.rejectAllPendingSyncAcks) {
      try {
        this.webSocketClient.rejectAllPendingSyncAcks(new Error('Sync stopped'));
      } catch (e) {
        this.logger.warn('Error clearing pending sync acks', e);
      }
    }
    
    // Wait for current operations to complete
    while (this.isSyncing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.info('Sync stopped');
  }

  async forceSync() {
    this.logger.info('Force sync requested');
    return this.startSync({ trigger: 'manual', force: true });
  }

  /**
   * Pull GST registrations from Tally via tally-sync-ts and upload to MongoDB.
   */
  async syncGstRegistrations(syncSession) {
    const { mapGstRegistrationRow } = require('../utils/tallySyncTsExportMapper');
    this.logger.info('Syncing GST registrations from Tally (tally-sync-ts)...');
    syncSession.currentStage = 'gstRegistrations';

    const allCompanies = await this.tallyService.getCompanies();
    const companies = this.getSelectedCompanies(allCompanies);
    let total = 0;
    let processed = 0;
    let errorCount = 0;

    this.emitPhaseProgress(syncSession, 'gstRegistrations', 0, {
      currentOperation: 'Fetching GST registrations',
      force: true
    });

    for (let ci = 0; ci < companies.length; ci++) {
      const company = companies[ci];
      if (!this.isRunning) break;

      try {
        const raw = await this.tallyService.getGSTRegistrations(company.name);
        const rows = raw.map(mapGstRegistrationRow).filter(Boolean);
        total += rows.length;

        if (rows.length > 0) {
          const batchResult = await this.syncMasterBatchToServer(
            'gst_registration',
            rows,
            company.name
          );
          processed += batchResult.processed;
          errorCount += batchResult.failed;
          for (const rowErr of batchResult.errors || []) {
            syncSession.errors.push({
              type: 'gstRegistrations',
              item: `batch (${company.name})`,
              error: rowErr.message,
              timestamp: new Date()
            });
          }
        }

        this.logger.info('GST registrations synced', {
          company: company.name,
          fetched: rows.length,
          uploaded: processed
        });
      } catch (error) {
        this.logger.warn('GST registration sync failed', {
          company: company.name,
          error: error.message
        });
        syncSession.errors.push({
          type: 'gstRegistrations',
          item: company.name,
          error: error.message,
          timestamp: new Date()
        });
      }

      this.emitPhaseProgress(syncSession, 'gstRegistrations', (ci + 1) / Math.max(1, companies.length), {
        currentOperation: `GST registrations — ${company.name}`,
        force: true
      });
    }

    syncSession.summary.gstRegistrations = { total, processed, errors: errorCount };
    this.emitPhaseProgress(syncSession, 'gstRegistrations', 1, {
      currentOperation: 'GST registration sync completed',
      force: true
    });
  }

  companySelectionKey(company) {
    const g = company?.guid != null ? String(company.guid).trim() : '';
    if (g) return g;
    const n = company?.name != null ? String(company.name).trim() : '';
    return n;
  }

  /**
   * Companies to sync = those currently OPEN in Tally that are also linked to the cloud.
   *
   * `allCompanies` comes from Tally's loaded-companies export, so it is already limited to
   * what is open right now. We intersect with the linked companies (each has a cloud target)
   * and case-insensitively match on GUID or name. We deliberately do NOT expand via the
   * `selectedCompanies` config — backend hydration rewrites it to *all* linked companies,
   * which previously caused a closed company (e.g. Aim Infocom) to sync alongside the open
   * one (e.g. SBI). Only what Tally has open is synced.
   */
  getSelectedCompanies(allCompanies) {
    const open = Array.isArray(allCompanies) ? allCompanies : [];

    const linkedIdentifiers = new Set();
    for (const entry of Array.isArray(this.config.linkedCompanies) ? this.config.linkedCompanies : []) {
      const g = String(entry?.tallyGuid || '').trim().toLowerCase();
      const n = String(entry?.tallyName || '').trim().toLowerCase();
      if (g) linkedIdentifiers.add(g);
      if (n) linkedIdentifiers.add(n);
    }

    // No linked companies configured yet → sync whatever is open (first-run / legacy).
    if (linkedIdentifiers.size === 0) {
      this.logger.info(`No linked companies configured — syncing ${open.length} open Tally company(ies)`);
      return open;
    }

    const selected = open.filter((company) => {
      const g = String(company?.guid || '').trim().toLowerCase();
      const n = String(company?.name || '').trim().toLowerCase();
      return (g && linkedIdentifiers.has(g)) || (n && linkedIdentifiers.has(n));
    });

    this.logger.info(
      `Syncing ${selected.length} of ${open.length} open Tally company(ies) that are linked`,
      { open: open.map((c) => c.name), selected: selected.map((c) => c.name) }
    );

    // Open companies exist but none are linked → guide the user instead of silently syncing
    // an unlinked company under the wrong cloud id.
    if (selected.length === 0 && open.length > 0) {
      this.logger.warn(
        'Open Tally company is not linked to any cloud company — link it from Add Company before syncing',
        { openCompanies: open.map((c) => c.name) }
      );
    }

    return selected;
  }

  async syncCompanies(syncSession) {
    this.logger.info('Syncing companies...');
    
    try {
      const allCompanies = await this.tallyService.getCompanies();
      const companies = this.getSelectedCompanies(allCompanies);
      
      syncSession.currentStage = 'companies';
      syncSession.summary.companies = { total: companies.length, processed: 0, errors: 0 };
      syncSession.totalItems += companies.length;
      this.emitPhaseProgress(syncSession, 'companies', 0, {
        currentOperation: 'Syncing companies',
        force: true
      });

      for (const company of companies) {
        if (!this.isRunning) break;

        try {
          await this.syncCompanyToServer(company);
          syncSession.summary.companies.processed++;
          syncSession.processedItems++;
        } catch (error) {
          syncSession.summary.companies.errors++;
          syncSession.errors.push({
            type: 'company',
            item: company.name,
            error: error.message,
            timestamp: new Date()
          });
          this.logger.error(`Failed to sync company ${company.name}:`, error);
        }

        const local = companies.length ? syncSession.summary.companies.processed / companies.length : 1;
        this.emitPhaseProgress(syncSession, 'companies', local, { type: 'companies' });
      }

      this.emitPhaseProgress(syncSession, 'companies', 1, {
        type: 'companies',
        currentOperation: 'Companies sync completed',
        force: true
      });
      this.logger.info(`Companies sync completed: ${syncSession.summary.companies.processed}/${syncSession.summary.companies.total}`);
    } catch (error) {
      this.logger.error('Failed to sync companies:', error);
      throw error;
    }
  }

  async syncVouchers(syncSession) {
    this.logger.info('Syncing vouchers...');
    this.voucherSyncLog.info('VOUCHER_SYNC_START', {
      sessionId: syncSession.id,
      trigger: syncSession.trigger || 'manual'
    });

    try {
      const allCompanies = await this.tallyService.getCompanies();
      const companies = this.getSelectedCompanies(allCompanies);
      const companyCount = Math.max(1, companies.length);
      this.logger.info(`Syncing vouchers for ${companies.length} companies`, {
        selectedCompanies: companies.map((c) => ({ name: c.name, guid: c.guid })),
        voucherUploadBatchSize: this.config.voucherUploadBatchSize
      });
      syncSession.currentStage = 'vouchers';
      let totalVouchers = 0;
      let processedVouchers = 0;
      let errorCount = 0;

      this.emitPhaseProgress(syncSession, 'vouchers', 0, {
        currentOperation: 'Preparing voucher sync',
        force: true
      });

      for (let ci = 0; ci < companies.length; ci++) {
        const company = companies[ci];
        if (!this.isRunning) break;

        try {
          const companyState = this.getCompanySyncState(company);
          const range = this.getVoucherSyncRange(company, companyState);
          const eta = this.estimateVoucherSyncDuration(range);
          this.voucherSyncLog.info('VOUCHER_SYNC_RANGE', {
            companyName: company.name,
            mode: range.mode,
            fromDate: range.fromDateIso,
            toDate: range.toDateIso,
            historicalSyncFromIso: companyState.historicalSyncFromIso || null,
            voucherSyncCursorIso: companyState.voucherSyncCursorIso || null,
            initialFullSyncCompleted: companyState.initialFullSyncCompleted === true,
            lastVoucherSyncDate: companyState.lastVoucherSyncDate || null,
            lastVoucherAlterId: companyState.lastVoucherAlterId || 0,
            preferredVoucherExport: companyState.preferredVoucherExport || null,
            estimatedWindows: eta.windows,
            estimatedMinutes: eta.estimatedMinutes
          });
          this.logger.info('Starting voucher sync range', {
            companyName: company.name,
            mode: range.mode,
            fromDate: range.fromDateIso,
            toDate: range.toDateIso,
            estimatedWindows: eta.windows,
            estimatedMinutes: eta.estimatedMinutes
          });
          this.emitPhaseProgress(syncSession, 'vouchers', ci / companyCount, {
            currentOperation: `Vouchers ${company.name}: ~${eta.estimatedMinutes} min (${eta.windows} windows, ${range.mode})`,
            force: true
          });

          const companyVoucherStartMs = Date.now();
          const chunkResult = await this.processVouchersInChunks(
            company.name,
            range.fromDateIso,
            range.toDateIso,
            async (vouchers, window) => {
              this.voucherSyncLog.info('VOUCHER_WINDOW_READY_FOR_UPLOAD', {
                companyName: company.name,
                windowStartIso: window.windowStartIso,
                windowEndIso: window.windowEndIso,
                count: vouchers.length
              });

              this.logger.info(`Processing ${vouchers.length} vouchers for window ${window.windowStartIso} to ${window.windowEndIso}`);
              totalVouchers += vouchers.length;
              syncSession.totalItems += vouchers.length;

              const dateFrac = this.voucherWindowDateFraction(range, window.windowEndIso);
              const phaseLocal = (ci + dateFrac) / companyCount;
              // ETA from real elapsed time scaled by the date fraction covered so far.
              const elapsedMs = Date.now() - companyVoucherStartMs;
              const etaMinutesRemaining =
                dateFrac > 0.02
                  ? Math.max(0, Math.ceil((elapsedMs * (1 - dateFrac)) / dateFrac / 60000))
                  : eta.estimatedMinutes;
              this.emitPhaseProgress(syncSession, 'vouchers', phaseLocal, {
                currentOperation: `Vouchers ${company.name}: ${window.windowStartIso} → ${window.windowEndIso} (${vouchers.length} fetched)`,
                etaMinutesRemaining,
                voucherWindow: {
                  from: window.windowStartIso,
                  to: window.windowEndIso,
                  count: vouchers.length,
                  rangeFrom: range.fromDateIso,
                  rangeTo: range.toDateIso,
                  mode: range.mode
                },
                companyName: company.name,
                force: true
              });

              if (vouchers.length > 0) {
                this.voucherSyncLog.info('VOUCHER_WINDOW_UPLOAD_START', {
                  companyName: company.name,
                  windowStartIso: window.windowStartIso,
                  windowEndIso: window.windowEndIso,
                  count: vouchers.length
                });
                const batchResult = await this.syncVouchersBatchToServer(vouchers, company.name);
                processedVouchers += batchResult.processed;
                syncSession.processedItems += batchResult.processed;
                errorCount += batchResult.failed;
                this.voucherSyncLog.info('VOUCHER_WINDOW_UPLOAD_DONE', {
                  companyName: company.name,
                  windowStartIso: window.windowStartIso,
                  windowEndIso: window.windowEndIso,
                  processed: batchResult.processed,
                  failed: batchResult.failed,
                  errorCount: (batchResult.errors || []).length
                });
                for (const rowErr of batchResult.errors || []) {
                  syncSession.errors.push({
                    type: 'voucher',
                    item: `${rowErr.voucherNumber || 'batch'} (${company.name})`,
                    error: rowErr.message,
                    timestamp: new Date()
                  });
                  this.voucherSyncLog.warn('VOUCHER_ROW_UPLOAD_ERROR', {
                    companyName: company.name,
                    windowStartIso: window.windowStartIso,
                    windowEndIso: window.windowEndIso,
                    voucherNumber: rowErr.voucherNumber || 'batch',
                    message: rowErr.message
                  });
                }
              }

              companyState.voucherSyncCursorIso = this.formatDateIso(
                this.addDays(new Date(`${window.windowEndIso}T00:00:00.000Z`), 1)
              );
              await this.saveSyncState().catch(() => {});
              this.voucherSyncLog.info('VOUCHER_CURSOR_SAVED', {
                companyName: company.name,
                voucherSyncCursorIso: companyState.voucherSyncCursorIso
              });

              this.emitPhaseProgress(syncSession, 'vouchers', phaseLocal, {
                currentOperation: `Uploaded batch — ${company.name} · ${window.windowEndIso}`,
                force: true
              });
            },
            {
              companyState,
              rangeMode: range.mode,
              preferredVoucherExport: companyState.preferredVoucherExport,
              onExportMethod: (method) => {
                if (method && companyState.preferredVoucherExport !== method) {
                  companyState.preferredVoucherExport = method;
                  this.saveSyncState().catch(() => {});
                }
              }
            }
          );

          const failedWindows = chunkResult?.failedWindows || [];
          const reachedEnd =
            !companyState.voucherSyncCursorIso ||
            companyState.voucherSyncCursorIso > range.toDateIso;

          if (range.mode === 'full' && failedWindows.length === 0 && reachedEnd) {
            companyState.initialFullSyncCompleted = true;
            companyState.voucherSyncCursorIso = null;
            companyState.lastFullSyncCompletedAt = new Date().toISOString();
            this.voucherSyncLog.info('VOUCHER_FULL_SYNC_COMPLETED', {
              companyName: company.name,
              totalFetched: totalVouchers,
              processedUploaded: processedVouchers,
              uploadErrors: errorCount
            });
          } else if (range.mode === 'full') {
            companyState.initialFullSyncCompleted = false;
            syncSession.voucherPhaseIncomplete = true;
            this.voucherSyncLog.warn('VOUCHER_FULL_SYNC_INCOMPLETE', {
              companyName: company.name,
              failedWindows: failedWindows.length,
              voucherSyncCursorIso: companyState.voucherSyncCursorIso,
              plannedTo: range.toDateIso,
              totalFetchedThisRun: totalVouchers,
              processedUploaded: processedVouchers,
              uploadErrors: errorCount
            });
            this.logger.warn('Full voucher sync incomplete — run sync again to resume', {
              companyName: company.name,
              failedWindows: failedWindows.length,
              voucherSyncCursorIso: companyState.voucherSyncCursorIso,
              plannedTo: range.toDateIso,
              totalFetchedThisRun: totalVouchers
            });
          } else {
            companyState.initialFullSyncCompleted = companyState.initialFullSyncCompleted || false;
          }

          companyState.lastVoucherSyncDate = range.toDateIso;
          companyState.lastRunAt = new Date().toISOString();
          await this.saveSyncState();

          /**
           * Optional second pass — disabled by default. Bulk summary export already parses
           * items + ledgerEntries; this pass used to request the entire FY in one CUSTOMVOUCHERCOL
           * call (~80MB) and freeze the desktop agent for 10–40+ minutes.
           */
          if (this.config.vouchers?.fullLinesAfterBulk === true) {
            await this.syncVoucherFullLinesForReportPeriods(company, syncSession);
          } else {
            this.logger.info('Skipping redundant full voucher line pass (lines included in bulk sync)', {
              companyName: company.name
            });
          }

          this.logger.info('Voucher sync finished for company', {
            companyName: company.name,
            mode: range.mode,
            totalFetched: totalVouchers,
            processedUploaded: processedVouchers,
            uploadErrors: errorCount,
            initialFullSyncCompleted: companyState.initialFullSyncCompleted
          });
        } catch (error) {
          const companyState = this.getCompanySyncState(company);
          companyState.lastRunAt = new Date().toISOString();
          companyState.initialFullSyncCompleted = false;
          syncSession.voucherPhaseIncomplete = true;
          await this.saveSyncState();
          this.voucherSyncLog.error('VOUCHER_SYNC_COMPANY_FAILED', {
            companyName: company.name,
            message: error.message,
            stack: error.stack || null,
            voucherSyncCursorIso: companyState.voucherSyncCursorIso || null
          });
          syncSession.errors.push({
            type: 'voucher',
            item: company.name,
            error: error.message,
            timestamp: new Date()
          });
          this.logger.error(`Failed to get vouchers for company ${company.name}:`, error);
        }
      }

      syncSession.summary.vouchers = {
        total: totalVouchers,
        processed: processedVouchers,
        errors: errorCount
      };

      this.voucherSyncLog.info('VOUCHER_SYNC_PHASE_DONE', {
        totalFetched: totalVouchers,
        processedUploaded: processedVouchers,
        uploadErrors: errorCount,
        sessionErrors: (syncSession.errors || []).filter((e) => e.type === 'voucher').length
      });

      this.emitPhaseProgress(syncSession, 'vouchers', 1, {
        currentOperation: 'Vouchers sync completed',
        force: true
      });
      this.logger.info(`Vouchers sync completed: ${processedVouchers}/${totalVouchers}`);
    } catch (error) {
      this.voucherSyncLog.error('VOUCHER_SYNC_PHASE_FAILED', {
        message: error.message,
        stack: error.stack || null
      });
      this.logger.error('Failed to sync vouchers:', error);
      throw error;
    }
  }

  async syncItems(syncSession, options = {}) {
    const phaseKey = options.phaseKey || 'items';
    this.logger.info('Syncing items...');

    try {
      const allCompanies = await this.tallyService.getCompanies();
      const companies = this.getSelectedCompanies(allCompanies);
      const companyCount = Math.max(1, companies.length);

      syncSession.currentStage = phaseKey;
      let totalItems = 0;
      let processedItems = 0;
      let errorCount = 0;

      this.emitPhaseProgress(syncSession, phaseKey, 0, {
        currentOperation: 'Fetching stock items from Tally',
        force: true
      });

      for (let ci = 0; ci < companies.length; ci++) {
        const company = companies[ci];
        if (!this.isRunning) break;

        try {
          const items = await this.tallyService.getStockItems(company.name);
          totalItems += items.length;
          syncSession.totalItems += items.length;

          this.emitPhaseProgress(syncSession, phaseKey, (ci + 0.02) / companyCount, {
            currentOperation: `Items — ${company.name} (${items.length} rows)`,
            force: true
          });

          const batchResult = await this.syncMasterBatchToServer('item', items, company.name);
          processedItems += batchResult.processed;
          syncSession.processedItems += batchResult.processed;
          errorCount += batchResult.failed;
          for (const rowErr of batchResult.errors || []) {
            syncSession.errors.push({
              type: 'item',
              item: `batch (${company.name})`,
              error: rowErr.message,
              timestamp: new Date()
            });
          }

          this.emitPhaseProgress(syncSession, phaseKey, (ci + 1) / companyCount, {
            currentOperation: `Items — ${company.name} uploaded (${batchResult.processed}/${items.length})`,
            force: true
          });
        } catch (error) {
          this.logger.error(`Failed to get items for company ${company.name}:`, error);
        }
      }

      if (phaseKey === 'items') {
        this.emitPhaseProgress(syncSession, phaseKey, 1, {
          currentOperation: 'Items sync completed',
          force: true
        });
      }
      syncSession.summary.items = {
        total: totalItems,
        processed: processedItems,
        errors: errorCount
      };

      this.logger.info(`Items sync completed: ${processedItems}/${totalItems}`);
    } catch (error) {
      this.logger.error('Failed to sync items:', error);
      throw error;
    }
  }

  async syncParties(syncSession) {
    this.logger.info('Syncing parties...');
    
    try {
      const allCompanies = await this.tallyService.getCompanies();
      const companies = this.getSelectedCompanies(allCompanies);
      const companyCount = Math.max(1, companies.length);

      syncSession.currentStage = 'parties';
      let totalParties = 0;
      let processedParties = 0;
      let errorCount = 0;

      this.emitPhaseProgress(syncSession, 'parties', 0, {
        currentOperation: 'Fetching ledgers / parties from Tally',
        force: true
      });

      for (let ci = 0; ci < companies.length; ci++) {
        const company = companies[ci];
        if (!this.isRunning) break;

        try {
          const parties = await this.tallyService.getParties(company.name);
          totalParties += parties.length;
          syncSession.totalItems += parties.length;

          this.emitPhaseProgress(syncSession, 'parties', (ci + 0.02) / companyCount, {
            currentOperation: `Parties — ${company.name} (${parties.length} rows)`,
            force: true
          });

          const batchResult = await this.syncMasterBatchToServer('party', parties, company.name);
          processedParties += batchResult.processed;
          syncSession.processedItems += batchResult.processed;
          errorCount += batchResult.failed;
          for (const rowErr of batchResult.errors || []) {
            syncSession.errors.push({
              type: 'party',
              item: `batch (${company.name})`,
              error: rowErr.message,
              timestamp: new Date()
            });
          }

          this.emitPhaseProgress(syncSession, 'parties', (ci + 1) / companyCount, {
            currentOperation: `Parties — ${company.name} uploaded (${batchResult.processed}/${parties.length})`,
            force: true
          });
        } catch (error) {
          this.logger.error(`Failed to get parties for company ${company.name}:`, error);
        }
      }

      this.emitPhaseProgress(syncSession, 'parties', 1, {
        currentOperation: 'Parties sync completed',
        force: true
      });
      syncSession.summary.parties = {
        total: totalParties,
        processed: processedParties,
        errors: errorCount
      };

      this.logger.info(`Parties sync completed: ${processedParties}/${totalParties}`);
    } catch (error) {
      this.logger.error('Failed to sync parties:', error);
      throw error;
    }
  }

  /**
   * All company ledgers in one Tally export → Party collection (sundry = party, others = ledger).
   */
  async syncPartiesAndLedgers(syncSession) {
    this.logger.info('Syncing company ledgers (parties + chart)...');

    try {
      const allCompanies = await this.tallyService.getCompanies();
      const companies = this.getSelectedCompanies(allCompanies);
      const companyCount = Math.max(1, companies.length);

      syncSession.currentStage = 'parties';
      let totalLedgers = 0;
      let totalParties = 0;
      let processedLedgers = 0;
      let processedParties = 0;
      let errorCount = 0;

      this.emitPhaseProgress(syncSession, 'parties', 0, {
        currentOperation: 'Fetching all ledgers from Tally',
        force: true
      });

      for (let ci = 0; ci < companies.length; ci++) {
        const company = companies[ci];
        if (!this.isRunning) break;

        try {
          const merged = await this.tallyService.getCompanyLedgersForPartySync(company.name);
          const partyCount = merged.filter((r) => r.recordType === 'party').length;
          const ledgerCount = merged.filter((r) => r.recordType === 'ledger').length;

          totalParties += partyCount;
          totalLedgers += ledgerCount;
          syncSession.totalItems += merged.length;

          this.emitPhaseProgress(syncSession, 'parties', (ci + 0.05) / companyCount, {
            currentOperation: `${company.name}: ${merged.length} rows → Party (${partyCount} parties, ${ledgerCount} ledgers)`,
            force: true
          });

          const batchResult = await this.syncMasterBatchToServer('party', merged, company.name);

          processedParties += partyCount;
          processedLedgers += ledgerCount;
          syncSession.processedItems += batchResult.processed;
          errorCount += batchResult.failed;

          for (const rowErr of batchResult.errors || []) {
            syncSession.errors.push({
              type: 'parties',
              item: `batch (${company.name})`,
              error: rowErr.message,
              timestamp: new Date()
            });
          }

          this.emitPhaseProgress(syncSession, 'parties', (ci + 1) / companyCount, {
            currentOperation: `${company.name}: uploaded ${batchResult.processed}/${merged.length} to Party`,
            force: true
          });
        } catch (error) {
          this.logger.error(`Failed parties/ledgers sync for ${company.name}:`, error);
        }
      }

      this.emitPhaseProgress(syncSession, 'parties', 1, {
        currentOperation: 'Parties & ledgers sync completed',
        force: true
      });
      syncSession.summary.parties = {
        total: totalParties,
        processed: processedParties,
        errors: errorCount
      };
      syncSession.summary.ledgers = {
        total: totalLedgers,
        processed: processedLedgers,
        errors: errorCount
      };

      this.logger.info(
        `Parties & ledgers completed: ${processedParties}/${totalParties} parties, ${processedLedgers}/${totalLedgers} ledgers`
      );
    } catch (error) {
      this.logger.error('Failed to sync parties and ledgers:', error);
      throw error;
    }
  }

  async syncMasters(syncSession) {
    this.logger.info('Syncing masters (items, godowns, voucher types, units)...');
    syncSession.currentStage = 'masters';
    await this.syncItems(syncSession, { phaseKey: 'masters' });
    await this.syncVoucherTypesGodownsUnits(syncSession, { phaseKey: 'masters' });
    this.emitPhaseProgress(syncSession, 'masters', 1, {
      currentOperation: 'Masters sync completed',
      force: true
    });
  }

  async syncSimpleMasterPhase(syncSession, phaseKey, entityType, fetchFn, label) {
    this.logger.info(`Syncing ${label}...`);
    const allCompanies = await this.tallyService.getCompanies();
    const companies = this.getSelectedCompanies(allCompanies);
    const companyCount = Math.max(1, companies.length);

    syncSession.currentStage = phaseKey;
    let total = 0;
    let processed = 0;
    let errorCount = 0;

    this.emitPhaseProgress(syncSession, phaseKey, 0, {
      currentOperation: `Fetching ${label} from Tally`,
      force: true
    });

    for (let ci = 0; ci < companies.length; ci++) {
      const company = companies[ci];
      if (!this.isRunning) break;

      try {
        const rows = await fetchFn(company.name);
        total += rows.length;
        syncSession.totalItems += rows.length;

        this.emitPhaseProgress(syncSession, phaseKey, (ci + 0.02) / companyCount, {
          currentOperation: `${label} — ${company.name} (${rows.length} rows)`,
          force: true
        });

        const batchResult = await this.syncMasterBatchToServer(entityType, rows, company.name);
        processed += batchResult.processed;
        syncSession.processedItems += batchResult.processed;
        errorCount += batchResult.failed;
        for (const rowErr of batchResult.errors || []) {
          syncSession.errors.push({
            type: phaseKey,
            item: `batch (${company.name})`,
            error: rowErr.message,
            timestamp: new Date()
          });
        }

        this.emitPhaseProgress(syncSession, phaseKey, (ci + 1) / companyCount, {
          currentOperation: `${label} — ${company.name} uploaded (${batchResult.processed}/${rows.length})`,
          force: true
        });
      } catch (error) {
        this.logger.error(`Failed to sync ${label} for company ${company.name}:`, error);
      }
    }

    this.emitPhaseProgress(syncSession, phaseKey, 1, {
      currentOperation: `${label} sync completed`,
      force: true
    });
    syncSession.summary[phaseKey] = { total, processed, errors: errorCount };
    this.logger.info(`${label} sync completed: ${processed}/${total}`);
  }

  /**
   * Fetch/upload voucher types, godowns, and units in parallel (one Tally wait per company).
   */
  async syncVoucherTypesGodownsUnits(syncSession, options = {}) {
    const phaseKey = options.phaseKey || 'masters';
    const allCompanies = await this.tallyService.getCompanies();
    const companies = this.getSelectedCompanies(allCompanies);
    const companyCount = Math.max(1, companies.length);

    syncSession.currentStage = phaseKey;
    this.emitPhaseProgress(syncSession, phaseKey, 0.35, {
      currentOperation: 'Fetching voucher types, godowns, units from Tally',
      force: true
    });

    for (let ci = 0; ci < companies.length; ci++) {
      const company = companies[ci];
      if (!this.isRunning) break;

      try {
        const fetched = await Promise.all([
          this.tallyService.getVoucherTypes(company.name).then((rows) => ({
            entityType: 'voucher_type',
            label: 'Voucher types',
            rows
          })),
          this.tallyService.getGodowns(company.name).then((rows) => ({
            entityType: 'godown',
            label: 'Godowns',
            rows
          })),
          this.tallyService.getUnits(company.name).then((rows) => ({
            entityType: 'unit',
            label: 'Units',
            rows
          }))
        ]);

        await Promise.all(
          fetched.map(({ entityType, rows }) =>
            this.syncMasterBatchToServer(entityType, rows, company.name)
          )
        );

        const summary = fetched.map((f) => `${f.label}: ${f.rows.length}`).join(', ');
        const local = 0.35 + ((ci + 1) / companyCount) * 0.65;
        this.emitPhaseProgress(syncSession, phaseKey, local, {
          currentOperation: `Masters — ${company.name} (${summary})`,
          force: true
        });
      } catch (error) {
        this.logger.error(`Failed compact masters sync for ${company.name}:`, error);
      }
    }
  }

  /**
   * Optional second pass for items + ledgerEntries (off by default — see vouchers.fullLinesAfterBulk).
   * Uses date windows; never requests the merged report-period span in one Tally export.
   */
  async syncVoucherFullLinesForReportPeriods(company, syncSession) {
    const { resolveReportPeriod, REPORT_PERIOD_KEYS } = require('../utils/reportPeriods');
    const periods = REPORT_PERIOD_KEYS.map((key) => resolveReportPeriod(key, company));
    if (!periods.length) return;

    let fromIso = periods[0].fromDateIso;
    let toIso = periods[0].toDateIso;
    for (const p of periods) {
      if (p.fromDateIso < fromIso) fromIso = p.fromDateIso;
      if (p.toDateIso > toIso) toIso = p.toDateIso;
    }

    try {
      this.emitPhaseProgress(syncSession, 'vouchers', 0.92, {
        currentOperation: `Voucher line details ${company.name} (${fromIso} → ${toIso})`,
        force: true
      });

      let totalUploaded = 0;
      await this.processVouchersInChunks(
        company.name,
        fromIso,
        toIso,
        async (vouchers, window) => {
          const withLines = vouchers.filter(
            (v) => (v.items?.length || 0) + (v.ledgerEntries?.length || 0) > 0
          );
          if (!withLines.length) return;
          const batchResult = await this.syncVouchersBatchToServer(withLines, company.name);
          totalUploaded += batchResult.processed || 0;
          syncSession.processedItems += batchResult.processed || 0;
          this.logger.info('Uploaded voucher line chunk', {
            companyName: company.name,
            windowStartIso: window.windowStartIso,
            windowEndIso: window.windowEndIso,
            fetched: vouchers.length,
            withLines: withLines.length,
            processed: batchResult.processed
          });
        },
        { detailLevel: 'summary' }
      );

      this.logger.info('Full voucher line pass completed', {
        companyName: company.name,
        fromIso,
        toIso,
        totalUploaded
      });
    } catch (err) {
      this.logger.warn('Full voucher lines sync failed', {
        companyName: company.name,
        fromIso,
        toIso,
        error: err.message
      });
    }
  }

  async syncTallyAccountsToServer(accounts, companyName) {
    if (!accounts?.length) return { processed: 0, failed: 0 };
    const companyId = this.resolveUploadCompanyId(companyName);
    const batchInner = {
      type: 'tally_account',
      action: 'upsert',
      companyId,
      companyName,
      items: accounts.map((a) => ({ ...a, companyName }))
    };
    return this.pushSyncBatchPayload(batchInner, { timeoutMs: 120000 });
  }

  buildGroupNameSetFromAccounts(accounts = []) {
    const set = new Set();
    for (const row of accounts) {
      if (row.accountType === 'group' && row.name) {
        set.add(String(row.name).trim());
      }
    }
    return set;
  }

  /**
   * Fetch Group Summary for a group and nested sub-groups (max depth 5).
   */
  async fetchGroupSummariesRecursive(
    companyName,
    groupName,
    groupAmount,
    fromIso,
    toIso,
    groupNameSet,
    parentGroup = '',
    depth = 0
  ) {
    if (depth > 5 || !groupName) return [];

    const gs = await this.tallyService.getGroupSummary(
      companyName,
      groupName,
      fromIso,
      toIso,
      { groupNameSet }
    );

    const ledgers = gs.ledgers || [];
    const summaries = [
      {
        groupName,
        parentGroup: parentGroup || '',
        groupAmount: Number(groupAmount || 0),
        ledgers
      }
    ];

    for (const row of ledgers) {
      if (!row.isGroup) continue;
      const childName = row.displayName || row.name;
      if (!childName || childName === groupName) continue;
      const nested = await this.fetchGroupSummariesRecursive(
        companyName,
        childName,
        row.amount,
        fromIso,
        toIso,
        groupNameSet,
        groupName,
        depth + 1
      );
      summaries.push(...nested);
    }

    return summaries;
  }

  async syncReports(syncSession) {
    this.logger.info('Syncing reports...');

    try {
      const allCompanies = await this.tallyService.getCompanies();
      const companies = this.getSelectedCompanies(allCompanies);
      const companyCount = Math.max(1, companies.length);

      syncSession.currentStage = 'reports';
      let totalReports = 0;
      let processedReports = 0;
      let errorCount = 0;

      this.emitPhaseProgress(syncSession, 'reports', 0, {
        currentOperation: 'Preparing profit & loss from Tally',
        force: true
      });

      for (let ci = 0; ci < companies.length; ci++) {
        const company = companies[ci];
        if (!this.isRunning) break;

        try {
          const { resolveReportPeriod, REPORT_PERIOD_KEYS } = require('../utils/reportPeriods');
          const companyState = this.getCompanySyncState(company);
          // P&L and Balance Sheet always sync all standard periods (same as full report refresh).
          const periodKeys = REPORT_PERIOD_KEYS;
          const reportMode = 'all_periods';
          const reportsToUpload = [];

          this.logger.info('Starting financial report sync', {
            companyName: company.name,
            reportMode,
            periodCount: periodKeys.length,
            periods: periodKeys
          });

          for (let pi = 0; pi < periodKeys.length; pi++) {
            if (!this.isRunning) break;

            const periodKey = periodKeys[pi];
            const period = resolveReportPeriod(periodKey, company);
            const periodLabel = period.label;

            this.emitPhaseProgress(
              syncSession,
              'reports',
              (ci + (pi + 0.15) / periodKeys.length) / companyCount,
              {
                currentOperation: `Reports — ${company.name} (${periodLabel}, ${reportMode})`,
                force: true
              }
            );

            let groupNameSet = new Set(
              Array.isArray(companyState.tallyGroupNames) ? companyState.tallyGroupNames : []
            );
            if (!groupNameSet.size) {
              try {
                const masters = await this.tallyService.getTallyAccountMasters(company.name);
                if (masters.accounts?.length) {
                  await this.syncTallyAccountsToServer(masters.accounts, company.name);
                  groupNameSet = this.buildGroupNameSetFromAccounts(masters.accounts);
                  companyState.tallyGroupNames = [...groupNameSet];
                  await this.saveSyncState().catch(() => {});
                }
              } catch (masterErr) {
                this.logger.warn('Tally account masters fetch failed for report drill-down', {
                  companyName: company.name,
                  error: masterErr.message
                });
              }
            }

            try {
              const plReport = await this.tallyService.getProfitAndLoss(
                company.name,
                period.fromDateIso,
                period.toDateIso
              );
              const groupSummaries = [];
              const drillableGroups = (plReport.entries || []).filter(
                (e) => e.isGroup && e.displayName
              );
              for (const groupEntry of drillableGroups) {
                if (!this.isRunning) break;
                try {
                  const nested = await this.fetchGroupSummariesRecursive(
                    company.name,
                    groupEntry.displayName,
                    groupEntry.mainAmount,
                    period.fromDateIso,
                    period.toDateIso,
                    groupNameSet,
                    '',
                    0
                  );
                  groupSummaries.push(...nested);
                } catch (gsErr) {
                  this.logger.warn('Group Summary fetch failed', {
                    companyName: company.name,
                    group: groupEntry.displayName,
                    error: gsErr.message
                  });
                }
              }

              totalReports += 1;
              syncSession.totalItems += 1;
              reportsToUpload.push({
                ...plReport,
                periodKey,
                fromDate: period.fromDateIso,
                toDate: period.toDateIso,
                groupSummaries
              });
            } catch (error) {
              errorCount += 1;
              syncSession.errors.push({
                type: 'report',
                item: `Profit and Loss ${periodLabel} (${company.name})`,
                error: error.message,
                timestamp: new Date()
              });
              this.logger.error(`Failed to fetch P&L ${periodLabel} for ${company.name}:`, error);
            }

            try {
              const { resolveBalanceSheetExportRange } = require('../utils/reportPeriods');
              const bsRange = resolveBalanceSheetExportRange(periodKey, company);
              const bsReport = await this.tallyService.getBalanceSheet(
                company.name,
                bsRange.booksFromDateIso,
                bsRange.asOfDateIso
              );
              let bsGroupSummaries = [];
              const bsDrillable = (bsReport.entries || []).filter(
                (e) => e.isGroup && Math.abs(Number(e.mainAmount || 0)) > 0
              );
              for (const groupEntry of bsDrillable) {
                if (!this.isRunning) break;
                try {
                  const nested = await this.fetchGroupSummariesRecursive(
                    company.name,
                    groupEntry.displayName || groupEntry.name,
                    groupEntry.mainAmount,
                    bsRange.booksFromDateIso,
                    bsRange.asOfDateIso,
                    groupNameSet,
                    '',
                    0
                  );
                  bsGroupSummaries.push(...nested);
                } catch (gsErr) {
                  this.logger.warn('Balance Sheet group summary fetch failed', {
                    companyName: company.name,
                    group: groupEntry.displayName,
                    error: gsErr.message
                  });
                }
              }
              totalReports += 1;
              syncSession.totalItems += 1;
              reportsToUpload.push({
                ...bsReport,
                periodKey,
                asOfDate: bsRange.asOfDateIso,
                toDate: bsRange.asOfDateIso,
                fromDate: bsRange.booksFromDateIso,
                groupSummaries: bsGroupSummaries
              });
            } catch (error) {
              errorCount += 1;
              syncSession.errors.push({
                type: 'report',
                item: `Balance Sheet ${periodLabel} (${company.name})`,
                error: error.message,
                timestamp: new Date()
              });
              this.logger.error(`Failed to fetch Balance Sheet ${periodLabel} for ${company.name}:`, error);
            }
          }

          if (reportsToUpload.length > 0) {
            this.emitPhaseProgress(syncSession, 'reports', (ci + 0.85) / companyCount, {
              currentOperation: `Reports — ${company.name} (uploading ${reportsToUpload.length} reports)`,
              force: true
            });
            const uploadResult = await this.syncReportsBatchToServer(reportsToUpload, company.name);
            processedReports += uploadResult.processed;
            syncSession.processedItems += uploadResult.processed;
            errorCount += uploadResult.failed;
          }

          if (reportMode === 'full') {
            companyState.lastFullReportsSyncAt = new Date().toISOString();
          }
          companyState.lastReportRunAt = new Date().toISOString();

          if (this.shouldSyncOutstandingReceivable(companyState, reportMode)) {
            const outstandingRange = this.getOutstandingReceivableDateRange(company);
            this.emitPhaseProgress(syncSession, 'reports', (ci + 0.92) / companyCount, {
              currentOperation: `Reports — ${company.name} (Bills Receivable)`,
              force: true
            });

            try {
              const outstanding = await this.tallyService.getBillsReceivable(
                company.name,
                outstandingRange.fromDateIso,
                outstandingRange.toDateIso
              );
              totalReports += 1;
              syncSession.totalItems += 1;
              await this.syncOutstandingReceivableToServer(outstanding, company.name);
              processedReports += 1;
              syncSession.processedItems += 1;
              companyState.lastReportSyncDate = outstandingRange.toDateIso;
              companyState.lastOutstandingSyncAt = new Date().toISOString();
              this.logger.info('Outstanding receivable synced', {
                companyName: company.name,
                ledgerCount: outstanding.ledgers?.length || 0,
                totalOutstanding: outstanding.totalOutstanding || 0
              });
            } catch (error) {
              errorCount += 1;
              syncSession.errors.push({
                type: 'report',
                item: `Bills Receivable (${company.name})`,
                error: error.message,
                timestamp: new Date()
              });
              this.logger.error(`Failed to sync outstanding receivable for ${company.name}:`, error);
            }
          } else {
            this.logger.info('Skipping Bills Receivable (incremental — synced recently)', {
              companyName: company.name
            });
          }

          await this.saveSyncState();
        } catch (error) {
          errorCount += 1;
          syncSession.errors.push({
            type: 'report',
            item: `Report sync for ${company.name}`,
            error: error.message,
            timestamp: new Date()
          });
          this.logger.error(`Failed to get report for company ${company.name}:`, error);
        }

        this.emitPhaseProgress(syncSession, 'reports', (ci + 1) / companyCount, {
          currentOperation: `Reports — ${company.name} done`
        });
      }

      syncSession.summary.reports = {
        total: totalReports,
        processed: processedReports,
        errors: errorCount
      };

      this.emitPhaseProgress(syncSession, 'reports', 1, {
        currentOperation: 'Reports sync completed',
        force: true
      });
      this.logger.info(`Reports sync completed: ${processedReports}/${totalReports}`);
    } catch (error) {
      this.logger.error('Failed to sync reports:', error);
      throw error;
    }
  }

  isRetryableSyncTransportError(error) {
    const msg = String(error?.message || error || '');
    return /WebSocket closed|Not connected|timed out|ECONNRESET|ECONNREFUSED/i.test(msg);
  }

  async pushSyncPayload(data, options = {}) {
    const timeoutMs = options.timeoutMs != null ? options.timeoutMs : 120000;

    if (!this.webSocketClient?.isConnected) {
      this.addToOfflineQueue(data);
      throw new Error('Not connected — cannot sync');
    }

    try {
      await this.webSocketClient.sendSyncDataWithAck(data, { timeoutMs });
    } catch (error) {
      if (this.isRetryableSyncTransportError(error)) {
        this.logger.warn('Sync transport error — queueing row for retry after reconnect', {
          type: data?.type,
          message: error.message
        });
        this.addToOfflineQueue(data);
        await this.webSocketClient.ensureConnected().catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Push with reconnect + retry — avoids false failures when WS drops (1006) during report upload.
   */
  async pushSyncPayloadResilient(data, options = {}) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
    const timeoutMs = options.timeoutMs != null ? options.timeoutMs : 120000;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!this.webSocketClient?.isConnected) {
          await this.webSocketClient.ensureConnected();
        }
        if (!this.webSocketClient?.isConnected) {
          throw new Error('Not connected — cannot sync');
        }
        await this.webSocketClient.sendSyncDataWithAck(data, { timeoutMs });
        return;
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryableSyncTransportError(error);
        if (!retryable || attempt >= maxAttempts) {
          if (retryable) {
            this.addToOfflineQueue(data);
            await this.webSocketClient.ensureConnected().catch(() => {});
          }
          throw error;
        }
        this.logger.warn('Sync payload retry after transport error', {
          attempt,
          maxAttempts,
          type: data?.type,
          message: error.message
        });
        this.addToOfflineQueue(data);
        await new Promise((r) => setTimeout(r, 1200 * attempt));
        await this.webSocketClient.ensureConnected().catch(() => {});
      }
    }

    throw lastError || new Error('Sync failed');
  }

  /**
   * Cloud company id for a Tally company name — routes each batch to the right company
   * instead of the single global WS companyId (which is just linkedCompanies[0]).
   */
  resolveUploadCompanyId(companyName) {
    return (
      this.resolveCloudCompanyIdForCompany({ name: companyName }) ||
      this.webSocketClient?.config?.companyId ||
      ''
    );
  }

  buildVoucherBatchPayloads(vouchers, companyName) {
    const companyId = this.resolveUploadCompanyId(companyName);
    const maxItems = Math.max(1, Number(this.config.voucherUploadBatchSize) || 200);
    const targetBytes = Number(this.config.voucherBatchTargetBytes) || 6 * 1024 * 1024;
    /** Envelope (type/action/companyId/companyName/syncRequestId wrapper) headroom. */
    const envelopeBytes = 512;
    const payloads = [];
    let chunk = [];
    let chunkBytes = envelopeBytes;

    const flush = () => {
      if (!chunk.length) return;
      payloads.push({
        type: 'voucher',
        action: 'upsert',
        companyId,
        companyName,
        items: chunk
      });
      chunk = [];
      chunkBytes = envelopeBytes;
    };

    for (const voucher of vouchers) {
      const row = { ...voucher, companyName };
      // Size each row once instead of re-serializing the whole chunk per append.
      const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
      if (chunk.length && (chunk.length >= maxItems || chunkBytes + rowBytes >= targetBytes)) {
        flush();
      }
      chunk.push(row);
      chunkBytes += rowBytes;
    }
    flush();
    return payloads;
  }

  async pushSyncBatchPayload(batchInner, options = {}) {
    const timeoutMs = options.timeoutMs != null ? options.timeoutMs : 300000;
    const serialize = options.serialize !== false;
    const items = batchInner.items || [];

    if (!items.length) {
      return { processed: 0, failed: 0, errors: [] };
    }

    if (!this.webSocketClient?.isConnected) {
      this.addToOfflineQueue({ ...batchInner, _syncBatch: true });
      throw new Error('Not connected — cannot sync batch');
    }

    try {
      return await this.webSocketClient.sendSyncDataBatchWithAck(batchInner, { timeoutMs, serialize });
    } catch (error) {
      const msg = String(error?.message || '');
      if (items.length > 1 && (/too large|payload too large/i.test(msg))) {
        const mid = Math.ceil(items.length / 2);
        const left = await this.pushSyncBatchPayload(
          { ...batchInner, items: items.slice(0, mid) },
          options
        );
        const right = await this.pushSyncBatchPayload(
          { ...batchInner, items: items.slice(mid) },
          options
        );
        return {
          processed: (left.processed || 0) + (right.processed || 0),
          failed: (left.failed || 0) + (right.failed || 0),
          errors: [...(left.errors || []), ...(right.errors || [])]
        };
      }

      if (this.isRetryableSyncTransportError(error)) {
        this.logger.warn('Batch sync transport error — queueing for retry', {
          type: batchInner?.type,
          count: items.length,
          message: error.message
        });
        this.addToOfflineQueue({ ...batchInner, _syncBatch: true });
        await this.webSocketClient.ensureConnected().catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Upload a voucher/master batch with reconnect + retry on WebSocket 1006 drops.
   */
  async pushSyncBatchPayloadResilient(batchInner, options = {}) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2);
    const timeoutMs = options.timeoutMs != null ? options.timeoutMs : 300000;
    const serialize = options.serialize !== false;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!this.webSocketClient?.isConnected) {
          await this.webSocketClient.ensureConnected();
        }
        if (!this.webSocketClient?.isConnected) {
          throw new Error('Not connected — cannot sync batch');
        }
        return await this.pushSyncBatchPayload(batchInner, { timeoutMs, serialize });
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryableSyncTransportError(error);
        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }
        this.logger.warn('Voucher batch upload retry after transport error', {
          attempt,
          maxAttempts,
          batchSize: batchInner?.items?.length || 0,
          message: error.message
        });
        this.voucherSyncLog.warn('VOUCHER_BATCH_UPLOAD_TRANSPORT_RETRY', {
          attempt: attempt + 1,
          maxAttempts,
          batchSize: batchInner?.items?.length || 0,
          message: error.message
        });
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        await this.webSocketClient.ensureConnected().catch(() => {});
      }
    }

    throw lastError || new Error('Batch upload failed');
  }

  /**
   * Upload vouchers in bulk WebSocket batches (far fewer round-trips than per-voucher).
   */
  async syncVouchersBatchToServer(vouchers, companyName) {
    const batches = this.buildVoucherBatchPayloads(vouchers, companyName);
    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const batch of batches) {
      if (!this.isRunning) {
        break;
      }
      try {
        const ack = await this.pushSyncBatchPayloadResilient(batch, {
          timeoutMs: 300000,
          serialize: true,
          maxAttempts: 2
        });
        const ok = Number(ack?.processed ?? batch.items.length);
        const bad = Number(ack?.failed ?? 0);
        processed += ok;
        failed += bad;
        if (Array.isArray(ack?.errors)) {
          for (const e of ack.errors) {
            errors.push({
              voucherNumber: e.voucherNumber,
              message: e.message || 'Batch row failed'
            });
          }
        }
        this.voucherSyncLog.info('VOUCHER_BATCH_UPLOAD_OK', {
          companyName,
          batchSize: batch.items.length,
          processed: ok,
          failed: bad
        });
        this.logger.info('Voucher batch uploaded', {
          companyName,
          batchSize: batch.items.length,
          processed: ok,
          failed: bad
        });
      } catch (error) {
        failed += batch.items.length;
        errors.push({ voucherNumber: 'batch', message: error.message });
        this.voucherSyncLog.error('VOUCHER_BATCH_UPLOAD_FAILED', {
          companyName,
          batchSize: batch.items.length,
          message: error.message,
          stack: error.stack || null,
          code: error.code || null
        });
        this.logger.error('Voucher batch upload failed', {
          companyName,
          batchSize: batch.items.length,
          error: error.message
        });
        throw error;
      }
    }

    return { processed, failed, errors };
  }

  async syncPartyToServer(party, companyName) {
    const data = {
      type: 'party',
      action: 'upsert',
      companyId: this.resolveUploadCompanyId(companyName),
      data: { ...party, companyName },
      timestamp: new Date().toISOString()
    };

    if (this.webSocketClient.isConnected) {
      this.logger.debug('Sending party sync payload', {
        companyId: data.companyId || '(empty)',
        companyName,
        partyName: party?.name || ''
      });
      await this.pushSyncPayload(data, { timeoutMs: 120000 });
    } else {
      this.addToOfflineQueue(data);
    }
  }

  async syncCompanyToServer(company) {
    const data = {
      type: 'company',
      action: 'upsert',
      companyId: this.resolveUploadCompanyId(company?.name),
      data: company,
      timestamp: new Date().toISOString()
    };

    if (this.webSocketClient.isConnected) {
      this.logger.debug('Sending company sync payload', {
        companyId: data.companyId || '(empty)',
        companyName: company?.name || '',
        guid: company?.guid || ''
      });
      await this.pushSyncPayload(data, { timeoutMs: 120000 });
    } else {
      this.addToOfflineQueue(data);
    }
  }

  async syncVoucherToServer(voucher, companyName) {
    const data = {
      type: 'voucher',
      action: 'upsert',
      companyId: this.resolveUploadCompanyId(companyName),
      data: { ...voucher, companyName },
      timestamp: new Date().toISOString()
    };

    if (this.webSocketClient.isConnected) {
      this.logger.debug('Sending voucher sync payload', {
        companyId: data.companyId || '(empty)',
        companyName,
        voucherNumber: voucher?.voucherNumber || '',
        voucherType: voucher?.voucherType || '',
        itemCount: Array.isArray(voucher?.items) ? voucher.items.length : 0,
        ledgerEntryCount: Array.isArray(voucher?.ledgerEntries) ? voucher.ledgerEntries.length : 0
      });
      await this.pushSyncPayload(data, { timeoutMs: 180000 });
    } else {
      this.logger.warn('WebSocket unavailable, adding voucher payload to offline queue', {
        companyName,
        voucherNumber: voucher?.voucherNumber || '',
        voucherType: voucher?.voucherType || ''
      });
      this.addToOfflineQueue(data);
    }
  }

  async syncOutstandingReceivableToServer(report, companyName) {
    const data = {
      type: 'outstanding_receivable',
      action: 'upsert',
      companyId: this.resolveUploadCompanyId(companyName),
      data: { ...report, companyName },
      timestamp: new Date().toISOString()
    };

    await this.pushSyncPayloadResilient(data, { timeoutMs: 300000, maxAttempts: 3 });
  }

  async syncReportToServer(report, companyName) {
    const data = {
      type: 'report',
      action: 'upsert',
      companyId: this.resolveUploadCompanyId(companyName),
      data: { ...report, companyName },
      timestamp: new Date().toISOString()
    };

    this.logger.debug('Sending report sync payload', {
      companyId: data.companyId || '(empty)',
      companyName,
      reportName: report?.reportName || 'Profit and Loss',
      entryCount: Array.isArray(report?.entries) ? report.entries.length : 0
    });
    await this.pushSyncPayloadResilient(data, { timeoutMs: 90000, maxAttempts: 2 });
  }

  async syncItemToServer(item, companyName) {
    const data = {
      type: 'item',
      action: 'upsert',
      companyId: this.resolveUploadCompanyId(companyName),
      data: { ...item, companyName },
      timestamp: new Date().toISOString()
    };

    if (this.webSocketClient.isConnected) {
      this.logger.debug('Sending item sync payload', {
        companyId: data.companyId || '(empty)',
        companyName,
        itemName: item?.name || '',
        guid: item?.guid || ''
      });
      await this.pushSyncPayload(data, { timeoutMs: 120000 });
    } else {
      this.addToOfflineQueue(data);
    }
  }

  addToOfflineQueue(data) {
    if (this.offlineQueue.length >= this.maxQueueSize) {
      // Remove oldest items
      this.offlineQueue.splice(0, Math.floor(this.maxQueueSize * 0.1));
    }

    this.offlineQueue.push({
      ...data,
      queuedAt: new Date().toISOString()
    });

    this.scheduleOfflineQueueSave();
    this.logger.debug(`Added item to offline queue: ${data.type}`);
  }

  /**
   * Drop queued party/item batches after a successful sync — they are duplicates and block the UI for minutes.
   */
  pruneStaleOfflineQueue(syncSession = null) {
    const summary = syncSession?.summary || {};
    const partySyncSucceeded =
      syncSession?.status === 'completed' &&
      (summary.parties?.processed > 0 || summary.ledgers?.processed > 0);

    const before = this.offlineQueue.length;
    this.offlineQueue = this.offlineQueue.filter((item) => {
      const type = item?.type;
      const isBatch =
        item?._syncBatch ||
        (Array.isArray(item?.items) &&
          ['voucher', 'item', 'party', 'report'].includes(type));

      if (partySyncSucceeded && type === 'party' && isBatch) {
        return false;
      }
      return true;
    });

    const removed = before - this.offlineQueue.length;
    if (removed > 0) {
      this.logger.info(`Pruned ${removed} stale batch(es) from offline queue`);
      this.scheduleOfflineQueueSave();
    }
    return removed;
  }

  async processOfflineQueue() {
    if (this.offlineQueue.length === 0 || this.isProcessingOfflineQueue) {
      return;
    }

    if (this.isSyncing) {
      return;
    }

    this.isProcessingOfflineQueue = true;
    let failed = 0;

    this.logger.info(`Processing ${this.offlineQueue.length} items from offline queue`);
    this.emit('offline-queue-progress', {
      pending: this.offlineQueue.length,
      currentOperation: `Sending ${this.offlineQueue.length} queued batch(es)…`
    });

    try {
      while (this.offlineQueue.length > 0 && this.webSocketClient.isConnected && !this.isSyncing) {
        const item = this.offlineQueue.shift();
        const { queuedAt, ...payload } = item;
        void queuedAt;

        this.emit('offline-queue-progress', {
          pending: this.offlineQueue.length + 1,
          currentOperation: `Sending queued ${payload.type || 'data'} batch…`
        });

        try {
          if (
            payload._syncBatch ||
            (Array.isArray(payload.items) &&
              ['voucher', 'item', 'party', 'report'].includes(payload.type))
          ) {
            const { _syncBatch, ...batchInner } = payload;
            void _syncBatch;
            await this.webSocketClient.sendSyncDataBatchWithAck(batchInner, {
              timeoutMs: 120000
            });
          } else {
            await this.webSocketClient.sendSyncDataWithAck(payload, { timeoutMs: 180000 });
          }
        } catch (error) {
          failed += 1;
          this.logger.error('Failed to process offline queue item:', error);
          this.offlineQueue.unshift(item);
          break;
        }
      }
    } finally {
      this.isProcessingOfflineQueue = false;
      await this.flushOfflineQueueSave();
      this.logger.info('Offline queue processing completed', {
        remaining: this.offlineQueue.length,
        failed
      });
      this.emit('offline-queue-finished', {
        pending: this.offlineQueue.length,
        failed
      });
    }
  }

  /**
   * Import a voucher from mobile/backend into TallyPrime (item or accounting).
   */
  async handleImportVoucher(payload = {}) {
    const { requestId, voucher, companyName, companyId, voucherId } = payload;

    const respond = (body) => {
      if (!this.webSocketClient?.isConnected) return;
      this.webSocketClient.sendMessage('import-voucher-response', {
        requestId,
        voucherId,
        companyId,
        ...body
      });
    };

    try {
      const importPayload = voucher || payload;
      const tallyCompany =
        companyName || importPayload.companyName || this.config?.tally?.companyName;
      if (!tallyCompany) {
        throw new Error('Missing Tally company name for import');
      }

      importPayload.companyName = tallyCompany;

      if (!this.webSocketClient?.isConnected) {
        throw new Error('Desktop agent is not connected to TallyFin server');
      }

      const vchType = String(importPayload.vchType || importPayload.voucherType || 'sales');
      const accountingTypes = ['receipt', 'payment', 'journal', 'contra'];
      const isAccounting = accountingTypes.includes(vchType.toLowerCase());

      if (isAccounting) {
        const entries = importPayload.ledgerEntries || importPayload.entries || [];
        if (!entries.length) {
          throw new Error('At least one ledger entry is required');
        }
        this.logger.info('Importing accounting voucher to Tally', {
          requestId,
          voucherId,
          vchType,
          entryCount: entries.length
        });
        const result = await this.tallyService.importAccountingVoucher(importPayload);
        await respond({
          success: true,
          data: {
            tallyGuid: result.tallyGuid,
            voucherNumber: result.voucherNumber,
            companyName: tallyCompany,
            alreadyExisted: Boolean(result.alreadyExisted),
            created: result.created,
            altered: result.altered
          }
        });
        return;
      }

      if (!importPayload.partyLedgerName && !importPayload.partyName) {
        throw new Error('partyLedgerName is required');
      }
      if (!Array.isArray(importPayload.items) || importPayload.items.length === 0) {
        throw new Error('At least one inventory item is required');
      }

      this.logger.info('Importing item voucher to Tally', {
        requestId,
        voucherId,
        companyName: tallyCompany,
        vchType,
        party: importPayload.partyLedgerName || importPayload.partyName,
        itemCount: importPayload.items.length,
        serverConnected: true
      });

      const result = await this.tallyService.importItemVoucher(importPayload);

      await respond({
        success: true,
        data: {
          tallyGuid: result.tallyGuid,
          voucherNumber: result.voucherNumber,
          companyName: tallyCompany,
          alreadyExisted: Boolean(result.alreadyExisted),
          created: result.created,
          altered: result.altered
        }
      });
    } catch (error) {
      this.logger.error('handleImportVoucher failed', {
        requestId,
        voucherId,
        error: error.message,
        tallyImport: error.tallyImport
      });
      await respond({
        success: false,
        error: error.message,
        data: error.tallyImport || null
      });
    }
  }

  async handleImportLedger(payload = {}) {
    const { requestId, ledger, companyName, companyId, partyId } = payload;
    const respond = (body) => {
      if (!this.webSocketClient?.isConnected) return;
      this.webSocketClient.sendMessage('import-ledger-response', {
        requestId,
        partyId,
        companyId,
        ...body
      });
    };

    try {
      const importPayload = ledger || payload;
      const tallyCompany =
        companyName || importPayload.companyName || this.config?.tally?.companyName;
      if (!tallyCompany) throw new Error('Missing Tally company name for import');
      if (!importPayload.name) throw new Error('Ledger name is required');
      if (!importPayload.parent) throw new Error('Ledger parent group is required');

      importPayload.companyName = tallyCompany;
      const result = await this.tallyService.importLedger(importPayload);
      await respond({
        success: true,
        data: {
          tallyGuid: result.tallyGuid,
          masterName: result.masterName || importPayload.name,
          companyName: tallyCompany,
          alreadyExisted: Boolean(result.alreadyExisted)
        }
      });
    } catch (error) {
      await respond({
        success: false,
        error: error.message,
        data: error.tallyImport || null
      });
    }
  }

  async handleImportStockItem(payload = {}) {
    const { requestId, stockItem, companyName, companyId, itemId } = payload;
    const respond = (body) => {
      if (!this.webSocketClient?.isConnected) return;
      this.webSocketClient.sendMessage('import-stock-item-response', {
        requestId,
        itemId,
        companyId,
        ...body
      });
    };

    try {
      const importPayload = stockItem || payload;
      const tallyCompany =
        companyName || importPayload.companyName || this.config?.tally?.companyName;
      if (!tallyCompany) throw new Error('Missing Tally company name for import');
      if (!importPayload.name) throw new Error('Stock item name is required');

      importPayload.companyName = tallyCompany;
      const result = await this.tallyService.importStockItem(importPayload);
      await respond({
        success: true,
        data: {
          tallyGuid: result.tallyGuid,
          masterName: result.masterName || importPayload.name,
          companyName: tallyCompany,
          alreadyExisted: Boolean(result.alreadyExisted)
        }
      });
    } catch (error) {
      await respond({
        success: false,
        error: error.message,
        data: error.tallyImport || null
      });
    }
  }

  /**
   * Server-requested lazy detail fetch (one voucher by GUID).
   */
  async handleFetchVoucherDetail(payload = {}) {
    const {
      requestId,
      companyName,
      guid,
      date,
      voucherId,
      companyId
    } = payload;

    const respond = async (body) => {
      if (!this.webSocketClient?.isConnected) return;
      this.webSocketClient.sendMessage('voucher-detail-response', {
        requestId,
        ...body
      });
    };

    try {
      if (!companyName || !guid) {
        throw new Error('Missing companyName or guid');
      }
      const full = await this.tallyService.getVoucherFullByGuid(companyName, guid, date);
      await this.webSocketClient.sendSyncDataWithAck(
        {
          type: 'voucher_detail',
          action: 'upsert',
          companyId: companyId || this.webSocketClient?.config?.companyId || '',
          data: {
            ...full,
            detailLevel: 'full',
            companyName,
            hydrateRequestId: requestId,
            voucherId
          },
          timestamp: new Date().toISOString()
        },
        { timeoutMs: 300000 }
      );
      await respond({ success: true, voucherId, guid });
    } catch (error) {
      this.logger.error('handleFetchVoucherDetail failed', {
        requestId,
        guid,
        error: error.message
      });
      await respond({ success: false, message: error.message, guid });
    }
  }

  handleSyncRequest(data) {
    this.logger.info('Handling sync request from server:', data);
    
    switch (data.action) {
      case 'start':
        this.startSync();
        break;
      case 'stop':
        this.stopSync();
        break;
      case 'force':
        this.forceSync();
        break;
      default:
        this.logger.warn('Unknown sync request action:', data.action);
    }
  }

  generateSyncId() {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isSyncing: this.isSyncing,
      config: this.config,
      offlineQueueSize: this.offlineQueue.length,
      lastSync: this.syncHistory.length > 0 ? this.syncHistory[this.syncHistory.length - 1] : null,
      syncHistory: this.syncHistory.slice(-10) // Last 10 entries
    };
  }

  updateConfig(newConfig) {
    const oldInterval = this.config.syncInterval;
    this.config = { ...this.config, ...newConfig };
    
    // If sync interval changed, reschedule
    if (oldInterval !== this.config.syncInterval && this.config.autoSync) {
      this.setupScheduledSync();
    }
    
    this.saveConfig();
    this.logger.info('Sync configuration updated');
  }

  stop() {
    this.isRunning = false;
    
    // Stop all scheduled jobs
    for (const [name, job] of this.syncJobs) {
      job.destroy();
      this.logger.info(`Stopped sync job: ${name}`);
    }
    
    this.syncJobs.clear();
    if (this.offlineQueueSaveTimer) {
      clearTimeout(this.offlineQueueSaveTimer);
      this.offlineQueueSaveTimer = null;
      this.saveOfflineQueue();
    }
    this.logger.info('Sync Manager stopped');
  }
}

module.exports = SyncManager;
