const net = require('net');
const http = require('http');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const EventEmitter = require('events');
const electronLog = require('electron-log');
const { getVoucherSyncLogger } = require('../utils/agentLogger');
const { withRetry } = require('../utils/retry');
const {
  resolveVoucherTypeFromTally,
  normalizeVoucherTypeSlug
} = require('../utils/tallyVoucherType');
const { buildItemVoucherImportXml } = require('../utils/tallySalesVoucherImportXml');
const { buildAccountingVoucherImportXml } = require('../utils/tallyAccountingVoucherImportXml');
const {
  mapItemVoucherPayload,
  mapLedgerPayload,
  mapStockItemPayload
} = require('../utils/tallySyncTsImportMapper');
const { injectStockItemPartNo } = require('../utils/tallyStockItemPartNo');
const TallySyncTsAdapter = require('./TallySyncTsAdapter');
const { importTallySyncTsModule } = require('../utils/tallySyncTsModuleLoader');
const {
  mapStockItemRow,
  mapSimpleMasterRow,
  mapLedgerToPartySyncRow,
  mapVoucherFromLibrary
} = require('../utils/tallySyncTsExportMapper');

class TallyService extends EventEmitter {
  constructor() {
    super();
    this.isConnected = false;
    this.client = null;
    /** Use tally-sync-ts for alter-ID checks, GST export, and future typed Tally HTTP calls. */
    this.useTallySyncTs = true;
    this.config = {
      host: '127.0.0.1',
      port: 9000,
      /** Max wait for each Tally HTTP XML export (large ledgers / parties need several minutes). */
      timeout: 900000,
      /** TCP probe when testing / opening the optional legacy socket path (keep short). */
      connectTimeoutMs: 20000,
      retryAttempts: 3,
      retryDelay: 5000
    };
    this.tallySyncTs = new TallySyncTsAdapter({
      host: this.config.host,
      port: this.config.port,
      timeoutMinutes: 15
    });
    this.httpAgent = new http.Agent({ keepAlive: true });
    
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      parseTagValue: true,
      trimValues: true,
      // Tally voucher XML can be deeply nested (inventory + ledger allocations)
      maxDepth: 512
    });
    
    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
      indentBy: '  '
    });
    
    this.logger = electronLog.scope('TallyService');
    this.voucherSyncLog = getVoucherSyncLogger();
  }

  getTallySyncTsPageSize() {
    return Math.max(100, Number(this.config.tallySyncTs?.recordsPerPage) || 500);
  }

  shouldUsePaginatedMasters() {
    return this.useTallySyncTs && this.config.tallySyncTs?.paginatedMasters !== false;
  }

  shouldUsePaginatedVoucherFallback() {
    return this.useTallySyncTs && this.config.tallySyncTs?.paginatedVouchersFallback !== false;
  }

  shouldEnrichStockBalances() {
    return this.config.tallySyncTs?.enrichStockBalances === true;
  }

  applySyncPipelineConfig(tallySyncTs = {}) {
    this.config.tallySyncTs = { ...(this.config.tallySyncTs || {}), ...tallySyncTs };
  }

  yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  async parseXmlResponseAsync(xmlString) {
    await this.yieldToEventLoop();
    const parsed = this.parseXmlResponse(xmlString);
    await this.yieldToEventLoop();
    return parsed;
  }

  async extractNodesAsync(response, nodeKey, parseFn, batchSize = 150) {
    const nodes = this.findNodesByKey(response, nodeKey);
    const results = [];
    for (let i = 0; i < nodes.length; i++) {
      const row = parseFn(nodes[i]);
      if (row) {
        results.push(row);
      }
      if (i > 0 && i % batchSize === 0) {
        await this.yieldToEventLoop();
      }
    }
    return results;
  }

  sanitizePreview(value, maxLength = 500) {
    if (value == null) {
      return '';
    }

    const normalized = String(value).replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength)}...`;
  }

  formatDdMmYyyy(value) {
    if (!value) return '';

    // Accept YYYY-MM-DD or Date, return DD-MM-YYYY (what Tally wants for TYPE="Date").
    const asString = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
    const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isoMatch) {
      return asString;
    }

    const [, year, month, day] = isoMatch;
    return `${day}-${month}-${year}`;
  }

  /** YYYYMMDD — preferred for Day Book static variables on many TallyPrime builds. */
  formatYyyyMmDd(value) {
    if (!value) return '';
    const asString = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
    const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return `${year}${month}${day}`;
    }
    const compact = asString.replace(/\D/g, '');
    if (compact.length === 8) return compact;
    return asString;
  }

  /**
   * Classic TallyPrime Export Data envelope (matches tally-connector style).
   */
  buildSimpleExportEnvelope(reportName, extraStaticVars = '') {
    const extra = extraStaticVars ? `\n          ${extraStaticVars.trim()}` : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${extra}
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
  }

  buildDayBookRequestYyyyMmDd(companyName, fromDate, toDate) {
    const from = this.formatYyyyMmDd(fromDate);
    const to = this.formatYyyyMmDd(toDate);
    let vars = `<SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>`;
    if (companyName) {
      vars += `
          <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>`;
    }
    return this.buildSimpleExportEnvelope('Day Book', vars);
  }

  parseTallyDate(value) {
    // Tally often returns dates as YYYYMMDD or nested objects like { '#text': '20250401' }
    const asString = this.parseString(value);
    const match = asString.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return asString;
    const [, year, month, day] = match;
    return `${year}-${month}-${day}`;
  }

  toNumber(value) {
    if (value == null) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'object') {
      return this.toNumber(this.parseString(value));
    }

    const raw = String(value).trim();

    // Foreign-currency amounts arrive as an expression, not a plain number:
    //   "$ 1500.00 @ ₹ 83.50/$ = 125250.00"
    // The base-currency figure is the one after the last '='. Stripping
    // non-numerics across the whole string concatenates all three numbers into
    // "1500.0083.50125250.00", which is NaN — and every forex voucher then
    // stored as 0.
    const eq = raw.lastIndexOf('=');
    const candidate = eq >= 0 ? raw.slice(eq + 1) : raw;

    const cleaned = candidate.replace(/[^0-9.+-]/g, '').trim();
    const num = Number(cleaned);
    if (cleaned !== '' && Number.isFinite(num)) return num;

    // No usable '=' segment (e.g. "$ 1500.00 @ 83.50"): fall back to the first
    // numeric token rather than discarding the amount entirely.
    const match = raw.match(/-?\d[\d,]*(?:\.\d+)?/);
    if (match) {
      const first = Number(match[0].replace(/,/g, ''));
      if (Number.isFinite(first)) return first;
    }
    return 0;
  }

  /** Prefer ZVOUCHERPARENT (Tally parent type) over renamed VOUCHERTYPENAME. */
  resolveVoucherTypeFields(voucher) {
    return resolveVoucherTypeFromTally(voucher);
  }

  normalizeVoucherTypeFromTally(value) {
    return normalizeVoucherTypeSlug(value);
  }

  /** Tally VCHENTRYMODE → app enum */
  normalizeVchEntryMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw.includes('item') && raw.includes('invoice')) return 'item_invoice';
    if (raw.includes('accounting') && raw.includes('invoice')) return 'accounting_invoice';
    if (raw.includes('as') && raw.includes('voucher')) return 'as_voucher';
    return '';
  }

  /**
   * Tally PERSISTEDVIEW / OBJVIEW — "Accounting Voucher View" vs "Invoice Voucher View".
   */
  parsePersistedView(voucher) {
    const raw = this.parseString(
      voucher?.PERSISTEDVIEW ||
        voucher?.['@_OBJVIEW'] ||
        voucher?.OBJVIEW ||
        ''
    );
    return raw;
  }

  isAccountingVoucherView(persistedView = '') {
    return String(persistedView).toLowerCase().includes('accounting voucher view');
  }

  isInvoiceVoucherView(persistedView = '') {
    return String(persistedView).toLowerCase().includes('invoice voucher view');
  }

  /**
   * Map Tally screen layout to app display mode (matches TallyPrime UI).
   * - Accounting Voucher View → as_voucher (Payment/Journal: Dr/Cr ledgers, image 1)
   * - Invoice Voucher View + Item Invoice → item_invoice (stock lines)
   * - Invoice Voucher View + Accounting Invoice → accounting_invoice (ledgers only)
   */
  resolveTallyVoucherEntryMode(voucher, items = [], ledgerEntries = []) {
    const persistedView = this.parsePersistedView(voucher);
    const vchMode = this.normalizeVchEntryMode(voucher?.VCHENTRYMODE);

    if (vchMode === 'as_voucher') {
      return 'as_voucher';
    }

    if (this.isAccountingVoucherView(persistedView)) {
      return 'as_voucher';
    }

    if (this.isInvoiceVoucherView(persistedView)) {
      if (vchMode) return vchMode;
      if (items.length > 0) return 'item_invoice';
      return 'accounting_invoice';
    }

    if (vchMode) return vchMode;
    return this.inferVchEntryMode(items, ledgerEntries);
  }

  async sendRawXml(xmlRequest, meta = {}) {
    const { requestType, collection } = meta;
    this.logger.info('Tally request XML preview', {
      requestType,
      collection,
      preview: this.sanitizePreview(xmlRequest)
    });

    const url = `http://${this.config.host}:${this.config.port}`;
    this.logger.info('Sending Tally request over HTTP', {
      requestType,
      collection,
      url,
      requestLength: xmlRequest.length,
      timeoutMs: this.config.timeout
    });
    if (collection === 'CUSTOMVOUCHERCOL') {
      this.logger.info(
        'Waiting for Tally CUSTOMVOUCHERCOL export (close any Tally error popup if sync appears stuck)',
        { timeoutMs: this.config.timeout }
      );
    }

    try {
      const responseText = await withRetry(
        () =>
          this.postXmlOverHttp(
            url,
            xmlRequest,
            {
              'Content-Type': 'application/xml',
              'Content-Length': Buffer.byteLength(xmlRequest, 'utf8')
            },
            this.config.timeout
          ),
        {
          retries: this.config.retryAttempts,
          baseMs: this.config.retryDelay,
          label: `TallyHTTP:${collection || requestType || 'xml'}`,
          shouldRetry: (err) => this.isRetryableTallyHttpError(err)
        }
      );

      this.logger.info('Received Tally HTTP response', {
        requestType,
        collection,
        status: 200,
        responseLength: responseText.length,
        preview: this.sanitizePreview(responseText)
      });

      if (responseText.length > 25_000_000) {
        this.logger.warn(
          'Very large Tally XML — parsing and voucher extraction can take 10–40+ minutes; reduce voucher window in agent sync config if this repeats',
          { responseLength: responseText.length, collection, requestType }
        );
      }

      const useAsyncParse = responseText.length > 5_000_000;
      const parsedResponse = useAsyncParse
        ? await this.parseXmlResponseAsync(responseText)
        : this.parseXmlResponse(responseText);
      if (this.isImportPromptResponse(parsedResponse)) {
        const error = new Error('Tally returned an import prompt response instead of export data');
        error.responseText = responseText;
        this.logger.error('Tally returned import prompt response', {
          requestType,
          collection,
          preview: this.sanitizePreview(responseText)
        });
        throw error;
      }

      if (meta.returnMeta) {
        return {
          parsed: parsedResponse,
          responseLength: responseText.length,
          responseText
        };
      }
      return parsedResponse;
    } catch (error) {
      this.logger.error('Tally HTTP request failed', {
        requestType,
        collection,
        message: error.message,
        code: error.code,
        status: error.status || null
      });
      throw error;
    }
  }

  isRetryableTallyHttpError(error) {
    if (!error) return false;
    const code = error.code;
    if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE') {
      return true;
    }
    const msg = String(error.message || '');
    if (/timed out|socket hang up|ECONN/i.test(msg)) return true;
    const status = error.status;
    if (status >= 500 && status < 600) return true;
    return false;
  }

  async postXmlOverHttp(url, xmlRequest, headers = {}, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const endpoint = new URL(url);
      const requestOptions = {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers,
        agent: this.httpAgent,
        timeout
      };

      const req = http.request(requestOptions, (res) => {
        let responseData = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode !== 200) {
            const error = new Error(`HTTP ${res.statusCode}`);
            error.status = res.statusCode;
            error.responseText = responseData;
            return reject(error);
          }
          resolve(responseData);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        const timeoutError = new Error(`Request timed out after ${timeout}ms`);
        timeoutError.code = 'ETIMEDOUT';
        req.destroy(timeoutError);
      });

      req.write(xmlRequest, 'utf8');
      req.end();
    });
  }

  /**
   * Normalize SVFROMDATE / SVTODATE for TDL SET lines (must be DD-MM-YYYY text, not objects).
   */
  normalizeTallyRequestDate(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'object' && value['#text'] != null) {
      return String(value['#text']).trim();
    }
    if (typeof value === 'string') return value.trim();
    return this.formatDdMmYyyy(value);
  }

  buildStaticVariables(staticVariables = {}) {
    return {
      SVEXPORTFORMAT: '$$SysName:XML',
      ...staticVariables
    };
  }

  buildExportDataRequest(reportName, staticVariables = {}, fetchList = ['*']) {
    const svFromText = this.normalizeTallyRequestDate(staticVariables.SVFROMDATE);
    const svToText = this.normalizeTallyRequestDate(staticVariables.SVTODATE);

    // Build STATICVARIABLES — Tally expects TYPE="Date" for range variables
    const staticVars = this.buildStaticVariables(staticVariables);
    if (svFromText) {
      staticVars.SVFROMDATE = { '@_TYPE': 'Date', '#text': svFromText };
    }
    if (svToText) {
      staticVars.SVTODATE = { '@_TYPE': 'Date', '#text': svToText };
    }

    // Build SET elements for TDL - convert date variables to TDL format
    const setElements = [];
    if (svFromText) {
      setElements.push({
        '#text': `SVFROMDATE:$$Date:"${svFromText}"`
      });
    }
    if (svToText) {
      setElements.push({
        '#text': `SVTODATE:$$Date:"${svToText}"`
      });
    }

    // Build the DESC structure with TDL REPORT
    const desc = {
      STATICVARIABLES: staticVars,
      TDL: {
        TDLMESSAGE: {
          REPORT: {
            '@_NAME': reportName,
            '@_ISMODIFY': 'YES',
            SET: setElements.length > 0 ? setElements : undefined
          }
        }
      }
    };

    // Remove undefined SET if empty
    if (!setElements.length) {
      delete desc.TDL.TDLMESSAGE.REPORT.SET;
    }

    const envelope = {
      ENVELOPE: {
        HEADER: {
          VERSION: 1,
          TALLYREQUEST: 'Export',
          TYPE: 'Data',
          ID: reportName.replace(/\s+/g, '')
        },
        BODY: {
          DESC: desc
        }
      }
    };

    let xml = this.xmlBuilder.build(envelope);
    if (!xml.startsWith('<?xml')) {
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    }
    return xml;
  }

  buildCollectionRequest(collectionName, staticVariables = {}, collectionAttributes = {}) {
    const envelope = {
      ENVELOPE: {
        HEADER: {
          VERSION: 1,
          TALLYREQUEST: 'Export',
          TYPE: 'Collection',
          ID: collectionName
        },
        BODY: {
          DESC: {
            STATICVARIABLES: this.buildStaticVariables(staticVariables),
            TDL: {
              TDLMESSAGE: {
                COLLECTION: collectionAttributes
              }
            }
          }
        }
      }
    };

    let xml = this.xmlBuilder.build(envelope);
    if (!xml.startsWith('<?xml')) {
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    }
    return xml;
  }

  /**
   * Escape text for use inside Tally XML element bodies.
   */
  escapeXmlForTally(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Minimal Ledgers collection export — only fields needed for Party sync (smaller XML than NATIVEMETHOD *).
   * PAN: INCOMETAXNUMBER. GSTIN / registration: LEDGSTREGDETAILS.LIST (via FETCH).
   */
  buildLedgersPartyCollectionXml(companyName) {
    const comp = this.escapeXmlForTally(companyName || '');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${comp}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No" NAME="Ledgers">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>NAME</NATIVEMETHOD>
            <NATIVEMETHOD>MAILINGNAME</NATIVEMETHOD>
            <NATIVEMETHOD>PARENT</NATIVEMETHOD>
            <NATIVEMETHOD>ADDRESS</NATIVEMETHOD>
            <NATIVEMETHOD>STATE</NATIVEMETHOD>
            <NATIVEMETHOD>CountryName</NATIVEMETHOD>
            <NATIVEMETHOD>PINCODE</NATIVEMETHOD>
            <NATIVEMETHOD>LEDGERMOBILE</NATIVEMETHOD>
            <NATIVEMETHOD>EMAIL</NATIVEMETHOD>
            <NATIVEMETHOD>INCOMETAXNUMBER</NATIVEMETHOD>
            <NATIVEMETHOD>OPENINGBALANCE</NATIVEMETHOD>
            <NATIVEMETHOD>Masterid</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
            <NATIVEMETHOD>ALTERID</NATIVEMETHOD>
            <FETCH>LEDGSTREGDETAILS.LIST</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
  }

  /**
   * CUSTOMVOUCHERCOL bulk export — date range via STATICVARIABLES only (no COLLECTION FILTER;
   * TallyPrime rejects "Date >= $$SVFROMDATE" style filters in collection TDL).
   * SVFROMDATE = sync start (company link / historical from); SVTODATE = end of range (usually today).
   */
  buildCustomVoucherColXml(companyName, fromDateIso, toDateIso, options = {}) {
    const comp = this.escapeXmlForTally(companyName || '');
    const from = this.formatYyyyMmDd(fromDateIso);
    const to = this.formatYyyyMmDd(toDateIso);
    const includeFullLines = options.detailLevel === 'full';
    /** Minimal FETCH — Tally still embeds ALLLEDGERENTRIES / INVENTORYALLOCATIONS in export XML. */
    const fetchFields = includeFullLines
      ? 'DATE,GUID,MASTERID,ALTERID,VOUCHERNUMBER,VOUCHERTYPENAME,PARTYLEDGERNAME,AMOUNT,ALLINVENTORYENTRIES.LIST,ALLLEDGERENTRIES.LIST,LEDGERENTRIES.LIST,NARRATION,PERSISTEDVIEW,VCHENTRYMODE'
      : 'DATE,GUID,MASTERID,ALTERID,VCHENTRYMODE,VOUCHERTYPENAME,PARTYLEDGERNAME,AMOUNT,PERSISTEDVIEW';
    const companyLine = companyName ? `\n        <SVCURRENTCOMPANY>${comp}</SVCURRENTCOMPANY>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE Action="">
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>EXPORT</TALLYREQUEST>
    <TYPE>COLLECTION</TYPE>
    <ID>CUSTOMVOUCHERCOL</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${companyLine}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No" NAME="CUSTOMVOUCHERCOL">
            <TYPE>VOUCHER</TYPE>
            <COMPUTE>zVoucherParent : $Parent:VOUCHERTYPE:$VOUCHERTYPENAME</COMPUTE>
            <FETCH>${fetchFields}</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
  }

  parseAlterId(value) {
    const n = Number(this.parseString(value));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Extract ledger names from ALLLEDGERENTRIES / LEDGERENTRIES for P&L drill-down indexing.
   */
  parseVoucherLedgerIndex(voucher) {
    const names = new Set();
    const addFromList = (key) => {
      const ledgers = voucher?.[key];
      const list = Array.isArray(ledgers) ? ledgers : ledgers ? [ledgers] : [];
      for (const entry of list) {
        const name = this.parseString(entry?.LEDGERNAME || entry?.PARTYLEDGERNAME);
        if (name) names.add(name);
      }
    };
    addFromList('ALLLEDGERENTRIES.LIST');
    addFromList('LEDGERENTRIES.LIST');

    let hasInventory = false;
    const invTop = voucher?.['ALLINVENTORYENTRIES.LIST'];
    if (invTop) hasInventory = true;

    const allLedgers = voucher?.['ALLLEDGERENTRIES.LIST'];
    const allList = Array.isArray(allLedgers) ? allLedgers : allLedgers ? [allLedgers] : [];
    for (const entry of allList) {
      const inv = entry?.['INVENTORYALLOCATIONS.LIST'];
      const invList = Array.isArray(inv) ? inv : inv ? [inv] : [];
      if (invList.length > 0) hasInventory = true;
    }

    return { ledgerNames: [...names], hasInventory };
  }

  /**
   * Stock lines + ledger rows from Tally voucher XML (ALLLEDGERENTRIES / INVENTORYALLOCATIONS).
   */
  parseVoucherLines(voucher) {
    let items = this.parseInventoryItems(voucher);
    if (items.length === 0) {
      items = this.parseInventoryAllocationItems(voucher);
    }

    const inventoryLedgers = this.parseInventoryAccountingLedgers(voucher);
    const fromLedgerEntries = this.parseLedgerEntries(voucher);
    const fromAllLedgerEntries = this.parseAllLedgerEntries(voucher);
    const ledgerEntries = this.mergeLedgerEntryLists(
      inventoryLedgers,
      fromLedgerEntries,
      fromAllLedgerEntries
    );

    return { items, ledgerEntries };
  }

  /**
   * Bulk sync row: header fields + parsed items / ledgerEntries when Tally returns them.
   */
  parseVoucherSummary(voucher) {
    const typeFields = this.resolveVoucherTypeFields(voucher);
    const amount = this.toNumber(voucher?.AMOUNT);
    const guid = this.parseString(voucher?.GUID || voucher?.['@_GUID']);
    const alterId = this.parseString(voucher?.ALTERID || voucher?.['@_ALTERID']);
    const { items, ledgerEntries } = this.parseVoucherLines(voucher);
    const { ledgerNames, hasInventory } = this.parseVoucherLedgerIndex(voucher);
    const tallyPersistedView = this.parsePersistedView(voucher);
    const tallyEntryMode = this.resolveTallyVoucherEntryMode(voucher, items, ledgerEntries);
    const totals = this.calculateVoucherTotals(items, ledgerEntries, voucher);

    return {
      detailLevel: 'summary',
      voucherNumber: this.parseString(voucher?.VOUCHERNUMBER),
      voucherType: typeFields.voucherType,
      tallyVoucherTypeParent: typeFields.tallyVoucherTypeParent,
      tallyVoucherTypeName: typeFields.tallyVoucherTypeName,
      tallyPersistedView,
      tallyEntryMode,
      date: this.parseTallyDate(voucher?.DATE),
      partyName: this.parseString(
        voucher?.PARTYLEDGERNAME || voucher?.PARTYNAME || voucher?.PARTYLEDGERNAME?.['#text']
      ),
      amount: totals.grandTotal || amount,
      guid,
      alterId,
      masterId: this.parseString(voucher?.MASTERID || voucher?.['@_MASTERID']),
      tallyId: guid,
      ledgerNames,
      hasInventory: hasInventory || items.length > 0,
      items,
      ledgerEntries,
      totals
    };
  }

  extractVoucherSummariesFromResponse(response) {
    const vouchers = [];
    try {
      const voucherNodes = this.findNodesByKey(response, 'VOUCHER');
      voucherNodes.forEach((voucher) => {
        if (voucher && typeof voucher === 'object') {
          const row = this.parseVoucherSummary(voucher);
          if (row.voucherNumber || row.guid) {
            vouchers.push(row);
          }
        }
      });
    } catch (error) {
      this.logger.error('Failed to extract voucher summaries from response:', error);
    }
    return vouchers;
  }

  async extractVoucherSummariesFromResponseAsync(response) {
    try {
      return await this.extractNodesAsync(response, 'VOUCHER', (voucher) => {
        if (!voucher || typeof voucher !== 'object') return null;
        const row = this.parseVoucherSummary(voucher);
        if (row.voucherNumber || row.guid) {
          return row;
        }
        return null;
      });
    } catch (error) {
      this.logger.error('Failed to extract voucher summaries from response:', error);
      return [];
    }
  }

  /**
   * Fetch one full voucher by GUID (lazy detail — Level 3).
   */
  async getVoucherFullByGuid(companyName, guid, dateIso = null) {
    const target = String(guid || '').trim().toLowerCase();
    if (!target) {
      throw new Error('Missing voucher GUID');
    }

    const anchor = dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)
      ? dateIso
      : new Date().toISOString().slice(0, 10);

    const tryRange = async (fromIso, toIso) => {
      const result = await this.getVouchers(companyName, fromIso, toIso, {
        detailLevel: 'full',
        preferredMethod: 'voucher_collection'
      });
      const list = result.vouchers || [];
      return list.find(
        (v) => String(v.guid || v.tallyId || '').trim().toLowerCase() === target
      );
    };

    let found = await tryRange(anchor, anchor);
    if (found) {
      found.detailLevel = 'full';
      return found;
    }

    const fromW = this.formatDateIso(this.addDays(new Date(`${anchor}T00:00:00.000Z`), -3));
    const toW = this.formatDateIso(this.addDays(new Date(`${anchor}T00:00:00.000Z`), 3));
    found = await tryRange(fromW, toW);
    if (found) {
      found.detailLevel = 'full';
      return found;
    }

    throw new Error(`Voucher not found in Tally for GUID ${guid}`);
  }

  /**
   * Clamp HTTP timeout used for Tally XML POSTs. UI / saved config often used 30s which is too low
   * for Ledgers/StockItems exports once vouchers have loaded — Tally stays busy and requests queue.
   */
  normalizeHttpTimeout() {
    const MIN_MS = 300000; // 5 minutes floor
    const DEFAULT_MS = 900000; // 15 minutes default when unset
    const MAX_MS = 3600000; // 1 hour cap

    let t = Number(this.config.timeout);
    if (!Number.isFinite(t) || t <= 0) {
      t = DEFAULT_MS;
    }
    if (t < MIN_MS) {
      this.logger.warn('Tally HTTP timeout was too low for exports; raising to minimum', {
        previous: t,
        minimumMs: MIN_MS
      });
      t = MIN_MS;
    }
    if (t > MAX_MS) {
      t = MAX_MS;
    }
    this.config.timeout = t;
  }

  normalizeConnectTimeout() {
    let t = Number(this.config.connectTimeoutMs);
    if (!Number.isFinite(t) || t <= 0) {
      t = 20000;
    }
    if (t > 120000) {
      t = 120000;
    }
    this.config.connectTimeoutMs = t;
  }

  async initialize() {
    this.logger.info('Initializing Tally Service...');
    
    try {
      // Load configuration
      await this.loadConfig();
      
      // Test initial connection
      await this.testConnection();

      // Establish a reusable socket for subsequent XML requests.
      await this.connect();
      
      this.logger.info('Tally Service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Tally Service:', error);
      throw error;
    }
  }

  async loadConfig() {
    // Load configuration from store or use defaults
    const Store = require('electron-store');
    const store = new Store();
    
    const savedConfig = store.get('tallyConfig', {});
    this.config = { ...this.config, ...savedConfig };
    
    // Windows may resolve "localhost" to IPv6 (::1), while Tally commonly binds only IPv4.
    if (this.config.host === 'localhost') {
      this.config.host = '127.0.0.1';
    }

    this.normalizeHttpTimeout();
    this.normalizeConnectTimeout();
    this.syncTallySyncTsConfig();
    
    this.logger.info('Tally configuration loaded:', {
      host: this.config.host,
      port: this.config.port,
      httpTimeoutMs: this.config.timeout,
      connectTimeoutMs: this.config.connectTimeoutMs
    });
  }

  syncTallySyncTsConfig() {
    const timeoutMinutes = Math.max(1, Math.ceil((Number(this.config.timeout) || 900000) / 60000));
    this.tallySyncTs.updateConfig({
      host: this.config.host,
      port: this.config.port,
      timeoutMinutes
    });
    this.tallySyncTs.setEnabled(this.useTallySyncTs !== false);
  }

  async saveConfig(newConfig) {
    const Store = require('electron-store');
    const store = new Store();
    
    this.config = { ...this.config, ...newConfig };
    if (this.config.host === 'localhost') {
      this.config.host = '127.0.0.1';
    }
    this.normalizeHttpTimeout();
    this.normalizeConnectTimeout();
    this.syncTallySyncTsConfig();
    store.set('tallyConfig', this.config);
    
    this.logger.info('Tally configuration saved', {
      httpTimeoutMs: this.config.timeout,
      connectTimeoutMs: this.config.connectTimeoutMs
    });
  }

  async testConnection() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = new net.Socket();

      const succeed = () => {
        if (settled) return;
        settled = true;
        this.isConnected = true;
        this.emit('connectionStatusChanged', true);
        this.logger.info('Tally connection test successful');
        client.destroy();
        resolve(true);
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        this.isConnected = false;
        this.emit('connectionStatusChanged', false);
        client.destroy();
        reject(error);
      };

      const timeout = setTimeout(() => {
        fail(new Error('Connection timeout'));
      }, this.config.connectTimeoutMs);

      client.connect(this.config.port, this.config.host, () => {
        clearTimeout(timeout);
        succeed();
      });

      client.on('error', (error) => {
        clearTimeout(timeout);
        this.logger.error('Tally connection error:', error);
        fail(error);
      });

      client.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  async connect() {
    if (this.isConnected && this.client) {
      return true;
    }

    return new Promise((resolve, reject) => {
      this.client = new net.Socket();
      
      const timeout = setTimeout(() => {
        if (this.client) {
          this.client.destroy();
        }
        reject(new Error('Connection timeout'));
      }, this.config.connectTimeoutMs);

      this.client.connect(this.config.port, this.config.host, () => {
        clearTimeout(timeout);
        this.isConnected = true;
        this.emit('connectionStatusChanged', true);
        this.logger.info('Connected to Tally');
        resolve(true);
      });

      this.client.on('error', (error) => {
        clearTimeout(timeout);
        this.isConnected = false;
        this.emit('connectionStatusChanged', false);
        this.logger.error('Tally connection error:', error);
        reject(error);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        this.emit('connectionStatusChanged', false);
        this.logger.info('Disconnected from Tally');
      });
    });
  }

  async disconnect() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.isConnected = false;
    this.emit('connectionStatusChanged', false);
    this.logger.info('Disconnected from Tally');
  }

  async sendRequest(requestType, collection, options = {}) {
    this.logger.info('Preparing Tally request', {
      requestType,
      collection,
      optionKeys: Object.keys(options),
      socketState: {
        isConnected: this.isConnected,
        hasClient: Boolean(this.client),
        clientDestroyed: this.client ? this.client.destroyed : null
      }
    });

    const xmlRequest = this.buildXmlRequest(requestType, collection, options);
    return this.sendRawXml(xmlRequest, { requestType, collection });
  }

  /**
   * Tally collection export for the currently loaded / active company.
   * Uses TDL Collection "CompanyInfo" (TYPE COMPANY, NATIVEMETHOD *) — supported across Tally Prime / ERP versions.
   */
  buildCompanyInfoCollectionXml(companyName = '') {
    const staticVariables = companyName ? { SVCURRENTCOMPANY: companyName } : {};
    const staticVariablesXml = Object.keys(staticVariables).length > 0
      ? `<STATICVARIABLES><SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY></STATICVARIABLES>`
      : `<STATICVARIABLES />`;

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Collection</TYPE>
        <ID>CompanyInfo</ID>
    </HEADER>
    <BODY>
        <DESC>
            ${staticVariablesXml}
            <TDL>
                <TDLMESSAGE>
                    <OBJECT NAME="CurrentCompany">
                        <LOCALFORMULA>CurrentCompany:##SVCURRENTCOMPANY</LOCALFORMULA>
                    </OBJECT>
                    <COLLECTION NAME="CompanyInfo">
                       <TYPE>COMPANY</TYPE>
                        <NATIVEMETHOD>*</NATIVEMETHOD>
                        <FETCH>Name,StartingFrom,BooksFrom,GUID,AlterID,RemoteID,Email,PhoneNumber,PriorStateName,CountryName,Pincode</FETCH>
                    </COLLECTION>
                </TDLMESSAGE>
            </TDL>
        </DESC>
    </BODY>
</ENVELOPE>`
    );
  }

  async getCompanies() {
    if (this.useTallySyncTs) {
      try {
        const fromLib = await this.tallySyncTs.getCompanies();
        if (fromLib.length > 0) {
          this.logger.info(`Retrieved ${fromLib.length} companies from Tally (tally-sync-ts)`);
          return fromLib;
        }
      } catch (error) {
        this.logger.warn('getCompanies via tally-sync-ts failed; using TDL export', {
          error: error.message
        });
      }
    }

    try {
      const xmlRequest = this.buildCompanyInfoCollectionXml();
      const response = await this.sendRawXml(xmlRequest, { requestType: 'Export', collection: 'CompanyInfo' });

      if (response && response.ENVELOPE && response.ENVELOPE.BODY) {
        const companies = this.extractCompaniesFromResponse(response);
        this.logger.info(`Retrieved ${companies.length} companies from Tally`, {
          companies: companies.map(c => ({
            name: c.name,
            guid: c.guid,
            booksFrom: c.booksFrom,
            startingFrom: c.startingFrom
          }))
        });
        return companies;
      }

      return [];
    } catch (error) {
      this.logger.error('Failed to get companies from Tally:', error);
      throw error;
    }
  }

  buildVoucherCollectionRequest(companyName, fromDate, toDate) {
    return this.buildCollectionRequest('VouchersForSync', {
      SVCURRENTCOMPANY: companyName,
      SVFROMDATE: this.formatDdMmYyyy(fromDate),
      SVTODATE: this.formatDdMmYyyy(toDate),
      SVEXPORTFORMAT: '$$SysName:XML'
    }, {
      '@_ISMODIFY': 'No',
      '@_ISFIXED': 'No',
      '@_ISINITIALIZE': 'No',
      '@_ISOPTION': 'No',
      '@_ISINTERNAL': 'No',
      '@_NAME': 'VouchersForSync',
      TYPE: 'Voucher',
      NATIVEMETHOD: '*'
    });
  }

  filterVouchersByDateRange(vouchers, fromDateIso, toDateIso) {
    const fromMs = new Date(`${fromDateIso}T00:00:00.000Z`).getTime();
    const toMs = new Date(`${toDateIso}T23:59:59.999Z`).getTime();
    return vouchers.filter((v) => {
      if (!v?.date) return true;
      const t = new Date(v.date).getTime();
      if (Number.isNaN(t)) return true;
      return t >= fromMs && t <= toMs;
    });
  }

  daysBetweenIso(fromDateIso, toDateIso) {
    const fromMs = new Date(`${fromDateIso}T00:00:00.000Z`).getTime();
    const toMs = new Date(`${toDateIso}T00:00:00.000Z`).getTime();
    return Math.max(1, Math.ceil((toMs - fromMs) / 86400000) + 1);
  }

  dedupeVouchersByGuid(vouchers) {
    const seen = new Set();
    const out = [];
    for (const v of vouchers || []) {
      const key = String(v.guid || v.tallyId || '').trim().toLowerCase();
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(v);
    }
    return out;
  }

  /**
   * Tally collection exports can cap rows per request; split wide ranges when count is suspiciously high.
   */
  async getVouchersCustomColWithSplit(companyName, fromDate, toDate, options = {}) {
    const threshold = Number(options.voucherSplitThreshold) || 150;
    const days = this.daysBetweenIso(fromDate, toDate);
    const maxResponseBytes = Number(options.maxVoucherResponseBytes) || 15_000_000;

    const xml = this.buildCustomVoucherColXml(companyName, fromDate, toDate, {
      detailLevel: options.detailLevel || 'summary'
    });
    const { parsed: response, responseLength } = await this.sendRawXml(xml, {
      requestType: 'EXPORT',
      collection: 'CUSTOMVOUCHERCOL',
      returnMeta: true
    });
    const extractSync =
      (options.detailLevel || 'summary') === 'full'
        ? this.extractVouchersFromResponse.bind(this)
        : this.extractVoucherSummariesFromResponse.bind(this);
    const extractAsync =
      (options.detailLevel || 'summary') === 'full'
        ? this.extractVouchersFromResponseAsync.bind(this)
        : this.extractVoucherSummariesFromResponseAsync.bind(this);
    const useAsyncExtract = responseLength > 5_000_000;
    const rawRows = useAsyncExtract
      ? await extractAsync(response)
      : extractSync(response);
    let vouchers = this.filterVouchersByDateRange(rawRows, fromDate, toDate);

    const responseTooLarge = responseLength > maxResponseBytes;
    if (
      !options._noSplit &&
      days > 1 &&
      (vouchers.length >= threshold || responseTooLarge)
    ) {
      if (responseTooLarge) {
        this.logger.warn('CUSTOMVOUCHERCOL response too large — splitting date range', {
          companyName,
          fromDate,
          toDate,
          responseLength,
          maxResponseBytes,
          voucherCount: vouchers.length
        });
      }
      const fromMs = new Date(`${fromDate}T00:00:00.000Z`).getTime();
      const toMs = new Date(`${toDate}T00:00:00.000Z`).getTime();
      const midMs = fromMs + Math.floor((toMs - fromMs) / 2);
      const midDate = new Date(midMs);
      const midIso = midDate.toISOString().slice(0, 10);
      const rightStartIso = this.formatDateIso(this.addDays(midDate, 1));

      this.logger.warn('Voucher window may be truncated — splitting date range', {
        companyName,
        fromDate,
        toDate,
        count: vouchers.length,
        threshold,
        midIso,
        rightStartIso
      });

      const left = await this.getVouchersCustomColWithSplit(companyName, fromDate, midIso, {
        ...options,
        _noSplit: false
      });
      const right = await this.getVouchersCustomColWithSplit(companyName, rightStartIso, toDate, {
        ...options,
        _noSplit: false
      });
      vouchers = this.dedupeVouchersByGuid([...left.vouchers, ...right.vouchers]);
      return { vouchers, exportMethod: 'custom_voucher_col_split' };
    }

    return { vouchers, exportMethod: 'custom_voucher_col' };
  }

  addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  formatDateIso(date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Pull vouchers from Tally for a date range.
   * Default bulk path: CUSTOMVOUCHERCOL + full parse (items + ledgerEntries into vouchers).
   * Pass `detailLevel: 'summary'` only for lightweight summary rows (future lazy-load plan).
   */
  async getVouchers(companyName, fromDate, toDate, options = {}) {
    const detailLevel = options.detailLevel || 'summary';

    if (detailLevel === 'summary') {
      try {
        this.voucherSyncLog.info('TALLY_VOUCHER_EXPORT_START', {
          companyName,
          fromDate,
          toDate,
          detailLevel: 'summary',
          exportMethod: 'custom_voucher_col_summary'
        });
        const { vouchers, exportMethod } = await this.getVouchersCustomColWithSplit(
          companyName,
          fromDate,
          toDate,
          { ...options, detailLevel: 'summary' }
        );
        this.voucherSyncLog.info('TALLY_VOUCHER_EXPORT_DONE', {
          companyName,
          fromDate,
          toDate,
          count: vouchers.length,
          exportMethod: exportMethod || 'custom_voucher_col_summary'
        });
        this.logger.info(`Retrieved ${vouchers.length} voucher summaries (CUSTOMVOUCHERCOL)`, {
          companyName,
          fromDate,
          toDate,
          exportMethod
        });
        return { vouchers, exportMethod: exportMethod || 'custom_voucher_col_summary' };
      } catch (error) {
        this.voucherSyncLog.error('TALLY_VOUCHER_EXPORT_FAILED', {
          companyName,
          fromDate,
          toDate,
          detailLevel: 'summary',
          message: error.message,
          stack: error.stack || null,
          code: error.code || null
        });
        if (this.shouldUsePaginatedVoucherFallback()) {
          try {
            const vouchers = await this.getVouchersViaTallySyncTs(companyName, fromDate, toDate);
            if (vouchers.length > 0) {
              this.voucherSyncLog.info('TALLY_VOUCHER_EXPORT_FALLBACK_OK', {
                companyName,
                fromDate,
                toDate,
                count: vouchers.length,
                exportMethod: 'tally_sync_ts_paginated'
              });
              return { vouchers, exportMethod: 'tally_sync_ts_paginated' };
            }
          } catch (fallbackError) {
            this.logger.warn('tally-sync-ts paginated summary fallback failed', {
              companyName,
              fromDate,
              toDate,
              message: fallbackError.message
            });
          }
        }
        this.logger.error('CUSTOMVOUCHERCOL summary export failed', {
          companyName,
          fromDate,
          toDate,
          message: error.message
        });
        throw error;
      }
    }

    try {
      const { vouchers, exportMethod } = await this.getVouchersCustomColWithSplit(
        companyName,
        fromDate,
        toDate,
        { ...options, detailLevel }
      );
      this.logger.info(`Retrieved ${vouchers.length} full vouchers (CUSTOMVOUCHERCOL)`, {
        companyName,
        fromDate,
        toDate,
        tallyFromDate: this.formatYyyyMmDd(fromDate),
        tallyToDate: this.formatYyyyMmDd(toDate),
        exportMethod,
        sampleItems: vouchers[0]?.items?.length ?? 0,
        sampleLedgers: vouchers[0]?.ledgerEntries?.length ?? 0,
        sampleVoucherDate: vouchers[0]?.date ?? null
      });
      return { vouchers, exportMethod };
    } catch (error) {
      this.logger.warn('CUSTOMVOUCHERCOL full export failed — falling back to legacy exports', {
        companyName,
        fromDate,
        toDate,
        message: error.message
      });
      if (options.customVoucherColOnly) {
        throw error;
      }
    }

    if (this.shouldUsePaginatedVoucherFallback()) {
      try {
        const vouchers = await this.getVouchersViaTallySyncTs(companyName, fromDate, toDate);
        if (vouchers.length > 0) {
          return { vouchers, exportMethod: 'tally_sync_ts_paginated' };
        }
      } catch (error) {
        this.logger.warn('tally-sync-ts paginated voucher export failed', {
          companyName,
          fromDate,
          toDate,
          message: error.message
        });
      }
    }

    const fromMs = new Date(`${fromDate}T00:00:00.000Z`).getTime();
    const toMs = new Date(`${toDate}T23:59:59.999Z`).getTime();
    const rangeDays = Math.max(1, Math.ceil((toMs - fromMs) / 86400000));
    /** EXPORTDATA Daybook + EXPLODEFLAG can return 100MB+ XML for multi-month ranges and stall sync for hours. */
    const MAX_DAYBOOK_REPORT_SPAN_DAYS = Number(options.maxDaybookReportSpanDays) || 35;

    const rangeVars = {
      SVCURRENTCOMPANY: companyName,
      SVFROMDATE: this.formatDdMmYyyy(fromDate),
      SVTODATE: this.formatDdMmYyyy(toDate),
      SVEXPORTFORMAT: '$$SysName:XML'
    };

    const tryImportPromptRecovery = (error, label) => {
      const msg = String(error?.message || '');
      if (msg.includes('import prompt')) {
        this.logger.warn('Tally returned import UI instead of voucher XML — trying next export', {
          label,
          companyName
        });
        return true;
      }
      if (error?.responseText) {
        try {
          if (this.isImportPromptResponse(this.parseXmlResponse(error.responseText))) {
            this.logger.warn('Tally import prompt detected in response — trying next export', {
              label,
              companyName
            });
            return true;
          }
        } catch {
          /* ignore parse errors */
        }
      }
      return false;
    };

    // TallyPrime: built-in report internal name is "Daybook" (HEADER <ID>Daybook</ID>).
    // Using "Day Book" becomes ID "DayBook" after space removal — wrong for many builds.
    const DAYBOOK_REPORT = 'Daybook';

    const attempts = [
      {
        id: 'daybook_yyyy',
        label: 'Day Book (YYYYMMDD simple export)',
        run: async () => {
          const xml = this.buildDayBookRequestYyyyMmDd(companyName, fromDate, toDate);
          const response = await this.sendRawXml(xml, {
            requestType: 'EXPORT',
            collection: 'DayBook-YYYYMMDD'
          });
          return this.filterVouchersByDateRange(
            this.extractVouchersFromResponse(response),
            fromDate,
            toDate
          );
        }
      },
      {
        id: 'voucher_collection',
        label: 'Voucher collection (VouchersForSync)',
        run: async () => {
          const xml = this.buildVoucherCollectionRequest(companyName, fromDate, toDate);
          const response = await this.sendRawXml(xml, {
            requestType: 'EXPORT',
            collection: 'VouchersForSync'
          });
          return this.filterVouchersByDateRange(
            this.extractVouchersFromResponse(response),
            fromDate,
            toDate
          );
        }
      },
      {
        id: 'daybook_report',
        label: `Daybook report (${DAYBOOK_REPORT})`,
        run: async () => {
          const xml = this.buildExportDataRequest(DAYBOOK_REPORT, {
            ...rangeVars,
            EXPLODEFLAG: 'Yes'
          });
          const response = await this.sendRawXml(xml, {
            requestType: 'EXPORT',
            collection: DAYBOOK_REPORT
          });
          return this.filterVouchersByDateRange(
            this.extractVouchersFromResponse(response),
            fromDate,
            toDate
          );
        }
      }
    ];

    let attemptsToRun = attempts;
    if (rangeDays > MAX_DAYBOOK_REPORT_SPAN_DAYS) {
      attemptsToRun = attempts.filter((a) => a.id !== 'daybook_report');
      this.logger.warn(
        'Skipping heavy Daybook report export — date range too wide (use smaller voucher windows in agent config)',
        { companyName, fromDate, toDate, rangeDays, maxSpan: MAX_DAYBOOK_REPORT_SPAN_DAYS }
      );
    }

    const preferred =
      options.preferredMethod === 'daybook_report' && rangeDays > MAX_DAYBOOK_REPORT_SPAN_DAYS
        ? null
        : options.preferredMethod || null;
    const ordered = preferred
      ? [
          ...attemptsToRun.filter((a) => a.id === preferred),
          ...attemptsToRun.filter((a) => a.id !== preferred)
        ]
      : attemptsToRun;

    try {
      for (const { id, label, run } of ordered) {
        try {
          const vouchers = await run();
          if (vouchers.length > 0) {
            this.logger.info(`Retrieved ${vouchers.length} vouchers from Tally (${label})`, {
              companyName,
              fromDate,
              toDate,
              exportMethod: id
            });
            return { vouchers, exportMethod: id };
          }
          this.logger.info(`No vouchers in range from ${label}`, { companyName, fromDate, toDate });
        } catch (error) {
          if (tryImportPromptRecovery(error, label)) {
            continue;
          }
          this.logger.error(`Failed to get vouchers from Tally (${label})`, error);
          throw error;
        }
      }

      this.logger.warn('No vouchers returned from Tally for date range (all export methods)', {
        companyName,
        fromDate,
        toDate
      });
      return { vouchers: [], exportMethod: preferred || null };
    } catch (error) {
      this.logger.error('Failed to get vouchers from Tally:', error);
      throw error;
    }
  }

  isPlDrillableGroup(displayName = '') {
    const name = String(displayName).trim();
    if (!name) return false;
    if (/^(add:|less:|opening|closing)/i.test(name)) return false;
    return true;
  }

  /**
   * TallyPrime P&L export: parallel DSPACCNAME[] and PLAMT[] at ENVELOPE root.
   */
  parseProfitAndLossFromEnvelope(env) {
    const entries = [];
    const names = this.ensureArray(env.DSPACCNAME);
    const amounts = this.ensureArray(env.PLAMT);
    const count = Math.max(names.length, amounts.length);

    for (let i = 0; i < count; i += 1) {
      const displayName = this.extractBalanceSheetDisplayName(names[i]);
      const amtNode = amounts[i] || {};
      const subAmount = this.toNumber(this.parseString(amtNode.PLSUBAMT));
      const mainAmount = this.toNumber(
        this.parseString(amtNode.BSMAINAMT ?? amtNode.MAINAMT ?? amtNode.PLSUBAMT)
      );
      if (!displayName && subAmount === 0 && mainAmount === 0) continue;
      entries.push({
        name: displayName,
        displayName,
        subAmount,
        mainAmount,
        isGroup: this.isPlDrillableGroup(displayName) && Math.abs(mainAmount) > 0
      });
    }
    return entries;
  }

  async getProfitAndLoss(companyName, fromDate, toDate) {
    const reportName = 'Profit and Loss';
    const empty = {
      reportName,
      fromDate,
      toDate,
      entries: [],
      totals: { subtotal: 0, grandTotal: 0 }
    };

    try {
      const from = this.formatYyyyMmDd(fromDate);
      const to = this.formatYyyyMmDd(toDate);
      let extra = `<SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>`;
      if (companyName) {
        extra += `
          <SVCURRENTCOMPANY>${this.escapeXmlForTally(companyName)}</SVCURRENTCOMPANY>`;
      }

      const simpleXml = this.buildSimpleExportEnvelope(reportName, extra);
      let response = await this.sendRawXml(simpleXml, {
        requestType: 'EXPORT',
        collection: reportName
      });

      if (response?.ENVELOPE) {
        const parsed = this.parseProfitAndLoss(response, fromDate, toDate);
        if (parsed.entries.length > 0) {
          return parsed;
        }
      }

      const tdlXml = this.buildExportDataRequest(reportName, {
        SVCURRENTCOMPANY: companyName,
        SVFROMDATE: this.formatDdMmYyyy(fromDate),
        SVTODATE: this.formatDdMmYyyy(toDate),
        SVEXPORTFORMAT: '$$SysName:XML'
      });
      response = await this.sendRawXml(tdlXml, { requestType: 'EXPORT', collection: reportName });
      if (response?.ENVELOPE) {
        return this.parseProfitAndLoss(response, fromDate, toDate);
      }

      return empty;
    } catch (error) {
      this.logger.error('Failed to get Profit and Loss from Tally:', error);
      throw error;
    }
  }

  /**
   * Group Summary net: credit − debit (Tally DSPCLCRAMTA positive, DSPCLDRAMTA negative).
   * Both-only → credit − |debit|; credit-only → +credit; debit-only → −|debit|.
   */
  computeGroupSummaryNetAmount(debitRaw, creditRaw) {
    const debitAbs = Math.abs(this.toNumber(debitRaw));
    const creditAbs = Math.abs(this.toNumber(creditRaw));
    if (creditAbs > 0 && debitAbs > 0) {
      return creditAbs - debitAbs;
    }
    if (creditAbs > 0) {
      return creditAbs;
    }
    if (debitAbs > 0) {
      return -debitAbs;
    }
    return 0;
  }

  /**
   * Group Summary for a P&L / Balance Sheet group (e.g. Current Liabilities → Provisions).
   * @param {object} env - Tally ENVELOPE
   * @param {Set<string>|null} groupNameSet - Tally Group master names (bold rows in Tally)
   */
  parseGroupSummaryFromEnvelope(env, groupNameSet = null) {
    const ledgers = [];
    const names = this.ensureArray(env.DSPACCNAME);
    const infos = this.ensureArray(env.DSPACCINFO);
    const count = Math.max(names.length, infos.length);

    for (let i = 0; i < count; i += 1) {
      const displayName = this.extractBalanceSheetDisplayName(names[i]);
      if (!displayName) continue;

      const info = infos[i] || {};
      const debitRaw = this.toNumber(
        this.parseString(info.DSPCLDRAMT?.DSPCLDRAMTA ?? info.DSPCLDRAMT)
      );
      const creditRaw = this.toNumber(
        this.parseString(info.DSPCLCRAMT?.DSPCLCRAMTA ?? info.DSPCLCRAMT)
      );
      const debitAbs = Math.abs(debitRaw);
      const creditAbs = Math.abs(creditRaw);
      const amount = this.computeGroupSummaryNetAmount(debitRaw, creditRaw);

      if (amount === 0 && debitAbs === 0 && creditAbs === 0) continue;

      const isGroup =
        groupNameSet instanceof Set
          ? groupNameSet.has(displayName.trim())
          : this.isPlDrillableGroup(displayName) && Math.abs(amount) > 0;

      ledgers.push({
        name: displayName,
        displayName,
        debit: debitAbs,
        credit: creditAbs,
        amount,
        isGroup
      });
    }

    return ledgers;
  }

  buildGroupsCollectionXml(companyName) {
    const comp = this.escapeXmlForTally(companyName || '');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllGroups</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${comp}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No" NAME="AllGroups">
            <TYPE>Group</TYPE>
            <NATIVEMETHOD>NAME</NATIVEMETHOD>
            <NATIVEMETHOD>PARENT</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
  }

  buildLedgersMasterCollectionXml(companyName) {
    const comp = this.escapeXmlForTally(companyName || '');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllLedgersMaster</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${comp}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No" NAME="AllLedgersMaster">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>NAME</NATIVEMETHOD>
            <NATIVEMETHOD>PARENT</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
  }

  parseTallyMasterNodes(response, nodeKey) {
    const nodes = this.findNodesByKey(response, nodeKey);
    const accounts = [];
    for (const node of nodes) {
      const name = this.parseString(node?.NAME || node?.['@_NAME']);
      if (!name) continue;
      const parentGroup = this.parseString(node?.PARENT || node?.['@_PARENT']);
      const guid = this.parseString(node?.GUID || node?.['@_GUID']);
      accounts.push({
        name,
        parentGroup: parentGroup || '',
        guid,
        accountType: nodeKey === 'GROUP' ? 'group' : 'ledger'
      });
    }
    return accounts;
  }

  async getTallyAccountMasters(companyName) {
    const empty = { groups: [], ledgers: [], accounts: [] };
    try {
      const groupXml = this.buildGroupsCollectionXml(companyName);
      const groupResp = await this.sendRawXml(groupXml, {
        requestType: 'EXPORT',
        collection: 'AllGroups'
      });
      const groups = this.parseTallyMasterNodes(groupResp, 'GROUP');

      const ledgerXml = this.buildLedgersMasterCollectionXml(companyName);
      const ledgerResp = await this.sendRawXml(ledgerXml, {
        requestType: 'EXPORT',
        collection: 'AllLedgersMaster'
      });
      const ledgers = this.parseTallyMasterNodes(ledgerResp, 'LEDGER');

      const accounts = [
        ...groups.map((g) => ({ ...g, accountType: 'group' })),
        ...ledgers.map((l) => ({ ...l, accountType: 'ledger' }))
      ];

      return { groups, ledgers, accounts };
    } catch (error) {
      this.logger.error('Failed to fetch Tally account masters:', error);
      return empty;
    }
  }

  async getGroupSummary(companyName, groupName, fromDate, toDate, options = {}) {
    const reportName = 'Group Summary';
    const empty = { reportName, groupName, fromDate, toDate, ledgers: [] };

    try {
      const from = this.formatYyyyMmDd(fromDate);
      const to = this.formatYyyyMmDd(toDate);
      const group = this.escapeXmlForTally(groupName);
      let extra = `<SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>
          <GROUPNAME>${group}</GROUPNAME>`;
      if (companyName) {
        extra += `
          <SVCURRENTCOMPANY>${this.escapeXmlForTally(companyName)}</SVCURRENTCOMPANY>`;
      }

      const xml = this.buildSimpleExportEnvelope(reportName, extra);
      const response = await this.sendRawXml(xml, {
        requestType: 'EXPORT',
        collection: 'GroupSummary'
      });

      if (!response?.ENVELOPE) return empty;

      const ledgers = this.parseGroupSummaryFromEnvelope(
        response.ENVELOPE,
        options.groupNameSet || null
      );
      return { reportName, groupName, fromDate, toDate, ledgers };
    } catch (error) {
      this.logger.error('Failed to get Group Summary from Tally:', error);
      throw error;
    }
  }

  /**
   * Balance Sheet export: SVFROMDATE = books/FY start, SVTODATE = as-on date (YYYYMMDD simple export).
   * Matches TallyPrime "Export Data" for Balance Sheet (same period keys as P&L sync).
   */
  async getBalanceSheet(companyName, booksFromDate, asOfDate) {
    const reportName = 'Balance Sheet';
    const empty = {
      reportName,
      asOfDate,
      toDate: asOfDate,
      entries: [],
      totals: { subtotal: 0, grandTotal: 0 }
    };

    try {
      const from = this.formatYyyyMmDd(booksFromDate);
      const to = this.formatYyyyMmDd(asOfDate);
      let extra = `<SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>`;
      if (companyName) {
        extra += `
          <SVCURRENTCOMPANY>${this.escapeXmlForTally(companyName)}</SVCURRENTCOMPANY>`;
      }

      const simpleXml = this.buildSimpleExportEnvelope(reportName, extra);
      let response = await this.sendRawXml(simpleXml, {
        requestType: 'EXPORT',
        collection: reportName
      });

      if (response?.ENVELOPE) {
        const parsed = this.parseBalanceSheet(response, asOfDate);
        if (parsed.entries.length > 0) {
          this.logger.info('Balance Sheet parsed (simple export)', {
            companyName,
            from,
            to,
            entryCount: parsed.entries.length
          });
          return parsed;
        }
      }

      this.logger.warn('Balance Sheet simple export returned no lines — trying TDL export', {
        companyName,
        from,
        to
      });

      const tdlXml = this.buildExportDataRequest(reportName, {
        SVCURRENTCOMPANY: companyName,
        SVFROMDATE: from,
        SVTODATE: to,
        SVEXPORTFORMAT: '$$SysName:XML'
      });
      response = await this.sendRawXml(tdlXml, { requestType: 'EXPORT', collection: reportName });
      if (response?.ENVELOPE) {
        const parsed = this.parseBalanceSheet(response, asOfDate);
        this.logger.info('Balance Sheet parsed (TDL export)', {
          companyName,
          entryCount: parsed.entries.length
        });
        return parsed;
      }

      return empty;
    } catch (error) {
      this.logger.error('Failed to get Balance Sheet from Tally:', error);
      throw error;
    }
  }

  async getStockItems(companyName) {
    if (this.shouldUsePaginatedMasters()) {
      try {
        const raw = await this.tallySyncTs.fetchStockItems(
          companyName,
          this.getTallySyncTsPageSize()
        );
        const items = raw.map(mapStockItemRow).filter(Boolean);
        if (items.length > 0) {
          if (this.shouldEnrichStockBalances()) {
            this.logger.info(
              `Retrieved ${items.length} stock items (tally-sync-ts paginated); enriching via TDL for stock balances`
            );
          } else {
            this.logger.info(
              `Retrieved ${items.length} stock items from Tally (tally-sync-ts paginated)`
            );
            return items;
          }
        }
      } catch (error) {
        this.logger.warn('getStockItems via tally-sync-ts failed; using TDL export', {
          companyName,
          error: error.message
        });
      }
    }

    try {
      const xmlRequest = this.buildCustomMasterCollectionXml(
        companyName,
        'CUSTOMSTOCKITEMCOL',
        'StockItem',
        ['*', 'OpeningBalance', 'InwardQuantity', 'OutwardQuantity', 'ClosingBalance', 'ClosingValue', 'ClosingRate']
      );
      const response = await this.sendRawXml(xmlRequest, { requestType: 'EXPORT', collection: 'StockItems' });

      if (response && response.ENVELOPE && response.ENVELOPE.BODY) {
        const items = await this.extractStockItemsFromResponseAsync(response);
        this.logger.info(`Retrieved ${items.length} stock items from Tally`);
        return items;
      }

      return [];
    } catch (error) {
      this.logger.error('Failed to get stock items from Tally:', error);
      throw error;
    }
  }

  /**
   * One Tally export: all company ledgers. Sundry debtors/creditors → party rows (rich fields);
   * others → ledger rows (name, parent, guid). Parent group drives classification — no second HTTP call.
   */
  async getCompanyLedgersForPartySync(companyName) {
    if (this.shouldUsePaginatedMasters()) {
      try {
        const raw = await this.tallySyncTs.fetchLedgers(
          companyName,
          this.getTallySyncTsPageSize()
        );
        const rows = raw.map(mapLedgerToPartySyncRow).filter(Boolean);
        if (rows.length > 0) {
          const partyCount = rows.filter((r) => r.recordType === 'party').length;
          this.logger.info(
            `Retrieved ${rows.length} ledgers via tally-sync-ts (${partyCount} parties)`
          );
          return rows;
        }
      } catch (error) {
        this.logger.warn('getCompanyLedgersForPartySync via tally-sync-ts failed; using TDL', {
          companyName,
          error: error.message
        });
      }
    }

    try {
      const xmlRequest = this.buildLedgersPartyCollectionXml(companyName);
      const response = await this.sendRawXml(xmlRequest, {
        requestType: 'EXPORT',
        collection: 'Ledgers'
      });

      if (response?.ENVELOPE?.BODY) {
        const rows = await this.extractLedgersForPartySyncFromResponseAsync(response);
        const partyCount = rows.filter((r) => r.recordType === 'party').length;
        this.logger.info(
          `Retrieved ${rows.length} ledgers for party sync (${partyCount} sundry, ${rows.length - partyCount} other ledgers)`
        );
        return rows;
      }

      return [];
    } catch (error) {
      this.logger.error('Failed to get company ledgers for party sync:', error);
      throw error;
    }
  }

  async getParties(companyName) {
    const rows = await this.getCompanyLedgersForPartySync(companyName);
    return rows.filter((r) => r.recordType === 'party');
  }

  buildCustomMasterCollectionXml(companyName, collectionId, masterType, nativeMethods = []) {
    const comp = this.escapeXmlForTally(companyName || '');
    const nativeLines = nativeMethods
      .map((m) => `            <NATIVEMETHOD>${m}</NATIVEMETHOD>`)
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE Action="">
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>EXPORT</TALLYREQUEST>
    <TYPE>COLLECTION</TYPE>
    <ID>${collectionId}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${comp}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No" NAME="${collectionId}">
            <TYPE>${masterType}</TYPE>
${nativeLines}
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
  }

  parseVoucherTypeRow(node) {
    const name = this.parseString(node?.['@_NAME'] || node?.NAME);
    if (!name) return null;
    const parent = this.parseString(
      node?.PARENT?.['#text'] ?? node?.PARENT ?? node?.['@_PARENT']
    );
    const reservedName = this.parseString(node?.['@_RESERVEDNAME'] || node?.RESERVEDNAME);
    return { name, parent, reservedName };
  }

  parseSimpleNamedMaster(node) {
    const name = this.parseString(node?.['@_NAME'] || node?.NAME);
    if (!name) return null;
    const reservedName = this.parseString(node?.['@_RESERVEDNAME'] || node?.RESERVEDNAME);
    return { name, reservedName };
  }

  async getVoucherTypes(companyName) {
    if (this.shouldUsePaginatedMasters()) {
      try {
        const raw = await this.tallySyncTs.fetchVoucherTypes(
          companyName,
          this.getTallySyncTsPageSize()
        );
        const rows = raw.map(mapSimpleMasterRow).filter(Boolean);
        if (rows.length > 0) {
          this.logger.info(`Retrieved ${rows.length} voucher types (tally-sync-ts)`);
          return rows;
        }
      } catch (error) {
        this.logger.warn('getVoucherTypes via tally-sync-ts failed', { error: error.message });
      }
    }

    try {
      const xmlRequest = this.buildCustomMasterCollectionXml(
        companyName,
        'CUSTOMVOUCHERTYPECOL',
        'VoucherType',
        ['PARENT']
      );
      const response = await this.sendRawXml(xmlRequest, {
        requestType: 'EXPORT',
        collection: 'CUSTOMVOUCHERTYPECOL'
      });
      const nodes = this.findNodesByKey(response, 'VOUCHERTYPE');
      const rows = nodes.map((n) => this.parseVoucherTypeRow(n)).filter(Boolean);
      this.logger.info(`Retrieved ${rows.length} voucher types from Tally`);
      return rows;
    } catch (error) {
      this.logger.error('Failed to get voucher types from Tally:', error);
      throw error;
    }
  }

  async getGodowns(companyName) {
    if (this.shouldUsePaginatedMasters()) {
      try {
        const raw = await this.tallySyncTs.fetchGodowns(companyName, this.getTallySyncTsPageSize());
        const rows = raw.map(mapSimpleMasterRow).filter(Boolean);
        if (rows.length > 0) {
          this.logger.info(`Retrieved ${rows.length} godowns (tally-sync-ts)`);
          return rows;
        }
      } catch (error) {
        this.logger.warn('getGodowns via tally-sync-ts failed', { error: error.message });
      }
    }

    try {
      const xmlRequest = this.buildCustomMasterCollectionXml(
        companyName,
        'CUSTOMGODOWNCOL',
        'Godown',
        []
      );
      const response = await this.sendRawXml(xmlRequest, {
        requestType: 'EXPORT',
        collection: 'CUSTOMGODOWNCOL'
      });
      const nodes = this.findNodesByKey(response, 'GODOWN');
      const rows = nodes.map((n) => this.parseSimpleNamedMaster(n)).filter(Boolean);
      this.logger.info(`Retrieved ${rows.length} godowns from Tally`);
      return rows;
    } catch (error) {
      this.logger.error('Failed to get godowns from Tally:', error);
      throw error;
    }
  }

  async getUnits(companyName) {
    if (this.shouldUsePaginatedMasters()) {
      try {
        const raw = await this.tallySyncTs.fetchUnits(companyName, this.getTallySyncTsPageSize());
        const rows = raw.map(mapSimpleMasterRow).filter(Boolean);
        if (rows.length > 0) {
          this.logger.info(`Retrieved ${rows.length} units (tally-sync-ts)`);
          return rows;
        }
      } catch (error) {
        this.logger.warn('getUnits via tally-sync-ts failed', { error: error.message });
      }
    }

    try {
      const xmlRequest = this.buildCustomMasterCollectionXml(
        companyName,
        'CUSTOMUNITCOL',
        'Unit',
        []
      );
      const response = await this.sendRawXml(xmlRequest, {
        requestType: 'EXPORT',
        collection: 'CUSTOMUNITCOL'
      });
      const nodes = this.findNodesByKey(response, 'UNIT');
      const rows = nodes.map((n) => this.parseSimpleNamedMaster(n)).filter(Boolean);
      this.logger.info(`Retrieved ${rows.length} units from Tally`);
      return rows;
    } catch (error) {
      this.logger.error('Failed to get units from Tally:', error);
      throw error;
    }
  }

  /** Minimal ledger list (name/parent/guid). Party sync uses {@link getCompanyLedgersForPartySync} instead. */
  async getAllLedgers(companyName) {
    try {
      const ledgerXml = this.buildLedgersMasterCollectionXml(companyName);
      const ledgerResp = await this.sendRawXml(ledgerXml, {
        requestType: 'EXPORT',
        collection: 'AllLedgersMaster'
      });
      const ledgers = this.parseTallyMasterNodes(ledgerResp, 'LEDGER').map((l) => ({
        ...l,
        accountType: 'ledger'
      }));
      this.logger.info(`Retrieved ${ledgers.length} ledgers from Tally`);
      return ledgers;
    } catch (error) {
      this.logger.error('Failed to get ledgers from Tally:', error);
      throw error;
    }
  }

  buildXmlRequest(requestType, collection, options = {}) {
    const envelope = {
      ENVELOPE: {
        HEADER: {
          VERSION: 1,
          TALLYREQUEST: requestType
        },
        BODY: {
          EXPORTDATA: {
            REQUESTDESC: {
              REPORTNAME: collection,
              ...options
            }
          }
        }
      }
    };

    let xml = this.xmlBuilder.build(envelope);
    if (!xml.startsWith('<?xml')) {
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    }
    this.logger.info('Built Tally XML request envelope', {
      requestType,
      collection,
      optionKeys: Object.keys(options)
    });
    return xml;
  }

  parseXmlResponse(xmlString) {
    try {
      return this.xmlParser.parse(xmlString);
    } catch (error) {
      this.logger.error('Failed to parse XML response:', error);
      throw new Error('Invalid XML response from Tally');
    }
  }

  isImportPromptResponse(parsedResponse) {
    if (!parsedResponse || typeof parsedResponse !== 'object') {
      return false;
    }

    const importPromptKeys = ['IMPORTFORMAT', 'IMPORTPATH', 'IMPORTFILE', 'IMPORTISBACKUPENABLED', 'IMPORTBACKUPPATH'];
    const containsImportPrompt = (node) => {
      if (!node || typeof node !== 'object') return false;
      if (Array.isArray(node)) return node.some(containsImportPrompt);

      return Object.keys(node).some((key) => {
        if (importPromptKeys.includes(key)) {
          return true;
        }
        return containsImportPrompt(node[key]);
      });
    };

    return containsImportPrompt(parsedResponse);
  }

  extractCompaniesFromResponse(response) {
    const companies = [];

    try {
      const companyNodes = this.findNodesByKey(response, 'COMPANY');
      companyNodes.forEach((company) => {
        if (company && typeof company === 'object') {
          companies.push(this.parseCompanyData(company));
        }
      });
    } catch (error) {
      this.logger.error('Failed to extract companies from response:', error);
    }

    return companies;
  }

  extractVouchersFromResponse(response) {
    const vouchers = [];

    try {
      const voucherNodes = this.findNodesByKey(response, 'VOUCHER');
      voucherNodes.forEach((voucher) => {
        if (voucher && typeof voucher === 'object') {
          const row = this.parseVoucherData(voucher);
          if (row.voucherNumber || row.guid || row.tallyId) {
            vouchers.push(row);
          }
        }
      });
    } catch (error) {
      this.logger.error('Failed to extract vouchers from response:', error);
    }

    return vouchers;
  }

  extractStockItemsFromResponse(response) {
    const items = [];

    try {
      const stockItemNodes = this.findNodesByKey(response, 'STOCKITEM');
      stockItemNodes.forEach((item) => items.push(this.parseStockItemData(item)));
    } catch (error) {
      this.logger.error('Failed to extract stock items from response:', error);
    }

    return items;
  }

  async extractStockItemsFromResponseAsync(response) {
    try {
      return await this.extractNodesAsync(
        response,
        'STOCKITEM',
        (item) => {
          const row = this.parseStockItemData(item);
          return row?.name ? row : null;
        }
      );
    } catch (error) {
      this.logger.error('Failed to extract stock items from response:', error);
      return [];
    }
  }

  findNodesByKey(node, keyName) {
    const result = [];

    const walk = (current) => {
      if (!current || typeof current !== 'object') return;
      if (Array.isArray(current)) {
        current.forEach(walk);
        return;
      }

      Object.entries(current).forEach(([key, value]) => {
        if (key === keyName) {
          if (Array.isArray(value)) {
            const filtered = value.filter((item) => item && Object.keys(item).length > 0);
            result.push(...filtered);
          } else if (value && Object.keys(value).length > 0) {
            result.push(value);
          }
        }
        walk(value);
      });
    };

    walk(node);
    return result;
  }

  async extractVouchersFromResponseAsync(response) {
    try {
      return await this.extractNodesAsync(response, 'VOUCHER', (voucher) => {
        if (!voucher || typeof voucher !== 'object') return null;
        const row = this.parseVoucherData(voucher);
        if (row.voucherNumber || row.guid || row.tallyId) {
          return row;
        }
        return null;
      });
    } catch (error) {
      this.logger.error('Failed to extract vouchers from response:', error);
      return [];
    }
  }

  parseVoucherData(voucher) {
    const typeFields = this.resolveVoucherTypeFields(voucher);
    const { items, ledgerEntries } = this.parseVoucherLines(voucher);

    const tallyPersistedView = this.parsePersistedView(voucher);
    const tallyEntryMode = this.resolveTallyVoucherEntryMode(voucher, items, ledgerEntries);

    this.logger.debug('Parsed voucher data', {
      voucherNumber: this.parseString(voucher?.VOUCHERNUMBER),
      voucherType: typeFields.voucherType,
      tallyVoucherTypeParent: typeFields.tallyVoucherTypeParent,
      tallyVoucherTypeName: typeFields.tallyVoucherTypeName,
      tallyPersistedView,
      vchEntryModeRaw: this.parseString(voucher?.VCHENTRYMODE),
      tallyEntryMode,
      itemCount: items.length,
      ledgerEntryCount: ledgerEntries.length,
      hasAllinventoryEntries: !!voucher?.['ALLINVENTORYENTRIES.LIST'],
      hasAllledgerEntries: !!voucher?.['ALLLEDGERENTRIES.LIST'],
      hasLedgerEntries: !!voucher?.['LEDGERENTRIES.LIST']
    });

    const totals = this.calculateVoucherTotals(items, ledgerEntries, voucher);
    const shipping = this.parseShippingDetails(voucher);

    return {
      voucherNumber: this.parseString(voucher?.VOUCHERNUMBER),
      voucherType: typeFields.voucherType,
      tallyVoucherTypeParent: typeFields.tallyVoucherTypeParent,
      tallyVoucherTypeName: typeFields.tallyVoucherTypeName,
      tallyPersistedView,
      tallyEntryMode,
      date: this.parseTallyDate(voucher?.DATE),
      amount: totals.grandTotal,
      partyName: this.parseString(voucher?.PARTYNAME || voucher?.PARTYLEDGERNAME || voucher?.BASICBUYERNAME || voucher?.PARTYMAILINGNAME),
      gstRegistration: this.parseString(voucher?.GSTREGISTRATION?.['#text'] || voucher?.GSTREGISTRATION?.['@_TAXREGISTRATION'] || voucher?.GSTREGISTRATION),
      placeOfSupply: this.parseString(voucher?.PLACEOFSUPPLY),
      stateName: this.parseString(voucher?.STATENAME),
      gstIn: this.parseString(voucher?.PARTYGSTIN || voucher?.CONSIGNEEGSTIN),
      reference: this.parseString(voucher?.REFERENCE),
      referenceDate: this.parseTallyDate(voucher?.REFERENCEDATE),
      narration: this.parseString(voucher?.NARRATION || voucher?.ADDITIONALNARRATION),
      guid: this.parseString(voucher?.GUID || voucher?.['@_GUID']),
      alterId: this.parseString(voucher?.ALTERID || voucher?.['@_ALTERID']),
      alterid: this.parseString(voucher?.ALTERID || voucher?.['@_ALTERID']),
      masterId: this.parseString(voucher?.MASTERID || voucher?.['@_MASTERID']),
      voucherKey: this.parseString(voucher?.VOUCHERKEY || voucher?.['@_VOUCHERKEY']),
      shipping,
      totals,
      items,
      ledgerEntries,
      ledgerNames: ledgerEntries.map((e) => e.ledgerName || e.name).filter(Boolean),
      hasInventory: items.length > 0,
      detailLevel: 'full',
      tallyId: this.parseString(voucher?.GUID || voucher?.['@_GUID'] || voucher?.['@_REMOTEID'] || voucher?.VCHKEY)
    };
  }

  inferVchEntryMode(items, ledgerEntries) {
    if (items.length > 0 && ledgerEntries.some((e) => /cgst|sgst|igst/i.test(e.name || ''))) {
      return 'item_invoice';
    }
    if (items.length > 0 && ledgerEntries.length > 0) {
      return 'as_voucher';
    }
    if (items.length === 0 && ledgerEntries.length > 0) {
      return 'accounting_invoice';
    }
    return 'item_invoice';
  }

  parseBillAllocationsFromEntry(entry) {
    const subLines = [];
    const bills = entry?.['BILLALLOCATIONS.LIST'];
    const list = Array.isArray(bills) ? bills : bills ? [bills] : [];

    for (const bill of list) {
      const refName = this.parseString(bill?.NAME);
      const billType = this.parseString(bill?.BILLTYPE);
      const rawAmt = this.toNumber(bill?.AMOUNT);
      if (!refName && !billType && rawAmt === 0) continue;

      const amtAbs = Math.abs(rawAmt);
      let side = '';
      if (rawAmt < 0) side = 'Dr';
      else if (rawAmt > 0) side = 'Cr';

      const label = [billType, refName].filter(Boolean).join(' ').trim() || 'On Account';
      const text =
        amtAbs > 0
          ? `${label} | ${amtAbs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${side}`.trim()
          : label;
      subLines.push({ text, billType, amount: amtAbs, side });
    }

    const lineNarration = this.parseString(entry?.NARRATION);
    if (lineNarration) {
      subLines.push({ text: lineNarration, isNarration: true });
    }

    return subLines;
  }

  mapLedgerRowFromTally(entry) {
    const rawAmount = this.toNumber(entry?.AMOUNT);
    const name = this.parseString(entry?.LEDGERNAME || entry?.PARTYLEDGERNAME);
    const amt = Math.abs(rawAmount);
    let debit = 0;
    let credit = 0;
    if (rawAmount < 0) {
      debit = amt;
    } else if (rawAmount > 0) {
      credit = amt;
    }
    const subLines = this.parseBillAllocationsFromEntry(entry);
    return {
      name,
      ledgerName: name,
      ledgerId: name,
      narration: this.parseString(entry?.NARRATION),
      subLines,
      amount: amt,
      debit,
      credit,
      type: debit > 0 ? 'debit' : 'credit',
      isPartyLedger: String(entry?.ISPARTYLEDGER).toLowerCase() === 'yes'
    };
  }

  /**
   * Combine ledger rows from item accounting allocations, LEDGERENTRIES.LIST, and ALLLEDGERENTRIES.LIST.
   */
  mergeLedgerEntryLists(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const row of list || []) {
        const name = String(row?.ledgerName || row?.name || '').trim();
        if (!name) continue;
        const debit = Number(row?.debit || 0);
        const credit = Number(row?.credit || 0);
        if (debit <= 0 && credit <= 0) continue;
        const key = `${name}|${debit}|${credit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
    }
    return out;
  }

  parseString(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      return this.parseString(value[0]);
    }
    if (typeof value === 'object') {
      if (typeof value['#text'] !== 'undefined') {
        return String(value['#text']).trim();
      }
      if (typeof value['@_NAME'] !== 'undefined') {
        return String(value['@_NAME']).trim();
      }
      return '';
    }
    return String(value).trim();
  }

  /**
   * Tally RATE is often "100.00/FT" — use the numeric part before "/".
   */
  parseInventoryRate(entry) {
    const raw = entry?.RATE;
    if (raw == null) return 0;
    const s = this.parseString(raw);
    const head = s.split('/')[0];
    return this.toNumber(head);
  }

  /**
   * Tally exports CGST, SGST, and IGST rate rows together; only one pair applies.
   * Use CGST+SGST when either is set, otherwise IGST (inter-state).
   */
  effectiveGstPercent(gstRates) {
    const cgst = Number(gstRates?.cgst || 0);
    const sgst = Number(gstRates?.sgst || 0);
    const igst = Number(gstRates?.igst || 0);
    if (cgst > 0 || sgst > 0) {
      return cgst + sgst;
    }
    return igst;
  }

  parseInventoryLine(entry) {
    const { quantity, unit } = this.parseQuantityAndUnit(
      entry?.ACTUALQTY || entry?.BILLEDQTY || entry?.UNIT
    );
    const rate = this.parseInventoryRate(entry);
    const lineAmountXml = Math.abs(this.toNumber(entry?.AMOUNT));
    const gstRates = this.parseRateDetails(entry?.['RATEDETAILS.LIST']);
    const effectivePct = this.effectiveGstPercent(gstRates);
    const qtyRateBase = quantity * rate;
    const taxableLine = lineAmountXml > 0 ? lineAmountXml : qtyRateBase;
    const taxAmount = Number(((taxableLine * effectivePct) / 100).toFixed(2));
    const name = this.parseString(entry?.STOCKITEMNAME);
    const taxRate = effectivePct + (gstRates.cess || 0);

    return {
      name,
      itemName: name,
      itemId: this.parseString(entry?.STOCKITEMNAME || entry?.STOCKITEMNAME?.['@_NAME']),
      description: this.parseString(entry?.NARRATION || entry?.DESCRIPTION),
      quantity,
      unit,
      rate,
      taxable: true,
      hsnCode: this.parseString(entry?.GSTHSNNAME || entry?.HSNITEMSOURCE),
      gst: {
        cgst: gstRates.cgst || 0,
        sgst: gstRates.sgst || 0,
        igst: gstRates.cgst > 0 || gstRates.sgst > 0 ? 0 : gstRates.igst || 0,
        cess: gstRates.cess || 0
      },
      taxRate,
      taxAmount,
      amount: taxableLine
    };
  }

  parseInventoryItems(voucher) {
    const inventory = voucher?.['ALLINVENTORYENTRIES.LIST'];
    const list = Array.isArray(inventory) ? inventory : inventory ? [inventory] : [];
    return list
      .filter((entry) => entry && this.parseString(entry?.STOCKITEMNAME))
      .map((entry) => this.parseInventoryLine(entry));
  }

  /**
   * As Voucher: stock lines live under ALLLEDGERENTRIES → INVENTORYALLOCATIONS.LIST
   */
  parseInventoryAllocationItems(voucher) {
    const ledgers = voucher?.['ALLLEDGERENTRIES.LIST'];
    const list = Array.isArray(ledgers) ? ledgers : ledgers ? [ledgers] : [];
    const items = [];

    for (const ledgerEntry of list) {
      const alloc = ledgerEntry?.['INVENTORYALLOCATIONS.LIST'];
      const allocs = Array.isArray(alloc) ? alloc : alloc ? [alloc] : [];
      for (const inv of allocs) {
        if (!this.parseString(inv?.STOCKITEMNAME)) continue;
        items.push(this.parseInventoryLine(inv));
      }
    }
    return items;
  }

  /**
   * Sales and other ledgers posted from item rows (ACCOUNTINGALLOCATIONS.LIST).
   */
  parseInventoryAccountingLedgers(voucher) {
    const inventory = voucher?.['ALLINVENTORYENTRIES.LIST'];
    const list = Array.isArray(inventory) ? inventory : (inventory ? [inventory] : []);
    const out = [];

    for (const invLine of list) {
      const alloc = invLine?.['ACCOUNTINGALLOCATIONS.LIST'];
      const allocs = Array.isArray(alloc) ? alloc : alloc ? [alloc] : [];
      for (const a of allocs) {
        const name = this.parseString(a?.LEDGERNAME);
        if (!name) continue;
        const rawAmount = this.toNumber(a?.AMOUNT);
        const amt = Math.abs(rawAmount);
        if (amt <= 0) continue;
        const debit = rawAmount < 0 ? amt : 0;
        const credit = rawAmount > 0 ? amt : 0;
        // Only the stock item sales/purchase account (e.g. "Sales GST", "Purchase GST").
        // Tax ledgers (CGST/SGST/IGST) live under LEDGERENTRIES.LIST and must stay visible.
        const isStockAccountAllocation = /^(sales|purchase)(\s|$)/i.test(name);
        out.push({
          name,
          ledgerName: name,
          ledgerId: name,
          narration: this.parseString(a?.NARRATION),
          amount: amt,
          debit,
          credit,
          type: debit > 0 ? 'debit' : 'credit',
          fromInventoryAccounting: isStockAccountAllocation
        });
      }
    }
    return out;
  }

  /**
   * Item / Accounting Invoice: LEDGERENTRIES.LIST
   */
  parseLedgerEntries(voucher) {
    const ledgers = voucher?.['LEDGERENTRIES.LIST'];
    const list = Array.isArray(ledgers) ? ledgers : ledgers ? [ledgers] : [];

    return list
      .map((entry) => this.mapLedgerRowFromTally(entry))
      .filter((row) => row.name && (row.debit > 0 || row.credit > 0));
  }

  /**
   * As Voucher: ALLLEDGERENTRIES.LIST (double-entry layout in Tally)
   */
  parseAllLedgerEntries(voucher) {
    const ledgers = voucher?.['ALLLEDGERENTRIES.LIST'];
    const list = Array.isArray(ledgers) ? ledgers : ledgers ? [ledgers] : [];

    return list
      .map((entry) => this.mapLedgerRowFromTally(entry))
      .filter((row) => row.name && (row.debit > 0 || row.credit > 0));
  }

  parseQuantityAndUnit(value) {
    const raw = this.parseString(value);
    if (!raw) {
      return { quantity: 0, unit: 'Nos' };
    }

    const numericMatch = raw.match(/^[+-]?\d+(?:\.\d+)?/);
    const quantity = numericMatch ? Number(numericMatch[0]) : 0;
    const unitPart = raw.slice(numericMatch?.[0]?.length || 0).trim();
    const unit = unitPart.replace(/\.*$/, '').trim();

    return {
      quantity,
      unit: unit || 'Nos'
    };
  }

  parseRateDetails(rateDetails) {
    const details = Array.isArray(rateDetails) ? rateDetails : (rateDetails ? [rateDetails] : []);
    const result = { cgst: 0, sgst: 0, igst: 0, cess: 0 };

    details.forEach(detail => {
      const type = this.parseString(detail?.GSTRATEDUTYHEAD || detail?.GSTRATEHEAD);
      const rate = this.toNumber(detail?.GSTRATE || detail?.RATE || 0);
      if (type.toLowerCase().includes('cgst')) result.cgst = rate;
      if (type.toLowerCase().includes('sgst') || type.toLowerCase().includes('utgst')) result.sgst = rate;
      if (type.toLowerCase().includes('igst')) result.igst = rate;
      if (type.toLowerCase().includes('cess')) result.cess = rate;
    });

    return result;
  }

  parseProfitAndLoss(response, fromDate = null, toDate = null) {
    const env = response?.ENVELOPE || response || {};
    const flatEntries = this.parseProfitAndLossFromEnvelope(env);
    if (flatEntries.length > 0) {
      const totals = {
        subtotal: flatEntries.reduce((sum, entry) => sum + entry.subAmount, 0),
        grandTotal: flatEntries.reduce((sum, entry) => sum + entry.mainAmount, 0)
      };
      return {
        reportName: 'Profit and Loss',
        fromDate: fromDate ? this.parseTallyDate(fromDate) : null,
        toDate: toDate ? this.parseTallyDate(toDate) : null,
        entries: flatEntries,
        totals
      };
    }

    const entries = [];

    const addEntry = (displayName, subAmtRaw, mainAmtRaw) => {
      const name = this.parseString(displayName);
      const subAmount = this.toNumber(this.parseString(subAmtRaw));
      const mainAmount = this.toNumber(this.parseString(mainAmtRaw));
      if (!name && subAmount === 0 && mainAmount === 0) {
        return;
      }
      entries.push({
        name,
        displayName: name,
        subAmount,
        mainAmount,
        isGroup: this.isPlDrillableGroup(name) && Math.abs(mainAmount) > 0
      });
    };

    const pairEntries = (dsp, pl) => {
      const dspArray = Array.isArray(dsp) ? dsp : [dsp];
      const plArray = Array.isArray(pl) ? pl : [pl];
      const count = Math.max(dspArray.length, plArray.length);
      for (let i = 0; i < count; i += 1) {
        const dspNode = dspArray[i];
        const plNode = plArray[i];
        const displayName = this.parseString(dspNode?.DSPDISPNAME || dspNode);
        const subAmtRaw = plNode?.PLSUBAMT;
        const mainAmtRaw = plNode?.BSMAINAMT;
        addEntry(displayName, subAmtRaw, mainAmtRaw);
      }
    };

    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      if (node.DSPACCNAME && node.PLAMT) {
        pairEntries(node.DSPACCNAME, node.PLAMT);
      }

      Object.values(node).forEach(walk);
    };

    walk(response);

    const totals = {
      subtotal: entries.reduce((sum, entry) => sum + entry.subAmount, 0),
      grandTotal: entries.reduce((sum, entry) => sum + entry.mainAmount, 0)
    };

    return {
      reportName: 'Profit and Loss',
      fromDate: fromDate ? this.parseTallyDate(fromDate) : null,
      toDate: toDate ? this.parseTallyDate(toDate) : null,
      entries,
      totals
    };
  }

  extractBalanceSheetDisplayName(bsNameNode) {
    if (!bsNameNode || typeof bsNameNode !== 'object') return '';
    const dsp = bsNameNode.DSPACCNAME ?? bsNameNode;
    if (Array.isArray(dsp)) {
      return dsp
        .map((d) => this.parseString(d?.DSPDISPNAME || d?.DSPACCNAME || d))
        .filter(Boolean)
        .join(' / ');
    }
    return this.parseString(dsp?.DSPDISPNAME || dsp?.DSPACCNAME || dsp);
  }

  /**
   * TallyPrime Balance Sheet export: parallel BSNAME[] and BSAMT[] at ENVELOPE root.
   */
  parseBalanceSheetFromEnvelope(env) {
    const entries = [];
    const bsNames = this.ensureArray(env.BSNAME);
    const bsAmts = this.ensureArray(env.BSAMT);
    const count = Math.max(bsNames.length, bsAmts.length);

    for (let i = 0; i < count; i += 1) {
      const displayName = this.extractBalanceSheetDisplayName(bsNames[i]);
      const amtNode = bsAmts[i] || {};
      const subAmount = this.toNumber(this.parseString(amtNode.BSSUBAMT));
      const mainAmount = this.toNumber(this.parseString(amtNode.BSMAINAMT));
      if (!displayName && subAmount === 0 && mainAmount === 0) {
        continue;
      }
      entries.push({
        name: displayName,
        displayName,
        subAmount,
        mainAmount,
        isGroup: this.isPlDrillableGroup(displayName) && Math.abs(mainAmount) > 0
      });
    }

    return entries;
  }

  parseBalanceSheet(response, asOfDate = null) {
    const entries = [];
    const seen = new Set();
    const env = response?.ENVELOPE || response || {};

    const flatEntries = this.parseBalanceSheetFromEnvelope(env);
    if (flatEntries.length > 0) {
      flatEntries.forEach((e) => entries.push(e));
    }

    const addEntry = (displayName, subAmtRaw, mainAmtRaw) => {
      const name = this.parseString(displayName);
      const subAmount = this.toNumber(this.parseString(subAmtRaw));
      const mainAmount = this.toNumber(this.parseString(mainAmtRaw));
      if (!name && subAmount === 0 && mainAmount === 0) {
        return;
      }
      const key = `${name}|${subAmount}|${mainAmount}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        name,
        displayName: name,
        subAmount,
        mainAmount,
        isGroup: this.isPlDrillableGroup(name) && Math.abs(mainAmount) > 0
      });
    };

    const pairEntries = (dsp, amtNode) => {
      const dspArray = Array.isArray(dsp) ? dsp : [dsp];
      const amtArray = Array.isArray(amtNode) ? amtNode : [amtNode];
      const pairCount = Math.max(dspArray.length, amtArray.length);
      for (let i = 0; i < pairCount; i += 1) {
        const dspNode = dspArray[i];
        const node = amtArray[i];
        const displayName = this.parseString(
          dspNode?.DSPDISPNAME || dspNode?.DSPACCNAME || dspNode
        );
        const subAmtRaw = node?.BSSUBAMT ?? node?.PLSUBAMT ?? node?.SUBAMT;
        const mainAmtRaw = node?.BSMAINAMT ?? node?.MAINAMT ?? node?.PLMAINAMT;
        addEntry(displayName, subAmtRaw, mainAmtRaw);
      }
    };

    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      const inlineName = this.parseString(node.DSPDISPNAME || node.DSPACCNAME);
      if (
        inlineName &&
        (node.BSSUBAMT != null ||
          node.BSMAINAMT != null ||
          node.PLSUBAMT != null ||
          node.PLAMT != null)
      ) {
        const plNode = node.PLAMT && typeof node.PLAMT === 'object' ? node.PLAMT : node;
        addEntry(
          inlineName,
          node.BSSUBAMT ?? plNode?.PLSUBAMT ?? plNode?.BSSUBAMT,
          node.BSMAINAMT ?? plNode?.BSMAINAMT ?? plNode?.MAINAMT
        );
      }

      if (node.DSPACCNAME && (node.BSAMT || node.PLAMT)) {
        pairEntries(node.DSPACCNAME, node.BSAMT || node.PLAMT);
      }

      Object.values(node).forEach(walk);
    };

    if (entries.length === 0) {
      walk(response);
    }

    const totals = {
      subtotal: entries.reduce((sum, entry) => sum + entry.subAmount, 0),
      grandTotal: entries.reduce((sum, entry) => sum + entry.mainAmount, 0)
    };

    const parsedAsOf = asOfDate ? this.parseTallyDate(asOfDate) : null;

    return {
      reportName: 'Balance Sheet',
      asOfDate: parsedAsOf,
      toDate: parsedAsOf,
      entries,
      totals
    };
  }

  parseLedgerTotals(ledgerEntries) {
    const totals = { cgst: 0, sgst: 0, igst: 0, cess: 0 };
    (ledgerEntries || []).forEach(entry => {
      const name = String(entry?.name || '').toLowerCase();
      const amount = Math.abs(this.toNumber(entry?.amount));
      if (name.includes('cgst')) totals.cgst += amount;
      if (name.includes('sgst') || name.includes('utgst')) totals.sgst += amount;
      if (name.includes('igst')) totals.igst += amount;
      if (name.includes('cess')) totals.cess += amount;
    });
    return totals;
  }

  parseShippingDetails(voucher) {
    return {
      address: {
        line1: this.parseString(voucher?.ADDRESS?.['#text'] || voucher?.ADDRESS || ''),
        city: this.parseString(voucher?.DISPATCHFROMPLACE || voucher?.DELIVERYCITY || ''),
        state: this.parseString(voucher?.CONSIGNEESTATENAME || voucher?.STATENAME || ''),
        pincode: this.parseString(voucher?.CONSIGNEEPINCODE || voucher?.PARTYPINCODE || ''),
        country: this.parseString(voucher?.CONSIGNEECOUNTRYNAME || voucher?.COUNTRYOFRESIDENCE || 'India')
      },
      charges: this.toNumber(voucher?.SHIPPING?.CHARGES || voucher?.SHIPPINGCHARGES || voucher?.CHARGES || 0),
      method: this.parseString(voucher?.TRANSPORTMODE || voucher?.SHIPMODE || ''),
      trackingNumber: this.parseString(voucher?.AIRWAYBILLNO || voucher?.LORRYRECPTNO || '')
    };
  }

  calculateVoucherTotals(items, ledgerEntries, voucher) {
    const subtotal = items.reduce(
      (sum, item) => sum + this.toNumber(item.amount || item.rate * item.quantity),
      0
    );
    const ledgerTotals = this.parseLedgerTotals(ledgerEntries);
    const hasLedgerTax =
      ledgerTotals.cgst > 0 ||
      ledgerTotals.sgst > 0 ||
      ledgerTotals.igst > 0 ||
      ledgerTotals.cess > 0;

    const cgst = hasLedgerTax
      ? ledgerTotals.cgst
      : items.reduce((sum, item) => {
          const base = this.toNumber(item.amount);
          const c = this.toNumber(item.gst?.cgst || 0);
          return sum + (base * c) / 100;
        }, 0);
    const sgst = hasLedgerTax
      ? ledgerTotals.sgst
      : items.reduce((sum, item) => {
          const base = this.toNumber(item.amount);
          const s = this.toNumber(item.gst?.sgst || 0);
          return sum + (base * s) / 100;
        }, 0);
    const igst = hasLedgerTax
      ? ledgerTotals.igst
      : items.reduce((sum, item) => {
          const base = this.toNumber(item.amount);
          const c = this.toNumber(item.gst?.cgst || 0);
          const s = this.toNumber(item.gst?.sgst || 0);
          const i = this.toNumber(item.gst?.igst || 0);
          if (c > 0 || s > 0) return sum;
          return sum + (base * i) / 100;
        }, 0);
    const cess = hasLedgerTax
      ? ledgerTotals.cess
      : items.reduce(
          (sum, item) =>
            sum + (this.toNumber(item.amount) * this.toNumber(item.gst?.cess || 0)) / 100,
          0
        );
    const totalTax = Number((cgst + sgst + igst + cess).toFixed(2));
    const taxableAmount = subtotal;
    const sumDebit = (ledgerEntries || []).reduce((s, e) => s + this.toNumber(e.debit), 0);
    const sumCredit = (ledgerEntries || []).reduce((s, e) => s + this.toNumber(e.credit), 0);
    const fromLedgers =
      sumDebit > 0 ? sumDebit : sumCredit > 0 ? sumCredit : 0;
    // Ledger totals first. On a multi-ledger accounting voucher (a Payment
    // split across two expense lines, say) Tally's VOUCHER.AMOUNT resolves to
    // the first ledger line, not the voucher total — a 50 + 140 payment was
    // stored as 50. A balanced voucher's debit total is its true value, so
    // trust that and keep AMOUNT only as a fallback for vouchers with no
    // ledger entries.
    const grandTotal =
      fromLedgers ||
      this.toNumber(voucher?.AMOUNT) ||
      Number((taxableAmount + totalTax).toFixed(2));
    const roundOff = Number((grandTotal - (taxableAmount + totalTax)).toFixed(2));

    return {
      subtotal,
      discount: 0,
      taxableAmount,
      cgst,
      sgst,
      igst,
      cess,
      totalTax,
      roundOff,
      grandTotal
    };
  }

  parseCompanyData(company) {
    const nameFromAttr = this.parseString(company['@_NAME']);
    const nameFromElement = this.parseString(company.NAME);

    return {
      name: this.parseString(nameFromAttr || nameFromElement),
      reservedName: this.parseString(company.RESERVEDNAME || company['@_RESERVEDNAME']),
      startingFrom: this.parseTallyDate(company.STARTINGFROM),
      booksFrom: this.parseTallyDate(company.BOOKSFROM),
      guid: this.parseString(company.GUID || company.GUID?.['#text'] || company['@_GUID']),
      alterid: this.parseString(company.ALTERID || company['@_ALTERID']),
      remoteid: this.parseString(company.REMOTEID || company['@_REMOTEID']),
      email: this.parseString(company.EMAIL),
      phone: this.parseString(company.PHONENUMBER),
      state: this.parseString(company.PRIORSTATENAME),
      country: this.parseString(company.COUNTRYNAME),
      pincode: this.parseString(company.PINCODE)
    };
  }

  parseStockItemData(item) {
    const parseQtyWithUnit = (value) => {
      const raw = this.parseString(value);
      if (!raw) return { quantity: 0, unit: '' };
      const match = raw.match(/(-?\d+(?:\.\d+)?)\s*(.*)$/);
      if (!match) return { quantity: this.toNumber(raw), unit: '' };
      return { quantity: Math.abs(Number(match[1]) || 0), unit: String(match[2] || '').trim() };
    };

    // Extract GST details
    const gstDetails = item['GSTDETAILS.LIST'];
    let gstInfo = {};
    if (gstDetails && gstDetails['STATEWISEDETAILS.LIST']) {
      const stateDetails = Array.isArray(gstDetails['STATEWISEDETAILS.LIST'])
        ? gstDetails['STATEWISEDETAILS.LIST']
        : [gstDetails['STATEWISEDETAILS.LIST']];

      stateDetails.forEach(state => {
        if (state['RATEDETAILS.LIST']) {
          const rates = Array.isArray(state['RATEDETAILS.LIST'])
            ? state['RATEDETAILS.LIST']
            : [state['RATEDETAILS.LIST']];

          rates.forEach(rate => {
            const dutyHead = rate['GSTRATEDUTYHEAD'];
            const rateValue = this.toNumber(rate['GSTRATE']);
            if (dutyHead && rateValue > 0) {
              gstInfo[dutyHead.toLowerCase()] = rateValue;
            }
          });
        }
      });
    }

    const openingBalanceNative = parseQtyWithUnit(
      item.OPENINGBALANCE ??
        item.OpeningBalance ??
        item.OPENINGBALANCEQTY ??
        item.OpeningBalanceQTY ??
        item['OPENINGBALANCE.QTY']
    );
    const inwardNative = parseQtyWithUnit(
      item.INWARDQUANTITY ?? item.InwardQuantity ?? item['INWARDQUANTITY.QTY']
    );
    const outwardNative = parseQtyWithUnit(
      item.OUTWARDQUANTITY ?? item.OutwardQuantity ?? item['OUTWARDQUANTITY.QTY']
    );
    const closingNative = parseQtyWithUnit(
      item.CLOSINGBALANCE ?? item.ClosingBalance ?? item['CLOSINGBALANCE.QTY']
    );

    const preferredUnit =
      closingNative.unit ||
      outwardNative.unit ||
      inwardNative.unit ||
      openingBalanceNative.unit ||
      this.parseString(item.BASEUNITS || item['@_BASEUNITS'] || '');

    const partNo = this.parseString(
      item.PARTNO?.['#text'] ?? item.PARTNO ?? item['@_PARTNO'] ?? ''
    );

    return {
      name: item['@_NAME'] || '',
      alias: item['@_ALIAS'] || '',
      partNo: partNo || '',
      parent: item.PARENT || item['@_PARENT'] || '',
      category: item.CATEGORY || item['@_CATEGORY'] || '',
      baseUnits: item.BASEUNITS || item['@_BASEUNITS'] || '',
      additionalUnits: item.ADDITIONALUNITS || item['@_ADDITIONALUNITS'] || '',
      openingBalance: this.toNumber(item.OPENINGBALANCE || item['@_OPENINGBALANCE'] || 0),
      openingValue: this.toNumber(item.OPENINGVALUE || item['@_OPENINGVALUE'] || 0),
      // Tally reports stock asset values as negative ledger amounts; store absolute.
      closingValue: Math.abs(
        this.toNumber(item.CLOSINGVALUE ?? item.ClosingValue ?? item['@_CLOSINGVALUE'] ?? 0)
      ),
      closingRate: Math.abs(
        this.toNumber(item.CLOSINGRATE ?? item.ClosingRate ?? item['@_CLOSINGRATE'] ?? 0)
      ),
      guid: item.GUID || item['@_GUID'] || null,
      alterid: item.ALTERID || item['@_ALTERID'] || null,
      remoteid: item.REMOTEID || item['@_REMOTEID'] || null,

      // Stock balance native methods (quantities)
      stockBalances: {
        unit: preferredUnit || '',
        openingBalance: openingBalanceNative.quantity,
        inwardQuantity: inwardNative.quantity,
        outwardQuantity: outwardNative.quantity,
        closingBalance: closingNative.quantity
      },

      // Tax applicability
      gstApplicable: item.GSTAPPLICABLE || item['@_GSTAPPLICABLE'] || '',
      gstTypeOfSupply: item.GSTTYPEOFSUPPLY || item['@_GSTTYPEOFSUPPLY'] || '',
      taxClassificationName: item.TAXCLASSIFICATIONNAME || item['@_TAXCLASSIFICATIONNAME'] || '',
      vatApplicable: item.VATAPPLICABLE || item['@_VATAPPLICABLE'] || '',
      exciseApplicable: item.EXCISEAPPLICABILITY || item['@_EXCISEAPPLICABILITY'] || '',
      serviceTaxApplicable: item.SERVICETAXAPPLICABLE || item['@_SERVICETAXAPPLICABLE'] || '',

      // Costing and valuation
      costingMethod: item.COSTINGMETHOD || item['@_COSTINGMETHOD'] || '',
      valuationMethod: item.VALUATIONMETHOD || item['@_VALUATIONMETHOD'] || '',

      // GST rates
      gstRates: gstInfo,

      // HSN details
      hsnCode: gstDetails?.HSNCODE || gstDetails?.['@_HSNCODE'] || '',
      hsn: gstDetails?.HSN || gstDetails?.['@_HSN'] || '',

      // Additional flags
      isBatchWiseOn: item.ISBATCHWISEON === 'Yes',
      isPerishableOn: item.ISPERISHABLEON === 'Yes',
      isCostTrackingOn: item.ISCOSTTRACKINGON === 'Yes',
      ignoreNegativeStock: item.IGNORENEGATIVESTOCK === 'Yes',
      ignorePhysicalDifference: item.IGNOREPHYSICALDIFFERENCE === 'Yes',

      // Timestamps
      updatedDateTime: item.UPDATEDDATETIME || item['@_UPDATEDDATETIME'] || null,
      activeFrom: item.ACTIVEFROM || item['@_ACTIVEFROM'] || null,
      activeTo: item.ACTIVETO || item['@_ACTIVETO'] || null
    };
  }

  extractPartiesFromResponse(response) {
    return this.extractLedgersForPartySyncFromResponse(response).filter(
      (r) => r.recordType === 'party'
    );
  }

  extractLedgersForPartySyncFromResponse(response) {
    const rows = [];

    try {
      const ledgerNodes = this.findNodesByKey(response, 'LEDGER');
      for (const ledger of ledgerNodes) {
        if (!ledger || typeof ledger !== 'object') continue;
        const row = this.parseLedgerForPartySyncUpload(ledger);
        if (row?.name) rows.push(row);
      }
    } catch (error) {
      this.logger.error('Failed to extract ledgers for party sync:', error);
    }

    return rows;
  }

  async extractLedgersForPartySyncFromResponseAsync(response) {
    try {
      return await this.extractNodesAsync(response, 'LEDGER', (ledger) => {
        if (!ledger || typeof ledger !== 'object') return null;
        const row = this.parseLedgerForPartySyncUpload(ledger);
        return row?.name ? row : null;
      });
    } catch (error) {
      this.logger.error('Failed to extract ledgers for party sync:', error);
      return [];
    }
  }

  /**
   * Non-sundry ledger (sales, cash, tax, etc.) — stored as recordType ledger for chart / lookups.
   */
  parseNonSundryLedgerRow(ledger) {
    const name = this.parseString(ledger['@_NAME'] || ledger.NAME);
    if (!name) return null;

    const parent = this.parseString(
      ledger.PARENT?.['#text'] ?? ledger.PARENT ?? ledger['@_PARENT']
    );
    const guid =
      this.parseString(ledger.GUID?.['#text'] ?? ledger.GUID ?? ledger['@_GUID']) || null;

    return {
      name: name.trim(),
      guid,
      tallyParent: parent || '',
      parent: parent || '',
      recordType: 'ledger',
      type: 'both'
    };
  }

  /**
   * Classify one LEDGER node: sundry debtor/creditor (by parent) → party; else → ledger.
   */
  parseLedgerForPartySyncUpload(ledger) {
    const party = this.parsePartyData(ledger);
    if (party) {
      return { ...party, recordType: 'party' };
    }
    return this.parseNonSundryLedgerRow(ledger);
  }

  /**
   * GST registration rows from ledger (LEDGSTREGDETAILS.LIST); GSTIN lives here, not on ledger root.
   */
  parseLedgerGstRegDetailsFromList(ledger) {
    const raw = ledger['LEDGSTREGDETAILS.LIST'];
    const rows = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    let gstin = '';
    let gstRegistrationType = '';
    let placeOfSupply = '';
    let state = '';
    let applicableFrom = '';

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const gin = this.parseString(row.GSTIN);
      if (!gstin && gin) gstin = gin;
      if (!gstRegistrationType) {
        gstRegistrationType = this.parseString(row.GSTREGISTRATIONTYPE);
      }
      if (!placeOfSupply) placeOfSupply = this.parseString(row.PLACEOFSUPPLY);
      if (!state) state = this.parseString(row.STATE);
      if (!applicableFrom) applicableFrom = this.parseString(row.APPLICABLEFROM);
    }

    return { gstin, gstRegistrationType, placeOfSupply, state, applicableFrom };
  }

  parseLedgerAddressList(ledger) {
    const raw = ledger['ADDRESS.LIST'];
    const lines = [];
    if (raw && typeof raw === 'object') {
      const addrNodes = raw.ADDRESS;
      const list = Array.isArray(addrNodes) ? addrNodes : addrNodes != null ? [addrNodes] : [];
      for (const node of list) {
        const line = this.parseString(node?.['#text'] ?? node);
        if (line) lines.push(line);
      }
    }
    const line1 = lines[0] || '';
    const line2 = lines.slice(1).join(', ');
    return { lines, line1, line2 };
  }

  resolvePartyTypeFromParent(parent) {
    const p = String(parent || '').toLowerCase();
    if (p.includes('creditor') || p.includes('sundry creditor')) return 'supplier';
    if (p.includes('both')) return 'both';
    return 'customer';
  }

  isSundryPartyLedger(parent) {
    const p = String(parent || '').toLowerCase();
    if (!p) return false;
    return (
      p.includes('sundry debtor') ||
      p.includes('sundry creditor') ||
      p === 'debtors' ||
      p === 'creditors' ||
      (p.includes('debtor') && !p.includes('duties')) ||
      (p.includes('creditor') && !p.includes('duties'))
    );
  }

  parsePartyData(ledger) {
    const name = this.parseString(ledger['@_NAME']);
    if (!name) return null;

    const parent = this.parseString(ledger.PARENT?.['#text'] ?? ledger.PARENT ?? ledger['@_PARENT']);
    if (!this.isSundryPartyLedger(parent)) {
      return null;
    }

    const guid =
      this.parseString(ledger.GUID?.['#text'] ?? ledger.GUID ?? ledger['@_GUID']) || null;
    const type = this.resolvePartyTypeFromParent(parent);
    const gst = this.parseLedgerGstRegDetailsFromList(ledger);
    const mailingName = this.parseString(
      ledger.MAILINGNAME?.['#text'] ?? ledger.MAILINGNAME ?? ledger['@_MAILINGNAME']
    );
    const panFromIncomeTax = this.parseString(
      ledger.INCOMETAXNUMBER?.['#text'] ?? ledger.INCOMETAXNUMBER
    );
    const panFallback = this.parseString(ledger.NAMEONPAN?.['#text'] ?? ledger.NAMEONPAN);
    const phone = this.parseString(ledger.LEDGERMOBILE?.['#text'] ?? ledger.LEDGERMOBILE);
    const email = this.parseString(ledger.EMAIL?.['#text'] ?? ledger.EMAIL);
    const masterId =
      this.parseString(ledger.MASTERID?.['#text'] ?? ledger.MASTERID ?? ledger['@_MASTERID']) ||
      this.parseString(ledger.Masterid?.['#text'] ?? ledger.Masterid ?? ledger['@_Masterid']) ||
      null;
    const alterId =
      this.parseString(ledger.ALTERID?.['#text'] ?? ledger.ALTERID ?? ledger['@_ALTERID']) ||
      null;

    const addr = this.parseLedgerAddressList(ledger);
    const ledgerState = this.parseString(ledger.STATE?.['#text'] ?? ledger.STATE);
    const state = gst.state || ledgerState || gst.placeOfSupply || '';
    const pincode = this.parseString(ledger.PINCODE?.['#text'] ?? ledger.PINCODE);
    const country = this.parseString(ledger.COUNTRYNAME?.['#text'] ?? ledger.COUNTRYNAME) || 'India';

    const openingRaw = this.toNumber(
      ledger.OPENINGBALANCE?.['#text'] ?? ledger.OPENINGBALANCE
    );
    const openingBalance = Math.abs(openingRaw);
    const openingBalanceType = openingRaw < 0 ? 'credit' : 'debit';

    const line1 = addr.line1 || mailingName || name.trim();
    const city =
      addr.lines.length > 1
        ? addr.lines[addr.lines.length - 1]
        : state || 'Unknown';

    return {
      name: name.trim(),
      displayName: mailingName || name.trim(),
      type,
      category: 'business',
      phone,
      email,
      address: line1,
      line2: addr.line2 || '',
      city,
      state,
      pincode,
      country,
      gstin: gst.gstin,
      gstRegistrationType: gst.gstRegistrationType,
      placeOfSupply: gst.placeOfSupply || state,
      gstApplicableFrom: gst.applicableFrom,
      pan: panFromIncomeTax || panFallback,
      parent,
      tallyParent: parent,
      guid,
      alterid: alterId,
      masterId,
      remoteId: this.parseString(ledger.REMOTEID ?? ledger['@_REMOTEID']) || null,
      openingBalance,
      openingBalanceType,
      isBillWise: this.parseString(ledger.ISBILLWISEON?.['#text'] ?? ledger.ISBILLWISEON) || 'No',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  generateObjectId() {
    return require('mongodb').ObjectId().toString();
  }

  ensureArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  parseHumanTallyDate(value) {
    const raw = this.parseString(value);
    if (!raw) return null;

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIdx = monthNames.indexOf(m[2].toLowerCase());
      if (monthIdx >= 0) {
        let year = Number(m[3]);
        if (year < 100) year += 2000;
        const month = String(monthIdx + 1).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }

    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }

    return this.parseTallyDate(raw) || raw;
  }

  pickEnvelopeArray(env, key, index) {
    const v = env[key];
    if (Array.isArray(v)) return v[index];
    return index === 0 ? v : undefined;
  }

  async getBillsReceivable(companyName, fromDate, toDate) {
    return this.getBillsOutstanding('Bills Receivable', companyName, fromDate, toDate);
  }

  async getBillsPayable(companyName, fromDate, toDate) {
    return this.getBillsOutstanding('Bills Payable', companyName, fromDate, toDate);
  }

  /**
   * Bills Receivable and Bills Payable are the same Tally report shape (BILLFIXED
   * rows keyed by party), only the report name differs — one request path serves both.
   */
  async getBillsOutstanding(reportName, companyName, fromDate, toDate) {
    try {
      const from = this.formatYyyyMmDd(fromDate);
      const to = this.formatYyyyMmDd(toDate);
      let extra = `<SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>`;
      if (companyName) {
        extra += `
          <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>`;
      }

      const xml = this.buildSimpleExportEnvelope(reportName, extra);
      const response = await this.sendRawXml(xml, {
        requestType: 'EXPORT',
        collection: reportName
      });

      return this.parseBillsOutstanding(response, reportName, fromDate, toDate);
    } catch (error) {
      this.logger.error(`Failed to get ${reportName} from Tally:`, error);
      throw error;
    }
  }

  parseBillsReceivable(response, fromDate = null, toDate = null) {
    return this.parseBillsOutstanding(response, 'Bills Receivable', fromDate, toDate);
  }

  parseBillsOutstanding(response, reportName = 'Bills Receivable', fromDate = null, toDate = null) {
    const env = response?.ENVELOPE || response || {};
    const fixedList = this.ensureArray(env.BILLFIXED);
    const bills = [];

    for (let i = 0; i < fixedList.length; i++) {
      const fixed = fixedList[i] || {};
      const rawCl = this.toNumber(this.pickEnvelopeArray(env, 'BILLCL', i));
      const closingBalance = Math.abs(rawCl);

      const invQty = this.ensureArray(this.pickEnvelopeArray(env, 'BILLINVQTY', i));
      const invItem = this.ensureArray(this.pickEnvelopeArray(env, 'BILLINVITEM', i));
      const invRate = this.ensureArray(this.pickEnvelopeArray(env, 'BILLINVRATE', i));
      const invCount = Math.max(invQty.length, invItem.length, invRate.length);
      const inventoryLines = [];
      for (let j = 0; j < invCount; j++) {
        const item = this.parseString(invItem[j] || invItem);
        const qty = this.parseString(invQty[j] || invQty);
        const rate = this.parseString(invRate[j] || invRate);
        if (!item && !qty && !rate) continue;
        inventoryLines.push({ item, quantity: qty, rate });
      }

      const overdueRaw = this.parseString(this.pickEnvelopeArray(env, 'BILLOVERDUE', i));
      const billOverdue = overdueRaw === '' ? null : this.toNumber(overdueRaw);

      bills.push({
        billRef: this.parseString(fixed.BILLREF),
        billParty: this.parseString(fixed.BILLPARTY),
        billDate: this.parseHumanTallyDate(fixed.BILLDATE),
        billDue: this.parseHumanTallyDate(this.pickEnvelopeArray(env, 'BILLDUE', i)),
        billOverdue,
        closingBalance,
        vchDate: this.parseHumanTallyDate(this.pickEnvelopeArray(env, 'BILLVCHDATE', i)),
        vchType: this.parseString(this.pickEnvelopeArray(env, 'BILLVCHTYPE', i)),
        vchNumber: this.parseString(this.pickEnvelopeArray(env, 'BILLVCHNUMBER', i)),
        vchAmount: Math.abs(this.toNumber(this.pickEnvelopeArray(env, 'BILLVCHAMOUNT', i))),
        inventoryLines
      });
    }

    const ledgerMap = new Map();
    for (const bill of bills) {
      const partyName = bill.billParty || 'Unknown';
      if (!ledgerMap.has(partyName)) {
        ledgerMap.set(partyName, {
          partyName,
          totalOutstanding: 0,
          billCount: 0,
          oldestBillDue: null,
          oldestOverdueDays: null,
          bills: []
        });
      }
      const ledger = ledgerMap.get(partyName);
      ledger.bills.push(bill);
      ledger.billCount += 1;
      ledger.totalOutstanding += bill.closingBalance;

      if (bill.billDue) {
        const due = new Date(`${bill.billDue}T00:00:00.000Z`);
        if (!ledger.oldestBillDue || due < new Date(`${ledger.oldestBillDue}T00:00:00.000Z`)) {
          ledger.oldestBillDue = bill.billDue;
        }
      }
      if (bill.billOverdue != null) {
        if (ledger.oldestOverdueDays == null || bill.billOverdue > ledger.oldestOverdueDays) {
          ledger.oldestOverdueDays = bill.billOverdue;
        }
      }
    }

    const ledgers = [...ledgerMap.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    const totalOutstanding = ledgers.reduce((s, l) => s + l.totalOutstanding, 0);

    return {
      reportName,
      fromDate: fromDate || null,
      toDate: toDate || null,
      asOfDate: new Date().toISOString(),
      totalOutstanding,
      ledgers
    };
  }

  /**
   * Pull human-readable errors from raw Tally XML (Prime 3+ often returns empty LINEERROR tags).
   */
  extractImportErrorsFromText(responseText = '') {
    const found = [];
    const text = String(responseText || '');
    if (!text.trim()) return found;

    const tagPatterns = [
      /<LINEERROR[^>]*>([^<]+)<\/LINEERROR>/gi,
      /<LASTIMPORTERROR[^>]*>([^<]+)<\/LASTIMPORTERROR>/gi,
      /<LASTERROR[^>]*>([^<]+)<\/LASTERROR>/gi,
      /<REMOTEERROR[^>]*>([^<]+)<\/REMOTEERROR>/gi,
      /<ERRMSG[^>]*>([^<]+)<\/ERRMSG>/gi
    ];

    for (const pattern of tagPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const msg = String(match[1] || '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        if (msg) found.push(msg);
      }
    }

    return [...new Set(found)];
  }

  buildImportFailureMessage(result, responseText = '') {
    const fromText = this.extractImportErrorsFromText(responseText);
    const combined = [...new Set([...(result.lineErrors || []), ...fromText])].filter(Boolean);
    if (combined.length > 0) {
      return combined[0];
    }

    const errCount = Number(result.errorCount) || 0;
    const excCount = Number(result.exceptions) || 0;
    const stats =
      excCount > 0 || errCount > 0
        ? ` (exceptions: ${excCount || 0}, errors: ${errCount || 0})`
        : '';

    return (
      `Tally rejected the voucher${stats}. ` +
      'Tally Prime 3+ often hides the reason in XML — check Tally import/exception logs, ' +
      'or verify order/reference number, item quantities, godown, and that party + ledger amounts balance.'
    );
  }

  /**
   * Parse Tally IMPORT response for errors and created voucher id.
   * @param {object} parsed
   * @param {string} [responseText] - raw XML for error extraction when LINEERROR is empty
   */
  parseVoucherImportResponse(parsed, responseText = '') {
    const result = {
      success: false,
      created: 0,
      altered: 0,
      exceptions: 0,
      errorCount: 0,
      errors: [],
      lineErrors: [],
      tallyGuid: '',
      voucherNumber: ''
    };

    const errorKeys = new Set([
      'LINEERROR',
      'LASTERROR',
      'LASTIMPORTERROR',
      'REMOTEERROR',
      'ERRMSG',
      'ERRORMSG',
      'ERRORDESC',
      'IMPORTERROR'
    ]);

    const walk = (node, depth = 0) => {
      if (!node || depth > 12) return;
      if (Array.isArray(node)) {
        node.forEach((n) => walk(n, depth + 1));
        return;
      }
      if (typeof node !== 'object') return;

      for (const [key, value] of Object.entries(node)) {
        const k = String(key).toUpperCase();
        if (errorKeys.has(k)) {
          const msg = this.parseString(value);
          if (msg) result.lineErrors.push(msg);
        }
        if (k === 'CREATED') {
          result.created = Math.max(result.created, Number(this.parseString(value)) || 0);
        }
        if (k === 'ALTERED') {
          result.altered = Math.max(result.altered, Number(this.parseString(value)) || 0);
        }
        if (k === 'EXCEPTIONS') {
          result.exceptions = Math.max(result.exceptions, Number(this.parseString(value)) || 0);
        }
        if (k === 'ERRORS') {
          const n = Number(this.parseString(value));
          if (!Number.isNaN(n)) result.errorCount = Math.max(result.errorCount, n);
        }
        if (k === 'GUID' && !result.tallyGuid) {
          const g = this.parseString(value);
          if (g) result.tallyGuid = g;
        }
        if (k === 'VOUCHERNUMBER' && !result.voucherNumber) {
          const n = this.parseString(value);
          if (n) result.voucherNumber = n;
        }
        walk(value, depth + 1);
      }
    };

    walk(parsed);

    const textErrors = this.extractImportErrorsFromText(responseText);
    if (textErrors.length) {
      result.lineErrors = [...new Set([...result.lineErrors, ...textErrors])];
    }

    if (result.lineErrors.length > 0) {
      result.errors = result.lineErrors;
      result.success = false;
    } else if (result.created > 0 || result.altered > 0) {
      result.success = true;
    } else if (result.voucherNumber && result.exceptions > 0) {
      // Same REMOTEID re-import: voucher already exists in Tally
      result.success = true;
      result.alreadyExisted = true;
    } else if (!result.lineErrors.length && !result.exceptions && !result.errorCount) {
      // Tally sometimes returns 200 with minimal body — treat as ok if no errors
      result.success = true;
    } else {
      const msg = this.buildImportFailureMessage(result, responseText);
      result.errors = [msg];
      result.lineErrors = [msg];
      result.success = false;
    }
    return result;
  }

  async importViaTallySyncTs(kind, payload = {}) {
    const companyName = payload.companyName || '';
    const hints = {
      voucherNumber: payload.voucherNumber || '',
      masterName: payload.name || ''
    };

    const { buildPostXml, parsePostResponse } = await importTallySyncTsModule();

    let tallyType;
    let objects;
    if (kind === 'voucher') {
      tallyType = 'Voucher';
      const voucher = mapItemVoucherPayload(payload);
      objects = [voucher];
      hints.voucherNumber = hints.voucherNumber || voucher.voucherNumber || '';
    } else if (kind === 'ledger') {
      tallyType = 'Ledger';
      objects = [mapLedgerPayload(payload)];
    } else if (kind === 'stockItem') {
      tallyType = 'StockItem';
      objects = [mapStockItemPayload(payload)];
    } else {
      throw new Error(`Unsupported tally-sync-ts import kind: ${kind}`);
    }

    let xml = buildPostXml(tallyType, objects, { company: companyName });
    if (kind === 'stockItem') {
      const partNo = String(payload.partNo || payload.barcode || payload.code || '').trim();
      if (partNo) {
        xml = injectStockItemPartNo(xml, partNo);
      }
    }
    const { responseText } = await this.sendRawXml(xml, {
      requestType: 'IMPORT',
      collection: tallyType,
      returnMeta: true
    });
    const responses = parsePostResponse(responseText);

    const outcome = this.tallySyncTs.normalizePostResponses(responses, hints);
    if (!outcome.success) {
      const err = new Error(outcome.lineErrors[0] || 'Tally rejected import');
      err.tallyImport = outcome;
      throw err;
    }

    return {
      success: true,
      tallyGuid: outcome.tallyGuid,
      voucherNumber: outcome.voucherNumber || hints.voucherNumber,
      masterName: hints.masterName,
      alreadyExisted: Boolean(outcome.alreadyExisted),
      created: outcome.created,
      altered: outcome.altered,
      tallySyncTs: true,
      responses
    };
  }

  /**
   * Import an item invoice voucher (Sales, Purchase, orders) into Tally.
   * Uses hand-built IMPORT XML (proven in production); tally-sync-ts PostResponse parsing
   * was too permissive and caused false "synced" without vouchers in TallyPrime.
   * @param {object} payload - see buildItemVoucherImportXml
   */
  async importItemVoucher(payload = {}) {
    const xml = buildItemVoucherImportXml(payload);
    const { parsed, responseText } = await this.sendRawXml(xml, {
      requestType: 'IMPORT',
      collection: payload.vchType || 'Voucher',
      returnMeta: true
    });
    const outcome = this.parseVoucherImportResponse(parsed, responseText);
    if (!outcome.success) {
      if (!outcome.lineErrors.length) {
        this.logger.warn('Tally import failed without LINEERROR text', {
          vchType: payload.vchType,
          exceptions: outcome.exceptions,
          responsePreview: this.sanitizePreview(responseText, 1200)
        });
      }
      const err = new Error(
        outcome.lineErrors[0] ||
          (Array.isArray(outcome.errors) ? outcome.errors[0] : outcome.errors) ||
          'Tally rejected voucher import'
      );
      err.tallyImport = outcome;
      throw err;
    }
    return {
      success: true,
      tallyGuid: outcome.tallyGuid,
      voucherNumber: outcome.voucherNumber || payload.voucherNumber || '',
      alreadyExisted: Boolean(outcome.alreadyExisted),
      created: outcome.created,
      altered: outcome.altered,
      parsed
    };
  }

  /** @alias importItemVoucher */
  async importSalesVoucher(payload = {}) {
    return this.importItemVoucher(payload);
  }

  async importAccountingVoucher(payload = {}) {
    const xml = buildAccountingVoucherImportXml(payload);
    const { parsed, responseText } = await this.sendRawXml(xml, {
      requestType: 'IMPORT',
      collection: payload.vchType || 'AccountingVoucher',
      returnMeta: true
    });
    const outcome = this.parseVoucherImportResponse(parsed, responseText);
    if (!outcome.success) {
      const err = new Error(
        outcome.lineErrors[0] || outcome.errors[0] || 'Tally rejected voucher import'
      );
      err.tallyImport = outcome;
      throw err;
    }
    return {
      success: true,
      tallyGuid: outcome.tallyGuid,
      voucherNumber: outcome.voucherNumber || payload.voucherNumber || '',
      alreadyExisted: Boolean(outcome.alreadyExisted),
      parsed
    };
  }

  async importLedger(payload = {}) {
    if (this.useTallySyncTs) {
      try {
        const result = await this.importViaTallySyncTs('ledger', payload);
        return {
          ...result,
          masterName: payload.name
        };
      } catch (error) {
        if (error.tallyImport) {
          throw error;
        }
        this.logger.warn('importLedger via tally-sync-ts failed', { error: error.message });
        throw error;
      }
    }

    throw new Error('tally-sync-ts is required for ledger import (enable useTallySyncTs)');
  }

  async importStockItem(payload = {}) {
    if (this.useTallySyncTs) {
      try {
        const result = await this.importViaTallySyncTs('stockItem', payload);
        return {
          ...result,
          masterName: payload.name
        };
      } catch (error) {
        if (error.tallyImport) {
          throw error;
        }
        this.logger.warn('importStockItem via tally-sync-ts failed', { error: error.message });
        throw error;
      }
    }

    throw new Error('tally-sync-ts is required for stock item import (enable useTallySyncTs)');
  }

  /**
   * Tally company-level alter IDs (masters + vouchers) via tally-sync-ts.
   */
  async getLastAlterIds(companyName) {
    if (!this.useTallySyncTs) {
      return { mastersLastId: 0, vouchersLastId: 0 };
    }
    try {
      return await this.tallySyncTs.getLastAlterIds(companyName);
    } catch (error) {
      this.logger.warn('getLastAlterIds failed', {
        companyName,
        error: error.message
      });
      return { mastersLastId: 0, vouchersLastId: 0 };
    }
  }

  /**
   * GST registration / tax units from Tally (for future server sync).
   */
  async getGSTRegistrations(companyName) {
    if (!this.useTallySyncTs) {
      return [];
    }
    try {
      return await this.tallySyncTs.getGSTRegistrations(companyName);
    } catch (error) {
      this.logger.warn('getGSTRegistrations failed', {
        companyName,
        error: error.message
      });
      return [];
    }
  }

  /**
   * HTTP-level Tally availability check (complements TCP socket probe).
   */
  async checkTallyHttp() {
    if (!this.useTallySyncTs) {
      return false;
    }
    try {
      return await this.tallySyncTs.check();
    } catch (error) {
      this.logger.warn('checkTallyHttp failed', { error: error.message });
      return false;
    }
  }

  /**
   * Tally license / edition info (serial, plan) via tally-sync-ts.
   */
  async getLicenseInfo() {
    if (!this.useTallySyncTs) {
      return null;
    }
    try {
      return await this.tallySyncTs.getLicenseInfo();
    } catch (error) {
      this.logger.warn('getLicenseInfo failed', { error: error.message });
      return null;
    }
  }

  /**
   * Paginated voucher export via tally-sync-ts (fallback when CUSTOMVOUCHERCOL fails).
   */
  async getVouchersViaTallySyncTs(companyName, fromDate, toDate) {
    const raw = await this.tallySyncTs.fetchVouchers(
      companyName,
      fromDate,
      toDate,
      this.getTallySyncTsPageSize()
    );
    const vouchers = raw
      .map(mapVoucherFromLibrary)
      .filter((v) => v && v.date);
    return this.filterVouchersByDateRange(vouchers, fromDate, toDate);
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      host: this.config.host,
      port: this.config.port,
      lastConnectionTest: new Date().toISOString(),
      tallySyncTsEnabled: this.useTallySyncTs !== false
    };
  }
}

module.exports = TallyService;
