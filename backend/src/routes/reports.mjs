import express from 'express';
import { protect, checkCompanyAccess } from '../middleware/auth.js';
import { requireActiveSubscription } from '../middleware/license.js';
import {
  getProfitLossReport,
  getBalanceSheet,
  getCashFlowReport,
  getSalesReport,
  getPurchaseReport,
  getBudgetVsActualReport,
  getDashboardSummary,
  getDayBook,
  getOutstandingReceivable,
  getOutstandingReceivableLedger,
  getOutstandingPayable,
  getOutstandingPayableLedger,
  getTop10Report,
  getFastMovingItemsReport,
  getInactiveCustomersReport,
  getInactiveItemsReport,
  getProfitLossGroupLedgers,
  getProfitLossVouchers,
  getBalanceSheetGroupLedgers,
  getBalanceSheetVouchers,
  getCashBankBook,
  getCashBankBookLedgers,
  getCashBankBookVouchers
} from '../controllers/reportController.mjs';

const router = express.Router();

router.use(protect, requireActiveSubscription);

// @desc    Get Dashboard Summary
// @route   GET /api/reports/dashboard
// @access  Private
router.get('/dashboard', checkCompanyAccess, getDashboardSummary);

// @desc    Get Profit & Loss Report
// @route   GET /api/reports/profit-loss
// @access  Private
router.get('/profit-loss', checkCompanyAccess, getProfitLossReport);
router.post('/profit-loss', checkCompanyAccess, getProfitLossReport);
router.get('/profit-loss/group-ledgers', checkCompanyAccess, getProfitLossGroupLedgers);
router.get('/profit-loss/vouchers', checkCompanyAccess, getProfitLossVouchers);

// @desc    Get Balance Sheet
// @route   GET /api/reports/balance-sheet
// @access  Private
router.get('/balance-sheet', checkCompanyAccess, getBalanceSheet);
router.get('/balance-sheet/group-ledgers', checkCompanyAccess, getBalanceSheetGroupLedgers);
router.get('/balance-sheet/vouchers', checkCompanyAccess, getBalanceSheetVouchers);

// @desc    Cash/Bank Book (Tally-style cash and bank summary)
router.get('/cash-bank-book', checkCompanyAccess, getCashBankBook);
router.get('/cash-bank-book/ledgers', checkCompanyAccess, getCashBankBookLedgers);
router.get('/cash-bank-book/vouchers', checkCompanyAccess, getCashBankBookVouchers);

// @desc    Get Cash Flow Statement
// @route   GET /api/reports/cash-flow
// @access  Private
router.get('/cash-flow', checkCompanyAccess, getCashFlowReport);

// @desc    Get Sales Report
// @route   GET /api/reports/sales
// @access  Private
router.get('/sales', checkCompanyAccess, getSalesReport);

// @desc    Get Purchase Report
// @route   GET /api/reports/purchase
// @access  Private
router.get('/purchase', checkCompanyAccess, getPurchaseReport);

// @desc    Get Budget vs Actual Report
// @route   GET /api/reports/budget-vs-actual
// @access  Private
router.get('/budget-vs-actual', checkCompanyAccess, getBudgetVsActualReport);

// @desc    Get DayBook Report
// @route   GET /api/reports/daybook
// @access  Private
router.get('/daybook', checkCompanyAccess, getDayBook);

// @desc    Top 10 rankings report
// @route   GET /api/reports/top-10
router.get('/top-10', checkCompanyAccess, getTop10Report);

// @desc    Fast moving items — best-selling stock items by qty sold
// @route   GET /api/reports/fast-moving-items
// @access  Private
router.get('/fast-moving-items', checkCompanyAccess, getFastMovingItemsReport);

// @desc    Inactive customers / items (days since last sale)
router.get('/inactive-customers', checkCompanyAccess, getInactiveCustomersReport);
router.get('/inactive-items', checkCompanyAccess, getInactiveItemsReport);

// @desc    Outstanding receivable — ledger list
// @route   GET /api/reports/outstanding-receivable
router.get('/outstanding-receivable', checkCompanyAccess, getOutstandingReceivable);

// @desc    Outstanding receivable — single ledger bills
// @route   GET /api/reports/outstanding-receivable/ledger
router.get('/outstanding-receivable/ledger', checkCompanyAccess, getOutstandingReceivableLedger);

// @desc    Outstanding payable — ledger list
// @route   GET /api/reports/outstanding-payable
router.get('/outstanding-payable', checkCompanyAccess, getOutstandingPayable);

// @desc    Outstanding payable — single ledger bills
// @route   GET /api/reports/outstanding-payable/ledger
router.get('/outstanding-payable/ledger', checkCompanyAccess, getOutstandingPayableLedger);

// Legacy endpoint
router.get('/', checkCompanyAccess, async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Reports API is ready. Available reports: /dashboard, /profit-loss, /balance-sheet, /cash-flow, /sales, /purchase, /budget-vs-actual'
  });
});

export default router;
