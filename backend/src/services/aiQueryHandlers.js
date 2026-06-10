import Voucher from '../models/Voucher.js';
import OutstandingReceivable from '../models/OutstandingReceivable.js';
import ProfitLossReport from '../models/ProfitLossReport.js';

// Helper to ensure we never send huge lists to the LLM
const trimList = (list, max = 10) => list.slice(0, max);

export const handleSalesToday = async (companyId) => {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  const vouchers = await Voucher.find({
    company: companyId,
    voucherType: 'sales',
    date: { $gte: start, $lte: end }
  }).select({ totals: 1 }).lean();

  const totalSales = vouchers.reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

  return {
    intent: 'sales_today',
    summary: {
      date: start.toISOString().split('T')[0],
      totalSales,
      invoiceCount: vouchers.length
    }
  };
};

export const handleSalesRange = async (companyId, params) => {
  const startDate = params?.startDate;
  const endDate = params?.endDate;

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);

  const vouchers = await Voucher.find({
    company: companyId,
    voucherType: 'sales',
    date: { $gte: start, $lte: end }
  }).select({ totals: 1 }).lean();

  const totalSales = vouchers.reduce((sum, v) => sum + (v.totals?.grandTotal || 0), 0);

  return {
    intent: 'sales_range',
    summary: {
      startDate,
      endDate,
      totalSales,
      invoiceCount: vouchers.length
    }
  };
};

export const handleOutstandingTopCustomers = async (companyId) => {
  const doc = await OutstandingReceivable.findOne({
    company: companyId,
    reportName: 'Bills Receivable'
  }).lean();

  if (!doc) {
    return {
      intent: 'outstanding_top_customers',
      summary: {
        asOfDate: null,
        totalOutstanding: 0,
        topCustomers: []
      }
    };
  }

  const sortedLedgers = [...(doc.ledgers || [])].sort(
    (a, b) => (b.totalOutstanding || 0) - (a.totalOutstanding || 0)
  );

  const topCustomers = trimList(sortedLedgers, 10).map((l) => ({
    customer: l.partyName,
    outstanding: l.totalOutstanding,
    billCount: l.billCount,
    oldestOverdueDays: l.oldestOverdueDays
  }));

  return {
    intent: 'outstanding_top_customers',
    summary: {
      asOfDate: doc.asOfDate,
      totalOutstanding: doc.totalOutstanding,
      topCustomers
    }
  };
};

export const handleProfitThisMonth = async (companyId) => {
  const doc = await ProfitLossReport.findOne({
    company: companyId,
    reportName: 'Profit & Loss',
    periodKey: 'this_month'
  }).lean();

  if (!doc) {
    return {
      intent: 'profit_this_month',
      summary: {
        periodKey: 'this_month',
        hasReport: false
      }
    };
  }

  const totalRevenue = (doc.entries || [])
    .filter((e) => /sales|revenue/i.test(e.name || e.displayName || ''))
    .reduce((sum, e) => sum + (e.mainAmount || 0), 0);

  const totalExpenses = (doc.entries || [])
    .filter((e) => /expense|purchase|cost of goods/i.test(e.name || e.displayName || ''))
    .reduce((sum, e) => sum + (e.mainAmount || 0), 0);

  const netProfit = (doc.totals?.grandTotal != null)
    ? doc.totals.grandTotal
    : totalRevenue - totalExpenses;

  return {
    intent: 'profit_this_month',
    summary: {
      periodKey: 'this_month',
      hasReport: true,
      fromDate: doc.fromDate,
      toDate: doc.toDate,
      totalRevenue,
      totalExpenses,
      netProfit
    }
  };
};

export const handleExpensesTrend = async (companyId) => {
  // Very lightweight heuristic: look at last 60 days of vouchers and aggregate debit entries
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 60);

  const vouchers = await Voucher.find({
    company: companyId,
    date: { $gte: start, $lte: today }
  }).select({ date: 1, ledgerEntries: 1 }).lean();

  const byMonth = {};

  vouchers.forEach((v) => {
    const monthKey = `${v.date.getFullYear()}-${String(v.date.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[monthKey]) {
      byMonth[monthKey] = {};
    }
    (v.ledgerEntries || []).forEach((le) => {
      const name = (le.ledger || '').toString();
      if (!/expense|rent|salary|wages|electricity|fuel|maintenance|advertising/i.test(name)) {
        return;
      }
      byMonth[monthKey][name] = (byMonth[monthKey][name] || 0) + (le.debit || 0);
    });
  });

  const months = Object.keys(byMonth).sort();
  const trend = months.map((m) => {
    const ledgers = Object.entries(byMonth[m])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ledger, amount]) => ({ ledger, amount }));
    const total = ledgers.reduce((sum, l) => sum + l.amount, 0);
    return { month: m, totalExpenses: total, topExpenseLedgers: ledgers };
  });

  return {
    intent: 'expenses_trend',
    summary: {
      windowDays: 60,
      months: trend
    }
  };
};

