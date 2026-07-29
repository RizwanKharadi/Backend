import { WebSocketServer, WebSocket } from 'ws';
import winston from 'winston';
import jwt from 'jsonwebtoken';
import { isValidId } from '../db/queryUtils.js';
import TallyConnection from '../models/TallyConnection.js';
import tallyCommunicationService from './tallyCommunicationService.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Voucher from '../models/Voucher.js';
import VoucherDetail from '../models/VoucherDetail.js';
import Item from '../models/Item.js';
import Party from '../models/Party.js';
import ProfitLossReport from '../models/ProfitLossReport.js';
import BalanceSheetReport from '../models/BalanceSheetReport.js';
import OutstandingReceivable from '../models/OutstandingReceivable.js';
import TallyAccount from '../models/TallyAccount.js';
import VoucherType from '../models/VoucherType.js';
import Godown from '../models/Godown.js';
import Unit from '../models/Unit.js';
import GstRegistration from '../models/GstRegistration.js';
import {
  checkDeviceLicense,
  verifyDeviceToken,
  isLicenseEnforcementEnabled
} from './licenseService.js';
import { registerTallySerial, mapTallyLicensePayload } from './tallySerialService.js';
import {
  normalizeVoucherTypeSlug,
  resolveVoucherTypeFromTally
} from '../utils/tallyVoucherType.js';

class TallyWebSocketService {
  constructor() {
    this.wss = null;
    this.connections = new Map(); // agentId -> connection info
    /** Serialize inbound messages per agent — prevents concurrent bulk MongoDB writes. */
    this.agentMessageQueues = new Map();
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pendingHydrations = new Map();
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pendingImports = new Map();
    
    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'tally-websocket' },
      transports: [
        new winston.transports.File({ filename: 'logs/websocket-error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/websocket-combined.log' })
      ]
    });

    if (process.env.NODE_ENV !== 'production') {
      this.logger.add(new winston.transports.Console({
        format: winston.format.simple()
      }));
    }
  }

  /**
   * Initialize WebSocket server
   * @param {Object} server - HTTP server instance
   * @param {string} path - WebSocket path
   */
  initialize(server, path = '/tally-agent') {
    this.wss = new WebSocketServer({
      server,
      path,
      verifyClient: this.verifyClient.bind(this),
      maxPayload: 64 * 1024 * 1024,
      /**
       * Voucher batch JSON compresses ~10x; agents on slow office uplinks spend most of a
       * batch round-trip on transfer. No context takeover keeps per-connection memory flat.
       */
      perMessageDeflate: {
        threshold: 1024,
        serverNoContextTakeover: true,
        clientNoContextTakeover: true
      }
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleServerError.bind(this));

    // Start heartbeat interval
    this.startHeartbeatInterval();

    this.logger.info('Tally WebSocket server initialized', { path });
  }

  /**
   * Verify client connection (async — supports device license checks).
   * @param {Object} info - Connection info
   * @param {Function} callback - ws verifyClient callback
   */
  verifyClient(info, callback) {
    this.verifyClientAsync(info)
      .then((allowed) => callback(allowed))
      .catch((error) => {
        this.logger.error('Error verifying WebSocket client', { error: error.message });
        callback(false);
      });
  }

  async verifyClientAsync(info) {
    const url = new URL(info.req.url, `http://${info.req.headers.host}`);
    const token = url.searchParams.get('token');
    const deviceToken = url.searchParams.get('deviceToken');
    const agentId = url.searchParams.get('agentId');
    const apiKey = url.searchParams.get('apiKey');
    const companyId = url.searchParams.get('companyId');

    if (!agentId) {
      this.logger.warn('WebSocket connection rejected: Missing agentId');
      return false;
    }

    const assertDeviceLicensed = async () => {
      if (!isLicenseEnforcementEnabled()) {
        return true;
      }
      const license = await checkDeviceLicense(agentId);
      if (!license.allowed) {
        this.logger.warn('WebSocket connection rejected: device license', {
          agentId,
          reason: license.reason
        });
        return false;
      }
      return true;
    };

    if (deviceToken) {
      try {
        const decoded = verifyDeviceToken(deviceToken);
        if (decoded.agentId !== agentId) {
          this.logger.warn('WebSocket rejected: deviceToken agentId mismatch', { agentId });
          return false;
        }
        if (!(await assertDeviceLicensed())) {
          return false;
        }
        info.req.user = decoded;
        info.req.agentId = agentId;
        info.req.companyId = companyId;
        info.req.authMethod = 'device';
        return true;
      } catch (error) {
        this.logger.warn('WebSocket connection rejected: Invalid device token', {
          agentId,
          error: error.message
        });
        return false;
      }
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded) {
          this.logger.warn('WebSocket connection rejected: Invalid token');
          return false;
        }
        if (decoded.type === 'device') {
          if (decoded.agentId !== agentId) {
            return false;
          }
        }
        if (!(await assertDeviceLicensed())) {
          return false;
        }
        info.req.user = decoded;
        info.req.agentId = agentId;
        info.req.companyId = companyId;
        info.req.authMethod = decoded.type === 'device' ? 'device' : 'jwt';
        return true;
      } catch (error) {
        this.logger.warn('WebSocket connection rejected: Invalid or expired login token', {
          agentId,
          error: error.message
        });
        return false;
      }
    }

    if (apiKey !== null) {
      const configuredApiKey = process.env.DESKTOP_AGENT_API_KEY || process.env.AGENT_API_KEY;

      if (configuredApiKey) {
        if (apiKey !== configuredApiKey) {
          this.logger.warn('WebSocket connection rejected: Invalid API key', { agentId });
          return false;
        }
      } else if (process.env.NODE_ENV === 'production') {
        this.logger.warn('WebSocket connection rejected: API key not configured in production', { agentId });
        return false;
      } else {
        this.logger.warn('DESKTOP_AGENT_API_KEY not configured; allowing API-key auth in non-production mode');
      }

      if (!(await assertDeviceLicensed())) {
        return false;
      }

      info.req.user = {
        id: 'desktop-agent',
        role: 'system',
        authType: 'apiKey'
      };
      info.req.agentId = agentId;
      info.req.companyId = companyId;
      info.req.authMethod = 'apiKey';
      return true;
    }

    this.logger.warn('WebSocket connection rejected: Missing token/deviceToken/apiKey', { agentId });
    return false;
  }

  async assertAgentLicensed(agentId, sendErr) {
    const license = await checkDeviceLicense(agentId);
    if (!license.allowed) {
      if (typeof sendErr === 'function') {
        sendErr(license.reason || 'Device license required');
      }
      return false;
    }
    return true;
  }

  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} req - HTTP request
   */
  async handleConnection(ws, req) {
    const agentId = req.agentId;
    const user = req.user;

    try {
      this.logger.info('New Tally agent connection', {
        agentId,
        userId: user?.id || 'unknown',
        authMethod: req.authMethod || 'unknown'
      });

      // Store connection
      this.connections.set(agentId, {
        ws,
        agentId,
        user,
        companyId: req.companyId || '',
        lastHeartbeat: new Date(),
        isAlive: true
      });

      // Register with communication service
      tallyCommunicationService.registerWebSocketConnection(agentId, ws);

      // Set up WebSocket event handlers
      ws.isAlive = true;
      ws.on('message', (data) => {
        this.enqueueAgentMessage(agentId, () => this.handleMessage(agentId, data));
      });
      ws.on('close', (code, reason) => this.handleDisconnection(agentId, code, reason));
      ws.on('error', (error) => this.handleConnectionError(agentId, error));
      ws.on('pong', () => this.handlePong(agentId));

      // Send welcome message
      this.sendMessage(agentId, {
        type: 'welcome',
        message: 'Connected to FinSync360 Tally Integration',
        timestamp: new Date().toISOString()
      });

      // Update connection status in database
      await this.updateConnectionStatus(agentId, 'connected');

    } catch (error) {
      this.logger.error('Error handling WebSocket connection', {
        agentId,
        error: error.message
      });
      ws.close(1011, 'Internal server error');
    }
  }

  /**
   * Process agent messages one at a time to avoid overlapping bulk writes on one connection.
   * @param {string} agentId
   * @param {() => Promise<void>} task
   */
  enqueueAgentMessage(agentId, task) {
    const prev = this.agentMessageQueues.get(agentId) || Promise.resolve();
    const next = prev
      .then(() => task())
      .catch((error) => {
        this.logger.error('Agent message task failed', {
          agentId,
          error: error.message
        });
      });
    this.agentMessageQueues.set(agentId, next);
    return next;
  }

  /**
   * Handle incoming WebSocket message
   * @param {string} agentId - Agent ID
   * @param {Buffer} data - Message data
   */
  async handleMessage(agentId, data) {
    try {
      const message = JSON.parse(data.toString());
      const connection = this.connections.get(agentId);

      if (!connection) {
        this.logger.warn('Message from unknown agent', { agentId });
        return;
      }

      // Agent traffic during long sync-data writes must not be treated as a dead connection.
      if (connection.ws) {
        connection.ws.isAlive = true;
        connection.isAlive = true;
        connection.lastHeartbeat = new Date();
      }

      this.logger.debug('Received message from agent', {
        agentId,
        messageType: message.type,
        messageId: message.id
      });

      switch (message.type) {
        case 'agent-register':
          await this.handleAgentRegister(agentId, message);
          break;

        case 'sync-data':
          await this.handleSyncData(agentId, message);
          break;

        case 'sync-data-batch':
          await this.handleSyncDataBatch(agentId, message);
          break;

        case 'heartbeat':
          await this.handleHeartbeat(agentId, message);
          break;

        case 'agent_info':
          await this.handleAgentInfo(agentId, message);
          break;

        case 'tally_response':
          // Forward to communication service
          tallyCommunicationService.handleWebSocketMessage(agentId, message);
          break;

        case 'tally_notification':
          await this.handleTallyNotification(agentId, message);
          break;

        case 'voucher-detail-response':
          this.handleVoucherDetailResponse(agentId, message);
          break;

        case 'import-voucher-response':
          this.handleImportVoucherResponse(agentId, message);
          break;

        case 'import-ledger-response':
          this.handleImportLedgerResponse(agentId, message);
          break;

        case 'import-stock-item-response':
          this.handleImportStockItemResponse(agentId, message);
          break;

        case 'error':
          await this.handleAgentError(agentId, message);
          break;

        default:
          this.logger.warn('Unknown message type', {
            agentId,
            messageType: message.type
          });
      }

    } catch (error) {
      this.logger.error('Error handling WebSocket message', {
        agentId,
        error: error.message
      });
    }
  }

  /**
   * Handle WebSocket disconnection
   * @param {string} agentId - Agent ID
   * @param {number} code - Close code
   * @param {string} reason - Close reason
   */
  async handleDisconnection(agentId, code, reason) {
    try {
      this.logger.info('Tally agent disconnected', {
        agentId,
        code,
        reason: reason.toString()
      });

      // Remove from connections
      this.connections.delete(agentId);
      this.agentMessageQueues.delete(agentId);

      // Update connection status in database
      await this.updateConnectionStatus(agentId, 'disconnected', reason.toString());

    } catch (error) {
      this.logger.error('Error handling WebSocket disconnection', {
        agentId,
        error: error.message
      });
    }
  }

  /**
   * Handle WebSocket connection error
   * @param {string} agentId - Agent ID
   * @param {Error} error - Error object
   */
  async handleConnectionError(agentId, error) {
    this.logger.error('WebSocket connection error', {
      agentId,
      error: error.message
    });

    try {
      await this.updateConnectionStatus(agentId, 'error', error.message);
    } catch (dbError) {
      this.logger.error('Error updating connection status', {
        agentId,
        error: dbError.message
      });
    }
  }

  /**
   * Handle heartbeat message
   * @param {string} agentId - Agent ID
   * @param {Object} message - Heartbeat message
   */
  async handleHeartbeat(agentId, message) {
    const connection = this.connections.get(agentId);
    if (connection) {
      connection.lastHeartbeat = new Date();
      connection.isAlive = true;
    }

    // Update database
    try {
      const dbConnection = await TallyConnection.findOne({ agentId });
      if (dbConnection) {
        await dbConnection.updateHeartbeat();
        
        // Update system info if provided
        if (message.data && message.data.systemInfo) {
          dbConnection.systemInfo = {
            ...dbConnection.systemInfo,
            ...message.data.systemInfo
          };
          await dbConnection.save();
        }
      }
    } catch (error) {
      this.logger.error('Error updating heartbeat', {
        agentId,
        error: error.message
      });
    }

    // Send heartbeat response
    this.sendMessage(agentId, {
      type: 'heartbeat_ack',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle agent info message
   * @param {string} agentId - Agent ID
   * @param {Object} message - Agent info message
   */
  async handleAgentInfo(agentId, message) {
    try {
      const { agentVersion, tallyInfo, systemInfo, capabilities } = message.data;

      // Find or create connection record
      let dbConnection = await TallyConnection.findOne({ agentId });
      
      if (!dbConnection) {
        // Create new connection record
        dbConnection = new TallyConnection({
          agentId,
          agentVersion,
          company: message.data.companyId, // Should be provided by agent
          connectionId: this.generateConnectionId(),
          status: 'connected',
          createdBy: this.connections.get(agentId)?.user?.id
        });
      }

      // Update connection info
      if (agentVersion) dbConnection.agentVersion = agentVersion;
      if (tallyInfo) dbConnection.tallyInfo = { ...dbConnection.tallyInfo, ...tallyInfo };
      if (systemInfo) dbConnection.systemInfo = { ...dbConnection.systemInfo, ...systemInfo };
      if (capabilities) dbConnection.capabilities = { ...dbConnection.capabilities, ...capabilities };

      await dbConnection.save();

      this.logger.info('Agent info updated', { agentId });

      // Send acknowledgment
      this.sendMessage(agentId, {
        type: 'agent_info_ack',
        message: 'Agent information updated successfully'
      });

    } catch (error) {
      this.logger.error('Error handling agent info', {
        agentId,
        error: error.message
      });
    }
  }

  /**
   * Handle lightweight agent registration from the desktop agent.
   * This path keeps the existing desktop-agent payload shape working.
   * @param {string} agentId
   * @param {Object} message
   */
  async handleAgentRegister(agentId, message) {
    try {
      const connectionInfo = this.connections.get(agentId);
      const {
        companyId: payloadCompanyId,
        version,
        platform,
        arch,
        tallyLicense
      } = message.data || {};
      const companyId = payloadCompanyId || connectionInfo?.companyId || '';

      if (!companyId) {
        this.logger.warn('Agent register received without companyId', { agentId });
        return;
      }

      const company = await Company.findById(companyId);
      if (!company) {
        this.logger.warn('Agent register received for unknown company', { agentId, companyId });
        return;
      }

      let connection = await TallyConnection.findOne({ agentId });

      if (!connection) {
        connection = new TallyConnection({
          company: company._id,
          agentId,
          agentVersion: version || 'unknown',
          connectionId: this.generateConnectionId(),
          status: 'connected',
          createdBy: company.createdBy,
          systemInfo: {
            os: platform || '',
            architecture: arch || ''
          }
        });
      } else {
        connection.company = company._id;
        connection.agentVersion = version || connection.agentVersion;
        connection.systemInfo = {
          ...connection.systemInfo,
          os: platform || connection.systemInfo?.os,
          architecture: arch || connection.systemInfo?.architecture
        };
      }

      if (tallyLicense && typeof tallyLicense === 'object') {
        connection.tallyInfo = {
          ...(connection.tallyInfo || {}),
          version: tallyLicense.tallyVersion || connection.tallyInfo?.version,
          release: tallyLicense.tallyShortVersion || connection.tallyInfo?.release,
          licenseInfo: {
            licenseType: tallyLicense.planName || '',
            educational: Boolean(tallyLicense.isEducationalMode),
            multiUser: Boolean(tallyLicense.isTallyPrimeServer),
            serialNumber: tallyLicense.serialNumber || '',
            remoteSerialNumber: tallyLicense.remoteSerialNumber || '',
            isGold: Boolean(tallyLicense.isGold),
            isSilver: Boolean(tallyLicense.isSilver),
            isTallyPrime: Boolean(tallyLicense.isTallyPrime),
            accountId: tallyLicense.accountId || '',
            userName: tallyLicense.userName || ''
          }
        };
      }

      await connection.connect();

      if (connectionInfo) {
        connectionInfo.companyId = company._id.toString();
      }

      let tallySerialConflict = null;
      const licensePayload = mapTallyLicensePayload(tallyLicense);
      if (licensePayload?.serialNumber && company.organizationId) {
        try {
          const owner = await User.findById(company.createdBy).select('email organizationId');
          if (owner) {
            await registerTallySerial({
              serialNumber: licensePayload.serialNumber,
              userId: owner._id,
              organizationId: company.organizationId,
              email: owner.email,
              licenseDetails: licensePayload
            });
          }
        } catch (serialErr) {
          tallySerialConflict = serialErr.conflict || {
            inUse: true,
            message: serialErr.message
          };
          this.logger.warn('Tally serial conflict on agent register', {
            agentId,
            serialNumber: licensePayload.serialNumber,
            message: serialErr.message
          });
        }
      }

      this.sendMessage(agentId, {
        type: 'agent-register-ack',
        data: {
          companyId: company._id.toString(),
          companyName: company.name,
          tallySerialConflict
        }
      });
    } catch (error) {
      this.logger.error('Error handling agent register', {
        agentId,
        error: error.message
      });
    }
  }

  /**
   * Persist sync payloads pushed by the desktop agent.
   * @param {string} agentId
   * @param {Object} message
   */
  /**
   * Bulk voucher (or homogeneous entity) upload from desktop agent — one ack per batch.
   */
  async handleSyncDataBatch(agentId, message) {
    const syncRequestId = message.syncRequestId || null;
    const payload = message.data || {};
    const entityType = payload.type || payload.entityType || 'voucher';
    const items = Array.isArray(payload.items) ? payload.items : [];
    const companyId = payload.companyId;

    const sendBatchAck = (extra = {}) => {
      this.sendMessage(agentId, {
        type: 'sync-data-batch-ack',
        syncRequestId,
        data: {
          ...extra,
          receivedAt: new Date().toISOString()
        }
      });
    };

    const sendBatchErr = (errMessage, extra = {}) => {
      this.sendMessage(agentId, {
        type: 'sync-data-batch-error',
        syncRequestId,
        data: {
          message: errMessage,
          timestamp: new Date().toISOString(),
          ...extra
        }
      });
    };

    if (!(await this.assertAgentLicensed(agentId, sendBatchErr))) {
      return;
    }

    if (!items.length) {
      sendBatchAck({ type: entityType, processed: 0, failed: 0, errors: [] });
      return;
    }

    const connection = this.connections.get(agentId);
    const userId = connection?.user?.id || null;

    // Company resolution costs several queries; batches stream in for the same company,
    // so cache the resolved doc on the connection for the life of the socket.
    const companyCacheKey =
      companyId || payload.companyName
        ? `${companyId || ''}|${payload.companyName || ''}`
        : null;
    let company =
      companyCacheKey && connection?.companyResolveCache
        ? connection.companyResolveCache.get(companyCacheKey)
        : null;
    if (!company) {
      try {
        company = await this.resolveCompanyForPayload(
          agentId,
          companyId,
          { companyName: payload.companyName, ...(items[0] || {}) },
          userId
        );
      } catch (err) {
        sendBatchErr(err.message || 'Company resolution failed');
        return;
      }
      if (company && companyCacheKey && connection) {
        if (!connection.companyResolveCache) {
          connection.companyResolveCache = new Map();
        }
        connection.companyResolveCache.set(companyCacheKey, company);
      }
    }

    if (!company) {
      sendBatchErr('Unknown company for sync batch — link the Tally company in the app.', {
        type: entityType,
        companyId: companyId || ''
      });
      return;
    }

    const MASTER_BULK_TYPES = new Set([
      'party',
      'item',
      'tally_account',
      'voucher_type',
      'godown',
      'unit',
      'gst_registration'
    ]);

    const errors = [];
    let processed = 0;

    if (MASTER_BULK_TYPES.has(entityType)) {
      const rows = items.map((row) => ({
        ...row,
        companyName: row.companyName || payload.companyName
      }));
      const bulkResult = await this.bulkUpsertMasterBatch(entityType, company, rows);
      processed = bulkResult.processed;
      errors.push(...bulkResult.errors);
      if (bulkResult.failed > 0) {
        this.logger.warn('Master batch had write failures', {
          agentId,
          entityType,
          failed: bulkResult.failed,
          processed: bulkResult.processed
        });
      }
    } else if (entityType === 'voucher') {
      const summaryRows = [];
      const otherRows = [];
      for (const row of items) {
        const data = { ...row, companyName: row.companyName || payload.companyName };
        if (data?.detailLevel === 'summary') {
          summaryRows.push(data);
        } else {
          otherRows.push(data);
        }
      }

      const voucherBatchStart = Date.now();
      let bulkTiming = null;

      if (summaryRows.length) {
        const bulkResult = await this.bulkUpsertVoucherSummaryBatch(company, summaryRows, { agentId });
        processed += bulkResult.processed;
        errors.push(...bulkResult.errors);
        bulkTiming = bulkResult.timing || null;
      }

      const otherSequentialStart = Date.now();
      for (const data of otherRows) {
        try {
          if (data?.detailLevel === 'full') {
            await this.upsertVoucherDetail(company, data);
          } else {
            await this.upsertVoucher(company, data);
          }
          processed += 1;
        } catch (error) {
          errors.push({ voucherNumber: data.voucherNumber, message: error.message });
          this.logger.warn('Batch sync row failed', {
            agentId,
            entityType,
            voucherNumber: data.voucherNumber,
            error: error.message
          });
        }
      }
      const otherSequentialMs = otherRows.length ? Date.now() - otherSequentialStart : 0;
      const totalBatchMs = Date.now() - voucherBatchStart;

      const timingMeta = {
        agentId,
        companyId: company._id?.toString(),
        entityType: 'voucher',
        syncRequestId,
        summaryItems: summaryRows.length,
        otherItems: otherRows.length,
        failed: errors.length,
        totalMs: totalBatchMs
      };
      if (totalBatchMs > 10000) {
        this.logger.warn('Slow voucher sync batch', timingMeta);
      }
      this.logger.info(
        `Voucher sync batch timing items=${items.length} partyPreloadMs=${bulkTiming?.partyPreloadMs ?? 0} bulkWriteMs=${bulkTiming?.bulkWriteMs ?? 0} preservePrepassMs=${bulkTiming?.preservePrepassMs ?? 0} preserveSequentialMs=${bulkTiming?.preserveSequentialMs ?? 0} otherSequentialMs=${otherSequentialMs} totalMs=${totalBatchMs} processed=${processed}`,
        timingMeta
      );
    } else {
      for (let i = 0; i < items.length; i++) {
        const row = items[i];
        const data = { ...row, companyName: row.companyName || payload.companyName };
        try {
          switch (entityType) {
            case 'voucher_detail':
              await this.upsertVoucherDetail(company, data);
              break;
            case 'report':
              await this.upsertReport(company, data);
              break;
            case 'outstanding_receivable':
              await this.upsertOutstandingReceivable(company, data);
              break;
            default:
              throw new Error(`Unsupported batch entity type: ${entityType}`);
          }
          processed += 1;
        } catch (error) {
          errors.push({
            index: i,
            voucherNumber: data.voucherNumber,
            message: error.message
          });
          this.logger.warn('Batch sync row failed', {
            agentId,
            entityType,
            index: i,
            error: error.message
          });
        }
      }
    }

    if (processed === 0 && errors.length > 0) {
      sendBatchErr('All rows in batch failed', {
        type: entityType,
        failed: errors.length,
        errors: errors.slice(0, 20)
      });
      return;
    }

    sendBatchAck({
      type: entityType,
      companyId: company._id.toString(),
      processed,
      failed: errors.length,
      errors: errors.slice(0, 20)
    });
  }

  async handleSyncData(agentId, message) {
    const syncRequestId = message.syncRequestId || null;

    const sendAck = (extra = {}) => {
      this.sendMessage(agentId, {
        type: 'sync-data-ack',
        syncRequestId,
        data: {
          ...extra,
          receivedAt: new Date().toISOString()
        }
      });
    };

    const sendErr = (errMessage, extra = {}) => {
      this.sendMessage(agentId, {
        type: 'sync-data-error',
        syncRequestId,
        data: {
          message: errMessage,
          timestamp: new Date().toISOString(),
          ...extra
        }
      });
    };

    if (!(await this.assertAgentLicensed(agentId, sendErr))) {
      return;
    }

    try {
      const payload = message.data || {};
      const { type, data, companyId } = payload;

      this.logger.info('Processing sync payload from desktop agent', {
        agentId,
        type,
        syncRequestId,
        companyId: companyId || '',
        payloadCompanyName: data?.companyName || data?.company || '',
        voucherNumber: data?.voucherNumber || '',
        itemName: data?.name || '',
        partyName: data?.name || ''
      });

      const connection = this.connections.get(agentId);
      const userId = connection?.user?.id || null;

      let company;
      if (type === 'company') {
        // For company sync, create or find by Tally GUID and bind to authenticated user
        company = await this.upsertCompany(data, userId);
        await this.bindAgentToCompany(agentId, company);
      } else {
        company = await this.resolveCompanyForPayload(agentId, companyId, data, userId);
        if (!company) {
          this.logger.warn('Sync data received for unknown company', {
            agentId,
            companyId: companyId || '',
            payloadCompanyName: data?.companyName || data?.company || '',
            payloadCompanyGuid: data?.guid || data?.companyGuid || data?.remoteid || '',
            type
          });
          sendErr('Unknown company for sync payload — link the Tally company in the app.', { type });
          return;
        }
      }

      switch (type) {
        case 'company':
          // Company already upserted above
          break;
        case 'voucher':
          if (data?.detailLevel === 'summary') {
            await this.upsertVoucherSummary(company, data);
          } else if (data?.detailLevel === 'full') {
            await this.upsertVoucherDetail(company, data);
          } else {
            await this.upsertVoucher(company, data);
          }
          break;
        case 'voucher_detail':
          await this.upsertVoucherDetail(company, data);
          break;
        case 'report':
          await this.upsertReport(company, data);
          break;
        case 'outstanding_receivable':
          await this.upsertOutstandingReceivable(company, data);
          break;
        case 'item':
          await this.upsertItem(company, data);
          break;
        case 'party':
          await this.upsertParty(company, data);
          break;
        case 'tally_account':
          await this.upsertTallyAccount(company, data);
          break;
        case 'voucher_type':
          await this.upsertVoucherType(company, data);
          break;
        case 'godown':
          await this.upsertGodown(company, data);
          break;
        case 'unit':
          await this.upsertUnit(company, data);
          break;
        case 'gst_registration':
          await this.upsertGstRegistration(company, data);
          break;
        default:
          this.logger.warn('Unsupported sync-data type', { agentId, type });
          sendErr(`Unsupported sync-data type: ${type || 'missing'}`, { type });
          return;
      }

      sendAck({
        type,
        companyId: company._id.toString()
      });
    } catch (error) {
      this.logger.error('Error handling sync data', {
        agentId,
        error: error.message,
        stack: error.stack
      });

      this.sendMessage(agentId, {
        type: 'sync-data-error',
        syncRequestId,
        data: {
          message: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  async bindAgentToCompany(agentId, company) {
    if (!agentId || !company?._id) return;

    let connection = await TallyConnection.findOne({ agentId });
    if (!connection) {
      connection = new TallyConnection({
        company: company._id,
        agentId,
        agentVersion: 'unknown',
        connectionId: this.generateConnectionId(),
        status: 'connected',
        createdBy: company.createdBy
      });
    } else {
      connection.company = company._id;
      if (!connection.createdBy) {
        connection.createdBy = company.createdBy;
      }
    }

    await connection.save();
  }

  /**
   * Resolve which MongoDB company a sync row belongs to.
   * Important: desktop sends the user's selected *workspace* id on every payload; that may be a signup
   * placeholder. Tally identity in the payload (GUID + company name) must win over that id so data is not
   * written into the wrong company document.
   */
  async resolveCompanyForPayload(agentId, companyId, payloadData = {}, userId = null) {
    const tallyGuidRaw =
      payloadData.guid ||
      payloadData.GUID ||
      payloadData.companyGuid ||
      payloadData.companyPath ||
      payloadData.remoteid;
    const guidStr = tallyGuidRaw != null ? String(tallyGuidRaw).trim() : '';

    const explicitCompanyName = String(
      payloadData.companyName || payloadData.company || ''
    ).trim();

    const userAccess =
      userId && isValidId(userId)
        ? {
            $or: [
              { createdBy: String(userId) },
            ]
          }
        : null;

    const matchesUserAccess = (doc) => {
      if (!userId || !doc) return true;
      const uid = String(userId);
      if (String(doc.createdBy) === uid) return true;
      const users = doc.users || [];
      return users.some((u) => String(u.user?._id || u.user) === uid);
    };

    // 1) Tally company GUID → company (canonical)
    if (guidStr) {
      const byGuid = { tallyCompanyPath: guidStr };
      let doc = userAccess ? await Company.findOne({ $and: [byGuid, userAccess] }) : null;
      if (!doc) {
        doc = await Company.findOne(byGuid);
      }
      if (doc && (!userAccess || matchesUserAccess(doc))) {
        return doc;
      }
      if (doc && userAccess && !matchesUserAccess(doc)) {
        // fall through — wrong owner
      } else if (doc) {
        return doc;
      }
    }

    // 2) Tally company name on payload (do not use payloadData.name — that is item/party name on items/parties)
    if (explicitCompanyName) {
      const byName = {
        $or: [{ name: explicitCompanyName }, { displayName: explicitCompanyName }]
      };
      let doc = userAccess ? await Company.findOne({ $and: [byName, userAccess] }) : null;
      if (!doc) {
        doc = await Company.findOne(byName);
      }
      if (doc && (!userAccess || matchesUserAccess(doc))) {
        return doc;
      }
    }

    // 3) Agent session bound to a company after `company` sync
    const connectionRecord = await TallyConnection.findOne({ agentId }).populate('company');
    const bound = connectionRecord?.company;
    if (bound) {
      if (
        !explicitCompanyName ||
        bound.name === explicitCompanyName ||
        (bound.displayName && bound.displayName === explicitCompanyName)
      ) {
        return bound;
      }
      const boundPath = bound.tallyIntegration?.companyPath;
      if (guidStr && boundPath && String(boundPath).trim() === guidStr) {
        return bound;
      }
    }

    // 4) Explicit workspace companyId from agent — last resort only
    if (companyId && isValidId(companyId)) {
      const byId = await Company.findById(companyId);
      if (byId) {
        return byId;
      }
    }

    return bound || null;
  }

  async upsertCompanyMetadata(company, incomingCompany = {}) {
    company.tallyIntegration = {
      ...company.tallyIntegration,
      enabled: true,
      lastSyncDate: new Date(),
      companyPath: incomingCompany.guid || company.tallyIntegration?.companyPath
    };
    company.tallyCompanyPath = company.tallyIntegration.companyPath;

    await company.save();
  }

  async upsertCompany(incomingCompany = {}, userId = null) {
    let organizationId = null;
    if (isValidId(userId)) {
      const owner = await User.findById(userId).select('organizationId');
      organizationId = owner?.organizationId || null;
    }

    const now = new Date();
    const fyStartMonth = 3; // April (0-based month index)
    const fyStartDay = 1;
    const year = now.getMonth() >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
    const financialYearStart = new Date(year, fyStartMonth, fyStartDay);
    const financialYearEnd = new Date(year + 1, fyStartMonth, fyStartDay - 1);

    // Find by Tally GUID first
    let company = await Company.findOne({ tallyCompanyPath: incomingCompany.guid });

    if (!company) {
      const createdById = isValidId(userId) ? String(userId) : undefined;
      const newUsers = [];

      if (isValidId(userId)) {
        newUsers.push({
          user: String(userId),
          role: 'admin',
          permissions: {
            vouchers: { create: true, read: true, update: true, delete: true },
            inventory: { create: true, read: true, update: true, delete: true },
            reports: { financial: true, inventory: true, gst: true, analytics: true }
          }
        });
      }

      company = new Company({
        name: incomingCompany.name || 'Unknown Company',
        displayName: incomingCompany.name || 'Unknown Company',
        address: {
          line1: 'Tally Company',
          city: 'Unknown',
          state: incomingCompany.state || 'Unknown',
          pincode: incomingCompany.pincode || '400001',
          country: incomingCompany.country || 'India'
        },
        contact: {
          phone: incomingCompany.phone || '+910000000000',
          email: incomingCompany.email || 'tally@company.com'
        },
        businessType: 'other',
        industry: 'general',
        financialYear: {
          startDate: financialYearStart,
          endDate: financialYearEnd
        },
        tallyIntegration: {
          enabled: true,
          companyPath: incomingCompany.guid,
          lastSyncDate: new Date(),
          syncSettings: {
            autoSync: false,
            syncInterval: 300000,
            syncVouchers: true,
            syncInventory: true,
            syncMasters: true
          }
        },
        tallyCompanyPath: incomingCompany.guid,
        createdBy: createdById,
        organizationId: organizationId || undefined,
        users: newUsers
      });

      await company.save();
      this.logger.info('Created new company from Tally sync', { companyId: company._id, name: company.name });
    } else {
      if (organizationId && !company.organizationId) {
        company.organizationId = organizationId;
      }
      // Add authenticated user to existing company if not already present
      if (isValidId(userId) && !company.hasUserAccess(userId)) {
        company.users = [
          ...(company.users || []),
          {
            user: String(userId),
            role: 'admin',
            permissions: {
              vouchers: { create: true, read: true, update: true, delete: true },
              inventory: { create: true, read: true, update: true, delete: true },
              reports: { financial: true, inventory: true, gst: true, analytics: true }
            }
          }
        ];
      }
      await this.upsertCompanyMetadata(company, incomingCompany);
    }

    // Mobile / REST APIs scope companies via User.companies — keep it in sync with company.users
    if (isValidId(userId)) {
      await User.findByIdAndUpdate(userId, {
        $addToSet: { companies: company._id || company.id }
      });
    }

    return company;
  }

  normalizeVoucherType(incoming = {}) {
    if (typeof incoming === 'string') {
      return normalizeVoucherTypeSlug(incoming);
    }
    const payload = incoming || {};
    return normalizeVoucherTypeSlug(
      payload.voucherType,
      payload.tallyVoucherTypeParent,
      payload.tallyVoucherTypeName
    );
  }

  resolveIncomingVoucherType(incomingVoucher = {}) {
    if (incomingVoucher.tallyVoucherTypeParent || incomingVoucher.tallyVoucherTypeName) {
      return resolveVoucherTypeFromTally({
        parent: incomingVoucher.tallyVoucherTypeParent || '',
        displayName: incomingVoucher.tallyVoucherTypeName || ''
      });
    }
    if (incomingVoucher.voucherType) {
      return {
        voucherType: normalizeVoucherTypeSlug(incomingVoucher.voucherType),
        tallyVoucherTypeParent: String(incomingVoucher.tallyVoucherTypeParent || '').trim(),
        tallyVoucherTypeName: String(incomingVoucher.tallyVoucherTypeName || '').trim()
      };
    }
    return resolveVoucherTypeFromTally(incomingVoucher);
  }

  toObjectIdOrUndefined(value) {
    if (!value) return undefined;
    if (isValidId(value) || (typeof value === 'string' && value.length > 0)) {
      return String(value);
    }
    return undefined;
  }

  /**
   * Resolve the MongoDB document to update for a Tally voucher row.
   * Identity is Tally GUID (tallySync.tallyId) scoped to company — not voucher number.
   * Legacy rows without a GUID may still match on type+number for one-time migration.
   */
  async resolveVoucherUpsertFilter(company, voucherType, voucherNumber, tallyId) {
    const companyId = company._id;
    const normalizedNumber = String(voucherNumber ?? '').trim();
    const normalizedTallyId = String(tallyId ?? '').trim();
    const compositeFilter = {
      company: companyId,
      voucherType,
      voucherNumber: normalizedNumber
    };

    if (normalizedTallyId) {
      const byGuid = await Voucher.findOne({
        company: companyId,
        'tallySync.tallyId': normalizedTallyId
      })
        .select('_id')
        .lean();

      if (byGuid?._id) {
        return { _id: byGuid._id };
      }

      if (normalizedNumber) {
        const byComposite = await Voucher.findOne(compositeFilter).select('_id').lean();
        if (byComposite?._id) {
          return { _id: byComposite._id };
        }
      }

      return { company: companyId, 'tallySync.tallyId': normalizedTallyId };
    }

    if (normalizedNumber) {
      const byComposite = await Voucher.findOne(compositeFilter).select('_id').lean();
      if (byComposite?._id) {
        return { _id: byComposite._id };
      }
    }

    return compositeFilter;
  }

  /**
   * Batch-resolve upsert filters for voucher summary bulkWrite (avoids GUID-only misses).
   */
  async resolveVoucherUpsertFiltersBatch(company, rows = []) {
    const companyId = company._id;
    const filters = rows.map(() => null);

    const tallyIds = [
      ...new Set(
        rows
          .map((r) => String(r.tallyId || r.guid || r.GUID || '').trim())
          .filter(Boolean)
      )
    ];

    const guidToId = new Map();
    if (tallyIds.length) {
      const existingByGuid = await Voucher.find({
        company: companyId,
        'tallySync.tallyId': { $in: tallyIds }
      })
        .select('_id tallySync.tallyId')
        .lean();
      for (const doc of existingByGuid) {
        if (doc.tallySync?.tallyId) {
          guidToId.set(String(doc.tallySync.tallyId).trim(), doc._id);
        }
      }
    }

    const compositeClauses = [];
    const compositeRowIndexes = [];
    rows.forEach((row, index) => {
      const tallyId = String(row.tallyId || row.guid || row.GUID || '').trim();
      if (!tallyId) return;
      if (guidToId.has(tallyId)) {
        filters[index] = { _id: guidToId.get(tallyId) };
        return;
      }
      const typeResolved = this.resolveIncomingVoucherType(row);
      const voucherNumber = String(row.voucherNumber || '').trim();
      if (!voucherNumber) {
        filters[index] = { company: companyId, 'tallySync.tallyId': tallyId };
        return;
      }
      compositeClauses.push({
        company: companyId,
        voucherType: typeResolved.voucherType,
        voucherNumber
      });
      compositeRowIndexes.push(index);
    });

    const compositeToId = new Map();
    if (compositeClauses.length) {
      const CHUNK = 200;
      for (let offset = 0; offset < compositeClauses.length; offset += CHUNK) {
        const slice = compositeClauses.slice(offset, offset + CHUNK);
        const sliceIndexes = compositeRowIndexes.slice(offset, offset + CHUNK);
        const found = await Voucher.find({ $or: slice })
          .select('_id voucherType voucherNumber')
          .lean();
        for (const doc of found) {
          compositeToId.set(`${doc.voucherType}::${doc.voucherNumber}`, doc._id);
        }
        for (let i = 0; i < slice.length; i++) {
          const rowIndex = sliceIndexes[i];
          const clause = slice[i];
          const key = `${clause.voucherType}::${clause.voucherNumber}`;
          const tallyId = String(
            rows[rowIndex].tallyId || rows[rowIndex].guid || rows[rowIndex].GUID || ''
          ).trim();
          if (filters[rowIndex]) continue;
          if (compositeToId.has(key)) {
            filters[rowIndex] = { _id: compositeToId.get(key) };
          } else if (tallyId) {
            filters[rowIndex] = { company: companyId, 'tallySync.tallyId': tallyId };
          }
        }
      }
    }

    return filters;
  }

  async upsertTallyAccount(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    const accountType = incoming.accountType === 'ledger' ? 'ledger' : 'group';
    if (!name) return;

    await TallyAccount.findOneAndUpdate(
      { company: company._id, name, accountType },
      {
        $set: {
          company: company._id,
          name,
          accountType,
          parentGroup: String(incoming.parentGroup || '').trim(),
          tallyGuid: String(incoming.guid || incoming.tallyGuid || '').trim(),
          tallySync: { synced: true, lastSyncDate: new Date() }
        }
      },
      { upsert: true, new: true, runValidators: false }
    );
  }

  async upsertTallyAccountsBatch(company, accounts = []) {
    if (!Array.isArray(accounts) || !accounts.length) return;
    for (const row of accounts) {
      await this.upsertTallyAccount(company, row);
    }
  }

  async upsertVoucherType(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    if (!name) return;

    await VoucherType.findOneAndUpdate(
      { company: company._id, name },
      {
        $set: {
          company: company._id,
          name,
          parent: String(incoming.parent || '').trim(),
          reservedName: String(incoming.reservedName || '').trim(),
          tallySync: { synced: true, lastSyncDate: new Date() },
          isActive: true
        }
      },
      { upsert: true, new: true, runValidators: false }
    );
  }

  async upsertGodown(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    if (!name) return;

    await Godown.findOneAndUpdate(
      { company: company._id, name },
      {
        $set: {
          company: company._id,
          name,
          reservedName: String(incoming.reservedName || '').trim(),
          tallySync: { synced: true, lastSyncDate: new Date() },
          isActive: true
        }
      },
      { upsert: true, new: true, runValidators: false }
    );
  }

  async upsertUnit(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    if (!name) return;

    await Unit.findOneAndUpdate(
      { company: company._id, name },
      {
        $set: {
          company: company._id,
          name,
          reservedName: String(incoming.reservedName || '').trim(),
          tallySync: { synced: true, lastSyncDate: new Date() },
          isActive: true
        }
      },
      { upsert: true, new: true, runValidators: false }
    );
  }

  buildPartyBulkOp(company, incomingParty = {}) {
    const name = String(incomingParty.name || 'Unnamed Party').trim();
    if (!name) return null;

    const recordType = incomingParty.recordType === 'ledger' ? 'ledger' : 'party';
    const displayName = String(incomingParty.displayName || name).trim();
    const type = incomingParty.type || (recordType === 'ledger' ? 'both' : 'customer');
    const tallyId =
      incomingParty.guid || incomingParty.tallyId || incomingParty.tallySync?.tallyId || null;
    const tallyParent = String(
      incomingParty.tallyParent || incomingParty.parent || incomingParty.parentGroup || ''
    ).trim();

    if (recordType === 'ledger') {
      const update = {
        company: company._id,
        name,
        displayName,
        recordType: 'ledger',
        type,
        category: 'business',
        tallyParent,
        contact: {
          phone: '+919999999999',
          website: '',
          whatsapp: ''
        },
        addresses: [
          {
            type: 'billing',
            line1: name,
            city: '—',
            state: '—',
            pincode: '110001',
            country: 'India',
            isDefault: true
          }
        ],
        balances: {
          opening: { amount: 0, type: 'debit' }
        },
        creditLimit: { amount: 0, days: 30 },
        pricing: { discountPercentage: 0 },
        tallySync: {
          synced: true,
          tallyId: tallyId || name,
          masterId: '',
          alterId: '',
          lastSyncDate: new Date(),
          syncError: ''
        },
        createdBy: company.createdBy,
        updatedBy: company.createdBy,
        isActive: true
      };

      const filter = tallyId
        ? { company: company._id, 'tallySync.tallyId': tallyId }
        : { company: company._id, name, recordType: 'ledger' };

      return { updateOne: { filter, update: { $set: update }, upsert: true } };
    }

    const phone = this.normalizePartyPhone(incomingParty.phone);
    const email = this.normalizePartyEmail(incomingParty.email);
    const gstin = this.normalizePartyGstin(incomingParty.gstin);
    const pan = this.normalizePartyPan(incomingParty.pan);
    const pincode = this.normalizePartyPincode(incomingParty.pincode) || '110001';
    const state = String(incomingParty.state || 'Unknown').trim() || 'Unknown';
    const city = String(incomingParty.city || state || 'Unknown').trim() || 'Unknown';
    const country = String(incomingParty.country || 'India').trim() || 'India';

    const update = {
      company: company._id,
      name,
      displayName,
      recordType: 'party',
      type,
      category: incomingParty.category || 'business',
      tallyParent,
      gstRegistrationType: String(incomingParty.gstRegistrationType || '').trim(),
      placeOfSupply: String(
        incomingParty.placeOfSupply || incomingParty.state || ''
      ).trim(),
      contact: {
        phone: phone || '+919999999999',
        website: incomingParty.website || '',
        whatsapp: incomingParty.whatsapp || ''
      },
      addresses: [
        {
          type: 'billing',
          line1: String(incomingParty.address || displayName).trim() || displayName,
          line2: String(incomingParty.line2 || '').trim(),
          city,
          state,
          pincode,
          country,
          isDefault: true
        }
      ],
      balances: {
        opening: {
          amount: Math.abs(Number(incomingParty.openingBalance || 0)),
          type: incomingParty.openingBalanceType === 'credit' ? 'credit' : 'debit'
        }
      },
      creditLimit: {
        amount: Number(incomingParty.creditLimit || 0),
        days: Number(incomingParty.creditDays || 30)
      },
      pricing: {
        discountPercentage: Number(incomingParty.discountPercentage || 0)
      },
      notes: incomingParty.notes || '',
      tallySync: {
        synced: true,
        tallyId: tallyId || name,
        masterId: String(incomingParty.masterId || '').trim(),
        alterId: String(incomingParty.alterid || incomingParty.alterId || '').trim(),
        lastSyncDate: new Date(),
        syncError: ''
      },
      createdBy: company.createdBy,
      updatedBy: company.createdBy,
      isActive: incomingParty.isActive !== false
    };

    if (email) update.contact.email = email;
    if (gstin) update.gstin = gstin;
    if (pan) update.pan = pan;

    const filter = tallyId
      ? { company: company._id, 'tallySync.tallyId': tallyId }
      : { company: company._id, name, recordType: 'party' };

    return { updateOne: { filter, update: { $set: update }, upsert: true } };
  }

  buildItemBulkOp(company, incomingItem = {}) {
    const name = incomingItem.name || 'Unnamed Item';
    if (!String(name).trim()) return null;

    const partNo = String(
      incomingItem.partNo || incomingItem.barcode || incomingItem.alias || ''
    ).trim();
    const code = partNo || incomingItem.guid || incomingItem.alterid || undefined;
    const stockBalances = incomingItem.stockBalances || {};
    const openingStock = Number(stockBalances.openingBalance ?? incomingItem.openingBalance ?? 0);
    const closingStock =
      stockBalances.closingBalance != null
        ? Number(stockBalances.closingBalance || 0)
        : Number(incomingItem.closingBalance || 0);
    const currentQty = closingStock || openingStock;
    const openingValue = Number(incomingItem.openingValue || 0);
    const closingValue = Math.abs(Number(incomingItem.closingValue || 0));
    const closingRate = Math.abs(Number(incomingItem.closingRate || 0));
    // Prefer Tally's closing rate/value for per-unit price; fall back to opening value.
    const unitPrice =
      closingRate ||
      (currentQty > 0 && closingValue > 0 ? closingValue / currentQty : 0) ||
      (openingStock > 0 ? openingValue / openingStock : openingValue);

    const update = {
      company: company._id,
      name,
      displayName: name,
      code,
      barcode: partNo || undefined,
      description: partNo || '',
      type: 'product',
      units: {
        primary: {
          name: incomingItem.baseUnits || 'Nos',
          symbol: incomingItem.baseUnits || 'Nos',
          decimalPlaces: 0
        }
      },
      pricing: {
        costPrice: unitPrice || 0,
        sellingPrice: unitPrice || 0,
        mrp: unitPrice || 0,
        wholesalePrice: unitPrice || 0,
        retailPrice: unitPrice || 0
      },
      inventory: {
        trackInventory: true,
        stockLevels: {
          minimum: 0,
          maximum: 0,
          reorderLevel: 0,
          reorderQuantity: 0
        },
        currentStock: [
          {
            quantity: currentQty,
            reservedQuantity: 0,
            availableQuantity: currentQty,
            lastUpdated: new Date()
          }
        ]
      },
      tallyStock: {
        unit: stockBalances.unit || incomingItem.baseUnits || '',
        openingBalance: openingStock,
        inwardQuantity: Number(stockBalances.inwardQuantity || 0),
        outwardQuantity: Number(stockBalances.outwardQuantity || 0),
        closingBalance: closingStock || currentQty,
        closingValue,
        closingRate
      },
      tallySync: {
        synced: true,
        tallyId: incomingItem.guid || incomingItem.alterid || name,
        lastSyncDate: new Date(),
        syncError: ''
      },
      createdBy: company.createdBy,
      updatedBy: company.createdBy,
      isActive: true
    };

    return {
      updateOne: {
        filter: { company: company._id, name },
        update: { $set: update },
        upsert: true
      }
    };
  }

  buildTallyAccountBulkOp(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    if (!name) return null;
    const accountType = incoming.accountType === 'ledger' ? 'ledger' : 'group';

    return {
      updateOne: {
        filter: { company: company._id, name, accountType },
        update: {
          $set: {
            company: company._id,
            name,
            accountType,
            parentGroup: String(incoming.parentGroup || '').trim(),
            tallyGuid: String(incoming.guid || incoming.tallyGuid || '').trim(),
            tallySync: { synced: true, lastSyncDate: new Date() }
          }
        },
        upsert: true
      }
    };
  }

  buildVoucherTypeBulkOp(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    if (!name) return null;
    return {
      updateOne: {
        filter: { company: company._id, name },
        update: {
          $set: {
            company: company._id,
            name,
            parent: String(incoming.parent || '').trim(),
            reservedName: String(incoming.reservedName || '').trim(),
            tallySync: { synced: true, lastSyncDate: new Date() },
            isActive: true
          }
        },
        upsert: true
      }
    };
  }

  buildGodownBulkOp(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    if (!name) return null;
    return {
      updateOne: {
        filter: { company: company._id, name },
        update: {
          $set: {
            company: company._id,
            name,
            reservedName: String(incoming.reservedName || '').trim(),
            tallySync: { synced: true, lastSyncDate: new Date() },
            isActive: true
          }
        },
        upsert: true
      }
    };
  }

  buildUnitBulkOp(company, incoming = {}) {
    const name = String(incoming.name || '').trim();
    if (!name) return null;
    return {
      updateOne: {
        filter: { company: company._id, name },
        update: {
          $set: {
            company: company._id,
            name,
            reservedName: String(incoming.reservedName || '').trim(),
            tallySync: { synced: true, lastSyncDate: new Date() },
            isActive: true
          }
        },
        upsert: true
      }
    };
  }

  buildGstRegistrationBulkOp(company, incoming = {}) {
    const name = String(incoming.name || incoming.stateName || '').trim();
    if (!name) return null;

    const tallyId =
      String(incoming.guid || incoming.remoteId || incoming.tallyId || name).trim() || name;
    const gstin = String(incoming.gstin || '')
      .trim()
      .toUpperCase();

    return {
      updateOne: {
        filter: { company: company._id, name },
        update: {
          $set: {
            company: company._id,
            name,
            stateName: String(incoming.stateName || name).trim(),
            priorStateName: String(incoming.priorStateName || '').trim(),
            gstin,
            eWayApplicableType: String(incoming.eWayApplicableType || '').trim(),
            gstUserName: String(incoming.gstUserName || '').trim(),
            eSignMethod: String(incoming.eSignMethod || '').trim(),
            isOtherTerritoryAssessee: Boolean(incoming.isOtherTerritoryAssessee),
            isEwayBillApplicable: Boolean(incoming.isEwayBillApplicable),
            isEwayBillApplicableForIntra: Boolean(incoming.isEwayBillApplicableForIntra),
            registrationDetails: Array.isArray(incoming.registrationDetails)
              ? incoming.registrationDetails
              : [],
            tallySync: {
              synced: true,
              tallyId,
              masterId: String(incoming.masterId || '').trim(),
              alterId: String(incoming.alterid || incoming.alterId || '').trim(),
              lastSyncDate: new Date(),
              syncError: ''
            },
            isActive: true
          }
        },
        upsert: true
      }
    };
  }

  async upsertGstRegistration(company, data) {
    const op = this.buildGstRegistrationBulkOp(company, data);
    if (!op) return null;
    await GstRegistration.bulkWrite([op], { ordered: false });
    return true;
  }

  async bulkUpsertMasterBatch(entityType, company, rows = []) {
    const builders = {
      party: (row) => this.buildPartyBulkOp(company, row),
      item: (row) => this.buildItemBulkOp(company, row),
      tally_account: (row) => this.buildTallyAccountBulkOp(company, row),
      voucher_type: (row) => this.buildVoucherTypeBulkOp(company, row),
      godown: (row) => this.buildGodownBulkOp(company, row),
      unit: (row) => this.buildUnitBulkOp(company, row),
      gst_registration: (row) => this.buildGstRegistrationBulkOp(company, row)
    };

    const models = {
      party: Party,
      item: Item,
      tally_account: TallyAccount,
      voucher_type: VoucherType,
      godown: Godown,
      unit: Unit,
      gst_registration: GstRegistration
    };

    const build = builders[entityType];
    const Model = models[entityType];
    if (!build || !Model) {
      throw new Error(`Unsupported bulk master type: ${entityType}`);
    }

    const ops = [];
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        const op = build(rows[i]);
        if (op) ops.push(op);
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn('Skipped row in bulk master build', {
          entityType,
          index: i,
          error: error.message
        });
      }
    }

    if (!ops.length) {
      return { processed: 0, failed: skipped, errors: [] };
    }

    const CHUNK = 500;
    const errors = [];
    let processed = 0;

    for (let offset = 0; offset < ops.length; offset += CHUNK) {
      const slice = ops.slice(offset, offset + CHUNK);
      const result = await Model.bulkWrite(slice, { ordered: false });
      const writeErrors = result.getWriteErrors?.() || [];
      processed += slice.length - writeErrors.length;
      for (const we of writeErrors) {
        errors.push({
          index: offset + we.index,
          message: we.errmsg || String(we)
        });
      }
    }

    return {
      processed,
      failed: Math.max(0, rows.length - processed),
      errors: errors.slice(0, 20)
    };
  }

  /**
   * Build a single bulkWrite op for a summary voucher (no DB calls).
   * Relies on preloaded partyMap passed in from the batch method.
   * With `preserveLines`, the op leaves existing items/ledgerEntries/totals untouched
   * (used when the incoming row carries no line detail but the stored voucher does).
   */
  buildVoucherSummaryBulkOp(company, incomingVoucher, partyMap, { preserveLines = false, filter = null } = {}) {
    const typeResolved = this.resolveIncomingVoucherType(incomingVoucher);
    const voucherType = typeResolved.voucherType;
    const voucherNumber = String(
      incomingVoucher.voucherNumber || incomingVoucher.guid || `AUTO-${Date.now()}`
    ).trim();
    const amount = Number(
      incomingVoucher.amount ?? incomingVoucher.totals?.grandTotal ?? 0
    );
    const tallyId = String(
      incomingVoucher.tallyId || incomingVoucher.guid || incomingVoucher.GUID || ''
    ).trim();
    const alterId = String(incomingVoucher.alterId || incomingVoucher.ALTERID || '').trim();

    if (!tallyId) {
      return null;
    }

    let voucherDate = new Date();
    if (incomingVoucher.date) {
      const d = new Date(incomingVoucher.date);
      if (!Number.isNaN(d.getTime())) voucherDate = d;
    }

    const partyId = incomingVoucher.partyName
      ? partyMap.get(String(incomingVoucher.partyName).trim())
      : undefined;

    const incomingLedgerNames = Array.isArray(incomingVoucher.ledgerNames)
      ? incomingVoucher.ledgerNames.map((n) => String(n || '').trim()).filter(Boolean)
      : [];

    const { items, ledgerEntries } = this.normalizeIncomingVoucherLines(incomingVoucher);

    const update = {
      company: company._id,
      voucherType,
      tallyVoucherTypeParent: typeResolved.tallyVoucherTypeParent,
      tallyVoucherTypeName: typeResolved.tallyVoucherTypeName,
      voucherNumber,
      date: voucherDate,
      ...(partyId ? { party: partyId } : {}),
      partyName: incomingVoucher.partyName || '',
      tallyPersistedView: String(incomingVoucher.tallyPersistedView || '').trim(),
      ...(incomingVoucher.tallyEntryMode || incomingVoucher.vchEntryMode
        ? { tallyEntryMode: incomingVoucher.tallyEntryMode || incomingVoucher.vchEntryMode }
        : {}),
      hasInventory: Boolean(incomingVoucher.hasInventory) || items.length > 0,
      items,
      ledgerEntries,
      totals: incomingVoucher.totals || {
        subtotal: amount,
        discount: 0,
        taxableAmount: amount,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        totalTax: 0,
        roundOff: 0,
        grandTotal: amount
      },
      'tallySync.synced': true,
      'tallySync.tallyId': tallyId,
      'tallySync.tallyAlterId': alterId,
      'tallySync.isSummaryOnly': items.length === 0 && ledgerEntries.length === 0,
      'tallySync.lastSyncDate': new Date(),
      'tallySync.syncError': '',
      createdBy: company.createdBy,
      updatedBy: company.createdBy
    };

    if (preserveLines) {
      delete update.hasInventory;
      delete update.items;
      delete update.ledgerEntries;
      delete update.totals;
      delete update['tallySync.isSummaryOnly'];
    }

    const upsertFilter =
      filter ||
      { company: company._id, 'tallySync.tallyId': tallyId };

    const updateDoc = { $set: update };
    if (incomingLedgerNames.length) {
      updateDoc.$addToSet = { ledgerNames: { $each: incomingLedgerNames } };
    }

    return {
      updateOne: {
        filter: upsertFilter,
        update: updateDoc,
        upsert: true
      }
    };
  }

  /**
   * Bulk upsert a batch of summary vouchers — mirrors bulkUpsertMasterBatch.
   * Vouchers that already have full line detail are routed through upsertVoucherSummary.
   */
  async bulkUpsertVoucherSummaryBatch(company, rows = [], context = {}) {
    const emptyTiming = {
      items: 0,
      partyPreloadMs: 0,
      bulkWriteMs: 0,
      preservePrepassMs: 0,
      preserveSequentialMs: 0
    };
    if (!rows.length) {
      return { processed: 0, failed: 0, errors: [], timing: emptyTiming };
    }

    const timing = {
      items: rows.length,
      partyPreloadMs: 0,
      bulkWriteMs: 0,
      preservePrepassMs: 0,
      preserveSequentialMs: 0
    };

    // Line detail only needs preserving when the incoming row has none. Rows that carry
    // their own items/ledgerEntries overwrite the stored lines regardless of what exists,
    // so the prepass query can be limited to line-less rows (usually zero after a bulk
    // export, which keeps every row on the bulkWrite path).
    const rowHasLines = (row) =>
      (Array.isArray(row.items) && row.items.length > 0) ||
      (Array.isArray(row.ledgerEntries) && row.ledgerEntries.length > 0);

    const linelessTallyIds = [
      ...new Set(
        rows
          .filter((r) => !rowHasLines(r))
          .map((r) => String(r.tallyId || r.guid || r.GUID || '').trim())
          .filter(Boolean)
      )
    ];

    const fullDetailIdSet = new Set();
    if (linelessTallyIds.length) {
      const preservePrepassStart = Date.now();
      const fullDetailVouchers = await Voucher.find({
        company: company._id,
        'tallySync.tallyId': { $in: linelessTallyIds },
        'tallySync.isSummaryOnly': false
      })
        .select('tallySync.tallyId')
        .lean();
      timing.preservePrepassMs = Date.now() - preservePrepassStart;
      for (const v of fullDetailVouchers) {
        if (v.tallySync?.tallyId) fullDetailIdSet.add(v.tallySync.tallyId);
      }
    }

    const errors = [];
    let processed = 0;

    const partyNames = [
      ...new Set(
        rows.map((r) => String(r.partyName || '').trim()).filter(Boolean)
      )
    ];
    const partyMap = new Map();
    if (partyNames.length) {
      const partyPreloadStart = Date.now();
      const parties = await Party.find(
        { company: company._id, name: { $in: partyNames } },
        { _id: 1, name: 1 }
      ).lean();
      timing.partyPreloadMs = Date.now() - partyPreloadStart;
      for (const p of parties) partyMap.set(p.name, p._id);
    }

    const ops = [];
    let skipped = 0;
    const resolvedFilters = await this.resolveVoucherUpsertFiltersBatch(company, rows);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const tid = String(row.tallyId || row.guid || row.GUID || '').trim();
        const preserveLines = !rowHasLines(row) && tid && fullDetailIdSet.has(tid);
        const op = this.buildVoucherSummaryBulkOp(company, row, partyMap, {
          preserveLines,
          filter: resolvedFilters[i]
        });
        if (op) ops.push(op);
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        this.logger.warn('Skipped voucher row in bulk build', { index: i, error: err.message });
      }
    }

    if (!ops.length) {
      return {
        processed,
        failed: Math.max(0, rows.length - processed) + skipped,
        errors: errors.slice(0, 20),
        timing
      };
    }

    const CHUNK = 500;
    const bulkWriteStart = Date.now();
    for (let offset = 0; offset < ops.length; offset += CHUNK) {
      const slice = ops.slice(offset, offset + CHUNK);
      try {
        const result = await Voucher.bulkWrite(slice, { ordered: false });
        const writeErrors = result.getWriteErrors?.() || [];
        processed += slice.length - writeErrors.length;
        for (const we of writeErrors) {
          errors.push({ index: offset + we.index, message: we.errmsg || String(we) });
        }
      } catch (err) {
        errors.push({ index: offset, message: err.message });
      }
    }
    timing.bulkWriteMs = Date.now() - bulkWriteStart;

    return {
      processed,
      failed: Math.max(0, rows.length - processed - skipped),
      errors: errors.slice(0, 20),
      timing
    };
  }

  /**
   * Map agent voucher lines into Voucher schema shape (items + ledgerEntries).
   */
  normalizeIncomingVoucherLines(incomingVoucher = {}) {
    const items = [];
    const ledgerEntries = [];

    if (Array.isArray(incomingVoucher.items)) {
      for (const item of incomingVoucher.items) {
        const quantity = Number(item.quantity || 0);
        const rate = Number(item.rate || 0);
        const taxableLine = Number(item.amount) > 0 ? Number(item.amount) : quantity * rate;
        if (!taxableLine && !item.itemName && !item.name) continue;
        items.push({
          item: this.toObjectIdOrUndefined(item.itemId),
          itemName: item.itemName || item.name || '',
          description: item.description || '',
          quantity,
          unit: item.unit || 'Nos',
          rate: rate || taxableLine,
          discount: {
            percentage: Number(item.discount?.percentage ?? 0),
            amount: Number(item.discount?.amount ?? 0)
          },
          taxable: item.taxable !== false,
          hsnCode: item.hsnCode || '',
          gst: {
            cgst: Number(item.gst?.cgst || 0),
            sgst: Number(item.gst?.sgst || 0),
            igst: Number(item.gst?.igst || 0),
            cess: Number(item.gst?.cess || 0)
          },
          amount: taxableLine
        });
      }
    }

    if (Array.isArray(incomingVoucher.ledgerEntries)) {
      for (const entry of incomingVoucher.ledgerEntries) {
        const ledgerName = String(entry.ledgerName || entry.name || entry.ledger || '').trim();
        if (!ledgerName) continue;
        let debit = Number(entry.debit || 0);
        let credit = Number(entry.credit || 0);
        if (!debit && !credit && entry.amount != null) {
          const amt = Math.abs(Number(entry.amount || 0));
          if (Number(entry.amount) < 0) debit = amt;
          else credit = amt;
        }
        if (!debit && !credit) continue;
        const subLines = Array.isArray(entry.subLines)
          ? entry.subLines
              .map((s) => ({
                text: String(s.text || '').trim(),
                billType: String(s.billType || '').trim(),
                amount: Number(s.amount || 0),
                side: String(s.side || '').trim(),
                isNarration: Boolean(s.isNarration)
              }))
              .filter((s) => s.text)
          : [];
        ledgerEntries.push({
          ledger: ledgerName,
          debit,
          credit,
          narration: entry.narration || '',
          fromInventoryAccounting: Boolean(entry.fromInventoryAccounting),
          subLines
        });
      }
    }

    return { items, ledgerEntries };
  }

  async upsertVoucherSummary(company, incomingVoucher = {}) {
    const typeResolved = this.resolveIncomingVoucherType(incomingVoucher);
    const voucherType = typeResolved.voucherType;
    const voucherNumber = String(
      incomingVoucher.voucherNumber || incomingVoucher.guid || `AUTO-${Date.now()}`
    ).trim();
    const amount = Number(
      incomingVoucher.amount ??
        incomingVoucher.totals?.grandTotal ??
        0
    );
    const tallyId = String(
      incomingVoucher.tallyId || incomingVoucher.guid || incomingVoucher.GUID || ''
    ).trim();
    const alterId = String(incomingVoucher.alterId || incomingVoucher.ALTERID || '').trim();

    let partyId;
    if (incomingVoucher.partyName) {
      const party = await Party.findOne({
        company: company._id,
        name: incomingVoucher.partyName.trim()
      })
        .select('_id')
        .lean();
      if (party) partyId = party._id;
    }

    let voucherDate = new Date();
    if (incomingVoucher.date) {
      const d = new Date(incomingVoucher.date);
      if (!Number.isNaN(d.getTime())) voucherDate = d;
    }

    const filter = await this.resolveVoucherUpsertFilter(
      company,
      voucherType,
      voucherNumber,
      tallyId
    );

    const existing = await Voucher.findOne(filter)
      .select('items ledgerEntries totals hasInventory tallySync.isSummaryOnly ledgerNames')
      .lean();

    const incomingLedgerNames = Array.isArray(incomingVoucher.ledgerNames)
      ? incomingVoucher.ledgerNames.map((n) => String(n || '').trim()).filter(Boolean)
      : [];
    const mergedLedgerNames = [
      ...new Set([...(existing?.ledgerNames || []), ...incomingLedgerNames])
    ];

    const hasIncomingLines =
      (Array.isArray(incomingVoucher.items) && incomingVoucher.items.length > 0) ||
      (Array.isArray(incomingVoucher.ledgerEntries) && incomingVoucher.ledgerEntries.length > 0);

    const hasExistingLines =
      (Array.isArray(existing?.items) && existing.items.length > 0) ||
      (Array.isArray(existing?.ledgerEntries) && existing.ledgerEntries.length > 0);

    const preserveLineDetail = hasExistingLines && !hasIncomingLines;
    const { items, ledgerEntries } = this.normalizeIncomingVoucherLines(incomingVoucher);

    const update = {
      company: company._id,
      voucherType,
      tallyVoucherTypeParent: typeResolved.tallyVoucherTypeParent,
      tallyVoucherTypeName: typeResolved.tallyVoucherTypeName,
      voucherNumber,
      date: voucherDate,
      party: partyId,
      partyName: incomingVoucher.partyName || '',
      tallyPersistedView: String(incomingVoucher.tallyPersistedView || '').trim(),
      tallyEntryMode: incomingVoucher.tallyEntryMode || incomingVoucher.vchEntryMode || undefined,
      ledgerNames: mergedLedgerNames,
      hasInventory:
        Boolean(incomingVoucher.hasInventory) ||
        Boolean(existing?.hasInventory) ||
        items.length > 0,
      items: preserveLineDetail ? existing.items : items,
      ledgerEntries: preserveLineDetail ? existing.ledgerEntries : ledgerEntries,
      totals: preserveLineDetail && existing?.totals
        ? existing.totals
        : incomingVoucher.totals || {
          subtotal: amount,
          discount: 0,
          taxableAmount: amount,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0,
          totalTax: 0,
          roundOff: 0,
          grandTotal: amount
        },
      tallySync: {
        synced: true,
        tallyId: tallyId || undefined,
        tallyAlterId: alterId,
        isSummaryOnly: !(preserveLineDetail || hasIncomingLines),
        lastSyncDate: new Date(),
        syncError: ''
      },
      createdBy: company.createdBy,
      updatedBy: company.createdBy
    };

    await Voucher.findOneAndUpdate(filter, { $set: update }, { upsert: true, new: true, runValidators: false });
  }

  /**
   * Level 2 cache — full lines; does not bulk-preload.
   */
  async upsertVoucherDetail(company, incomingVoucher = {}) {
    const typeResolved = this.resolveIncomingVoucherType(incomingVoucher);
    const voucherType = typeResolved.voucherType;
    const voucherNumber = String(
      incomingVoucher.voucherNumber || incomingVoucher.guid || `AUTO-${Date.now()}`
    ).trim();
    const tallyId = String(
      incomingVoucher.tallyId || incomingVoucher.guid || incomingVoucher.GUID || ''
    ).trim();

    const filter = await this.resolveVoucherUpsertFilter(
      company,
      voucherType,
      voucherNumber,
      tallyId
    );

    await this.upsertVoucherSummary(company, {
      detailLevel: 'summary',
      voucherNumber,
      voucherType,
      tallyVoucherTypeParent: typeResolved.tallyVoucherTypeParent,
      tallyVoucherTypeName: typeResolved.tallyVoucherTypeName,
      date: incomingVoucher.date,
      partyName: incomingVoucher.partyName,
      amount: incomingVoucher.amount ?? incomingVoucher.totals?.grandTotal,
      guid: incomingVoucher.guid,
      tallyId,
      alterId: incomingVoucher.alterId,
      ledgerNames: incomingVoucher.ledgerNames,
      hasInventory: incomingVoucher.hasInventory,
      tallyPersistedView: incomingVoucher.tallyPersistedView,
      tallyEntryMode: incomingVoucher.tallyEntryMode
    });

    const voucherDoc = await Voucher.findOne(filter).select('_id').lean();
    if (!voucherDoc?._id) {
      throw new Error(`Voucher summary not found for detail upsert: ${voucherNumber}`);
    }

    const { items, ledgerEntries } = this.normalizeIncomingVoucherLines(incomingVoucher);
    const taxes = [];

    if (Array.isArray(incomingVoucher.items)) {
      for (const item of incomingVoucher.items) {
        const pct = Number(item.gst?.cgst || 0) + Number(item.gst?.sgst || 0) + Number(item.gst?.igst || 0);
        if (pct > 0) {
          taxes.push({
            name: item.itemName || item.name,
            rate: pct,
            amount: Number(item.taxAmount || 0)
          });
        }
      }
    }

    const now = new Date();
    await VoucherDetail.findOneAndUpdate(
      { voucherId: voucherDoc._id },
      {
        $set: {
          voucherId: voucherDoc._id,
          company: company._id,
          items,
          ledgerEntries,
          taxes,
          shipping: incomingVoucher.shipping || {},
          narration: incomingVoucher.narration || '',
          fullVoucherData: incomingVoucher,
          lastFetchedAt: now,
          lastAccessedAt: now
        }
      },
      { upsert: true, new: true }
    );

    const ledgerNamesFromDetail = ledgerEntries.map((e) => e.ledger).filter(Boolean);
    const ledgerNamesFromPayload = Array.isArray(incomingVoucher.ledgerNames)
      ? incomingVoucher.ledgerNames.map((n) => String(n || '').trim()).filter(Boolean)
      : [];
    const mergedLedgerNames = [
      ...new Set([...ledgerNamesFromDetail, ...ledgerNamesFromPayload])
    ];

    await Voucher.updateOne(
      { _id: voucherDoc._id },
      {
        $set: {
          'tallySync.isSummaryOnly': false,
          items,
          ledgerEntries,
          ledgerNames: mergedLedgerNames.length ? mergedLedgerNames : undefined,
          hasInventory: items.length > 0 || Boolean(incomingVoucher.hasInventory),
          narration: incomingVoucher.narration || '',
          shipping: incomingVoucher.shipping,
          totals: incomingVoucher.totals || undefined,
          tallyPersistedView: String(incomingVoucher.tallyPersistedView || '').trim(),
          tallyEntryMode: incomingVoucher.tallyEntryMode || incomingVoucher.vchEntryMode
        }
      }
    );

    const hydrateRequestId = incomingVoucher.hydrateRequestId;
    if (hydrateRequestId && this.pendingHydrations.has(hydrateRequestId)) {
      const pending = this.pendingHydrations.get(hydrateRequestId);
      clearTimeout(pending.timer);
      this.pendingHydrations.delete(hydrateRequestId);
      pending.resolve({ voucherId: voucherDoc._id.toString() });
    }
  }

  handleVoucherDetailResponse(agentId, message) {
    const requestId = message.requestId || message.data?.requestId;
    const data = message.data || {};
    if (!requestId || !this.pendingHydrations.has(requestId)) {
      return;
    }
    const pending = this.pendingHydrations.get(requestId);
    clearTimeout(pending.timer);
    this.pendingHydrations.delete(requestId);
    if (data.success === false) {
      pending.reject(new Error(data.message || 'Agent failed to fetch voucher detail'));
    } else {
      pending.resolve(data);
    }
  }

  async findConnectedAgentForCompany(companyId) {
    const companyKey = companyId?.toString?.() ?? String(companyId);
    const liveAgents = [];

    for (const [agentId, live] of this.connections) {
      if (live?.ws?.readyState === WebSocket.OPEN) {
        liveAgents.push({
          agentId,
          companyId: String(live.companyId || '')
        });
      }
    }

    const companyMatch = liveAgents.find((a) => a.companyId === companyKey);
    if (companyMatch) {
      return companyMatch.agentId;
    }

    const dbConnections = await TallyConnection.find({
      company: companyId,
      status: 'connected'
    })
      .sort({ lastConnected: -1 })
      .lean();

    for (const row of dbConnections) {
      const live = this.connections.get(row.agentId);
      if (live?.ws?.readyState === WebSocket.OPEN) {
        if (live.companyId !== companyKey) {
          live.companyId = companyKey;
        }
        return row.agentId;
      }
    }

    if (liveAgents.length === 1) {
      return liveAgents[0].agentId;
    }

    this.logger.warn('No live desktop agent for Tally import', {
      companyId: companyKey,
      liveAgentCount: liveAgents.length,
      liveAgents: liveAgents.map((a) => a.agentId),
      dbConnectedRows: dbConnections.length
    });

    return null;
  }

  /**
   * Request desktop agent to fetch one voucher's full XML from Tally.
   */
  handleImportVoucherResponse(agentId, message) {
    const data = message.data || message;
    const requestId = data.requestId || message.requestId;
    if (!requestId) {
      this.logger.warn('import-voucher-response missing requestId', { agentId });
      return;
    }
    const pending = this.pendingImports.get(requestId);
    if (!pending) {
      this.logger.warn('No pending import for response', { agentId, requestId });
      return;
    }
    clearTimeout(pending.timer);
    this.pendingImports.delete(requestId);

    if (data.success === true) {
      const result = data.data || data;
      pending.resolve({
        tallyGuid: result.tallyGuid || '',
        voucherNumber: result.voucherNumber || '',
        companyName: result.companyName || '',
        alreadyExisted: Boolean(result.alreadyExisted),
        ...result
      });
      return;
    }

    const tallyMeta = data.data && typeof data.data === 'object' ? data.data : {};
    const lineError =
      (Array.isArray(tallyMeta.lineErrors) && tallyMeta.lineErrors[0]) ||
      (Array.isArray(tallyMeta.errors) && tallyMeta.errors[0]) ||
      '';
    const errMsg =
      data.error ||
      data.message ||
      lineError ||
      'Voucher import failed';

    this.logger.warn('import-voucher rejected by agent', {
      agentId,
      requestId,
      error: errMsg,
      tallyImport: tallyMeta
    });
    pending.reject(new Error(errMsg));
  }

  handleImportLedgerResponse(agentId, message) {
    this.handleImportVoucherResponse(agentId, message);
  }

  handleImportStockItemResponse(agentId, message) {
    this.handleImportVoucherResponse(agentId, message);
  }

  _pushToAgent(company, messageType, data, options = {}) {
    return new Promise(async (resolve, reject) => {
      const agentId = await this.findConnectedAgentForCompany(company._id);
      if (!agentId) {
        return reject(
          new Error(
            'Desktop agent is not connected to the server. Open FinSync360 Desktop Agent, wait until Server shows Connected (green), then retry.'
          )
        );
      }

      const requestId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const timeoutMs = Number(process.env.VOUCHER_IMPORT_TIMEOUT_MS) || 120000;

      const timer = setTimeout(() => {
        if (this.pendingImports.has(requestId)) {
          this.pendingImports.delete(requestId);
          reject(new Error('Import timed out'));
        }
      }, timeoutMs);

      this.pendingImports.set(requestId, { resolve, reject, timer });

      const sent = this.sendMessage(agentId, {
        type: messageType,
        requestId,
        data: { requestId, ...data }
      });

      if (!sent) {
        clearTimeout(timer);
        this.pendingImports.delete(requestId);
        reject(new Error('Failed to send import request to agent'));
      }
    });
  }

  /**
   * Push a voucher to Tally via connected desktop agent.
   * @param {object} company - Company mongoose doc
   * @param {object} importPayload - see tallyVoucherImportPayload
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  pushVoucherToTally(company, importPayload, options = {}) {
    const companyName =
      importPayload.companyName || company.displayName || company.name || '';
    return this._pushToAgent(
      company,
      'import-voucher',
      {
        companyId: company._id.toString(),
        companyName,
        voucherId: options.voucherId || importPayload.remoteId,
        voucher: importPayload
      },
      options
    );
  }

  pushLedgerToTally(company, importPayload, options = {}) {
    const companyName =
      importPayload.companyName || company.displayName || company.name || '';
    return this._pushToAgent(company, 'import-ledger', {
      companyId: company._id.toString(),
      companyName,
      partyId: options.partyId || importPayload.remoteId,
      ledger: importPayload
    });
  }

  pushStockItemToTally(company, importPayload, options = {}) {
    const companyName =
      importPayload.companyName || company.displayName || company.name || '';
    return this._pushToAgent(company, 'import-stock-item', {
      companyId: company._id.toString(),
      companyName,
      itemId: options.itemId || importPayload.remoteId,
      stockItem: importPayload
    });
  }

  /**
   * @deprecated use pushVoucherToTally
   */
  pushSalesVoucherToTally(company, importPayload, options = {}) {
    return this.pushVoucherToTally(company, importPayload, options);
  }

  requestVoucherHydration(company, voucher) {
    return new Promise(async (resolve, reject) => {
      const agentId = await this.findConnectedAgentForCompany(company._id);
      if (!agentId) {
        return reject(new Error('Desktop agent is not connected'));
      }

      const tallyGuid = voucher?.tallySync?.tallyId || '';
      if (!tallyGuid) {
        return reject(new Error('Voucher has no Tally GUID'));
      }

      const companyName =
        company.displayName || company.name || voucher.companyName || '';
      const requestId = `hydrate_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const timer = setTimeout(() => {
        if (this.pendingHydrations.has(requestId)) {
          this.pendingHydrations.delete(requestId);
          reject(new Error('Voucher detail fetch timed out'));
        }
      }, Number(process.env.VOUCHER_HYDRATE_TIMEOUT_MS) || 120000);

      this.pendingHydrations.set(requestId, { resolve, reject, timer });

      const sent = this.sendMessage(agentId, {
        type: 'fetch-voucher-detail',
        requestId,
        data: {
          requestId,
          companyId: company._id.toString(),
          companyName,
          guid: tallyGuid,
          date: voucher.date ? new Date(voucher.date).toISOString().slice(0, 10) : null,
          voucherId: voucher._id.toString()
        }
      });

      if (!sent) {
        clearTimeout(timer);
        this.pendingHydrations.delete(requestId);
        reject(new Error('Failed to send hydrate request to agent'));
      }
    });
  }

  async upsertVoucher(company, incomingVoucher = {}) {
    if (incomingVoucher.detailLevel === 'summary') {
      return this.upsertVoucherSummary(company, incomingVoucher);
    }
    if (incomingVoucher.detailLevel === 'full') {
      return this.upsertVoucherDetail(company, incomingVoucher);
    }

    const typeResolved = this.resolveIncomingVoucherType(incomingVoucher);
    const voucherType = typeResolved.voucherType;
    const voucherNumber = String(
      incomingVoucher.voucherNumber || incomingVoucher.guid || `AUTO-${Date.now()}`
    ).trim();

    // Calculate totals from items and ledger entries if available
    let subtotal = 0;
    let totalTax = 0;
    let grandTotal = 0;

    const items = [];
    const ledgerEntries = [];

    // Process voucher items if available
    if (incomingVoucher.items && Array.isArray(incomingVoucher.items)) {
      for (const item of incomingVoucher.items) {
        const quantity = Number(item.quantity || 0);
        const rate = Number(item.rate || 0);
        const fromClientLine = Number(item.amount);
        const qtyRateLine = quantity * rate;
        const taxableLine =
          Number.isFinite(fromClientLine) && fromClientLine > 0 ? fromClientLine : qtyRateLine;

        const cgstPct = Number(item.gst?.cgst || item.CGST || 0);
        const sgstPct = Number(item.gst?.sgst || item.SGST || 0);
        const igstPct = Number(item.gst?.igst || item.IGST || 0);
        const cessPct = Number(item.gst?.cess || item.CESS || 0);
        const effectivePct =
          cgstPct > 0 || sgstPct > 0 ? cgstPct + sgstPct : igstPct;

        const computedTax = Number(((taxableLine * effectivePct) / 100).toFixed(2));
        const taxFromClient = Number(item.taxAmount);
        const taxAmount =
          Number.isFinite(taxFromClient) && taxFromClient > 0 ? taxFromClient : computedTax;

        const mappedItemId = this.toObjectIdOrUndefined(item.itemId);
        const itemName = item.itemName || item.name || item.description || '';

        items.push({
          item: mappedItemId,
          itemName,
          description: item.description || '',
          quantity,
          unit: item.unit || 'Nos',
          rate,
          discount: {
            percentage: Number(item.discount?.percentage ?? item.discountPercent ?? 0),
            amount: Number(item.discount?.amount ?? item.discount ?? 0)
          },
          taxable: typeof item.taxable === 'boolean' ? item.taxable : true,
          hsnCode: item.hsnCode || item.HSN || '',
          gst: {
            cgst: cgstPct,
            sgst: sgstPct,
            igst: igstPct,
            cess: cessPct
          },
          amount: taxableLine
        });

        subtotal += taxableLine;
        totalTax += taxAmount;
      }
    }

    // Process ledger entries (Tally sync sends debit/credit; legacy sent amount/type)
    if (incomingVoucher.ledgerEntries && Array.isArray(incomingVoucher.ledgerEntries)) {
      for (const entry of incomingVoucher.ledgerEntries) {
        const ledgerName = String(
          entry.ledgerName || entry.name || entry.ledger || ''
        ).trim();
        if (!ledgerName) continue;

        let debit = Number(entry.debit || 0);
        let credit = Number(entry.credit || 0);

        if (!debit && !credit && entry.amount != null) {
          const amt = Math.abs(Number(entry.amount || 0));
          const t = String(entry.type || '').toLowerCase();
          if (t === 'debit') debit = amt;
          else if (t === 'credit') credit = amt;
          else if (Number(entry.amount) < 0) debit = amt;
          else credit = amt;
        }

        if (!debit && !credit) continue;

        const subLines = Array.isArray(entry.subLines)
          ? entry.subLines
              .map((s) => ({
                text: String(s.text || '').trim(),
                billType: String(s.billType || '').trim(),
                amount: Number(s.amount || 0),
                side: String(s.side || '').trim(),
                isNarration: Boolean(s.isNarration)
              }))
              .filter((s) => s.text)
          : [];

        ledgerEntries.push({
          ledger: ledgerName,
          debit,
          credit,
          narration: entry.narration || '',
          fromInventoryAccounting: Boolean(entry.fromInventoryAccounting),
          subLines
        });
      }
    }

    const incomingTotals = incomingVoucher.totals || {};
    if (Number(incomingTotals.grandTotal) > 0) {
      subtotal = Number(incomingTotals.subtotal ?? subtotal);
      totalTax = Number(incomingTotals.totalTax ?? totalTax);
      grandTotal = Number(incomingTotals.grandTotal);
    } else if (items.length === 0 && ledgerEntries.length === 0) {
      const amount = Number(incomingVoucher.amount || 0);
      subtotal = amount;
      grandTotal = amount;
    } else if (items.length === 0 && ledgerEntries.length > 0) {
      const totalDebit = ledgerEntries.reduce((s, e) => s + Number(e.debit || 0), 0);
      const totalCredit = ledgerEntries.reduce((s, e) => s + Number(e.credit || 0), 0);
      grandTotal = Math.max(totalDebit, totalCredit);
      const taxFromLedgers = ledgerEntries.reduce((s, e) => {
        const n = String(e.ledger || '').toLowerCase();
        if (n.includes('cgst') || n.includes('sgst') || n.includes('igst') || n.includes('cess')) {
          return s + Math.max(Number(e.debit || 0), Number(e.credit || 0));
        }
        return s;
      }, 0);
      totalTax = taxFromLedgers;
      subtotal = Math.max(0, grandTotal - totalTax);
    } else {
      grandTotal = subtotal + totalTax;
    }

    let partyId;
    if (incomingVoucher.partyName) {
      const query = { company: company._id, name: incomingVoucher.partyName.trim() };
      if (incomingVoucher.gstIn) {
        query.gstin = incomingVoucher.gstIn.trim();
      }
      const party = await Party.findOne(query).lean();
      if (party) {
        partyId = party._id;
      }
    }

    let voucherDate = null;
    if (incomingVoucher.date) {
      voucherDate = new Date(incomingVoucher.date);
      if (Number.isNaN(voucherDate.getTime())) {
        this.logger.warn('Incoming voucher date is invalid, falling back to today', {
          companyId: company._id.toString(),
          voucherNumber,
          rawDate: incomingVoucher.date
        });
        voucherDate = new Date();
      }
    } else {
      voucherDate = new Date();
    }

    const tallyId = String(
      incomingVoucher.tallyId || incomingVoucher.guid || incomingVoucher.GUID || ''
    ).trim();

    const filter = await this.resolveVoucherUpsertFilter(
      company,
      voucherType,
      voucherNumber,
      tallyId
    );

    const update = {
      company: company._id,
      voucherType,
      tallyVoucherTypeParent: typeResolved.tallyVoucherTypeParent,
      tallyVoucherTypeName: typeResolved.tallyVoucherTypeName,
      voucherNumber,
      date: voucherDate,
      narration: incomingVoucher.narration || '',
      party: partyId,
      partyName: incomingVoucher.partyName || incomingVoucher.PartyName || incomingVoucher.party || '',
      reference: {
        number: incomingVoucher.reference || '',
        date: incomingVoucher.referenceDate ? new Date(incomingVoucher.referenceDate) : undefined
      },
      items,
      ledgerEntries,
      tallyPersistedView: String(incomingVoucher.tallyPersistedView || '').trim(),
      tallyEntryMode:
        incomingVoucher.tallyEntryMode ||
        incomingVoucher.vchEntryMode ||
        (items.length > 0 ? 'item_invoice' : ledgerEntries.length > 0 ? 'accounting_invoice' : 'item_invoice'),
      totals: {
        subtotal: Number(incomingTotals.subtotal ?? subtotal),
        discount: Number(incomingTotals.discount ?? 0),
        taxableAmount: Number(incomingTotals.taxableAmount ?? subtotal),
        cgst: Number(incomingTotals.cgst ?? 0),
        sgst: Number(incomingTotals.sgst ?? 0),
        igst: Number(incomingTotals.igst ?? 0),
        cess: Number(incomingTotals.cess ?? 0),
        totalTax: Number(incomingTotals.totalTax ?? totalTax),
        roundOff: Number(incomingTotals.roundOff ?? 0),
        grandTotal: Number(incomingTotals.grandTotal ?? grandTotal)
      },
      shipping: incomingVoucher.shipping ? {
        address: {
          line1: incomingVoucher.shipping.address?.line1 || '',
          line2: incomingVoucher.shipping.address?.line2 || '',
          city: incomingVoucher.shipping.address?.city || '',
          state: incomingVoucher.shipping.address?.state || '',
          pincode: incomingVoucher.shipping.address?.pincode || '',
          country: incomingVoucher.shipping.address?.country || 'India'
        },
        method: incomingVoucher.shipping.method || '',
        charges: Number(incomingVoucher.shipping.charges || 0),
        trackingNumber: incomingVoucher.shipping.trackingNumber || ''
      } : undefined,
      status: incomingVoucher.status || 'pending',
      tallySync: {
        synced: true,
        tallyId: tallyId || String(incomingVoucher.alterid || '').trim() || undefined,
        tallyAlterId: String(
          incomingVoucher.alterId || incomingVoucher.alterid || incomingVoucher.ALTERID || ''
        ).trim(),
        isSummaryOnly: items.length === 0 && ledgerEntries.length === 0,
        lastSyncDate: new Date(),
        syncError: ''
      },
      createdBy: company.createdBy,
      updatedBy: company.createdBy
    };

    const updateOptions = {
      upsert: true,
      new: true,
      runValidators: false
    };

    try {
      await Voucher.findOneAndUpdate(filter, { $set: update }, updateOptions);
    } catch (error) {
      const isDupKey =
        error?.code === 11000 ||
        /E11000 duplicate key/i.test(String(error?.message || ''));

      if (isDupKey) {
        const compositeFilter = {
          company: company._id,
          voucherType,
          voucherNumber
        };
        const existing = await Voucher.findOne(compositeFilter).select('_id').lean();
        if (existing?._id) {
          await Voucher.findOneAndUpdate(
            { _id: existing._id },
            { $set: update },
            { new: true, runValidators: false }
          );
          return;
        }
      }

      this.logger.error('Failed to upsert voucher', {
        companyId: company._id.toString(),
        voucherType,
        voucherNumber,
        tallyId: tallyId || '(none)',
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async upsertOutstandingReceivable(company, incoming = {}) {
    const reportName = incoming.reportName || 'Bills Receivable';
    const fromDate = incoming.fromDate ? new Date(incoming.fromDate) : null;
    const toDate = incoming.toDate ? new Date(incoming.toDate) : null;
    const asOfDate = incoming.asOfDate ? new Date(incoming.asOfDate) : new Date();

    const ledgers = Array.isArray(incoming.ledgers)
      ? incoming.ledgers.map((ledger) => ({
          partyName: String(ledger.partyName || '').trim(),
          totalOutstanding: Number(ledger.totalOutstanding || 0),
          billCount: Number(ledger.billCount || (ledger.bills || []).length),
          oldestBillDue: ledger.oldestBillDue ? new Date(ledger.oldestBillDue) : undefined,
          oldestOverdueDays:
            ledger.oldestOverdueDays != null ? Number(ledger.oldestOverdueDays) : undefined,
          bills: (ledger.bills || []).map((bill) => ({
            billRef: String(bill.billRef || ''),
            billDate: bill.billDate ? new Date(bill.billDate) : undefined,
            billDue: bill.billDue ? new Date(bill.billDue) : undefined,
            billOverdue: bill.billOverdue != null ? Number(bill.billOverdue) : undefined,
            closingBalance: Math.abs(Number(bill.closingBalance || 0)),
            vchDate: bill.vchDate ? new Date(bill.vchDate) : undefined,
            vchType: bill.vchType || '',
            vchNumber: bill.vchNumber || '',
            vchAmount: Number(bill.vchAmount || 0),
            inventoryLines: Array.isArray(bill.inventoryLines) ? bill.inventoryLines : []
          }))
        }))
      : [];

    const totalOutstanding =
      Number(incoming.totalOutstanding) ||
      ledgers.reduce((sum, l) => sum + Number(l.totalOutstanding || 0), 0);

    const filter = { company: company._id, reportName };
    const update = {
      company: company._id,
      reportName,
      fromDate,
      toDate,
      asOfDate,
      totalOutstanding,
      ledgers,
      tallySync: {
        synced: true,
        lastSyncDate: new Date(),
        syncError: ''
      },
      createdBy: company.createdBy,
      updatedBy: company.createdBy
    };

    await OutstandingReceivable.findOneAndUpdate(filter, { $set: update }, {
      upsert: true,
      new: true,
      runValidators: false
    });
  }

  async upsertReport(company, incomingReport = {}) {
    const reportName = incomingReport.reportName || 'Profit and Loss';
    const periodKey = incomingReport.periodKey || null;

    const entries = Array.isArray(incomingReport.entries)
      ? incomingReport.entries.map(e => ({
        name: e.name || '',
        displayName: e.displayName || e.name || '',
        subAmount: Number(e.subAmount || 0),
        mainAmount: Number(e.mainAmount || 0),
        isGroup: Boolean(e.isGroup)
      }))
      : [];

    const totals = incomingReport.totals || {};

    const tallySync = {
      synced: true,
      tallyId: incomingReport.tallyId || incomingReport.guid || undefined,
      lastSyncDate: new Date(),
      syncError: ''
    };

    const isBalanceSheet = /balance\s*sheet/i.test(reportName);

    try {
      if (isBalanceSheet) {
        const asOfDate = incomingReport.asOfDate
          ? new Date(incomingReport.asOfDate)
          : incomingReport.toDate
            ? new Date(incomingReport.toDate)
            : null;

        if (!periodKey) {
          throw new Error('Balance Sheet sync requires periodKey');
        }

        const filter = {
          company: company._id,
          reportName: 'Balance Sheet',
          periodKey
        };

        const fromDate = incomingReport.fromDate
          ? new Date(incomingReport.fromDate)
          : incomingReport.booksFromDate
            ? new Date(incomingReport.booksFromDate)
            : null;

        const groupSummaries = Array.isArray(incomingReport.groupSummaries)
          ? incomingReport.groupSummaries.map((g) => ({
            groupName: g.groupName || '',
            parentGroup: g.parentGroup || '',
            groupAmount: Number(g.groupAmount || 0),
            ledgers: Array.isArray(g.ledgers)
              ? g.ledgers.map((l) => ({
                name: l.name || l.displayName || '',
                displayName: l.displayName || l.name || '',
                debit: Number(l.debit || 0),
                credit: Number(l.credit || 0),
                amount: Number(l.amount || 0),
                isGroup: Boolean(l.isGroup)
              }))
              : []
          }))
          : [];

        const update = {
          company: company._id,
          reportName: 'Balance Sheet',
          periodKey,
          asOfDate,
          fromDate,
          entries,
          groupSummaries,
          totals,
          tallySync,
          createdBy: company.createdBy,
          updatedBy: company.createdBy
        };

        await BalanceSheetReport.findOneAndUpdate(filter, { $set: update }, {
          upsert: true,
          new: true,
          runValidators: false
        });
        return;
      }

      const fromDate = incomingReport.fromDate ? new Date(incomingReport.fromDate) : null;
      const toDate = incomingReport.toDate ? new Date(incomingReport.toDate) : null;

      const filter = periodKey
        ? { company: company._id, reportName, periodKey }
        : { company: company._id, reportName, fromDate, toDate };

      const groupSummaries = Array.isArray(incomingReport.groupSummaries)
        ? incomingReport.groupSummaries.map((g) => ({
          groupName: g.groupName || '',
          parentGroup: g.parentGroup || '',
          groupAmount: Number(g.groupAmount || 0),
          ledgers: Array.isArray(g.ledgers)
            ? g.ledgers.map((l) => ({
              name: l.name || l.displayName || '',
              displayName: l.displayName || l.name || '',
              debit: Number(l.debit || 0),
              credit: Number(l.credit || 0),
              amount: Number(l.amount || 0),
              isGroup: Boolean(l.isGroup)
            }))
            : []
        }))
        : [];

      const update = {
        company: company._id,
        reportName,
        periodKey: periodKey || undefined,
        fromDate,
        toDate,
        entries,
        groupSummaries,
        totals,
        tallySync,
        createdBy: company.createdBy,
        updatedBy: company.createdBy
      };

      await ProfitLossReport.findOneAndUpdate(filter, { $set: update }, {
        upsert: true,
        new: true,
        runValidators: false
      });
    } catch (error) {
      this.logger.error('Failed to upsert report', {
        companyId: company._id.toString(),
        reportName,
        periodKey,
        error: error.message
      });
      throw error;
    }
  }

  async upsertItem(company, incomingItem = {}) {
    const name = incomingItem.name || 'Unnamed Item';
    const partNo = String(
      incomingItem.partNo || incomingItem.barcode || incomingItem.alias || ''
    ).trim();
    const code = partNo || incomingItem.guid || incomingItem.alterid || undefined;
    const stockBalances = incomingItem.stockBalances && typeof incomingItem.stockBalances === 'object'
      ? incomingItem.stockBalances
      : null;

    const closingStock =
      stockBalances && stockBalances.closingBalance != null
        ? Number(stockBalances.closingBalance || 0)
        : Number(incomingItem.closingBalance || incomingItem.ClosingBalance || 0);

    const openingStock = Number(incomingItem.openingBalance || 0);
    const openingValue = Number(incomingItem.openingValue || 0);
    const closingValue = Math.abs(Number(incomingItem.closingValue || 0));
    const closingRate = Math.abs(Number(incomingItem.closingRate || 0));
    const valueQtyBase = closingStock > 0 ? closingStock : openingStock;
    // Prefer Tally's closing rate/value for per-unit price; fall back to opening value.
    const sellingPrice =
      closingRate ||
      (valueQtyBase > 0 && closingValue > 0 ? closingValue / valueQtyBase : 0) ||
      (valueQtyBase > 0 ? openingValue / valueQtyBase : openingValue);

    const filter = {
      company: company._id,
      name
    };

    const update = {
      company: company._id,
      name,
      displayName: name,
      code,
      barcode: partNo || undefined,
      description: partNo || '',
      type: 'product',
      units: {
        primary: {
          name: incomingItem.baseUnits || 'Nos',
          symbol: incomingItem.baseUnits || 'Nos',
          decimalPlaces: 0
        }
      },
      pricing: {
        costPrice: sellingPrice || 0,
        sellingPrice: sellingPrice || 0,
        mrp: sellingPrice || 0,
        wholesalePrice: sellingPrice || 0,
        retailPrice: sellingPrice || 0
      },
      inventory: {
        trackInventory: true,
        stockLevels: {
          minimum: 0,
          maximum: 0,
          reorderLevel: 0,
          reorderQuantity: 0
        },
        currentStock: [{
          // Inventory screens should reflect the current/closing stock on hand from Tally.
          quantity: valueQtyBase,
          reservedQuantity: 0,
          availableQuantity: valueQtyBase,
          lastUpdated: new Date()
        }]
      },
      tallyStock: {
        unit: stockBalances?.unit || incomingItem.baseUnits || '',
        openingBalance: Number(stockBalances?.openingBalance || openingStock || 0),
        inwardQuantity: Number(stockBalances?.inwardQuantity || 0),
        outwardQuantity: Number(stockBalances?.outwardQuantity || 0),
        closingBalance: Number(stockBalances?.closingBalance || closingStock || valueQtyBase || 0),
        closingValue,
        closingRate
      },
      tallySync: {
        synced: true,
        tallyId: incomingItem.guid || incomingItem.alterid || name,
        lastSyncDate: new Date(),
        syncError: ''
      },
      createdBy: company.createdBy,
      updatedBy: company.createdBy,
      isActive: true
    };

    await Item.findOneAndUpdate(filter, { $set: update }, { upsert: true, new: true, runValidators: false });
  }

  normalizePartyPhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (String(raw).startsWith('+')) return String(raw).trim();
    return `+${digits}`;
  }

  normalizePartyEmail(raw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email) return '';
    return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email) ? email : '';
  }

  normalizePartyGstin(raw) {
    const gstin = String(raw || '').trim().toUpperCase();
    if (!gstin) return '';
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin) ? gstin : '';
  }

  normalizePartyPan(raw) {
    const pan = String(raw || '').trim().toUpperCase();
    if (!pan) return '';
    return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan) ? pan : '';
  }

  normalizePartyPincode(raw) {
    const pin = String(raw || '').replace(/\D/g, '');
    if (/^[1-9][0-9]{5}$/.test(pin)) return pin;
    return '';
  }

  async upsertParty(company, incomingParty = {}) {
    const op = this.buildPartyBulkOp(company, incomingParty);
    if (!op) return;
    await Party.bulkWrite([op], { ordered: true });
  }

  /**
   * Handle Tally notification
   * @param {string} agentId - Agent ID
   * @param {Object} message - Notification message
   */
  async handleTallyNotification(agentId, message) {
    this.logger.info('Received Tally notification', {
      agentId,
      notificationType: message.data?.type,
      notification: message.data
    });

    // TODO: Process different types of Tally notifications
    // - Data changes
    // - Company events
    // - Error notifications
    // - Status updates
  }

  /**
   * Handle agent error
   * @param {string} agentId - Agent ID
   * @param {Object} message - Error message
   */
  async handleAgentError(agentId, message) {
    this.logger.error('Agent reported error', {
      agentId,
      error: message.data
    });

    // Update connection with error
    try {
      const dbConnection = await TallyConnection.findOne({ agentId });
      if (dbConnection) {
        dbConnection.addLog('error', message.data.message || 'Agent error', message.data);
        await dbConnection.save();
      }
    } catch (error) {
      this.logger.error('Error logging agent error', {
        agentId,
        error: error.message
      });
    }
  }

  /**
   * Handle pong response
   * @param {string} agentId - Agent ID
   */
  handlePong(agentId) {
    const connection = this.connections.get(agentId);
    if (connection?.ws) {
      connection.ws.isAlive = true;
    }
    if (connection) {
      connection.isAlive = true;
    }
  }

  /**
   * Handle WebSocket server error
   * @param {Error} error - Server error
   */
  handleServerError(error) {
    this.logger.error('WebSocket server error', {
      error: error.message,
      stack: error.stack
    });
  }

  /**
   * Send message to agent
   * @param {string} agentId - Agent ID
   * @param {Object} message - Message to send
   * @returns {boolean} Success status
   */
  sendMessage(agentId, message) {
    const connection = this.connections.get(agentId);
    
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('Cannot send message: Agent not connected', { agentId });
      return false;
    }

    try {
      connection.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.logger.error('Error sending message to agent', {
        agentId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Broadcast message to all connected agents
   * @param {Object} message - Message to broadcast
   * @param {Array} excludeAgents - Agent IDs to exclude
   */
  broadcastMessage(message, excludeAgents = []) {
    let sentCount = 0;
    
    for (const [agentId, connection] of this.connections) {
      if (!excludeAgents.includes(agentId) && connection.ws.readyState === WebSocket.OPEN) {
        if (this.sendMessage(agentId, message)) {
          sentCount++;
        }
      }
    }

    this.logger.info('Message broadcasted', { sentCount, totalConnections: this.connections.size });
    return sentCount;
  }

  /**
   * Start heartbeat interval to check connection health
   */
  startHeartbeatInterval() {
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 60000); // 60 seconds — allow slow voucher/item upserts without dropping the agent
  }

  /**
   * Update connection status in database
   * @param {string} agentId - Agent ID
   * @param {string} status - Connection status
   * @param {string} reason - Reason for status change
   */
  async updateConnectionStatus(agentId, status, reason = '') {
    try {
      const dbConnection = await TallyConnection.findOne({ agentId });
      if (!dbConnection) {
        this.logger.info('Skipping connection status persistence until agent registers a company', {
          agentId,
          status
        });
        return;
      }

      if (status === 'connected') {
        await dbConnection.connect();
      } else if (status === 'disconnected') {
        await dbConnection.disconnect(reason);
      } else {
        dbConnection.status = status;
        if (reason) {
          dbConnection.addLog('info', `Status changed to ${status}: ${reason}`);
        }
        await dbConnection.save();
      }
    } catch (error) {
      this.logger.error('Error updating connection status', {
        agentId,
        status,
        error: error.message
      });
    }
  }

  /**
   * Generate unique connection ID
   * @returns {string} Connection ID
   */
  generateConnectionId() {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection statistics
   */
  getConnectionStats() {
    const totalConnections = this.connections.size;
    const activeConnections = Array.from(this.connections.values())
      .filter(conn => conn.ws.readyState === WebSocket.OPEN).length;

    return {
      totalConnections,
      activeConnections,
      inactiveConnections: totalConnections - activeConnections
    };
  }

  /**
   * Close all connections and shutdown server
   */
  shutdown() {
    if (this.wss) {
      this.wss.clients.forEach((ws) => {
        ws.close(1001, 'Server shutting down');
      });
      this.wss.close();
    }

    this.connections.clear();
    this.logger.info('Tally WebSocket service shutdown complete');
  }
}

export default new TallyWebSocketService();
