import mongoose from 'mongoose';
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
  PERIOD_LABELS
} from '../utils/reportPeriods.js';
import logger from '../utils/logger.js';
import moment from 'moment';

const TOP_LIMIT = 10;

/** Orders do not post to P&L / Balance Sheet — exclude from report voucher drill-down. */
const REPORT_DRILLDOWN_EXCLUDED_VOUCHER_TYPES = ['sales_order', 'purchase_order'];

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
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
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
      $match: {
        company: companyOid,
        voucherType,
        date: { $gte: start, $lte: end }
      }
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
      $match: {
        company: companyOid,
        voucherType,
        date: { $gte: start, $lte: end }
      }
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
      $match: {
        company: companyOid,
        voucherType,
        date: { $gte: start, $lte: end },
        'items.0': { $exists: true }
      }
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
      $match: {
        company: companyOid,
        voucherType,
        date: { $gte: start, $lte: end },
        'items.0': { $exists: true }
      }
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

    const row = { account: label, amount: Math.abs(amount) };
    const section = classifyBalanceSheetGroup(label);

    if (entry.isGroup && Math.abs(mainAmount) > 0) {
      const synced = groupSummaries.find(
        (g) => String(g.groupName).trim().toLowerCase() === label.trim().toLowerCase()
      );
      groups.push({
        name: label,
        amount: Math.abs(mainAmount),
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
const queryVouchersForLedger = async (companyOid, ledgerName, fromDate, toDate) => {
  const ledgerRegex = new RegExp(`^${ledgerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const dateFilter = {
    company: companyOid,
    date: { $gte: fromDate, $lte: toDate }
  };
  const ledgerMatch = {
    ledgerEntries: { $elemMatch: { ledger: ledgerRegex } }
  };

  let vouchers = await Voucher.find({
    ...dateFilter,
    ...ledgerMatch,
    voucherType: { $nin: REPORT_DRILLDOWN_EXCLUDED_VOUCHER_TYPES }
  })
    .select('voucherNumber voucherType date partyName totals.grandTotal narration')
    .sort({ date: -1 })
    .limit(500)
    .lean();

  const detailRows = await VoucherDetail.find({
    company: companyOid,
    ledgerEntries: { $elemMatch: { ledger: ledgerRegex } }
  })
    .select('voucherId')
    .lean();

  const seenIds = new Set(vouchers.map((v) => String(v._id)));
  const extraIds = detailRows
    .map((d) => d.voucherId)
    .filter((id) => id && !seenIds.has(String(id)));

  if (extraIds.length > 0) {
    const extra = await Voucher.find({
      ...dateFilter,
      _id: { $in: extraIds },
      voucherType: { $nin: REPORT_DRILLDOWN_EXCLUDED_VOUCHER_TYPES }
    })
      .select('voucherNumber voucherType date partyName totals.grandTotal narration')
      .lean();
    for (const row of extra) {
      if (!seenIds.has(String(row._id))) {
        vouchers.push(row);
        seenIds.add(String(row._id));
      }
    }
    vouchers.sort((a, b) => new Date(b.date) - new Date(a.date));
    vouchers = vouchers.slice(0, 500);
  }

  return vouchers;
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

    const cashVouchers = await Voucher.find({
      company: companyId,
      voucherType: { $in: ['receipt', 'payment', 'contra'] },
      date: { $gte: start, $lte: end }
    });

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

    const salesVouchers = await Voucher.find({
      company: companyId,
      voucherType: 'sales',
      date: { $gte: start, $lte: end }
    }).populate('party', 'name');

    const totalSales = salesVouchers.reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);
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
      salesByPeriod[key].amount += v.totals?.grandTotal || 0;
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
        customerSales[customerId].totalAmount += v.totals?.grandTotal || 0;
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

    const purchaseVouchers = await Voucher.find({
      company: companyId,
      voucherType: 'purchase',
      date: { $gte: start, $lte: end }
    }).populate('party', 'name');

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
export const getDashboardSummary = async (req, res) => {
  try {
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    // This month's data
    const thisMonthVouchers = await Voucher.find({
      company: companyId,
      date: { $gte: startOfMonth }
    });

    const monthSales = thisMonthVouchers
      .filter(v => v.voucherType === 'sales')
      .reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    const monthPurchases = thisMonthVouchers
      .filter(v => v.voucherType === 'purchase')
      .reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    // Year to date
    const ytdVouchers = await Voucher.find({
      company: companyId,
      date: { $gte: startOfYear }
    });

    const ytdSales = ytdVouchers
      .filter(v => v.voucherType === 'sales')
      .reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    const ytdPurchases = ytdVouchers
      .filter(v => v.voucherType === 'purchase')
      .reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    // Outstanding
    const outstandingReceivables = await Voucher.find({
      company: companyId,
      voucherType: 'sales',
      isPaid: false
    });

    const outstandingPayables = await Voucher.find({
      company: companyId,
      voucherType: 'purchase',
      isPaid: false
    });

    const totalReceivables = outstandingReceivables.reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);
    const totalPayables = outstandingPayables.reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        thisMonth: {
          sales: monthSales,
          purchases: monthPurchases,
          profit: monthSales - monthPurchases
        },
        yearToDate: {
          sales: ytdSales,
          purchases: ytdPurchases,
          profit: ytdSales - ytdPurchases
        },
        outstanding: {
          receivables: totalReceivables,
          payables: totalPayables,
          net: totalReceivables - totalPayables
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

    const parseYmd = (ymd, endOfDay = false) => {
      const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) {
        const d = new Date(ymd);
        if (endOfDay) d.setHours(23, 59, 59, 999);
        else d.setHours(0, 0, 0, 0);
        return d;
      }
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (endOfDay) d.setHours(23, 59, 59, 999);
      else d.setHours(0, 0, 0, 0);
      return d;
    };

    const startDate = fromDate ? parseYmd(fromDate, false) : parseYmd(new Date(), false);
    const endDate = toDate ? parseYmd(toDate, true) : parseYmd(new Date(), true);

    // Get all vouchers for the date range
    const vouchers = await Voucher.find({
      company: companyId,
      date: { $gte: startDate, $lte: endDate }
    })
    .populate('party', 'name displayName')
    .sort({ date: 1, createdAt: 1 });

    // Format daybook entries
    const dayBookEntries = vouchers.map(voucher => {
      let amount = 0;
      let type = 'debit';

      // Determine amount and type based on voucher type
      switch (voucher.voucherType) {
        case 'sales':
        case 'receipt':
          amount = voucher.totals?.grandTotal || 0;
          type = 'credit'; // Money coming in
          break;
        case 'purchase':
        case 'payment':
          amount = voucher.totals?.grandTotal || 0;
          type = 'debit'; // Money going out
          break;
        case 'journal':
        case 'contra':
        case 'debit_note':
        case 'credit_note':
          // For these, we need to determine based on the actual transaction
          amount = voucher.totals?.grandTotal || 0;
          type = voucher.amount > 0 ? 'credit' : 'debit';
          break;
        default:
          amount = voucher.totals?.grandTotal || 0;
          type = 'debit';
      }

      return {
        id: voucher._id.toString(),
        voucherId: voucher._id.toString(),
        date: voucher.date.toISOString().split('T')[0],
        voucherType: voucher.voucherType,
        voucherNumber: voucher.voucherNumber,
        partyName: voucher.party?.name || voucher.party?.displayName || 'N/A',
        amount: Math.abs(amount),
        type,
        narration: voucher.narration || ''
      };
    });

    // Calculate totals
    const totals = dayBookEntries.reduce(
      (acc, entry) => {
        if (entry.type === 'debit') {
          acc.totalDebit += entry.amount;
        } else {
          acc.totalCredit += entry.amount;
        }
        return acc;
      },
      { totalDebit: 0, totalCredit: 0 }
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
          transactionCount: dayBookEntries.length
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
export const getOutstandingReceivable = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body?.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId is required' });
    }

    const doc = await OutstandingReceivable.findOne({
      company: companyId,
      reportName: 'Bills Receivable'
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
    logger.error('Outstanding receivable list error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while loading outstanding receivable'
    });
  }
};

// @desc    Outstanding receivable — bills for one ledger/party
// @route   GET /api/reports/outstanding-receivable/ledger
export const getOutstandingReceivableLedger = async (req, res) => {
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
      reportName: 'Bills Receivable'
    }).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Outstanding receivable data not found. Run desktop sync first.'
      });
    }

    const ledger = (doc.ledgers || []).find(
      (l) => String(l.partyName).trim().toLowerCase() === String(partyName).trim().toLowerCase()
    );

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: 'Ledger not found in outstanding receivable report'
      });
    }

    const normalizeVoucherNumber = (v) => String(v || '').trim();
    const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const bills = Array.isArray(ledger.bills) ? ledger.bills : [];
    const voucherLookups = bills
      .map((b) => ({
        vchNumber: normalizeVoucherNumber(b?.vchNumber),
        vchType: String(b?.vchType || '').trim(),
        vchDate: b?.vchDate ? new Date(b.vchDate) : null
      }))
      .filter((x) => x.vchNumber);

    // Batch-resolve voucher IDs for drill-down to VoucherDetailScreen.
    const orClauses = voucherLookups.map((x) => {
      const voucherType = normalizeVoucherTypeSlug('', x.vchType, x.vchType);
      const clause = {
        company: toObjectId(companyId),
        voucherType,
        voucherNumber: { $regex: new RegExp(`^${escapeRegex(x.vchNumber)}$`, 'i') }
      };
      if (x.vchDate && !Number.isNaN(x.vchDate.getTime())) {
        // Match within the same calendar day (Tally dates are day-granular).
        const start = new Date(x.vchDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(x.vchDate);
        end.setHours(23, 59, 59, 999);
        clause.date = { $gte: start, $lte: end };
      }
      return clause;
    });

    const voucherIdByKey = new Map();
    if (orClauses.length > 0) {
      const matches = await Voucher.find({ $or: orClauses })
        .select('_id voucherNumber voucherType date')
        .lean();

      for (const v of matches) {
        const key = `${String(v.voucherType)}::${String(v.voucherNumber).trim().toLowerCase()}`;
        if (!voucherIdByKey.has(key)) {
          voucherIdByKey.set(key, v._id.toString());
        }
      }
    }

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
          const vchNumber = normalizeVoucherNumber(b?.vchNumber);
          const vchType = String(b?.vchType || '').trim();
          const voucherType = normalizeVoucherTypeSlug('', vchType, vchType);
          const key = `${voucherType}::${vchNumber.toLowerCase()}`;
          return {
            ...b,
            voucherId: voucherIdByKey.get(key) || null
          };
        })
      }
    });
  } catch (error) {
    logger.error('Outstanding receivable ledger error:', error);
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
    const { companyId, startDate, endDate } = req.query;

    if (!companyId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Company ID, start date, and end date are required'
      });
    }

    const companyOid = toObjectId(companyId);
    if (!companyOid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid company ID'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

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
        period: { startDate, endDate },
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

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
      $match: {
        company: companyOid,
        ...INACTIVE_SALES_MATCH,
        date: { $exists: true, $ne: null }
      }
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
      $match: {
        company: companyOid,
        ...INACTIVE_SALES_MATCH,
        date: { $exists: true, $ne: null }
      }
    },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'items',
        localField: 'items.item',
        foreignField: '_id',
        as: 'itemDoc'
      }
    },
    {
      $addFields: {
        resolvedItemName: {
          $trim: {
            input: {
              $cond: [
                { $gt: [{ $size: '$itemDoc' }, 0] },
                { $arrayElemAt: ['$itemDoc.name', 0] },
                { $ifNull: ['$items.itemName', { $ifNull: ['$items.description', ''] }] }
              ]
            }
          }
        }
      }
    },
    { $match: { resolvedItemName: { $nin: ['', null] } } },
    {
      $group: {
        _id: { itemId: '$items.item', nameKey: { $toLower: '$resolvedItemName' } },
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
  const q = Number(qty || 0);
  const rate = Number(
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
    const today = startOfDay(new Date());
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

    const lastSaleMap = new Map(
      lastSales.map((r) => [String(r.name).trim().toLowerCase(), r])
    );

    const customerNames = new Set();
    partyDocs.forEach((p) => customerNames.add((p.displayName || p.name || '').trim()));
    salesNameRows.forEach((n) => {
      if (n && String(n).trim()) customerNames.add(String(n).trim());
    });

    const totalCustomers = customerNames.size;
    const rows = [];

    for (const name of customerNames) {
      if (!name) continue;
      const key = name.toLowerCase();
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

      rows.push({
        name,
        lastSaleDate: lastSaleDate ? lastSaleDate.toISOString() : null,
        lastSaleDateDisplay: formatTallyDisplayDate(lastSaleDate),
        billCount: sale?.billCount || 0
      });
    }

    rows.sort((a, b) => {
      if (!a.lastSaleDate && !b.lastSaleDate) return a.name.localeCompare(b.name);
      if (!a.lastSaleDate) return -1;
      if (!b.lastSaleDate) return 1;
      return new Date(a.lastSaleDate).getTime() - new Date(b.lastSaleDate).getTime();
    });

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
    const today = startOfDay(new Date());
    const cutoff =
      inactive.mode === 'days'
        ? startOfDay(new Date(today.getTime() - inactive.days * 86400000))
        : null;

    const [lastSold, itemDocs] = await Promise.all([
      aggregateLastSaleByItem(companyOid),
      Item.find({ company: companyOid, type: 'product' }).lean()
    ]);

    const lastSaleMap = new Map(
      lastSold.map((r) => [String(r.name).trim().toLowerCase(), r])
    );

    const itemByName = new Map();
    itemDocs.forEach((item) => {
      const label = (item.displayName || item.name || '').trim();
      if (label) itemByName.set(label.toLowerCase(), item);
    });

    lastSold.forEach((r) => {
      const label = String(r.name || '').trim();
      if (label && !itemByName.has(label.toLowerCase())) {
        itemByName.set(label.toLowerCase(), { name: label, displayName: label });
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

    rows.sort((a, b) => {
      if (!a.lastSaleDate && !b.lastSaleDate) return a.name.localeCompare(b.name);
      if (!a.lastSaleDate) return -1;
      if (!b.lastSaleDate) return 1;
      return new Date(a.lastSaleDate).getTime() - new Date(b.lastSaleDate).getTime();
    });

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
