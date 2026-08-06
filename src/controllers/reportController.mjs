import { isValidId } from '../db/queryUtils.js';
import Voucher from '../models/Voucher.js';
import VoucherDetail from '../models/VoucherDetail.js';
import Party from '../models/Party.js';
import Item from '../models/Item.js';
import Budget from '../models/Budget.mjs';
import Company from '../models/Company.js';
import ProfitLossReport from '../models/ProfitLossReport.js';
import TallyAccount from '../models/TallyAccount.js';
import BalanceSheetReport from '../models/BalanceSheetReport.js';
import OutstandingReceivable from '../models/OutstandingReceivable.js';
import { normalizeVoucherTypeSlug } from '../utils/tallyVoucherType.js';
import {
  normalizePeriodKey,
  resolveReportPeriod,
  resolveBalanceSheetVoucherRange,
  todayInReportTz,
  endOfDay as endOfReportDay,
  PERIOD_LABELS
} from '../utils/reportPeriods.js';
import {
  matchesAccountLedgerParent,
  normalizeTallyParentName
} from '../utils/tallyLedgerFilter.js';
import { syncStateClause } from '../utils/syncStateFilter.js';
import logger from '../utils/logger.js';
import moment from 'moment';

const TOP_LIMIT = 10;
const FAST_MOVING_DEFAULT_LIMIT = 200;
const FAST_MOVING_MAX_LIMIT = 500;

/** Orders do not post to P&L / Balance Sheet — exclude from report voucher drill-down. */
const REPORT_DRILLDOWN_EXCLUDED_VOUCHER_TYPES = ['sales_order', 'purchase_order'];

/** Cash/Bank Book parent groups (Tally chart of accounts). */
const CASH_BANK_PARENT_GROUPS = ['Cash-in-hand', 'Bank Accounts', 'Bank OD A/c'];

/** Voucher types shown in Cash/Bank Book ledger drill-down. */
const CASH_BANK_VOUCHER_TYPES = ['receipt', 'payment', 'contra'];

/**
 * Group Summary display amount: credit − debit (matches Tally Group Summary).
 */
const computeGroupSummaryNetAmount = (debit, credit) => {
  const debitAbs = Math.abs(Number(debit || 0));
  const creditAbs = Math.abs(Number(credit || 0));
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
};

const mapGroupSummaryLedgerRow = (l, groupNameSet) => {
  const name = String(l.displayName || l.name || '').trim();
  const debit = Math.abs(Number(l.debit || 0));
  const credit = Math.abs(Number(l.credit || 0));
  const amount = computeGroupSummaryNetAmount(l.debit, l.credit);
  const isGroup =
    l.isGroup === true || (name && groupNameSet.has(name.toLowerCase()));
  return {
    name: l.name || name,
    displayName: l.displayName || name,
    debit,
    credit,
    amount,
    isGroup
  };
};

const toObjectId = (id) => {
  try {
    if (id == null) return null;
    const s = String(id);
    if (!isValidId(s) && s.length < 8) return null;
    return s;
  } catch {
    return null;
  }
};

/**
 * Tally-synced vouchers often carry custom voucher type names; the reliable signal is
 * the Tally parent type (tallyVoucherTypeParent). Match both, like the inactive reports.
 */
/**
 * Vouchers that record a commitment or a stock movement, not money changing
 * hands. They have no debit/credit side, so the Day Book must not sign them —
 * a Sales Order is not money going out.
 */
const NON_ACCOUNTING_VOUCHER_TYPES = new Set([
  'sales_order',
  'purchase_order',
  'quotation',
  'delivery_note',
  'receipt_note',
  'rejection_in',
  'rejection_out',
  'material_in',
  'material_out',
  'physical_stock',
  'stock_journal'
]);

const normalizeVoucherTypeKey = (value) =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const isNonAccountingVoucher = (voucher) =>
  NON_ACCOUNTING_VOUCHER_TYPES.has(normalizeVoucherTypeKey(voucher?.voucherType)) ||
  NON_ACCOUNTING_VOUCHER_TYPES.has(normalizeVoucherTypeKey(voucher?.tallyVoucherTypeParent));

/**
 * Restricts a voucher query to what Tally itself would report.
 *
 * Two things were being counted that Tally does not have:
 *
 *  - Records created in the app that never reached Tally. The vouchers register
 *    already hides these (see utils/syncStateFilter.js) but no report did, so a
 *    KPI could total more than the list you reach by tapping it.
 *  - Optional vouchers. Tally keeps them out of its own books until they are
 *    marked regular, so counting them inflates figures by an amount Tally will
 *    never show.
 *
 * Compose through `$and`: `voucherKindMatch` and the sync clause both use
 * `$or`, and merging them as plain keys would silently drop one.
 */
const booksMatch = (match = {}) => {
  const { $and: existing = [], ...rest } = match;
  return {
    ...rest,
    $and: [...existing, syncStateClause('synced'), { isOptional: { $ne: true } }]
  };
};

const voucherKindMatch = (kind) => {
  const parentRegexByKind = {
    sales: /^sales$/i,
    purchase: /^purchase$/i,
    receipt: /^receipt$/i,
    payment: /^payment$/i,
    credit_note: /^credit\s*note$/i,
    debit_note: /^debit\s*note$/i
  };
  const regex = parentRegexByKind[kind];
  if (!regex) return { voucherType: kind };
  return {
    $or: [{ voucherType: kind }, { tallyVoucherTypeParent: { $regex: regex } }]
  };
};

const withRankAndShare = (rows, total, valueKey = 'totalAmount') =>
  rows.map((row, index) => ({
    rank: index + 1,
    ...row,
    sharePercent:
      total > 0
        ? Number(((row[valueKey] / total) * 100).toFixed(2))
        : 0
  }));

/** Top parties (customers or suppliers) by voucher value in period */
const aggregateTopParties = async (companyOid, voucherType, start, end) => {
  const rows = await Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...voucherKindMatch(voucherType),
        date: { $gte: start, $lte: end }
      })
    },
    {
      $lookup: {
        from: 'parties',
        localField: 'party',
        foreignField: '_id',
        as: 'partyDoc'
      }
    },
    {
      $addFields: {
        displayName: {
          $trim: {
            input: {
              $cond: [
                { $gt: [{ $size: '$partyDoc' }, 0] },
                { $arrayElemAt: ['$partyDoc.name', 0] },
                { $ifNull: ['$partyName', ''] }
              ]
            }
          }
        },
        lineAmount: {
          $abs: {
            $ifNull: ['$totals.grandTotal', '$amount', 0]
          }
        }
      }
    },
    {
      $match: {
        displayName: { $nin: ['', null] },
        lineAmount: { $gt: 0 }
      }
    },
    {
      $group: {
        _id: {
          partyKey: { $ifNull: ['$party', '$partyName'] },
          name: '$displayName'
        },
        name: { $first: '$displayName' },
        totalAmount: { $sum: '$lineAmount' },
        transactionCount: { $sum: 1 }
      }
    },
    { $sort: { totalAmount: -1 } },
    { $limit: TOP_LIMIT }
  ]);

  const [periodAgg] = await Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...voucherKindMatch(voucherType),
        date: { $gte: start, $lte: end }
      })
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $abs: { $ifNull: ['$totals.grandTotal', '$amount', 0] }
          }
        }
      }
    }
  ]);
  const periodTotal = periodAgg?.total || 0;

  return {
    rows: withRankAndShare(
      rows.map((r) => ({
        partyId: r._id?.toString?.() || String(r._id),
        name: r.name,
        totalAmount: r.totalAmount,
        transactionCount: r.transactionCount
      })),
      periodTotal
    ),
    total: periodTotal
  };
};

/** Top line items from sales or purchase vouchers */
const aggregateTopItems = async (companyOid, voucherType, start, end, sortBy) => {
  const sortField = sortBy === 'quantity' ? 'quantity' : 'totalAmount';

  const rows = await Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...voucherKindMatch(voucherType),
        date: { $gte: start, $lte: end },
        'items.0': { $exists: true }
      })
    },
    { $unwind: '$items' },
    {
      $addFields: {
        itemAmount: {
          $ifNull: [
            '$items.amount',
            {
              $multiply: [
                { $ifNull: ['$items.quantity', 0] },
                { $ifNull: ['$items.rate', 0] }
              ]
            }
          ]
        },
        itemQty: { $ifNull: ['$items.quantity', 0] },
        itemLabel: { $ifNull: ['$items.itemName', 'Unknown'] }
      }
    },
    {
      $group: {
        _id: { $ifNull: ['$items.item', '$items.itemName'] },
        name: { $first: '$itemLabel' },
        totalAmount: { $sum: '$itemAmount' },
        quantity: { $sum: '$itemQty' }
      }
    },
    { $sort: { [sortField]: -1 } },
    { $limit: TOP_LIMIT }
  ]);

  const [periodAgg] = await Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...voucherKindMatch(voucherType),
        date: { $gte: start, $lte: end },
        'items.0': { $exists: true }
      })
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: null,
        totalValue: {
          $sum: {
            $ifNull: [
              '$items.amount',
              {
                $multiply: [
                  { $ifNull: ['$items.quantity', 0] },
                  { $ifNull: ['$items.rate', 0] }
                ]
              }
            ]
          }
        },
        totalQty: { $sum: { $ifNull: ['$items.quantity', 0] } }
      }
    }
  ]);

  const periodTotalValue = periodAgg?.totalValue || 0;
  const periodTotalQty = periodAgg?.totalQty || 0;
  const shareTotal = sortBy === 'quantity' ? periodTotalQty : periodTotalValue;

  return {
    rows: withRankAndShare(
      rows.map((r) => ({
        itemId: r._id?.toString?.() || String(r._id),
        name: r.name,
        totalAmount: r.totalAmount,
        quantity: r.quantity
      })),
      shareTotal,
      sortField
    ),
    totalValue: periodTotalValue,
    totalQty: periodTotalQty
  };
};

/**
 * Fast moving items = highest qty sold (sales vouchers), sorted desc.
 * Uses the same voucher.items payload shape produced by tally sync:
 * { itemName, quantity, unit, rate, amount, ... }.
 */
const aggregateFastMovingItems = async (companyOid, start, end, limit) => {
  const baseMatch = booksMatch({
    company: companyOid,
    ...voucherKindMatch('sales'),
    date: { $gte: start, $lte: end }
  });

  const rows = await Voucher.aggregate([
    { $match: { ...baseMatch, 'items.0': { $exists: true } } },
    { $unwind: '$items' },
    // Only count positive quantities as "sold"
    { $match: { 'items.quantity': { $gt: 0 } } },
    {
      $addFields: {
        itemQty: { $ifNull: ['$items.quantity', 0] },
        itemLabel: { $ifNull: ['$items.itemName', 'Unknown'] },
        itemUnit: { $ifNull: ['$items.unit', 'Nos'] },
        // Group on the normalized name, not items.item: sync leaves itemId unset on
        // lines it can't map, which would otherwise split one stock item into two rows.
        itemKey: {
          $toLower: { $trim: { input: { $ifNull: ['$items.itemName', 'Unknown'] } } }
        },
        itemAmount: {
          $ifNull: [
            '$items.amount',
            { $multiply: [{ $ifNull: ['$items.quantity', 0] }, { $ifNull: ['$items.rate', 0] }] }
          ]
        }
      }
    },
    {
      $group: {
        _id: '$itemKey',
        itemId: { $first: '$items.item' },
        name: { $first: '$itemLabel' },
        unit: { $first: '$itemUnit' },
        qtySold: { $sum: '$itemQty' },
        totalAmount: { $sum: '$itemAmount' }
      }
    },
    { $sort: { qtySold: -1 } },
    { $limit: limit }
  ]);

  // Total qty sold across the full period (not just limited rows)
  const [periodAgg] = await Voucher.aggregate([
    { $match: { ...baseMatch, 'items.0': { $exists: true } } },
    { $unwind: '$items' },
    { $match: { 'items.quantity': { $gt: 0 } } },
    { $addFields: { itemQty: { $ifNull: ['$items.quantity', 0] } } },
    { $group: { _id: null, totalQtySold: { $sum: '$itemQty' } } }
  ]);

  return {
    rows: Array.isArray(rows) ? rows : [],
    totalQtySold: Number(periodAgg?.totalQtySold || 0)
  };
};

const formatTallyDisplayDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    .replace(/ /g, ' ');
};

const buildProfitLossResponse = (report, startDate, endDate) => {
  const entries = Array.isArray(report.entries) ? report.entries : [];
  const groupSummaries = Array.isArray(report.groupSummaries) ? report.groupSummaries : [];
  const revenueByCategory = {};
  const expensesByCategory = {};
  const groups = [];

  let totalRevenue = 0;
  let totalExpenses = 0;

  entries.forEach((entry) => {
    const mainAmount = Number(entry.mainAmount || 0);
    const subAmount = Number(entry.subAmount || 0);
    const displayAmount = mainAmount !== 0 ? mainAmount : subAmount;
    const label = entry.displayName || entry.name || 'Unknown';
    const isGroup = Boolean(entry.isGroup) && Math.abs(mainAmount) > 0;

    if (mainAmount >= 0) {
      totalRevenue += mainAmount;
    } else {
      totalExpenses += Math.abs(mainAmount);
    }

    if (displayAmount === 0) {
      return;
    }

    if (displayAmount >= 0) {
      revenueByCategory[label] = (revenueByCategory[label] || 0) + displayAmount;
    } else {
      expensesByCategory[label] = (expensesByCategory[label] || 0) + Math.abs(displayAmount);
    }

    if (isGroup) {
      const synced = groupSummaries.find(
        (g) => String(g.groupName).trim().toLowerCase() === label.trim().toLowerCase()
      );
      groups.push({
        name: label,
        amount: Math.abs(mainAmount),
        side: mainAmount >= 0 ? 'revenue' : 'expense',
        drillable: true,
        ledgerCount: synced?.ledgers?.length || 0
      });
    }
  });

  const netProfit = Number(report.totals?.grandTotal ?? (totalRevenue - totalExpenses));
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : 0;

  return {
    period: {
      startDate: report.fromDate ? report.fromDate.toISOString() : startDate.toISOString(),
      endDate: report.toDate ? report.toDate.toISOString() : endDate.toISOString(),
      periodKey: report.periodKey,
      label: report.periodKey ? PERIOD_LABELS[report.periodKey] : undefined
    },
    lastSyncDate: report.tallySync?.lastSyncDate?.toISOString?.() || null,
    summary: {
      totalRevenue,
      totalExpenses,
      netProfit,
      profitMargin
    },
    groups,
    groupSummaries,
    revenue: {
      total: totalRevenue,
      byCategory: revenueByCategory,
      transactions: entries.length
    },
    expenses: {
      total: totalExpenses,
      byCategory: expensesByCategory,
      transactions: entries.length
    }
  };
};

const classifyBalanceSheetGroup = (label = '') => {
  const lower = String(label).toLowerCase();

  if (
    lower.includes('capital') ||
    lower.includes('reserve') ||
    lower.includes('equity') ||
    (lower.includes('profit') && lower.includes('loss')) ||
    lower.includes('forex gain') ||
    lower.includes('forex loss')
  ) {
    return 'equity';
  }

  if (
    lower.includes('liabilit') ||
    lower.includes('loan') ||
    lower.includes('payable') ||
    lower.includes('creditor') ||
    lower.includes('duties') ||
    lower.includes('provisions') ||
    lower.includes('suspense')
  ) {
    return 'liabilities';
  }

  if (
    lower.includes('asset') ||
    lower.includes('fixed asset') ||
    lower.includes('current asset') ||
    lower.includes('investment') ||
    lower.includes('stock') ||
    lower.includes('bank') ||
    lower.includes('cash') ||
    lower.includes('deposit') ||
    lower.includes('misc. expenses')
  ) {
    return 'assets';
  }

  return 'liabilities';
};

const buildBalanceSheetResponse = (report, periodMeta) => {
  const entries = Array.isArray(report.entries) ? report.entries : [];
  const groupSummaries = Array.isArray(report.groupSummaries) ? report.groupSummaries : [];
  const assets = [];
  const liabilities = [];
  const equity = [];
  const groups = [];

  entries.forEach((entry) => {
    const mainAmount = Number(entry.mainAmount || 0);
    const subAmount = Number(entry.subAmount || 0);
    const amount = Number(mainAmount !== 0 ? mainAmount : subAmount || 0);
    const label = (entry.displayName || entry.name || '').trim();
    if (!label || amount === 0) return;

    const section = classifyBalanceSheetGroup(label);

    // Tally signs these: negative is a debit, positive a credit. Taking the
    // absolute value made a debit balance indistinguishable from a credit one,
    // so a Capital Account carrying a debit balance was added to equity as a
    // positive instead of subtracted — overstating equity by twice its value
    // and leaving assets short of liabilities + equity.
    //
    // Assets are debits, so flip them to read positive the way a balance sheet
    // presents them. Liabilities and equity are credits and already read
    // positive; a debit balance among them stays negative, which is exactly
    // what negative equity means.
    const signedAmount = section === 'assets' ? -amount : amount;
    const row = { account: label, amount: signedAmount };

    if (entry.isGroup && mainAmount !== 0) {
      const synced = groupSummaries.find(
        (g) => String(g.groupName).trim().toLowerCase() === label.trim().toLowerCase()
      );
      groups.push({
        name: label,
        amount: section === 'assets' ? -mainAmount : mainAmount,
        section,
        drillable: true,
        ledgerCount: synced?.ledgers?.length || 0
      });
    }

    if (section === 'equity') {
      equity.push(row);
    } else if (section === 'assets') {
      assets.push(row);
    } else {
      liabilities.push(row);
    }
  });

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equity.reduce((s, r) => s + r.amount, 0);

  return {
    period: {
      periodKey: report.periodKey,
      label: periodMeta.label,
      asOfDate: report.asOfDate
        ? report.asOfDate.toISOString()
        : periodMeta.asOfDate.toISOString()
    },
    lastSyncDate: report.tallySync?.lastSyncDate?.toISOString?.() || null,
    entries,
    groups,
    groupSummaries,
    assets: {
      current: assets,
      fixed: [],
      total: totalAssets
    },
    liabilities: {
      current: liabilities,
      longTerm: [],
      total: totalLiabilities
    },
    equity: {
      current: equity,
      capital: totalEquity,
      retainedEarnings: totalEquity,
      total: totalEquity
    },
    balanceCheck: {
      assetsTotal: totalAssets,
      liabilitiesAndEquityTotal: totalLiabilities + totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
    }
  };
};

// @desc    Get Profit & Loss Report
// @route   GET /api/reports/profit-loss
// @access  Private
export const getProfitLossReport = async (req, res) => {
  try {
    const companyId = req.query?.companyId || req.body?.companyId;
    const periodKey = normalizePeriodKey(
      req.query?.periodKey || req.body?.periodKey || 'this_month'
    );

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const period = resolveReportPeriod(periodKey, company);

    const storedReport = await ProfitLossReport.findOne({
      company: companyId,
      reportName: 'Profit and Loss',
      periodKey: period.periodKey
    });

    if (storedReport) {
      const data = buildProfitLossResponse(storedReport, period.fromDate, period.toDate);
      data.period.label = period.label;
      data.period.periodKey = period.periodKey;
      return res.status(200).json({ success: true, data });
    }

    return res.status(404).json({
      success: false,
      code: 'REPORT_NOT_SYNCED',
      message: 'Profit & Loss for this period is not synced yet. Run sync on the Tally PC with desktop-agent.',
      periodKey: period.periodKey
    });
  } catch (error) {
    logger.error('Profit & Loss report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating Profit & Loss report'
    });
  }
};

// @desc    Ledgers under a P&L group (from synced Group Summary)
// @route   GET /api/reports/profit-loss/group-ledgers
export const getProfitLossGroupLedgers = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_month');
    const groupName = String(req.query?.groupName || '').trim();

    if (!companyId || !groupName) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and groupName are required'
      });
    }

    const storedReport = await ProfitLossReport.findOne({
      company: companyId,
      reportName: 'Profit and Loss',
      periodKey
    }).lean();

    if (!storedReport) {
      return res.status(404).json({
        success: false,
        code: 'REPORT_NOT_SYNCED',
        message: 'Profit & Loss for this period is not synced yet.'
      });
    }

    const group = (storedReport.groupSummaries || []).find(
      (g) => String(g.groupName).trim().toLowerCase() === groupName.toLowerCase()
    );

    if (!group) {
      return res.status(404).json({
        success: false,
        message: `Group "${groupName}" summary not synced. Run desktop-agent sync again.`
      });
    }

    const tallyGroups = await TallyAccount.find({
      company: companyId,
      accountType: 'group'
    })
      .select('name')
      .lean();
    const groupNameSet = new Set(
      tallyGroups.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean)
    );

    const ledgers = (group.ledgers || []).map((l) => mapGroupSummaryLedgerRow(l, groupNameSet));

    return res.status(200).json({
      success: true,
      data: {
        groupName: group.groupName,
        parentGroup: group.parentGroup || '',
        groupAmount: group.groupAmount,
        ledgers
      }
    });
  } catch (error) {
    logger.error('P&L group ledgers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading group ledgers'
    });
  }
};

/**
 * Vouchers that actually post to a ledger (not every name in ledgerNames index).
 */
const queryVouchersForLedger = async (
  companyOid,
  ledgerName,
  fromDate,
  toDate,
  voucherTypes = null
) => {
  const ledgerRegex = new RegExp(`^${ledgerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const dateFilter = {
    company: companyOid,
    date: { $gte: fromDate, $lte: toDate }
  };

  const voucherTypeFilter =
    Array.isArray(voucherTypes) && voucherTypes.length > 0
      ? { voucherType: { $in: voucherTypes } }
      : { voucherType: { $nin: REPORT_DRILLDOWN_EXCLUDED_VOUCHER_TYPES } };

  // MySQL compat layer does not support Mongo `$elemMatch` on JSON arrays.
  // So we fetch candidate vouchers by date/type and filter by ledger in JS.
  const candidates = await Voucher.find(
    booksMatch({
      ...dateFilter,
      ...voucherTypeFilter
    })
  )
    .select('_id voucherNumber voucherType date partyName totals.grandTotal narration ledgerEntries ledgerNames')
    .sort({ date: -1 })
    .limit(5000)
    .lean();

  const matchesLedger = (v) => {
    const entries = Array.isArray(v.ledgerEntries) ? v.ledgerEntries : [];
    const inEntries = entries.some((e) => typeof e?.ledger === 'string' && ledgerRegex.test(e.ledger));

    const names = Array.isArray(v.ledgerNames) ? v.ledgerNames : [];
    const inNames = names.some((n) => typeof n === 'string' && ledgerRegex.test(n));

    return inEntries || inNames;
  };

  const vouchers = candidates.filter(matchesLedger);
  vouchers.sort((a, b) => new Date(b.date) - new Date(a.date));
  return vouchers.slice(0, 500);
};

const mapVoucherRowsForApi = (vouchers) =>
  vouchers.map((v) => ({
    id: v._id.toString(),
    voucherNumber: v.voucherNumber,
    voucherType: v.voucherType,
    date: v.date,
    dateDisplay: formatTallyDisplayDate(v.date),
    partyName: v.partyName || '',
    amount: Math.abs(Number(v.totals?.grandTotal || 0)),
    narration: v.narration || ''
  }));

// @desc    Vouchers using a ledger (e.g. Sales GST) in P&L period
// @route   GET /api/reports/profit-loss/vouchers
export const getProfitLossVouchers = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_month');
    const ledgerName = String(req.query?.ledgerName || '').trim();

    if (!companyId || !ledgerName) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and ledgerName are required'
      });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const period = resolveReportPeriod(periodKey, company);
    const vouchers = await queryVouchersForLedger(
      companyOid,
      ledgerName,
      period.fromDate,
      period.toDate
    );

    return res.status(200).json({
      success: true,
      data: {
        ledgerName,
        period: {
          periodKey: period.periodKey,
          label: period.label,
          startDate: period.fromDate.toISOString(),
          endDate: period.toDate.toISOString()
        },
        count: vouchers.length,
        vouchers: mapVoucherRowsForApi(vouchers)
      }
    });
  } catch (error) {
    logger.error('P&L vouchers by ledger error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading vouchers'
    });
  }
};

// @desc    Ledgers under a Balance Sheet group (from synced Group Summary)
// @route   GET /api/reports/balance-sheet/group-ledgers
export const getBalanceSheetGroupLedgers = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_month');
    const groupName = String(req.query?.groupName || '').trim();

    if (!companyId || !groupName) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and groupName are required'
      });
    }

    const storedReport = await BalanceSheetReport.findOne({
      company: companyId,
      reportName: 'Balance Sheet',
      periodKey
    }).lean();

    if (!storedReport) {
      return res.status(404).json({
        success: false,
        code: 'REPORT_NOT_SYNCED',
        message: 'Balance Sheet for this period is not synced yet.'
      });
    }

    const group = (storedReport.groupSummaries || []).find(
      (g) => String(g.groupName).trim().toLowerCase() === groupName.toLowerCase()
    );

    if (!group) {
      return res.status(404).json({
        success: false,
        message: `Group "${groupName}" summary not synced. Run desktop-agent sync again.`
      });
    }

    const tallyGroups = await TallyAccount.find({
      company: companyId,
      accountType: 'group'
    })
      .select('name')
      .lean();
    const groupNameSet = new Set(
      tallyGroups.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean)
    );

    const ledgers = (group.ledgers || []).map((l) => mapGroupSummaryLedgerRow(l, groupNameSet));

    return res.status(200).json({
      success: true,
      data: {
        groupName: group.groupName,
        parentGroup: group.parentGroup || '',
        groupAmount: group.groupAmount,
        ledgers
      }
    });
  } catch (error) {
    logger.error('Balance Sheet group ledgers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading group ledgers'
    });
  }
};

// @desc    Vouchers for a ledger in Balance Sheet period (books from → as-on date)
// @route   GET /api/reports/balance-sheet/vouchers
export const getBalanceSheetVouchers = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_month');
    const ledgerName = String(req.query?.ledgerName || '').trim();

    if (!companyId || !ledgerName) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and ledgerName are required'
      });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const range = resolveBalanceSheetVoucherRange(periodKey, company);
    const vouchers = await queryVouchersForLedger(
      companyOid,
      ledgerName,
      range.fromDate,
      range.toDate
    );

    return res.status(200).json({
      success: true,
      data: {
        ledgerName,
        period: {
          periodKey: range.periodKey,
          label: range.label,
          startDate: range.fromDate.toISOString(),
          endDate: range.toDate.toISOString(),
          asOfDate: range.asOfDate.toISOString()
        },
        count: vouchers.length,
        vouchers: mapVoucherRowsForApi(vouchers)
      }
    });
  } catch (error) {
    logger.error('Balance Sheet vouchers by ledger error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading vouchers'
    });
  }
};

// @desc    Get Balance Sheet
// @route   GET /api/reports/balance-sheet
// @access  Private
export const getBalanceSheet = async (req, res) => {
  try {
    const companyId = req.query?.companyId || req.body?.companyId;
    const periodKey = normalizePeriodKey(
      req.query?.periodKey || req.body?.periodKey || 'this_month'
    );

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const period = resolveReportPeriod(periodKey, company);

    const storedReport = await BalanceSheetReport.findOne({
      company: companyId,
      reportName: 'Balance Sheet',
      periodKey: period.periodKey
    });

    if (storedReport) {
      const data = buildBalanceSheetResponse(storedReport, period);
      return res.status(200).json({ success: true, data });
    }

    return res.status(404).json({
      success: false,
      code: 'REPORT_NOT_SYNCED',
      message: 'Balance Sheet for this period is not synced yet. Run sync on the Tally PC with desktop-agent.',
      periodKey: period.periodKey
    });
  } catch (error) {
    logger.error('Balance Sheet report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating Balance Sheet'
    });
  }
};

// @desc    Get Cash Flow Statement
// @route   GET /api/reports/cash-flow
// @access  Private
export const getCashFlowReport = async (req, res) => {
  try {
    const { companyId, startDate, endDate } = req.query;

    if (!companyId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Company ID, start date, and end date are required'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const cashVouchers = await Voucher.find(
      booksMatch({
        company: companyId,
        voucherType: { $in: ['receipt', 'payment', 'contra'] },
        date: { $gte: start, $lte: end }
      })
    );

    const cashInflows = cashVouchers
      .filter(v => v.voucherType === 'receipt')
      .reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    const cashOutflows = cashVouchers
      .filter(v => v.voucherType === 'payment')
      .reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    const netCashFlow = cashInflows - cashOutflows;

    res.status(200).json({
      success: true,
      data: {
        period: { startDate, endDate },
        operatingActivities: {
          cashInflows,
          cashOutflows,
          netCashFlow
        },
        summary: {
          totalInflows: cashInflows,
          totalOutflows: cashOutflows,
          netChange: netCashFlow
        }
      }
    });
  } catch (error) {
    logger.error('Cash Flow report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating Cash Flow report'
    });
  }
};

// @desc    Get Sales Report
// @route   GET /api/reports/sales
// @access  Private
export const getSalesReport = async (req, res) => {
  try {
    const { companyId, startDate, endDate, groupBy = 'day' } = req.query;

    if (!companyId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Company ID, start date, and end date are required'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Match the same way the dashboard trend does: a company whose sales sit
    // under a custom Tally voucher type (parent "Sales") would otherwise be
    // missing here while showing up in the 7-day dashboard trend.
    const salesVouchers = await Voucher.find(
      booksMatch({
        company: companyId,
        ...voucherKindMatch('sales'),
        date: { $gte: start, $lte: end }
      })
    ).populate('party', 'name');

    const voucherAmount = (v) => Math.abs(Number(v.totals?.grandTotal || 0));
    const totalSales = salesVouchers.reduce((sum, v) => sum + voucherAmount(v), 0);
    const totalQuantity = salesVouchers.reduce((sum, v) => {
      return sum + (v.items?.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0) || 0);
    }, 0);

    // Group by time period
    const salesByPeriod = {};
    salesVouchers.forEach(v => {
      const key = moment(v.date).startOf(groupBy).format('YYYY-MM-DD');
      if (!salesByPeriod[key]) {
        salesByPeriod[key] = { date: key, amount: 0, count: 0 };
      }
      salesByPeriod[key].amount += voucherAmount(v);
      salesByPeriod[key].count += 1;
    });

    // Top customers
    const customerSales = {};
    salesVouchers.forEach(v => {
      if (v.party) {
        const customerId = v.party._id.toString();
        if (!customerSales[customerId]) {
          customerSales[customerId] = {
            name: v.party.name,
            totalAmount: 0,
            transactionCount: 0
          };
        }
        customerSales[customerId].totalAmount += voucherAmount(v);
        customerSales[customerId].transactionCount += 1;
      }
    });

    const topCustomers = Object.values(customerSales)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        period: { startDate, endDate },
        summary: {
          totalSales,
          totalQuantity,
          transactionCount: salesVouchers.length,
          averageOrderValue: salesVouchers.length > 0 ? totalSales / salesVouchers.length : 0
        },
        salesByPeriod: Object.values(salesByPeriod).sort((a, b) => a.date.localeCompare(b.date)),
        topCustomers
      }
    });
  } catch (error) {
    logger.error('Sales report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating Sales report'
    });
  }
};

// @desc    Get Purchase Report
// @route   GET /api/reports/purchase
// @access  Private
export const getPurchaseReport = async (req, res) => {
  try {
    const { companyId, startDate, endDate } = req.query;

    if (!companyId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Company ID, start date, and end date are required'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Same parent-type matching as the sales report, for the same reason.
    const purchaseVouchers = await Voucher.find(
      booksMatch({
        company: companyId,
        ...voucherKindMatch('purchase'),
        date: { $gte: start, $lte: end }
      })
    ).populate('party', 'name');

    const totalPurchases = purchaseVouchers.reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    // Top suppliers
    const supplierPurchases = {};
    purchaseVouchers.forEach(v => {
      if (v.party) {
        const supplierId = v.party._id.toString();
        if (!supplierPurchases[supplierId]) {
          supplierPurchases[supplierId] = {
            name: v.party.name,
            totalAmount: 0,
            transactionCount: 0
          };
        }
        supplierPurchases[supplierId].totalAmount += v.totals?.grandTotal || 0;
        supplierPurchases[supplierId].transactionCount += 1;
      }
    });

    const topSuppliers = Object.values(supplierPurchases)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        period: { startDate, endDate },
        summary: {
          totalPurchases,
          transactionCount: purchaseVouchers.length,
          averagePurchaseValue: purchaseVouchers.length > 0 ? totalPurchases / purchaseVouchers.length : 0
        },
        topSuppliers
      }
    });
  } catch (error) {
    logger.error('Purchase report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating Purchase report'
    });
  }
};

// @desc    Get Budget vs Actual Report
// @route   GET /api/reports/budget-vs-actual
// @access  Private
export const getBudgetVsActualReport = async (req, res) => {
  try {
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const budgets = await Budget.find({
      company: companyId,
      status: 'active'
    });

    const budgetAnalysis = budgets.map(budget => ({
      name: budget.name,
      category: budget.category,
      budgetAmount: budget.amount,
      actualSpent: budget.actualSpent,
      remaining: budget.remainingAmount,
      utilization: budget.utilizationPercentage,
      variance: {
        amount: budget.actualSpent - budget.amount,
        percentage: budget.amount > 0 ? ((budget.actualSpent - budget.amount) / budget.amount * 100).toFixed(2) : 0
      },
      status: budget.actualSpent > budget.amount ? 'Over Budget' : 
              budget.utilizationPercentage >= 90 ? 'Near Limit' : 'On Track'
    }));

    const summary = {
      totalBudget: budgets.reduce((sum, b) => sum + b.amount, 0),
      totalSpent: budgets.reduce((sum, b) => sum + b.actualSpent, 0),
      totalRemaining: budgets.reduce((sum, b) => sum + b.remainingAmount, 0),
      averageUtilization: budgets.length > 0 ? 
        budgets.reduce((sum, b) => sum + b.utilizationPercentage, 0) / budgets.length : 0
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        budgets: budgetAnalysis
      }
    });
  } catch (error) {
    logger.error('Budget vs Actual report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating Budget vs Actual report'
    });
  }
};

// @desc    Get Dashboard Summary
// @route   GET /api/reports/dashboard
// @access  Private
/** Sum |grandTotal| (fallback |amount|) of vouchers of a kind within [start, end]. */
const sumVoucherAmounts = async (companyOid, kind, start, end) => {
  const [agg] = await Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...voucherKindMatch(kind),
        date: { $gte: start, $lte: end }
      })
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $abs: { $ifNull: ['$totals.grandTotal', '$amount', 0] } } },
        count: { $sum: 1 }
      }
    }
  ]);
  return { amount: agg?.total || 0, count: agg?.count || 0 };
};

/** Daily sales totals for the trend strip (last N IST days, inclusive of today). */
const aggregateDailySales = async (companyOid, fromDate, toDate) => {
  const rows = await Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...voucherKindMatch('sales'),
        date: { $gte: fromDate, $lte: toDate }
      })
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        amount: { $sum: { $abs: { $ifNull: ['$totals.grandTotal', '$amount', 0] } } },
        count: { $sum: 1 }
      }
    }
  ]);
  return new Map(rows.map((r) => [r._id, { amount: r.amount, count: r.count }]));
};

// @desc    Get Dashboard Summary (single round-trip for the mobile dashboard)
// @route   GET /api/reports/dashboard
// @access  Private
export const getDashboardSummary = async (req, res) => {
  try {
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // All boundaries are IST calendar days aligned with voucher storage (UTC midnight).
    const today = todayInReportTz();
    const todayEnd = endOfReportDay(today);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const fyStart = resolveReportPeriod('this_year', company).fromDate;
    const trendStart = new Date(today);
    trendStart.setUTCDate(trendStart.getUTCDate() - 6);

    const [
      todaySales,
      monthSales,
      monthPurchases,
      ytdSales,
      ytdPurchases,
      outstandingDoc,
      payableDoc,
      storedPnl,
      topCustomersMonth,
      dailySales,
      recentVouchers
    ] = await Promise.all([
      sumVoucherAmounts(companyOid, 'sales', today, todayEnd),
      sumVoucherAmounts(companyOid, 'sales', monthStart, todayEnd),
      sumVoucherAmounts(companyOid, 'purchase', monthStart, todayEnd),
      sumVoucherAmounts(companyOid, 'sales', fyStart, todayEnd),
      sumVoucherAmounts(companyOid, 'purchase', fyStart, todayEnd),
      OutstandingReceivable.findOne({ company: companyId, reportName: 'Bills Receivable' })
        .select('totalOutstanding ledgers.oldestOverdueDays tallySync.lastSyncDate updatedAt')
        .lean(),
      OutstandingReceivable.findOne({ company: companyId, reportName: 'Bills Payable' })
        .select('totalOutstanding ledgers.oldestOverdueDays tallySync.lastSyncDate updatedAt')
        .lean(),
      ProfitLossReport.findOne({
        company: companyId,
        reportName: 'Profit and Loss',
        periodKey: 'this_month'
      })
        .select('totals.grandTotal')
        .lean(),
      aggregateTopParties(companyOid, 'sales', monthStart, todayEnd),
      aggregateDailySales(companyOid, trendStart, todayEnd),
      Voucher.find(booksMatch({ company: companyOid }))
        // `amount` is not a real SQL column (we store amounts inside `totals.grandTotal`)
        // Also include `_id` because the API maps `v._id.toString()`.
        .select('_id voucherNumber voucherType tallyVoucherTypeParent date partyName totals.grandTotal narration')
        .sort({ date: -1, createdAt: -1 })
        .limit(8)
        .lean()
    ]);

    // Bank balance from the Cash/Bank Book sources (Balance Sheet group summary,
    // falling back to ledger opening balances) — same numbers the report shows.
    let bankBalance = 0;
    let cashInHand = 0;
    try {
      const storedBs = await loadBalanceSheetReportForPeriod(companyId, 'this_month');
      const tallyGroups = await TallyAccount.find({ company: companyId, accountType: 'group' })
        .select('name')
        .lean();
      const groupNameSet = new Set(
        tallyGroups.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean)
      );
      const bank = await resolveCashBankLedgers(storedBs, companyId, 'Bank Accounts', groupNameSet);
      const cash = await resolveCashBankLedgers(storedBs, companyId, 'Cash-in-hand', groupNameSet);
      const bankTotals = sumLedgerDebitCredit(bank.ledgers || []);
      const cashTotals = sumLedgerDebitCredit(cash.ledgers || []);
      // Asset ledgers carry debit balances; show debit − credit.
      bankBalance = bankTotals.debit - bankTotals.credit;
      cashInHand = cashTotals.debit - cashTotals.credit;
    } catch (e) {
      logger.warn('Dashboard bank balance resolution failed:', e.message);
    }

    const countOverdue = (doc) =>
      (doc?.ledgers || []).filter((l) => Number(l.oldestOverdueDays || 0) > 0).length;
    const overdueParties = countOverdue(outstandingDoc);
    const overduePayableParties = countOverdue(payableDoc);

    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = dailySales.get(key);
      trend.push({ date: key, amount: row?.amount || 0, count: row?.count || 0 });
    }

    const topCustomer = topCustomersMonth.rows?.[0] || null;

    res.status(200).json({
      success: true,
      data: {
        asOf: {
          date: today.toISOString().slice(0, 10),
          timezone: 'Asia/Kolkata'
        },
        lastSyncedAt:
          company.tallyIntegration?.lastSyncDate ||
          outstandingDoc?.tallySync?.lastSyncDate ||
          null,
        todaySales: { amount: todaySales.amount, count: todaySales.count },
        monthlyRevenue: {
          amount: monthSales.amount,
          count: monthSales.count,
          fromDate: monthStart.toISOString().slice(0, 10),
          toDate: today.toISOString().slice(0, 10)
        },
        monthlyPurchase: {
          amount: monthPurchases.amount,
          count: monthPurchases.count,
          fromDate: monthStart.toISOString().slice(0, 10),
          toDate: today.toISOString().slice(0, 10)
        },
        outstanding: {
          receivables: outstandingDoc?.totalOutstanding || 0,
          overdueParties,
          parties: outstandingDoc?.ledgers?.length || 0
        },
        // Bills Payable — mirrors `outstanding`; zeros until the agent syncs it.
        payable: {
          payables: payableDoc?.totalOutstanding || 0,
          overdueParties: overduePayableParties,
          parties: payableDoc?.ledgers?.length || 0,
          synced: Boolean(payableDoc)
        },
        bankBalance: {
          amount: bankBalance + cashInHand,
          bankAccounts: bankBalance,
          cashInHand
        },
        profitThisMonth:
          storedPnl?.totals?.grandTotal != null
            ? Number(storedPnl.totals.grandTotal)
            : monthSales.amount - monthPurchases.amount,
        topCustomer: topCustomer
          ? { name: topCustomer.name, amount: topCustomer.totalAmount }
          : null,
        salesTrend: trend,
        recentVouchers: recentVouchers.map((v) => ({
          id: v._id.toString(),
          voucherNumber: v.voucherNumber,
          voucherType: v.voucherType,
          tallyVoucherTypeParent: v.tallyVoucherTypeParent || '',
          date: v.date,
          partyName: v.partyName || '',
          amount: Math.abs(Number(v.totals?.grandTotal ?? v.amount ?? 0)),
          narration: v.narration || ''
        })),
        // Back-compat for older clients
        thisMonth: {
          sales: monthSales.amount,
          purchases: monthPurchases.amount,
          profit: monthSales.amount - monthPurchases.amount
        },
        yearToDate: {
          sales: ytdSales.amount,
          purchases: ytdPurchases.amount,
          profit: ytdSales.amount - ytdPurchases.amount
        }
      }
    });
  } catch (error) {
    logger.error('Dashboard summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating dashboard summary'
    });
  }
};

// @desc    Get DayBook Report
// @route   GET /api/reports/daybook
// @access  Private
export const getDayBook = async (req, res) => {
  try {
    const { companyId, fromDate, toDate } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    // Voucher dates are stored at UTC midnight of the Tally calendar date; parse
    // YYYY-MM-DD strings as UTC days and default to "today" in IST.
    const parseYmd = (ymd, endOfDayFlag = false) => {
      const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      const base = m
        ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
        : todayInReportTz(new Date(ymd));
      return endOfDayFlag ? endOfReportDay(base) : base;
    };

    const istToday = todayInReportTz();
    const startDate = fromDate ? parseYmd(fromDate, false) : istToday;
    const endDate = toDate ? parseYmd(toDate, true) : endOfReportDay(istToday);

    // Get all vouchers for the date range
    const vouchers = await Voucher.find(
      booksMatch({
        company: companyId,
        date: { $gte: startDate, $lte: endDate }
      })
    )
    .populate('party', 'name displayName')
    .sort({ date: 1, createdAt: 1 });

    // Format daybook entries
    const dayBookEntries = vouchers.map(voucher => {
      const amount = voucher.totals?.grandTotal || 0;
      let type;

      // Determine the side based on voucher type. Orders, quotations and stock
      // notes are checked first: they carry no debit/credit side, and used to
      // fall through to `default` and be reported as debits, so a Sales Order
      // read as money going out.
      if (isNonAccountingVoucher(voucher)) {
        type = 'none';
      } else {
        switch (voucher.voucherType) {
          case 'sales':
          case 'receipt':
            type = 'credit'; // Money coming in
            break;
          case 'purchase':
          case 'payment':
            type = 'debit'; // Money going out
            break;
          case 'journal':
          case 'contra':
          case 'debit_note':
          case 'credit_note':
            // For these, we need to determine based on the actual transaction
            type = voucher.amount > 0 ? 'credit' : 'debit';
            break;
          default:
            type = 'debit';
        }
      }

      return {
        id: voucher._id.toString(),
        voucherId: voucher._id.toString(),
        date: voucher.date.toISOString().split('T')[0],
        voucherType: voucher.voucherType,
        tallyVoucherTypeParent: voucher.tallyVoucherTypeParent || '',
        tallyVoucherTypeName: voucher.tallyVoucherTypeName || '',
        voucherNumber: voucher.voucherNumber,
        partyName:
          voucher.partyName ||
          voucher.party?.name ||
          voucher.party?.displayName ||
          '',
        amount: Math.abs(amount),
        type,
        narration: voucher.narration || ''
      };
    });

    // Calculate totals
    // `type: 'none'` entries belong to neither column — an unsigned else-branch
    // would silently bank every order as a credit.
    const totals = dayBookEntries.reduce(
      (acc, entry) => {
        if (entry.type === 'debit') {
          acc.totalDebit += entry.amount;
        } else if (entry.type === 'credit') {
          acc.totalCredit += entry.amount;
        }
        return acc;
      },
      { totalDebit: 0, totalCredit: 0 }
    );

    // Money in / money out is cash actually moved, not turnover: a Sales invoice
    // and the Receipt settling it are the same rupees, so counting both would
    // double them. Only Receipt and Payment vouchers move cash. Match the Tally
    // parent type too, so renamed/custom voucher types still count.
    const isKind = (entry, kind) => {
      const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
      return norm(entry.voucherType) === kind || norm(entry.tallyVoucherTypeParent) === kind;
    };
    const cash = dayBookEntries.reduce(
      (acc, entry) => {
        if (isKind(entry, 'receipt')) {
          acc.moneyIn.amount += entry.amount;
          acc.moneyIn.count += 1;
        } else if (isKind(entry, 'payment')) {
          acc.moneyOut.amount += entry.amount;
          acc.moneyOut.count += 1;
        }
        return acc;
      },
      { moneyIn: { amount: 0, count: 0 }, moneyOut: { amount: 0, count: 0 } }
    );

    res.status(200).json({
      success: true,
      data: {
        period: {
          fromDate: startDate.toISOString().split('T')[0],
          toDate: endDate.toISOString().split('T')[0]
        },
        entries: dayBookEntries,
        summary: {
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
          netBalance: totals.totalCredit - totals.totalDebit,
          transactionCount: dayBookEntries.length,
          // Cash movement (Receipt / Payment only) — what the Day Book header shows.
          moneyIn: cash.moneyIn,
          moneyOut: cash.moneyOut,
          netCash: cash.moneyIn.amount - cash.moneyOut.amount
        }
      }
    });
  } catch (error) {
    logger.error('DayBook report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating DayBook report'
    });
  }
};

// @desc    Outstanding receivable — ledger summary list (Bills Receivable)
// @route   GET /api/reports/outstanding-receivable
export const getOutstandingReceivable = (req, res) =>
  getOutstandingBills(req, res, 'Bills Receivable');

// @desc    Outstanding payable — ledger list
// @route   GET /api/reports/outstanding-payable
export const getOutstandingPayable = (req, res) =>
  getOutstandingBills(req, res, 'Bills Payable');

/**
 * Both outstanding reports live in the same collection keyed by `reportName`,
 * so one reader serves receivables and payables.
 */
const getOutstandingBills = async (req, res, reportName) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId is required' });
    }

    const doc = await OutstandingReceivable.findOne({
      company: companyId,
      reportName
    }).lean();

    if (!doc) {
      return res.status(200).json({
        success: true,
        data: {
          asOfDate: null,
          fromDate: null,
          toDate: null,
          totalOutstanding: 0,
          ledgers: []
        }
      });
    }

    const ledgers = (doc.ledgers || []).map((l) => ({
      partyName: l.partyName,
      totalOutstanding: l.totalOutstanding,
      billCount: l.billCount,
      oldestBillDue: l.oldestBillDue,
      oldestOverdueDays: l.oldestOverdueDays
    }));

    return res.status(200).json({
      success: true,
      data: {
        asOfDate: doc.asOfDate,
        fromDate: doc.fromDate,
        toDate: doc.toDate,
        totalOutstanding: doc.totalOutstanding,
        lastSyncedAt: doc.tallySync?.lastSyncDate || doc.updatedAt,
        ledgers
      }
    });
  } catch (error) {
    logger.error(`${reportName} list error:`, error);
    return res.status(500).json({
      success: false,
      message: `Server error while loading ${reportName}`
    });
  }
};

// @desc    Outstanding receivable — bills for one ledger/party
// @route   GET /api/reports/outstanding-receivable/ledger
export const getOutstandingReceivableLedger = (req, res) =>
  getOutstandingBillsLedger(req, res, 'Bills Receivable');

// @desc    Outstanding payable — bills for one ledger/party
// @route   GET /api/reports/outstanding-payable/ledger
export const getOutstandingPayableLedger = (req, res) =>
  getOutstandingBillsLedger(req, res, 'Bills Payable');

const getOutstandingBillsLedger = async (req, res, reportName) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId;
    const partyName = req.query.partyName || req.query.ledgerName;

    if (!companyId || !partyName) {
      return res.status(400).json({
        success: false,
        message: 'companyId and partyName are required'
      });
    }

    const doc = await OutstandingReceivable.findOne({
      company: companyId,
      reportName
    }).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: `${reportName} data not found. Run desktop sync first.`
      });
    }

    const ledger = (doc.ledgers || []).find(
      (l) => String(l.partyName).trim().toLowerCase() === String(partyName).trim().toLowerCase()
    );

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: `Ledger not found in ${reportName} report`
      });
    }

    const normalizeVoucherNumber = (v) => String(v || '').trim();
    const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sameCalendarDay = (a, b) => {
      if (!a || !b) return false;
      const left = new Date(a);
      const right = new Date(b);
      if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
      return (
        left.getUTCFullYear() === right.getUTCFullYear() &&
        left.getUTCMonth() === right.getUTCMonth() &&
        left.getUTCDate() === right.getUTCDate()
      );
    };

    const bills = Array.isArray(ledger.bills) ? ledger.bills : [];
    const billLookupNumber = (bill) =>
      normalizeVoucherNumber(bill?.vchNumber) || normalizeVoucherNumber(bill?.billRef);

    const uniqueLookupNumbers = [
      ...new Set(bills.map(billLookupNumber).filter(Boolean))
    ];

    // Batch-resolve voucher IDs for drill-down to VoucherDetailScreen.
    // Tally often leaves BILLVCHNUMBER empty while BILLREF carries the voucher number.
    // Match by voucher number only; use date/type only as tie-breakers when duplicates exist.
    const matchesByNumber = new Map();
    if (uniqueLookupNumbers.length > 0) {
      const orClauses = uniqueLookupNumbers.map((num) => ({
        company: toObjectId(companyId),
        voucherNumber: { $regex: new RegExp(`^${escapeRegex(num)}$`, 'i') }
      }));

      const matches = await Voucher.find({ $or: orClauses })
        .select('_id voucherNumber voucherType tallyVoucherTypeName date')
        .lean();

      for (const v of matches) {
        const numKey = String(v.voucherNumber).trim().toLowerCase();
        if (!matchesByNumber.has(numKey)) matchesByNumber.set(numKey, []);
        matchesByNumber.get(numKey).push(v);
      }
    }

    const resolveVoucherId = (lookupNumber, vchType, prefDate) => {
      let candidates = matchesByNumber.get(String(lookupNumber).trim().toLowerCase()) || [];
      if (!candidates.length) return null;
      if (candidates.length === 1) return candidates[0]._id.toString();

      if (prefDate) {
        const dateMatches = candidates.filter((v) => sameCalendarDay(v.date, prefDate));
        if (dateMatches.length === 1) return dateMatches[0]._id.toString();
        if (dateMatches.length > 1) candidates = dateMatches;
      }

      const slug = normalizeVoucherTypeSlug('', vchType, vchType);
      const typeNameLower = String(vchType || '').trim().toLowerCase();
      const best = candidates.find(
        (v) =>
          String(v.voucherType) === slug ||
          String(v.tallyVoucherTypeName || '').trim().toLowerCase() === typeNameLower
      );
      return (best || candidates[0])._id.toString();
    };

    return res.status(200).json({
      success: true,
      data: {
        asOfDate: doc.asOfDate,
        fromDate: doc.fromDate,
        toDate: doc.toDate,
        partyName: ledger.partyName,
        totalOutstanding: ledger.totalOutstanding,
        billCount: ledger.billCount,
        oldestBillDue: ledger.oldestBillDue,
        oldestOverdueDays: ledger.oldestOverdueDays,
        bills: bills.map((b) => {
          const lookupNumber = billLookupNumber(b);
          const vchType = String(b?.vchType || '').trim();
          const prefDate = b?.vchDate || b?.billDate || null;
          return {
            ...b,
            voucherId: lookupNumber ? resolveVoucherId(lookupNumber, vchType, prefDate) : null
          };
        })
      }
    });
  } catch (error) {
    logger.error(`${reportName} ledger error:`, error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading ledger outstanding'
    });
  }
};

// @desc    Top 10 rankings (customers, suppliers, items by value/qty)
// @route   GET /api/reports/top-10
// @access  Private
export const getTop10Report = async (req, res) => {
  try {
    const { companyId, startDate, endDate, periodKey } = req.query;

    if (!companyId || (!periodKey && (!startDate || !endDate))) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and either periodKey or start/end dates are required'
      });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid company ID'
      });
    }

    let start;
    let end;
    if (periodKey) {
      const company = await Company.findById(companyId).lean();
      const period = resolveReportPeriod(normalizePeriodKey(periodKey), company || {});
      start = period.fromDate;
      end = period.toDate;
    } else {
      start = new Date(startDate);
      end = endOfReportDay(new Date(endDate));
    }

    const [
      customers,
      suppliers,
      itemsSoldByValue,
      itemsPurchasedByValue,
      itemsSoldByQty,
      itemsPurchasedByQty
    ] = await Promise.all([
      aggregateTopParties(companyOid, 'sales', start, end),
      aggregateTopParties(companyOid, 'purchase', start, end),
      aggregateTopItems(companyOid, 'sales', start, end, 'value'),
      aggregateTopItems(companyOid, 'purchase', start, end, 'value'),
      aggregateTopItems(companyOid, 'sales', start, end, 'quantity'),
      aggregateTopItems(companyOid, 'purchase', start, end, 'quantity')
    ]);

    return res.status(200).json({
      success: true,
      data: {
        period: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          ...(periodKey ? { periodKey: normalizePeriodKey(periodKey) } : {})
        },
        summary: {
          totalCustomerSales: customers.total,
          totalSupplierPurchases: suppliers.total,
          totalItemsSoldValue: itemsSoldByValue.totalValue,
          totalItemsPurchasedValue: itemsPurchasedByValue.totalValue,
          totalItemsSoldQty: itemsSoldByQty.totalQty,
          totalItemsPurchasedQty: itemsPurchasedByQty.totalQty
        },
        topCustomers: customers.rows,
        topSuppliers: suppliers.rows,
        itemsSoldByValue: itemsSoldByValue.rows,
        itemsPurchasedByValue: itemsPurchasedByValue.rows,
        itemsSoldByQty: itemsSoldByQty.rows,
        itemsPurchasedByQty: itemsPurchasedByQty.rows
      }
    });
  } catch (error) {
    logger.error('Top 10 report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while generating Top 10 report'
    });
  }
};

// @desc    Fast moving items — best-selling stock items by qty sold
// @route   GET /api/reports/fast-moving-items
// @access  Private
export const getFastMovingItemsReport = async (req, res) => {
  try {
    const companyId = req.query?.companyId || req.body?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_year');
    const limitRaw = req.query?.limit ?? req.query?.top ?? FAST_MOVING_DEFAULT_LIMIT;
    const limit =
      Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
        ? Math.min(FAST_MOVING_MAX_LIMIT, Math.max(1, parseInt(String(limitRaw), 10)))
        : FAST_MOVING_DEFAULT_LIMIT;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company ID is required' });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const period = resolveReportPeriod(periodKey, company);

    const { rows, totalQtySold } = await aggregateFastMovingItems(
      companyOid,
      period.fromDate,
      period.toDate,
      limit
    );

    const items = rows
      .filter((r) => Number(r?.qtySold || 0) > 0 && String(r?.name || '').trim() !== '')
      .map((r, index) => ({
        rank: index + 1,
        itemId: r.itemId != null ? String(r.itemId) : null,
        name: r.name,
        unit: r.unit || 'Nos',
        qtySold: Number(r.qtySold || 0),
        totalAmount: Number(r.totalAmount || 0)
      }));

    return res.status(200).json({
      success: true,
      data: {
        period: {
          periodKey,
          label: period.label,
          startDate: period.fromDate.toISOString(),
          endDate: period.toDate.toISOString()
        },
        summary: { totalQtySold },
        items
      }
    });
  } catch (error) {
    logger.error('Fast moving items report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while generating fast moving items report'
    });
  }
};

const INACTIVE_DAY_PRESETS = [30, 60, 90, 120, 180];

const parseInactiveDaysQuery = (query = {}) => {
  const raw = String(query.inactiveDays || query.days || '30').toLowerCase();
  if (raw === 'never_sold' || raw === 'never') {
    return { mode: 'never_sold', days: null, label: 'Never Sold' };
  }
  if (raw === 'custom' && query.customDays) {
    const days = Math.max(1, Number(query.customDays) || 30);
    return { mode: 'days', days, label: `> ${days} days` };
  }
  const days = INACTIVE_DAY_PRESETS.includes(Number(raw)) ? Number(raw) : 30;
  return { mode: 'days', days, label: `> ${days} days` };
};

/** UTC-midnight truncation — voucher dates are stored at UTC midnight of the IST calendar date. */
const startOfDay = (d) => {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
};

const normalizeInactiveNameKey = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const buildLastSaleMap = (rows = []) => {
  const map = new Map();
  for (const row of rows) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const key = normalizeInactiveNameKey(name);
    const existing = map.get(key);
    const rowDate = row?.lastSaleDate ? new Date(row.lastSaleDate) : null;
    const existingDate = existing?.lastSaleDate ? new Date(existing.lastSaleDate) : null;
    if (!existing || (rowDate && (!existingDate || rowDate > existingDate))) {
      map.set(key, row);
    }
  }
  return map;
};

const sortInactiveRows = (a, b) => {
  // Latest last-sale date first; never-sold rows at the end.
  if (!a.lastSaleDate && !b.lastSaleDate) return a.name.localeCompare(b.name);
  if (!a.lastSaleDate) return 1;
  if (!b.lastSaleDate) return -1;
  return new Date(b.lastSaleDate).getTime() - new Date(a.lastSaleDate).getTime();
};

// Vouchers that represent a "sale" event for inactivity tracking.
// Source of truth is Tally's parent type (e.g. tallyVoucherTypeParent: "Sales"),
// because voucherType can be "sales_order", "delivery_note", etc.
const SALES_PARENT_REGEX = /^sales$/i;
const INACTIVE_SALES_MATCH = {
  $or: [
    { voucherType: 'sales' }, // legacy/manual vouchers
    { tallyVoucherTypeParent: { $regex: SALES_PARENT_REGEX } }
  ]
};

/** Last sales bill date per customer from synced sales vouchers */
const aggregateLastSaleByCustomer = async (companyOid) =>
  Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...INACTIVE_SALES_MATCH,
        date: { $exists: true, $ne: null }
      })
    },
    {
      $lookup: {
        from: 'parties',
        localField: 'party',
        foreignField: '_id',
        as: 'partyDoc'
      }
    },
    {
      $addFields: {
        resolvedName: {
          $trim: {
            input: {
              $cond: [
                { $gt: [{ $size: '$partyDoc' }, 0] },
                { $arrayElemAt: ['$partyDoc.name', 0] },
                {
                  $cond: [
                    { $gt: [{ $strLenCP: { $ifNull: ['$partyName', ''] } }, 0] },
                    '$partyName',
                    ''
                  ]
                }
              ]
            }
          }
        }
      }
    },
    { $match: { resolvedName: { $nin: ['', null] } } },
    {
      $group: {
        _id: { partyId: '$party', nameKey: { $toLower: '$resolvedName' } },
        name: { $first: '$resolvedName' },
        lastSaleDate: { $max: '$date' },
        billCount: { $sum: 1 }
      }
    }
  ]);

/** Last sale date per item from sales voucher lines */
const aggregateLastSaleByItem = async (companyOid) =>
  Voucher.aggregate([
    {
      $match: booksMatch({
        company: companyOid,
        ...INACTIVE_SALES_MATCH,
        date: { $exists: true, $ne: null },
        'items.0': { $exists: true }
      })
    },
    { $unwind: '$items' },
    {
      $addFields: {
        resolvedItemName: {
          $trim: {
            input: {
              $ifNull: [
                '$items.itemName',
                { $ifNull: ['$items.item', { $ifNull: ['$items.description', ''] }] }
              ]
            }
          }
        }
      }
    },
    { $match: { resolvedItemName: { $nin: ['', null] } } },
    {
      $group: {
        _id: { nameKey: { $toLower: '$resolvedItemName' } },
        name: { $first: '$resolvedItemName' },
        lastSaleDate: { $max: '$date' },
        billCount: { $sum: 1 }
      }
    }
  ]);

const itemClosingQty = (item = {}) => {
  const stocks = item?.inventory?.currentStock;
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return Number(item?.openingStock || 0);
  }
  return stocks.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
};

const itemClosingValue = (item = {}, qty) => {
  // Tally's closing stock value is authoritative when synced.
  const tallyClosing = Math.abs(Number(item?.tallyStock?.closingValue || 0));
  if (tallyClosing > 0) return tallyClosing;

  const q = Number(qty || 0);
  const rate = Number(
    item?.tallyStock?.closingRate ||
      item?.pricing?.costPrice ||
      item?.pricing?.sellingPrice ||
      item?.openingValue ||
      0
  );
  if (item?.openingStock > 0 && item?.openingValue) {
    const perUnit = Number(item.openingValue) / Number(item.openingStock);
    return Math.abs(q * perUnit);
  }
  return Math.abs(q * rate);
};

// @desc    Inactive customers (no sales bill for N days)
// @route   GET /api/reports/inactive-customers
export const getInactiveCustomersReport = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company ID is required' });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const inactive = parseInactiveDaysQuery(req.query);
    const today = todayInReportTz();
    const cutoff =
      inactive.mode === 'days'
        ? startOfDay(new Date(today.getTime() - inactive.days * 86400000))
        : null;

    const [lastSales, partyDocs, salesNameRows] = await Promise.all([
      aggregateLastSaleByCustomer(companyOid),
      Party.find({ company: companyOid, type: { $in: ['customer', 'both'] } })
        .select('name displayName')
        .lean(),
      Voucher.distinct('partyName', {
        company: companyOid,
        ...INACTIVE_SALES_MATCH,
        partyName: { $exists: true, $ne: '' }
      })
    ]);

    const lastSaleMap = buildLastSaleMap(lastSales);

    const customerNames = new Set();
    partyDocs.forEach((p) => customerNames.add((p.displayName || p.name || '').trim()));
    salesNameRows.forEach((n) => {
      if (n && String(n).trim()) customerNames.add(String(n).trim());
    });

    const totalCustomers = customerNames.size;
    const rows = [];

    for (const name of customerNames) {
      if (!name) continue;
      const sale = lastSaleMap.get(normalizeInactiveNameKey(name));
      const lastSaleDate = sale?.lastSaleDate ? new Date(sale.lastSaleDate) : null;

      let isInactive = false;
      if (inactive.mode === 'never_sold') {
        isInactive = !lastSaleDate;
      } else if (!lastSaleDate) {
        isInactive = true;
      } else {
        isInactive = startOfDay(lastSaleDate) <= cutoff;
      }

      if (!isInactive) continue;

      rows.push({
        name,
        lastSaleDate: lastSaleDate ? lastSaleDate.toISOString() : null,
        lastSaleDateDisplay: formatTallyDisplayDate(lastSaleDate),
        billCount: sale?.billCount || 0
      });
    }

    rows.sort(sortInactiveRows);

    const inactiveCount = rows.length;
    const percentOfTotal =
      totalCustomers > 0
        ? Number(((inactiveCount / totalCustomers) * 100).toFixed(2))
        : 0;

    return res.status(200).json({
      success: true,
      data: {
        filter: inactive,
        summary: {
          inactiveCount,
          totalCustomers,
          percentOfTotal
        },
        customers: rows
      }
    });
  } catch (error) {
    logger.error('Inactive customers report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while generating inactive customers report'
    });
  }
};

// @desc    Inactive stock items (not sold for N days)
// @route   GET /api/reports/inactive-items
export const getInactiveItemsReport = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company ID is required' });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const inactive = parseInactiveDaysQuery(req.query);
    const today = todayInReportTz();
    const cutoff =
      inactive.mode === 'days'
        ? startOfDay(new Date(today.getTime() - inactive.days * 86400000))
        : null;

    const [lastSold, itemDocs] = await Promise.all([
      aggregateLastSaleByItem(companyOid),
      Item.find({ company: companyOid, type: 'product' }).lean()
    ]);

    const lastSaleMap = buildLastSaleMap(lastSold);

    const itemByName = new Map();
    itemDocs.forEach((item) => {
      const label = (item.displayName || item.name || '').trim();
      if (label) itemByName.set(normalizeInactiveNameKey(label), item);
    });

    lastSold.forEach((r) => {
      const label = String(r.name || '').trim();
      const key = normalizeInactiveNameKey(label);
      if (label && !itemByName.has(key)) {
        itemByName.set(key, { name: label, displayName: label });
      }
    });

    const totalItems = itemByName.size;
    const rows = [];
    let totalValue = 0;

    for (const [key, item] of itemByName.entries()) {
      const name = (item.displayName || item.name || '').trim();
      if (!name) continue;

      const sale = lastSaleMap.get(key);
      const lastSaleDate = sale?.lastSaleDate ? new Date(sale.lastSaleDate) : null;

      let isInactive = false;
      if (inactive.mode === 'never_sold') {
        isInactive = !lastSaleDate;
      } else if (!lastSaleDate) {
        isInactive = true;
      } else {
        isInactive = startOfDay(lastSaleDate) <= cutoff;
      }

      if (!isInactive) continue;

      const quantity = itemClosingQty(item);
      const amount = itemClosingValue(item, quantity);
      totalValue += amount;

      rows.push({
        name,
        quantity,
        unit: item?.units?.primary?.symbol || item?.units?.primary?.name || 'Nos',
        amount,
        lastSaleDate: lastSaleDate ? lastSaleDate.toISOString() : null,
        lastSaleDateDisplay: formatTallyDisplayDate(lastSaleDate),
        billCount: sale?.billCount || 0
      });
    }

    rows.sort(sortInactiveRows);

    const inactiveCount = rows.length;
    const percentOfTotal =
      totalItems > 0 ? Number(((inactiveCount / totalItems) * 100).toFixed(2)) : 0;

    return res.status(200).json({
      success: true,
      data: {
        filter: inactive,
        summary: {
          inactiveCount,
          totalItems,
          percentOfTotal,
          totalValue
        },
        items: rows
      }
    });
  } catch (error) {
    logger.error('Inactive items report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while generating inactive items report'
    });
  }
};

const sumLedgerDebitCredit = (ledgers = []) => {
  let debit = 0;
  let credit = 0;
  for (const row of ledgers) {
    if (row.isGroup) continue;
    debit += Math.abs(Number(row.debit || 0));
    credit += Math.abs(Number(row.credit || 0));
  }
  return { debit, credit };
};

const findCashBankGroupSummary = (groupSummaries, parentGroup) =>
  (groupSummaries || []).find((g) =>
    matchesAccountLedgerParent(g.groupName, parentGroup)
  );

const loadBalanceSheetReportForPeriod = async (companyId, periodKey) => {
  const storedReport = await BalanceSheetReport.findOne({
    company: companyId,
    reportName: 'Balance Sheet',
    periodKey
  }).lean();
  return storedReport;
};

const buildCashBankLedgersFromParty = async (companyId, parentGroup) => {
  const rows = await Party.find({
    company: companyId,
    isActive: true,
    recordType: 'ledger'
  })
    .sort({ name: 1 })
    .lean();

  return rows
    .filter((r) => matchesAccountLedgerParent(r.tallyParent, parentGroup))
    .map((r) => {
      const amt = Math.abs(Number(r.balances?.opening?.amount || 0));
      const side = r.balances?.opening?.type === 'credit' ? 'credit' : 'debit';
      return {
        name: r.name,
        displayName: r.displayName || r.name,
        debit: side === 'debit' ? amt : 0,
        credit: side === 'credit' ? amt : 0,
        amount: side === 'debit' ? -amt : amt,
        isGroup: false
      };
    });
};

const resolveCashBankLedgers = async (storedReport, companyId, parentGroup, groupNameSet) => {
  const group = findCashBankGroupSummary(storedReport?.groupSummaries, parentGroup);
  if (group?.ledgers?.length) {
    return {
      groupName: group.groupName,
      parentGroup: group.parentGroup || '',
      groupAmount: group.groupAmount,
      ledgers: group.ledgers.map((l) => mapGroupSummaryLedgerRow(l, groupNameSet))
    };
  }

  const ledgers = await buildCashBankLedgersFromParty(companyId, parentGroup);
  const totals = sumLedgerDebitCredit(ledgers);
  return {
    groupName: parentGroup,
    parentGroup: '',
    groupAmount: totals.debit - totals.credit,
    ledgers
  };
};

// @desc    Cash/Bank Book — parent group summary (Cash-in-hand, Bank Accounts, Bank OD A/c)
// @route   GET /api/reports/cash-bank-book
export const getCashBankBook = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_month');

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const storedReport = await loadBalanceSheetReportForPeriod(companyId, periodKey);
    const range = resolveBalanceSheetVoucherRange(periodKey, company);
    const tallyGroups = await TallyAccount.find({
      company: companyId,
      accountType: 'group'
    })
      .select('name')
      .lean();
    const groupNameSet = new Set(
      tallyGroups.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean)
    );

    const sections = [];
    for (const parentGroup of CASH_BANK_PARENT_GROUPS) {
      const resolved = await resolveCashBankLedgers(
        storedReport,
        companyId,
        parentGroup,
        groupNameSet
      );
      const leafLedgers = (resolved.ledgers || []).filter((l) => !l.isGroup);
      if (!leafLedgers.length) {
        continue;
      }
      const totals = sumLedgerDebitCredit(resolved.ledgers);
      sections.push({
        name: resolved.groupName || parentGroup,
        parentGroup,
        debit: totals.debit,
        credit: totals.credit,
        ledgerCount: leafLedgers.length,
        drillable: leafLedgers.length > 0
      });
    }

    if (!sections.length) {
      return res.status(404).json({
        success: false,
        code: storedReport ? 'NO_CASH_BANK_GROUPS' : 'REPORT_NOT_SYNCED',
        message: storedReport
          ? 'No cash or bank groups found. Re-run desktop-agent sync after opening Tally.'
          : 'Balance Sheet for this period is not synced yet. Run desktop-agent sync.'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        reportName: 'Cash/Bank Book',
        period: {
          periodKey: range.periodKey,
          label: range.label,
          startDate: range.fromDate.toISOString(),
          endDate: range.toDate.toISOString(),
          asOfDate: range.asOfDate.toISOString()
        },
        lastSyncDate: storedReport?.tallySync?.lastSyncDate?.toISOString?.() || null,
        sections
      }
    });
  } catch (error) {
    logger.error('Cash/Bank Book summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading Cash/Bank Book'
    });
  }
};

// @desc    Cash/Bank Book — ledgers under a parent group
// @route   GET /api/reports/cash-bank-book/ledgers
export const getCashBankBookLedgers = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_month');
    const parentGroup = String(req.query?.parentGroup || '').trim();

    if (!companyId || !parentGroup) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and parentGroup are required'
      });
    }

    const storedReport = await loadBalanceSheetReportForPeriod(companyId, periodKey);
    const tallyGroups = await TallyAccount.find({
      company: companyId,
      accountType: 'group'
    })
      .select('name')
      .lean();
    const groupNameSet = new Set(
      tallyGroups.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean)
    );

    const resolved = await resolveCashBankLedgers(
      storedReport,
      companyId,
      parentGroup,
      groupNameSet
    );
    const leafLedgers = (resolved.ledgers || []).filter((l) => !l.isGroup);

    if (!leafLedgers.length) {
      return res.status(404).json({
        success: false,
        message: `No ledgers found under "${normalizeTallyParentName(parentGroup)}". Run desktop-agent sync.`
      });
    }

    const totals = sumLedgerDebitCredit(resolved.ledgers);

    return res.status(200).json({
      success: true,
      data: {
        parentGroup: resolved.groupName || parentGroup,
        debit: totals.debit,
        credit: totals.credit,
        ledgers: resolved.ledgers
      }
    });
  } catch (error) {
    logger.error('Cash/Bank Book ledgers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading Cash/Bank Book ledgers'
    });
  }
};

// @desc    Cash/Bank Book — receipt/payment/contra vouchers for a ledger
// @route   GET /api/reports/cash-bank-book/vouchers
export const getCashBankBookVouchers = async (req, res) => {
  try {
    const companyId = req.query?.companyId;
    const periodKey = normalizePeriodKey(req.query?.periodKey || 'this_month');
    const ledgerName = String(req.query?.ledgerName || '').trim();

    if (!companyId || !ledgerName) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and ledgerName are required'
      });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const company = await Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const range = resolveBalanceSheetVoucherRange(periodKey, company);
    const vouchers = await queryVouchersForLedger(
      companyOid,
      ledgerName,
      range.fromDate,
      range.toDate,
      CASH_BANK_VOUCHER_TYPES
    );

    return res.status(200).json({
      success: true,
      data: {
        ledgerName,
        period: {
          periodKey: range.periodKey,
          label: range.label,
          startDate: range.fromDate.toISOString(),
          endDate: range.toDate.toISOString(),
          asOfDate: range.asOfDate.toISOString()
        },
        count: vouchers.length,
        vouchers: mapVoucherRowsForApi(vouchers)
      }
    });
  } catch (error) {
    logger.error('Cash/Bank Book vouchers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading Cash/Bank Book vouchers'
    });
  }
};
