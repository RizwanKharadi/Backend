import { Sequelize, DataTypes } from 'sequelize';
import { createCompatModel } from './compatModel.js';
import { newId } from './queryUtils.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ID = {
  type: DataTypes.STRING(36),
  primaryKey: true,
  defaultValue: () => newId(),
};

const JSONF = DataTypes.JSON;
const STR = DataTypes.STRING;
const TEXT = DataTypes.TEXT;
const BOOL = DataTypes.BOOLEAN;
const INT = DataTypes.INTEGER;
const FLOAT = DataTypes.FLOAT;
const DATE = DataTypes.DATE;
const DECIMAL = DataTypes.DECIMAL(18, 4);

function refId(field = 'company') {
  return { type: DataTypes.STRING(36), allowNull: true, field };
}

/**
 * Define all Sequelize models and return mongoose-compat wrappers + registry.
 */
export function defineAllModels(sequelize) {
  const Organization = sequelize.define(
    'Organization',
    {
      id: ID,
      name: { type: STR, allowNull: false },
      billingEmail: { type: STR, allowNull: false },
      status: { type: STR, defaultValue: 'trial' },
      subscription: { type: STR(36), allowNull: true },
      mobileEnabled: { type: BOOL, defaultValue: true },
      createdBy: { type: STR(36), allowNull: false },
      metadata: { type: JSONF, defaultValue: {} },
    },
    { tableName: 'organizations', underscored: false }
  );

  const User = sequelize.define(
    'User',
    {
      id: ID,
      name: { type: STR(50), allowNull: false },
      email: { type: STR, allowNull: false, unique: true },
      phone: { type: STR, allowNull: false, unique: true },
      password: { type: STR, allowNull: false },
      role: { type: STR, defaultValue: 'admin' },
      organizationId: { type: STR(36), allowNull: true },
      companies: { type: JSONF, defaultValue: [] },
      permissions: { type: JSONF, defaultValue: {} },
      preferences: { type: JSONF, defaultValue: {} },
      twoFactorAuth: { type: JSONF, defaultValue: {} },
      lastLogin: DATE,
      loginAttempts: { type: INT, defaultValue: 0 },
      lockUntil: DATE,
      isActive: { type: BOOL, defaultValue: true },
      isEmailVerified: { type: BOOL, defaultValue: false },
      emailVerificationToken: STR,
      emailVerificationExpire: DATE,
      resetPasswordToken: STR,
      resetPasswordExpire: DATE,
      avatar: { type: STR, defaultValue: '' },
      createdBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'users', defaultScope: {}, scopes: { withPassword: { attributes: { include: ['password'] } } } }
  );

  /**
   * One-time passcodes for email verification and password reset.
   *
   * A separate table rather than columns on `users` for three reasons: a user
   * can legitimately have both an email-verification and a password-reset code
   * live at once; the rate-limit counters do not belong on the user record; and
   * a new table is created by `sequelize.sync()` without needing
   * MYSQL_SYNC_ALTER, so this deploys without touching the users table.
   *
   * Keyed by email, not user id — password reset must behave identically for an
   * address that has no account, or the endpoint leaks who is a customer.
   *
   * `codeHash` is an HMAC, never the code itself. A 6-digit code is only a
   * million possibilities, so a plain hash in a leaked dump would fall in
   * seconds; the HMAC key means an attacker needs the server secret too.
   */
  /**
   * One row per signed-in device.
   *
   * Access tokens carry this row's id as `sid`, and `protect` checks the row on
   * every request. That is what makes "sign out my other device" possible at
   * all: a stateless JWT cannot be withdrawn, so revocation has to live here.
   */
  const Session = sequelize.define(
    'Session',
    {
      id: ID,
      userId: { type: STR, allowNull: false },
      /** Stable per-install identifier chosen by the client. */
      deviceId: { type: STR, allowNull: false },
      /** Shown to the user when they are asked to sign the other device out. */
      deviceName: { type: STR, allowNull: true },
      platform: { type: STR(32), allowNull: true },
      appVersion: { type: STR(32), allowNull: true },
      /**
       * SHA-256 of the current refresh token. Storing the hash means a database
       * leak does not hand over live sessions, and rotation can detect a token
       * being presented twice.
       */
      refreshTokenHash: { type: STR, allowNull: true },
      /**
       * The hash replaced by the most recent rotation. Accepted for a short
       * grace period so a client that raced itself, or restarted before it
       * could persist the new token, is not mistaken for a thief.
       */
      prevRefreshTokenHash: { type: STR, allowNull: true },
      prevRotatedAt: { type: DATE, allowNull: true },
      lastIp: { type: STR(64), allowNull: true },
      lastSeenAt: { type: DATE, allowNull: true },
      revokedAt: { type: DATE, allowNull: true },
      revokeReason: { type: STR(64), allowNull: true },
    },
    {
      tableName: 'sessions',
      indexes: [
        { fields: ['userId'], name: 'sessions_user_idx' },
        { fields: ['userId', 'deviceId'], name: 'sessions_user_device_idx' },
      ],
    }
  );

  const Otp = sequelize.define(
    'Otp',
    {
      id: ID,
      email: { type: STR, allowNull: false },
      purpose: { type: STR(32), allowNull: false },
      codeHash: { type: STR, allowNull: false },
      expiresAt: { type: DATE, allowNull: false },
      /** Wrong guesses against the current code. */
      attempts: { type: INT, defaultValue: 0 },
      /** Set once used, so a correct code cannot be replayed. */
      consumedAt: { type: DATE, allowNull: true },
      /** Drives the resend cooldown. */
      lastSentAt: { type: DATE, allowNull: true },
      /** Sends inside the current rate-limit window. */
      sendCount: { type: INT, defaultValue: 0 },
      windowStartedAt: { type: DATE, allowNull: true },
    },
    {
      tableName: 'otps',
      indexes: [{ fields: ['email', 'purpose'], unique: true, name: 'otps_email_purpose_unique' }],
    }
  );

  const Company = sequelize.define(
    'Company',
    {
      id: ID,
      name: { type: STR, allowNull: false },
      displayName: STR,
      gstin: { type: STR, unique: true, allowNull: true },
      pan: STR,
      address: { type: JSONF, defaultValue: {} },
      contact: { type: JSONF, defaultValue: {} },
      businessType: STR,
      industry: STR,
      financialYear: { type: JSONF, defaultValue: {} },
      currency: { type: JSONF, defaultValue: {} },
      taxation: { type: JSONF, defaultValue: {} },
      banking: { type: JSONF, defaultValue: {} },
      tallyIntegration: { type: JSONF, defaultValue: {} },
      tallyCompanyPath: STR,
      integrations: { type: JSONF, defaultValue: {} },
      settings: { type: JSONF, defaultValue: {} },
      subscription: { type: JSONF, defaultValue: {} },
      organizationId: { type: STR(36), allowNull: true },
      logo: STR,
      isActive: { type: BOOL, defaultValue: true },
      createdBy: { type: STR(36), allowNull: true },
      users: { type: JSONF, defaultValue: [] },
    },
    { tableName: 'companies', indexes: [{ fields: ['tallyCompanyPath'] }] }
  );

  const Subscription = sequelize.define(
    'Subscription',
    {
      id: ID,
      organization: { type: STR(36), allowNull: false, unique: true },
      planId: { type: STR, defaultValue: 'trial' },
      billingCycle: { type: STR, defaultValue: 'trial' },
      status: { type: STR, defaultValue: 'trial' },
      seatLimit: { type: INT, defaultValue: 1 },
      trialEndsAt: DATE,
      currentPeriodStart: DATE,
      currentPeriodEnd: DATE,
      paymentFailedAt: DATE,
      cancelledAt: DATE,
      razorpaySubscriptionId: STR,
      razorpayPlanId: STR,
      razorpayCustomerId: STR,
      pendingSeatLimit: INT,
      notes: TEXT,
    },
    { tableName: 'subscriptions' }
  );

  const DeviceLicense = sequelize.define(
    'DeviceLicense',
    {
      id: ID,
      organization: { type: STR(36), allowNull: false },
      agentId: { type: STR, allowNull: false, unique: true },
      status: { type: STR, defaultValue: 'pending' },
      machineFingerprint: STR,
      hostname: STR,
      os: STR,
      agentVersion: STR,
      linkedCompanies: { type: JSONF, defaultValue: [] },
      activatedBy: { type: STR(36), allowNull: false },
      activatedAt: DATE,
      lastSeenAt: DATE,
      revokedAt: DATE,
      revokedBy: { type: STR(36), allowNull: true },
      revokeReason: STR,
    },
    { tableName: 'devicelicenses' }
  );

  const Party = sequelize.define(
    'Party',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      displayName: STR,
      recordType: { type: STR, defaultValue: 'party' },
      type: STR,
      category: STR,
      gstin: STR,
      gstRegistrationType: STR,
      placeOfSupply: STR,
      tallyParent: STR,
      pan: STR,
      contact: { type: JSONF, defaultValue: {} },
      contactPhone: STR,
      contactEmail: STR,
      addresses: { type: JSONF, defaultValue: [] },
      banking: { type: JSONF, defaultValue: {} },
      creditLimit: { type: JSONF, defaultValue: {} },
      pricing: { type: JSONF, defaultValue: {} },
      preferences: { type: JSONF, defaultValue: {} },
      balances: { type: JSONF, defaultValue: {} },
      tallySync: { type: JSONF, defaultValue: {} },
      tallyId: STR,
      tallyGuid: STR,
      tallySynced: BOOL,
      tags: { type: JSONF, defaultValue: [] },
      notes: TEXT,
      isActive: { type: BOOL, defaultValue: true },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'parties', indexes: [{ fields: ['company', 'name'] }, { fields: ['company', 'tallyId'] }] }
  );

  const Item = sequelize.define(
    'Item',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      displayName: STR,
      code: STR,
      barcode: STR,
      categoryName: STR,
      category: { type: STR(36), allowNull: true },
      type: { type: STR, defaultValue: 'product' },
      description: TEXT,
      specifications: { type: JSONF, defaultValue: {} },
      units: { type: JSONF, defaultValue: {} },
      pricing: { type: JSONF, defaultValue: {} },
      taxation: { type: JSONF, defaultValue: {} },
      hsnCode: STR,
      inventory: { type: JSONF, defaultValue: {} },
      tallyStock: { type: JSONF, defaultValue: {} },
      images: { type: JSONF, defaultValue: [] },
      documents: { type: JSONF, defaultValue: [] },
      suppliers: { type: JSONF, defaultValue: [] },
      tallySync: { type: JSONF, defaultValue: {} },
      tallyId: STR,
      tallySynced: BOOL,
      tags: { type: JSONF, defaultValue: [] },
      notes: TEXT,
      isActive: { type: BOOL, defaultValue: true },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'items', indexes: [{ fields: ['company', 'name'] }, { fields: ['company', 'tallyId'] }] }
  );

  const Voucher = sequelize.define(
    'Voucher',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      voucherType: STR,
      tallyVoucherTypeParent: STR,
      tallyVoucherTypeName: STR,
      salesLedgerName: STR,
      purchaseLedgerName: STR,
      placeOfSupply: STR,
      isOptional: { type: BOOL, defaultValue: false },
      voucherNumber: { type: STR, allowNull: false },
      date: DATE,
      reference: { type: JSONF, defaultValue: {} },
      party: { type: STR(36), allowNull: true },
      partyName: STR,
      narration: TEXT,
      items: { type: JSONF, defaultValue: [] },
      ledgerNames: { type: JSONF, defaultValue: [] },
      hasInventory: BOOL,
      ledgerEntries: { type: JSONF, defaultValue: [] },
      totals: { type: JSONF, defaultValue: {} },
      payment: { type: JSONF, defaultValue: {} },
      shipping: { type: JSONF, defaultValue: {} },
      terms: { type: JSONF, defaultValue: {} },
      status: { type: STR, defaultValue: 'draft' },
      tallyPersistedView: STR,
      tallyEntryMode: STR,
      dueDate: DATE,
      attachments: { type: JSONF, defaultValue: [] },
      tallySync: { type: JSONF, defaultValue: {} },
      tallyId: STR,
      tallyGuid: STR,
      tallySynced: BOOL,
      tallyLastSyncDate: DATE,
      workflow: { type: JSONF, defaultValue: {} },
      recurring: { type: JSONF, defaultValue: {} },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    {
      tableName: 'vouchers',
      indexes: [
        // Unique when tallyId present; MySQL allows multiple NULLs
        { fields: ['company', 'tallyId'], unique: true, name: 'vouchers_company_tallyid_unique' },
        { fields: ['company', 'date'] },
        { fields: ['company', 'party'] },
        { fields: ['company', 'voucherType', 'voucherNumber'] },
      ],
    }
  );

  const VoucherDetail = sequelize.define(
    'VoucherDetail',
    {
      id: ID,
      voucherId: { type: STR(36), allowNull: false, unique: true },
      company: { type: STR(36), allowNull: false },
      items: { type: JSONF, defaultValue: [] },
      ledgerEntries: { type: JSONF, defaultValue: [] },
      taxes: { type: JSONF, defaultValue: [] },
      shipping: { type: JSONF, defaultValue: {} },
      narration: TEXT,
      fullVoucherData: { type: JSONF, defaultValue: {} },
      lastFetchedAt: DATE,
      lastAccessedAt: DATE,
    },
    { tableName: 'voucherdetails' }
  );

  const Godown = sequelize.define(
    'Godown',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      reservedName: STR,
      tallySync: { type: JSONF, defaultValue: {} },
      isActive: { type: BOOL, defaultValue: true },
    },
    { tableName: 'godowns', indexes: [{ unique: true, fields: ['company', 'name'] }] }
  );

  const Unit = sequelize.define(
    'Unit',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      reservedName: STR,
      tallySync: { type: JSONF, defaultValue: {} },
      isActive: { type: BOOL, defaultValue: true },
    },
    { tableName: 'units', indexes: [{ unique: true, fields: ['company', 'name'] }] }
  );

  const VoucherType = sequelize.define(
    'VoucherType',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      parent: STR,
      reservedName: STR,
      tallySync: { type: JSONF, defaultValue: {} },
      isActive: { type: BOOL, defaultValue: true },
    },
    { tableName: 'vouchertypes', indexes: [{ unique: true, fields: ['company', 'name'] }] }
  );

  const TallyAccount = sequelize.define(
    'TallyAccount',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      accountType: { type: STR, allowNull: false },
      parentGroup: STR,
      tallyGuid: STR,
      tallySync: { type: JSONF, defaultValue: {} },
    },
    { tableName: 'tallyaccounts', indexes: [{ unique: true, fields: ['company', 'name', 'accountType'] }] }
  );

  const GstRegistration = sequelize.define(
    'GstRegistration',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      stateName: STR,
      priorStateName: STR,
      gstin: STR,
      eWayApplicableType: STR,
      gstUserName: STR,
      eSignMethod: STR,
      isOtherTerritoryAssessee: BOOL,
      isEwayBillApplicable: BOOL,
      isEwayBillApplicableForIntra: BOOL,
      registrationDetails: { type: JSONF, defaultValue: [] },
      tallySync: { type: JSONF, defaultValue: {} },
      tallyId: STR,
      isActive: { type: BOOL, defaultValue: true },
    },
    { tableName: 'gstregistrations', indexes: [{ unique: true, fields: ['company', 'name'] }] }
  );

  const TallyConnection = sequelize.define(
    'TallyConnection',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      agentId: { type: STR, unique: true },
      agentVersion: STR,
      connectionId: STR,
      status: { type: STR, defaultValue: 'disconnected' },
      tallyInfo: { type: JSONF, defaultValue: {} },
      tallyCompanyGuid: STR,
      systemInfo: { type: JSONF, defaultValue: {} },
      connectionDetails: { type: JSONF, defaultValue: {} },
      capabilities: { type: JSONF, defaultValue: {} },
      syncSettings: { type: JSONF, defaultValue: {} },
      performance: { type: JSONF, defaultValue: {} },
      security: { type: JSONF, defaultValue: {} },
      logs: { type: JSONF, defaultValue: [] },
      lastConnected: DATE,
      lastDisconnected: DATE,
      lastHeartbeat: DATE,
      totalUptime: { type: INT, defaultValue: 0 },
      isActive: { type: BOOL, defaultValue: true },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'tallyconnections' }
  );

  const TallySync = sequelize.define(
    'TallySync',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      entityType: STR,
      entityId: STR,
      tallyId: STR,
      tallyGuid: STR,
      syncDirection: { type: STR, defaultValue: 'from_tally' },
      syncStatus: { type: STR, defaultValue: 'pending' },
      lastSyncDate: DATE,
      lastSyncAttempt: DATE,
      syncAttempts: { type: INT, defaultValue: 0 },
      maxSyncAttempts: { type: INT, defaultValue: 3 },
      syncError: { type: JSONF, defaultValue: {} },
      conflictData: { type: JSONF, defaultValue: {} },
      metadata: { type: JSONF, defaultValue: {} },
      priority: { type: STR, defaultValue: 'normal' },
      isActive: { type: BOOL, defaultValue: true },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'tallysyncs' }
  );

  const ProfitLossReport = sequelize.define(
    'ProfitLossReport',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      reportName: STR,
      periodKey: STR,
      fromDate: DATE,
      toDate: DATE,
      entries: { type: JSONF, defaultValue: [] },
      groupSummaries: { type: JSONF, defaultValue: [] },
      totals: { type: JSONF, defaultValue: {} },
      tallySync: { type: JSONF, defaultValue: {} },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'profitlossreports', indexes: [{ unique: true, fields: ['company', 'reportName', 'periodKey'] }] }
  );

  const BalanceSheetReport = sequelize.define(
    'BalanceSheetReport',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      reportName: STR,
      periodKey: { type: STR, allowNull: false },
      asOfDate: DATE,
      fromDate: DATE,
      toDate: DATE,
      entries: { type: JSONF, defaultValue: [] },
      groupSummaries: { type: JSONF, defaultValue: [] },
      totals: { type: JSONF, defaultValue: {} },
      tallySync: { type: JSONF, defaultValue: {} },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'balancesheetreports', indexes: [{ unique: true, fields: ['company', 'reportName', 'periodKey'] }] }
  );

  const OutstandingReceivable = sequelize.define(
    'OutstandingReceivable',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      reportName: { type: STR, defaultValue: 'Bills Receivable' },
      fromDate: DATE,
      toDate: DATE,
      asOfDate: DATE,
      totalOutstanding: { type: FLOAT, defaultValue: 0 },
      ledgers: { type: JSONF, defaultValue: [] },
      tallySync: { type: JSONF, defaultValue: {} },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'outstandingreceivables', indexes: [{ unique: true, fields: ['company', 'reportName'] }] }
  );

  /**
   * Append-only payment history, derived from successive Bills Receivable /
   * Bills Payable snapshots.
   *
   * `outstandingreceivables` holds exactly one row per (company, reportName) and
   * is overwritten on every sync, so it answers "what is owed right now" but not
   * "does this party usually pay late" — the question every risk and prediction
   * feature is built on. This table keeps a row per bill for its whole life:
   * seen while it is open, marked settled when it stops appearing in snapshots.
   *
   * `settledAt` is the asOfDate of the first snapshot the bill was missing from,
   * so its precision equals the customer's sync frequency — good enough for
   * "usually pays ~3 weeks late", not for exact day counts.
   */
  const BillHistory = sequelize.define(
    'BillHistory',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      // Receivable and payable bills share this table, as they do in outstandingreceivables.
      reportName: { type: STR(64), allowNull: false, defaultValue: 'Bills Receivable' },
      partyName: { type: STR, allowNull: false },
      billRef: { type: STR, allowNull: false },
      // Lowercased, length-capped copies: bill identity is a (party, ref) string
      // pair, and the unique index over them has to fit MySQL's key length limit.
      partyKey: { type: STR(191), allowNull: false },
      billKey: { type: STR(191), allowNull: false },
      billDate: DATE,
      billDue: DATE,
      // Highest balance ever seen — a bill can be partly settled before it closes.
      originalAmount: { type: FLOAT, defaultValue: 0 },
      lastSeenBalance: { type: FLOAT, defaultValue: 0 },
      lastSeenOverdue: { type: INT, allowNull: true },
      vchType: STR,
      vchNumber: STR,
      firstSeenAt: DATE,
      lastSeenAt: DATE,
      settledAt: DATE,
      // settledAt − billDue. Negative means paid early. Null when Tally gave no
      // due date, or while the bill is still open.
      daysLate: { type: INT, allowNull: true },
      // 'open' | 'settled'
      status: { type: STR(16), defaultValue: 'open' },
    },
    {
      tableName: 'billhistory',
      indexes: [
        {
          unique: true,
          fields: ['company', 'reportName', 'partyKey', 'billKey'],
          name: 'billhistory_identity_unique',
        },
        { fields: ['company', 'reportName', 'status'] },
        { fields: ['company', 'partyKey', 'settledAt'] },
      ],
    }
  );

  /**
   * Durable queue for records created in the app that could not be pushed into
   * Tally at the time (agent offline, socket flapping, Tally busy). Without this
   * a create was a one-shot synchronous push: if it missed, the record stayed in
   * the cloud and never reached Tally, with nothing to retry it.
   * Flushed when a desktop agent connects for the company.
   */
  const TallyImportQueue = sequelize.define(
    'TallyImportQueue',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      // 'voucher' | 'ledger' | 'stock-item'
      entityType: { type: STR(32), allowNull: false },
      // Row id in vouchers/parties/items, so we can mark it synced afterwards.
      entityId: { type: STR(36), allowNull: false },
      // Exact payload built at creation time — replayed verbatim.
      payload: { type: JSONF, defaultValue: {} },
      // 'pending' | 'done' | 'failed'
      status: { type: STR(16), defaultValue: 'pending' },
      attempts: { type: INT, defaultValue: 0 },
      lastError: TEXT,
      lastAttemptAt: DATE,
      createdBy: { type: STR(36), allowNull: true },
    },
    {
      tableName: 'tallyimportqueue',
      indexes: [
        { fields: ['company', 'status'] },
        { unique: true, fields: ['entityType', 'entityId'] },
      ],
    }
  );

  const Budget = sequelize.define(
    'Budget',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      name: { type: STR, allowNull: false },
      description: TEXT,
      category: STR,
      amount: { type: FLOAT, defaultValue: 0 },
      actualSpent: { type: FLOAT, defaultValue: 0 },
      remainingAmount: { type: FLOAT, defaultValue: 0 },
      utilizationPercentage: { type: FLOAT, defaultValue: 0 },
      period: STR,
      startDate: DATE,
      endDate: DATE,
      alerts: { type: JSONF, defaultValue: {} },
      status: { type: STR, defaultValue: 'active' },
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'budgets' }
  );

  const GSTReturn = sequelize.define(
    'GSTReturn',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      gstin: STR,
      returnType: STR,
      returnPeriod: { type: JSONF, defaultValue: {} },
      returnPeriodMonth: INT,
      returnPeriodYear: INT,
      filingStatus: { type: STR, defaultValue: 'draft' },
      filedDate: DATE,
      dueDate: DATE,
      gstr1Data: { type: JSONF, defaultValue: {} },
      gstr3bData: { type: JSONF, defaultValue: {} },
      summary: { type: JSONF, defaultValue: {} },
      reconciliation: { type: JSONF, defaultValue: {} },
      attachments: { type: JSONF, defaultValue: [] },
      notes: TEXT,
      createdBy: { type: STR(36), allowNull: true },
      updatedBy: { type: STR(36), allowNull: true },
    },
    { tableName: 'gstreturns' }
  );

  const Notification = sequelize.define(
    'Notification',
    {
      id: ID,
      company: { type: STR(36), allowNull: false },
      user: { type: STR(36), allowNull: false },
      type: STR,
      title: STR,
      message: TEXT,
      priority: { type: STR, defaultValue: 'medium' },
      status: { type: STR, defaultValue: 'unread' },
      readAt: DATE,
      expiresAt: DATE,
      relatedEntity: { type: JSONF, defaultValue: {} },
      actions: { type: JSONF, defaultValue: [] },
      channels: { type: JSONF, defaultValue: {} },
      deliveryStatus: { type: JSONF, defaultValue: {} },
      metadata: { type: JSONF, defaultValue: {} },
    },
    { tableName: 'notifications' }
  );

  const TallySerialRegistration = sequelize.define(
    'TallySerialRegistration',
    {
      id: ID,
      serialNumber: { type: STR, allowNull: false, unique: true },
      user: { type: STR(36), allowNull: false },
      organization: { type: STR(36), allowNull: false },
      registeredEmail: STR,
      licenseDetails: { type: JSONF, defaultValue: {} },
      lastSeenAt: DATE,
    },
    { tableName: 'tallyserialregistrations' }
  );

  // --- Compat wrappers ---
  const registry = {};

  const UserCompat = createCompatModel('User', User, {
    registry,
    refs: {
      companies: { model: 'Company', array: true },
      organizationId: { model: 'Organization', array: false },
      createdBy: { model: 'User', array: false },
    },
    instanceMethods: {
      async matchPassword(entered) {
        return bcrypt.compare(entered, this.password);
      },
      getSignedJwtToken() {
        return jwt.sign({ id: this.id }, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_EXPIRE || '30d',
        });
      },
      getRefreshToken() {
        return jwt.sign({ id: this.id }, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_REFRESH_EXPIRE || '90d',
        });
      },
      getResetPasswordToken() {
        const resetToken = crypto.randomBytes(20).toString('hex');
        this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
        return resetToken;
      },
      getEmailVerificationToken() {
        const token = crypto.randomBytes(20).toString('hex');
        this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
        this.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
        return token;
      },
      async incLoginAttempts() {
        this.loginAttempts = (this.loginAttempts || 0) + 1;
        if (this.loginAttempts >= 5) {
          this.lockUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
        }
        await this.save();
      },
      async resetLoginAttempts() {
        this.loginAttempts = 0;
        this.lockUntil = null;
        await this.save();
      },
    },
  });

  // Password hashing on create/save via hooks
  User.addHook('beforeCreate', async (user) => {
    if (user.password && !user.password.startsWith('$2')) {
      const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
      user.password = await bcrypt.hash(user.password, rounds);
    }
  });
  User.addHook('beforeUpdate', async (user) => {
    if (user.changed('password') && user.password && !user.password.startsWith('$2')) {
      const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
      user.password = await bcrypt.hash(user.password, rounds);
    }
  });

  // Override findById/findOne to support select('+password') / default exclude password
  const wrapPasswordSelect = (q) => {
    const origSelect = q.select.bind(q);
    q._select = q._select || '-password';
    q.select = (fields) => {
      if (
        fields === '+password' ||
        (typeof fields === 'string' && fields.includes('+password')) ||
        (typeof fields === 'string' && fields.includes('password') && !fields.includes('-password'))
      ) {
        q._select = null; // include all fields including password
        return q;
      }
      return origSelect(fields);
    };
    return q;
  };

  const origFindById = UserCompat.findById.bind(UserCompat);
  UserCompat.findById = (id) => wrapPasswordSelect(origFindById(id));

  const origFindOne = UserCompat.findOne.bind(UserCompat);
  UserCompat.findOne = (filter) => wrapPasswordSelect(origFindOne(filter));

  const CompanyCompat = createCompatModel('Company', Company, {
    registry,
    refs: {
      organizationId: { model: 'Organization', array: false },
      createdBy: { model: 'User', array: false },
    },
    instanceMethods: {
      hasUserAccess(userId) {
        const users = this.users || [];
        return users.some((u) => String(u.user) === String(userId) || String(u.user?._id) === String(userId));
      },
      getUserRole(userId) {
        const users = this.users || [];
        const entry = users.find((u) => String(u.user) === String(userId) || String(u.user?._id) === String(userId));
        return entry?.role || null;
      },
      async addUser(userId, role = 'viewer', permissions = {}) {
        const users = [...(this.users || [])];
        if (!users.some((u) => String(u.user) === String(userId))) {
          users.push({ user: userId, role, permissions, addedAt: new Date() });
          this.users = users;
          await this.save();
        }
        return this;
      },
      async removeUser(userId) {
        this.users = (this.users || []).filter((u) => String(u.user) !== String(userId));
        await this.save();
        return this;
      },
    },
  });

  const PartyCompat = createCompatModel('Party', Party, {
    registry,
    refs: { company: { model: 'Company', array: false }, createdBy: { model: 'User', array: false } },
    staticMethods: {
      async findWithOutstanding(companyId) {
        return this.find({ company: companyId, isActive: true }).lean();
      },
    },
  });

  const ItemCompat = createCompatModel('Item', Item, {
    registry,
    refs: { company: { model: 'Company', array: false } },
    staticMethods: {
      async findLowStockItems(companyId) {
        const items = await this.find({ company: companyId, isActive: true }).lean();
        return items.filter((item) => {
          const levels = item.inventory?.stockLevels;
          const current = item.inventory?.currentStock || [];
          const total = current.reduce((s, c) => s + (c.available || c.qty || 0), 0);
          const reorder = levels?.reorderLevel ?? levels?.minimum ?? 0;
          return total <= reorder;
        });
      },
    },
    instanceMethods: {
      async updateStock() {
        await this.save();
        return this;
      },
    },
  });

  const VoucherCompat = createCompatModel('Voucher', Voucher, {
    registry,
    refs: {
      company: { model: 'Company', array: false },
      party: { model: 'Party', array: false },
      createdBy: { model: 'User', array: false },
      updatedBy: { model: 'User', array: false },
    },
  });

  const VoucherDetailCompat = createCompatModel('VoucherDetail', VoucherDetail, {
    registry,
    refs: { voucherId: { model: 'Voucher', array: false }, company: { model: 'Company', array: false } },
    staticMethods: {
      async cleanupStale(days = 30) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return this.deleteMany({ lastAccessedAt: { $lt: cutoff } });
      },
    },
  });

  const NotificationCompat = createCompatModel('Notification', Notification, {
    registry,
    staticMethods: {
      async getUnreadCount(userId) {
        return this.countDocuments({ user: userId, status: 'unread' });
      },
      async getRecent(userId, limit = 20) {
        return this.find({ user: userId }).sort({ createdAt: -1 }).limit(limit);
      },
      async markAllAsRead(userId) {
        return this.updateMany(
          { user: userId, status: 'unread' },
          { $set: { status: 'read', readAt: new Date() } }
        );
      },
    },
    instanceMethods: {
      async markAsRead() {
        this.status = 'read';
        this.readAt = new Date();
        await this.save();
        return this;
      },
      async archive() {
        this.status = 'archived';
        await this.save();
        return this;
      },
    },
  });

  const TallyConnectionCompat = createCompatModel('TallyConnection', TallyConnection, {
    registry,
    refs: { company: { model: 'Company', array: false } },
    staticMethods: {
      async findActiveConnections(companyId) {
        return this.find({ company: companyId, status: 'connected', isActive: true });
      },
      async cleanupStaleConnections(minutes = 10) {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        return this.updateMany(
          { status: 'connected', 'connectionDetails.lastHeartbeat': { $lt: cutoff } },
          { $set: { status: 'disconnected' } }
        );
      },
    },
    instanceMethods: {
      async updateHeartbeat() {
        this.connectionDetails = {
          ...(this.connectionDetails || {}),
          lastHeartbeat: new Date(),
        };
        await this.save();
        return this;
      },
      async connect() {
        this.status = 'connected';
        this.lastConnected = new Date();
        await this.save();
        return this;
      },
      async disconnect() {
        this.status = 'disconnected';
        this.lastDisconnected = new Date();
        await this.save();
        return this;
      },
      addLog(level, message, details) {
        const logs = [...(this.logs || [])];
        logs.push({ timestamp: new Date(), level, message, details });
        this.logs = logs.slice(-100);
      },
    },
  });

  const TallySyncCompat = createCompatModel('TallySync', TallySync, {
    registry,
    staticMethods: {
      async getPendingSyncs(companyId) {
        return this.find({ company: companyId, syncStatus: 'pending', isActive: true });
      },
      async getSyncStats(companyId) {
        return this.aggregate([
          { $match: { company: companyId } },
          { $group: { _id: '$syncStatus', count: { $sum: 1 } } },
        ]);
      },
    },
    instanceMethods: {
      async markAsFailed(error) {
        this.syncStatus = 'failed';
        this.syncError = { message: error?.message || String(error), timestamp: new Date() };
        this.syncAttempts = (this.syncAttempts || 0) + 1;
        await this.save();
        return this;
      },
      async markAsCompleted() {
        this.syncStatus = 'completed';
        this.lastSyncDate = new Date();
        await this.save();
        return this;
      },
    },
  });

  const BudgetCompat = createCompatModel('Budget', Budget, {
    registry,
    staticMethods: {
      async getActiveBudgets(companyId) {
        return this.find({ company: companyId, status: 'active' });
      },
    },
    instanceMethods: {
      async addSpending(amount) {
        this.actualSpent = (this.actualSpent || 0) + Number(amount);
        this.remainingAmount = (this.amount || 0) - this.actualSpent;
        this.utilizationPercentage = this.amount ? (this.actualSpent / this.amount) * 100 : 0;
        await this.save();
        return this;
      },
    },
  });

  const GSTReturnCompat = createCompatModel('GSTReturn', GSTReturn, {
    registry,
    staticMethods: {
      async getPendingReturns(companyId) {
        return this.find({ company: companyId, filingStatus: { $in: ['draft', 'pending', 'not_filed'] } });
      },
      async getOverdueReturns(companyId) {
        return this.find({
          company: companyId,
          filingStatus: { $in: ['draft', 'pending', 'not_filed'] },
          dueDate: { $lt: new Date() },
        });
      },
    },
  });

  const models = {
    User: UserCompat,
    Organization: createCompatModel('Organization', Organization, { registry }),
    Company: CompanyCompat,
    Subscription: createCompatModel('Subscription', Subscription, { registry }),
    DeviceLicense: createCompatModel('DeviceLicense', DeviceLicense, { registry }),
    Party: PartyCompat,
    Item: ItemCompat,
    Voucher: VoucherCompat,
    VoucherDetail: VoucherDetailCompat,
    Godown: createCompatModel('Godown', Godown, { registry }),
    Unit: createCompatModel('Unit', Unit, { registry }),
    VoucherType: createCompatModel('VoucherType', VoucherType, { registry }),
    TallyAccount: createCompatModel('TallyAccount', TallyAccount, { registry }),
    GstRegistration: createCompatModel('GstRegistration', GstRegistration, { registry }),
    TallyConnection: TallyConnectionCompat,
    TallySync: TallySyncCompat,
    ProfitLossReport: createCompatModel('ProfitLossReport', ProfitLossReport, { registry }),
    BalanceSheetReport: createCompatModel('BalanceSheetReport', BalanceSheetReport, { registry }),
    OutstandingReceivable: createCompatModel('OutstandingReceivable', OutstandingReceivable, { registry }),
    BillHistory: createCompatModel('BillHistory', BillHistory, { registry }),
    Budget: BudgetCompat,
    GSTReturn: GSTReturnCompat,
    Notification: NotificationCompat,
    TallySerialRegistration: createCompatModel('TallySerialRegistration', TallySerialRegistration, { registry }),
    TallyImportQueue: createCompatModel('TallyImportQueue', TallyImportQueue, { registry }),
    Otp: createCompatModel('Otp', Otp, { registry }),
    Session: createCompatModel('Session', Session, { registry }),
  };

  Object.assign(registry, models);
  // Also map plural collection-ish names for aggregate $lookup
  registry.parties = models.Party;
  registry.items = models.Item;
  registry.vouchers = models.Voucher;
  registry.companies = models.Company;
  registry.users = models.User;

  for (const m of Object.values(models)) {
    m._registry = registry;
  }

  return { models, sequelizeModels: {
    Organization, User, Company, Subscription, DeviceLicense, Party, Item, Voucher,
    VoucherDetail, Godown, Unit, VoucherType, TallyAccount, GstRegistration,
    TallyConnection, TallySync, ProfitLossReport, BalanceSheetReport,
    OutstandingReceivable, BillHistory, Budget, GSTReturn, Notification, TallySerialRegistration,
    TallyImportQueue,
  }};
}

export { DataTypes, Sequelize };
