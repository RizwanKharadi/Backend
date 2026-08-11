/**
 * Lazy-loaded bridge to tally-sync-ts (ESM) for the CommonJS Electron desktop-agent.
 * @see https://github.com/GreenHacker420/tally-sync-ts
 */
const electronLog = require('electron-log');
const { importTallyClientClass } = require('../utils/tallySyncTsModuleLoader');

let TallyClientClass = null;
let loadPromise = null;

async function loadTallyClientClass() {
  if (TallyClientClass) {
    return TallyClientClass;
  }
  if (!loadPromise) {
    loadPromise = importTallyClientClass()
      .then((Client) => {
        TallyClientClass = Client;
        return TallyClientClass;
      })
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

class TallySyncTsAdapter {
  constructor(config = {}) {
    this.logger = electronLog.scope('TallySyncTs');
    this.config = {
      host: config.host || '127.0.0.1',
      port: Number(config.port) || 9000,
      timeoutMinutes: Number(config.timeoutMinutes) || 15
    };
    this._client = null;
    this._enabled = config.enabled !== false;
  }

  setEnabled(enabled) {
    this._enabled = Boolean(enabled);
  }

  isEnabled() {
    return this._enabled;
  }

  updateConfig(config = {}) {
    if (config.host) {
      this.config.host = config.host === 'localhost' ? '127.0.0.1' : config.host;
    }
    if (config.port != null) {
      this.config.port = Number(config.port) || 9000;
    }
    if (config.timeoutMinutes != null) {
      this.config.timeoutMinutes = Number(config.timeoutMinutes) || 15;
    }
    if (this._client && typeof this._client.setupTallyService === 'function') {
      this._client.setupTallyService(`http://${this.config.host}`, this.config.port);
    }
  }

  async getClient() {
    if (!this._enabled) {
      throw new Error('tally-sync-ts adapter is disabled');
    }
    const Client = await loadTallyClientClass();
    if (!this._client) {
      this._client = new Client(
        `http://${this.config.host}`,
        this.config.port,
        this.config.timeoutMinutes
      );
    }
    return this._client;
  }

  async check() {
    const client = await this.getClient();
    return client.check();
  }

  async getActiveCompany() {
    const client = await this.getClient();
    return client.getActiveCompany();
  }

  async getLastAlterIds(companyName) {
    const client = await this.getClient();
    const options = companyName ? { company: companyName } : {};
    const ids = await client.getLastAlterIds(options);
    return {
      mastersLastId: Number(ids?.mastersLastId) || 0,
      vouchersLastId: Number(ids?.vouchersLastId) || 0
    };
  }

  async getLicenseInfo() {
    const client = await this.getClient();
    return client.getLicenseInfo();
  }

  async getGSTRegistrations(companyName) {
    const client = await this.getClient();
    const options = companyName ? { company: companyName } : {};
    return client.getGSTRegistrations(options);
  }

  /**
   * Map library Company objects to FinSync360 desktop-agent company shape.
   */
  mapCompanies(companies) {
    if (!Array.isArray(companies)) {
      return [];
    }
    return companies.map((c) => ({
      name: c.name || '',
      guid: c.guid || c.remoteId || '',
      booksFrom: c.booksBeginningFrom || c.startingFrom || '',
      startingFrom: c.startingFrom || c.booksBeginningFrom || '',
      state: c.state || '',
      country: c.country || ''
    })).filter((c) => c.name);
  }

  async getCompanies(companyName = '') {
    const client = await this.getClient();
    const options = companyName ? { company: companyName } : {};
    const rows = await client.getCompanies(options);
    return this.mapCompanies(rows);
  }

  /**
   * Normalize tally-sync-ts PostResponse[] to FinSync import outcome shape.
   */
  normalizePostResponses(responses = [], hints = {}) {
    const first = Array.isArray(responses) ? responses[0] : null;
    if (!first) {
      return {
        success: false,
        lineErrors: ['Empty Tally import response'],
        errors: ['Empty Tally import response'],
        tallyGuid: '',
        voucherNumber: hints.voucherNumber || '',
        alreadyExisted: false
      };
    }

    if (first.status === 'failure') {
      const msg = first.error || first.message || 'Tally rejected import';
      return {
        success: false,
        lineErrors: [msg],
        errors: [msg],
        tallyGuid: first.guid || '',
        voucherNumber: '',
        alreadyExisted: false,
        created: 0,
        altered: 0
      };
    }

    const message = String(first.message || '').toLowerCase();

    // tally-sync-ts collapses Tally's <IMPORTRESULT> into status + a wording:
    // it emits "Created successfully" only when CREATED > 0, "Altered
    // successfully" only when ALTERED > 0, "Deleted successfully" only when
    // DELETED > 0 — and "Imported successfully" when all three are zero.
    // For master imports (ledger / stock item) that wording is ALL we get:
    // there is no GUID, LASTVCHID is absent so masterId is undefined, and
    // alteredId is never populated by parsePostResponse at all. Reading only
    // the numeric fields threw away Tally's own confirmation and reported a
    // successful import as a failure.
    const createdByMessage = /created\s+successfully/.test(message);
    const alteredByMessage = /altered\s+successfully/.test(message);
    const deletedByMessage = /deleted\s+successfully/.test(message);

    const alreadyExisted =
      Boolean(hints.alreadyExisted) ||
      message.includes('exist') ||
      message.includes('duplicate') ||
      // Tally alters instead of duplicating when a master of that name is there.
      alteredByMessage ||
      (first.alteredId > 0 && !first.masterId);

    const created = first.masterId || createdByMessage ? 1 : 0;
    const altered = first.alteredId || alteredByMessage ? 1 : 0;
    const tallyGuid = first.guid || '';
    const hasProof =
      Boolean(tallyGuid) ||
      alreadyExisted ||
      created > 0 ||
      altered > 0 ||
      deletedByMessage;

    // Note "Imported successfully" is deliberately NOT proof: it is what the
    // library says when CREATED, ALTERED and DELETED are all zero, i.e. Tally
    // accepted the XML but changed nothing.

    if (!hasProof) {
      const msg =
        first.message ||
        'Tally did not confirm import (no GUID or CREATED/ALTERED in response)';
      return {
        success: false,
        lineErrors: [msg],
        errors: [msg],
        tallyGuid: '',
        voucherNumber: '',
        alreadyExisted: false,
        created: 0,
        altered: 0
      };
    }

    return {
      success: true,
      lineErrors: [],
      errors: [],
      tallyGuid,
      voucherNumber: first.name || hints.voucherNumber || '',
      alreadyExisted,
      created,
      altered
    };
  }

  async postVouchers(vouchers, companyName) {
    const client = await this.getClient();
    const options = companyName ? { company: companyName } : {};
    return client.postVouchers(vouchers, options);
  }

  async postLedgers(ledgers, companyName) {
    const client = await this.getClient();
    const options = companyName ? { company: companyName } : {};
    return client.postLedgers(ledgers, options);
  }

  async postStockItems(stockItems, companyName) {
    const client = await this.getClient();
    const options = companyName ? { company: companyName } : {};
    return client.postStockItems(stockItems, options);
  }

  /**
   * Fetch all pages of a Tally collection via getPaginatedObjects.
   */
  async fetchAllPaginated(collectionType, options = {}) {
    const client = await this.getClient();
    const recordsPerPage = Math.max(50, Number(options.recordsPerPage) || 500);
    const baseOptions = { ...options };
    delete baseOptions.recordsPerPage;

    let pageNum = 1;
    let totalPages = 1;
    const objects = [];

    while (pageNum <= totalPages) {
      const page = await client.getPaginatedObjects(collectionType, {
        ...baseOptions,
        pageNum,
        recordsPerPage,
        disableCountTag: pageNum > 1
      });
      if (Array.isArray(page?.objects)) {
        objects.push(...page.objects);
      }
      totalPages = Math.max(1, Number(page?.totalPages) || 1);
      if (!page?.objects?.length || page.objects.length < recordsPerPage) {
        break;
      }
      pageNum += 1;
    }

    this.logger.info('Paginated Tally export complete', {
      collectionType,
      pages: pageNum,
      count: objects.length,
      company: options.company || ''
    });

    return objects;
  }

  async fetchStockItems(companyName, recordsPerPage) {
    return this.fetchAllPaginated('StockItem', {
      company: companyName,
      recordsPerPage
    });
  }

  async fetchLedgers(companyName, recordsPerPage) {
    return this.fetchAllPaginated('Ledger', {
      company: companyName,
      recordsPerPage
    });
  }

  async fetchGodowns(companyName, recordsPerPage) {
    return this.fetchAllPaginated('Godown', {
      company: companyName,
      recordsPerPage
    });
  }

  async fetchUnits(companyName, recordsPerPage) {
    return this.fetchAllPaginated('Unit', {
      company: companyName,
      recordsPerPage
    });
  }

  async fetchVoucherTypes(companyName, recordsPerPage) {
    return this.fetchAllPaginated('VoucherType', {
      company: companyName,
      recordsPerPage
    });
  }

  async fetchVouchers(companyName, fromDate, toDate, recordsPerPage) {
    return this.fetchAllPaginated('Voucher', {
      company: companyName,
      fromDate,
      toDate,
      recordsPerPage
    });
  }
}

module.exports = TallySyncTsAdapter;
