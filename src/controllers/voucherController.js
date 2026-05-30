import Voucher from '../models/Voucher.js';
import VoucherDetail from '../models/VoucherDetail.js';
import Party from '../models/Party.js';
import tallyWebSocketService from '../services/tallyWebSocketService.js';
import {
  buildSalesImportPayload,
  buildVoucherImportPayload
} from '../utils/tallyVoucherImportPayload.js';
import { supportsTallyImport } from '../utils/tallyVoucherImportTypes.js';
import Item from '../models/Item.js';
import Company from '../models/Company.js';
import { validationResult } from 'express-validator';
import logger from '../utils/logger.js';
import PDFService from '../services/pdfService.js';
import moment from 'moment';

async function pushVoucherToTallyWithResult(voucher, company, body, extraLedgerEntries = []) {
  if (!supportsTallyImport(voucher.voucherType)) {
    return {
      status: 'skipped',
      message: `Tally import not enabled for ${voucher.voucherType}`
    };
  }

  try {
    const importPayload = buildVoucherImportPayload(voucher, company, {
      salesLedgerName: body.salesLedgerName,
      purchaseLedgerName: body.purchaseLedgerName,
      voucherTypeName: body.tallyVoucherTypeName || voucher.tallyVoucherTypeName,
      isOptional: body.isOptional,
      placeOfSupply: body.placeOfSupply,
      partyLedgerName: body.partyName || body.partyLedgerName,
      partyGstin: body.partyGstin,
      companyName: body.tallyCompanyName,
      bankLedgerName: body.bankLedgerName || voucher.payment?.bank,
      paymentMode: body.paymentMode || voucher.payment?.method,
      billName: body.billName || body.billReference,
      extraLedgerEntries,
      ledgerEntries: body.ledgerEntries || body.entries
    });

    const importResult = await tallyWebSocketService.pushVoucherToTally(
      company,
      importPayload,
      { voucherId: voucher._id.toString() }
    );

    await Voucher.findByIdAndUpdate(voucher._id, {
      'tallySync.synced': true,
      'tallySync.tallyId': importResult.tallyGuid || voucher.tallySync?.tallyId,
      'tallySync.lastSyncDate': new Date(),
      'tallySync.syncError': ''
    });

    return {
      status: importResult.alreadyExisted ? 'already_synced' : 'completed',
      tallyGuid: importResult.tallyGuid,
      voucherNumber: importResult.voucherNumber || voucher.voucherNumber
    };
  } catch (pushError) {
    logger.warn('Voucher saved but Tally import failed', {
      voucherId: voucher._id,
      voucherType: voucher.voucherType,
      error: pushError.message
    });
    await Voucher.findByIdAndUpdate(voucher._id, {
      'tallySync.synced': false,
      'tallySync.syncError': pushError.message
    });
    return { status: 'failed', message: pushError.message };
  }
}

// @desc    Get all vouchers
// @route   GET /api/vouchers
// @access  Private
export const getVouchers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      voucherType,
      status,
      party,
      fromDate,
      toDate,
      search
    } = req.query;

    const query = { company: req.company._id };

    // Add filters
    if (voucherType) query.voucherType = voucherType;
    if (status) query.status = status;
    if (party) query.party = party;
    
    if (fromDate || toDate) {
      query.date = {};
      const parseRangeDate = (value, endOfDay = false) => {
        const raw = String(value).trim();
        const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (ymd) {
          const dt = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
          if (endOfDay) dt.setHours(23, 59, 59, 999);
          else dt.setHours(0, 0, 0, 0);
          return dt;
        }
        const dt = new Date(raw);
        if (!Number.isNaN(dt.getTime()) && endOfDay) {
          dt.setHours(23, 59, 59, 999);
        }
        return dt;
      };
      if (fromDate) query.date.$gte = parseRangeDate(fromDate, false);
      if (toDate) query.date.$lte = parseRangeDate(toDate, true);
    }

    if (search) {
      query.$or = [
        { voucherNumber: { $regex: search, $options: 'i' } },
        { narration: { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { date: -1, createdAt: -1 },
      populate: [
        { path: 'party', select: 'name displayName type gstin' },
        { path: 'createdBy', select: 'name email' },
        { path: 'updatedBy', select: 'name email' }
      ]
    };

    const vouchers = await Voucher.paginate(query, options);

    res.status(200).json({
      success: true,
      data: vouchers
    });
  } catch (error) {
    logger.error('Get vouchers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get voucher statistics (aggregated)
// @route   GET /api/vouchers/stats
// @access  Private
export const getVoucherStats = async (req, res) => {
  try {
    const companyId = req.company._id;
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const sumAbsAmount = {
      $sum: {
        $abs: { $ifNull: ['$totals.grandTotal', '$amount', 0] },
      },
    };

    const [
      total,
      byTypeRows,
      byStatusRows,
      thisMonthAgg,
      lastMonthAgg,
      amountAgg,
      salesThisMonthAgg,
      purchasesThisMonthAgg,
    ] = await Promise.all([
        Voucher.countDocuments({ company: companyId }),
        Voucher.aggregate([
          { $match: { company: companyId } },
          { $group: { _id: '$voucherType', count: { $sum: 1 } } },
        ]),
        Voucher.aggregate([
          { $match: { company: companyId } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Voucher.aggregate([
          {
            $match: {
              company: companyId,
              date: { $gte: startOfThisMonth },
            },
          },
          {
            $group: {
              _id: null,
              amount: sumAbsAmount,
            },
          },
        ]),
        Voucher.aggregate([
          {
            $match: {
              company: companyId,
              date: { $gte: startOfLastMonth, $lte: endOfLastMonth },
            },
          },
          {
            $group: {
              _id: null,
              amount: sumAbsAmount,
            },
          },
        ]),
        Voucher.aggregate([
          { $match: { company: companyId } },
          {
            $group: {
              _id: null,
              totalAmount: sumAbsAmount,
            },
          },
        ]),
        Voucher.aggregate([
          {
            $match: {
              company: companyId,
              voucherType: 'sales',
              date: { $gte: startOfThisMonth },
            },
          },
          { $group: { _id: null, amount: sumAbsAmount } },
        ]),
        Voucher.aggregate([
          {
            $match: {
              company: companyId,
              voucherType: 'purchase',
              date: { $gte: startOfThisMonth },
            },
          },
          { $group: { _id: null, amount: sumAbsAmount } },
        ]),
      ]);

    const byType = {};
    for (const row of byTypeRows) {
      if (row._id) byType[row._id] = row.count;
    }

    const byStatus = {};
    for (const row of byStatusRows) {
      if (row._id) byStatus[row._id] = row.count;
    }

    res.status(200).json({
      success: true,
      data: {
        total,
        byType,
        byStatus,
        totalAmount: amountAgg[0]?.totalAmount ?? 0,
        thisMonth: thisMonthAgg[0]?.amount ?? 0,
        lastMonth: lastMonthAgg[0]?.amount ?? 0,
        salesThisMonth: salesThisMonthAgg[0]?.amount ?? 0,
        purchasesThisMonth: purchasesThisMonthAgg[0]?.amount ?? 0,
      },
    });
  } catch (error) {
    logger.error('Get voucher stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

// @desc    Get single voucher
// @route   GET /api/vouchers/:id
// @access  Private
export const getVoucher = async (req, res) => {
  try {
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      company: req.company._id
    })
    .populate('party', 'name displayName type gstin contact addresses')
    .populate('items.item', 'name displayName code units pricing taxation')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('workflow.approvedBy', 'name email')
    .populate('workflow.rejectedBy', 'name email');

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    let detail = await VoucherDetail.findOne({ voucherId: voucher._id });
    if (detail) {
      detail.lastAccessedAt = new Date();
      await detail.save();
    }

    const hasEmbeddedLines =
      (Array.isArray(voucher.items) && voucher.items.length > 0) ||
      (Array.isArray(voucher.ledgerEntries) && voucher.ledgerEntries.length > 0);

    const responsePayload = voucher.toObject ? voucher.toObject() : voucher;
    if (detail) {
      responsePayload.items = detail.items?.length ? detail.items : responsePayload.items;
      responsePayload.ledgerEntries = detail.ledgerEntries?.length
        ? detail.ledgerEntries
        : responsePayload.ledgerEntries;
      responsePayload.narration = detail.narration || responsePayload.narration;
      responsePayload.shipping = detail.shipping || responsePayload.shipping;
      responsePayload.detailCached = true;
    } else {
      responsePayload.detailCached = hasEmbeddedLines;
      responsePayload.isSummaryOnly = voucher.tallySync?.isSummaryOnly !== false && !hasEmbeddedLines;
    }

    res.status(200).json({
      success: true,
      data: responsePayload,
      detail: detail || null
    });
  } catch (error) {
    logger.error('Get voucher error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Push existing sales voucher to Tally via desktop agent
// @route   POST /api/vouchers/:id/push-to-tally
// @access  Private
export const pushVoucherToTally = async (req, res) => {
  try {
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      company: req.company._id
    }).populate('party', 'name displayName gstin');

    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }

    if (!supportsTallyImport(voucher.voucherType)) {
      return res.status(400).json({
        success: false,
        message: `Voucher type "${voucher.voucherType}" cannot be pushed to Tally`
      });
    }

    const isAccounting = ['receipt', 'payment', 'journal'].includes(voucher.voucherType);
    if (isAccounting) {
      if (!voucher.ledgerEntries?.length) {
        return res.status(400).json({
          success: false,
          message: 'Accounting voucher must have ledger entries'
        });
      }
    } else if (!voucher.items?.length) {
      return res.status(400).json({
        success: false,
        message: 'Item voucher must have at least one line item'
      });
    }

    if (voucher.tallySync?.synced && voucher.tallySync?.tallyId) {
      return res.status(200).json({
        success: true,
        message: 'Voucher is already synced to Tally',
        data: {
          tallyGuid: voucher.tallySync.tallyId,
          voucherNumber: voucher.voucherNumber,
          alreadyExisted: true
        }
      });
    }

    const pushBody = {
      ...req.body,
      salesLedgerName: req.body.salesLedgerName || voucher.salesLedgerName,
      purchaseLedgerName: req.body.purchaseLedgerName || voucher.purchaseLedgerName,
      tallyVoucherTypeName: req.body.tallyVoucherTypeName || voucher.tallyVoucherTypeName,
      placeOfSupply: req.body.placeOfSupply || voucher.placeOfSupply,
      partyName: req.body.partyName || voucher.partyName,
      isOptional: req.body.isOptional ?? voucher.isOptional,
      ledgerEntries: req.body.ledgerEntries || voucher.ledgerEntries
    };

    const tallyPush = await pushVoucherToTallyWithResult(
      voucher,
      req.company,
      pushBody,
      req.body.ledgerEntries || []
    );

    if (tallyPush.status === 'failed') {
      return res.status(422).json({
        success: false,
        message: tallyPush.message || 'Failed to push voucher to Tally'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Voucher imported to Tally',
      data: tallyPush
    });
  } catch (error) {
    logger.error('Push voucher to Tally error:', error);
    let status = 500;
    if (/not connected|timed out/i.test(error.message)) {
      status = 503;
    } else if (
      /already synced|does not exist|rejected|duplicate|import failed/i.test(error.message)
    ) {
      status = 422;
    }
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to push voucher to Tally'
    });
  }
};

// @desc    Hydrate voucher detail from Tally via desktop agent (lazy load)
// @route   POST /api/vouchers/:id/hydrate
// @access  Private
export const hydrateVoucherFromTally = async (req, res) => {
  try {
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      company: req.company._id
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    let detail = await VoucherDetail.findOne({ voucherId: voucher._id });
    if (detail) {
      detail.lastAccessedAt = new Date();
      await detail.save();
      return res.status(200).json({
        success: true,
        message: 'Detail already cached',
        data: { voucherId: voucher._id, detailCached: true },
        detail
      });
    }

    await tallyWebSocketService.requestVoucherHydration(req.company, voucher);

    detail = await VoucherDetail.findOne({ voucherId: voucher._id });
    const refreshed = await Voucher.findById(voucher._id)
      .populate('party', 'name displayName type gstin')
      .populate('items.item', 'name displayName code units');

    if (!detail) {
      return res.status(503).json({
        success: false,
        message: 'Detail fetch completed but cache was not saved'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Voucher detail hydrated from Tally',
      data: refreshed,
      detail
    });
  } catch (error) {
    logger.error('Hydrate voucher error:', error);
    const status = /not connected|timed out/i.test(error.message) ? 503 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to hydrate voucher'
    });
  }
};

// @desc    Create voucher
// @route   POST /api/vouchers
// @access  Private
export const createVoucher = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const itemVoucherTypes = ['sales', 'purchase', 'sales_order', 'purchase_order'];
    const isItemInvoice =
      itemVoucherTypes.includes(req.body.voucherType) &&
      Array.isArray(req.body.items) &&
      req.body.items.length > 0;

    // Extra tax/charge ledgers from mobile — used for Tally import, not stored on item invoices
    const extraLedgerEntries = isItemInvoice ? req.body.ledgerEntries || [] : [];

    const voucherNumber =
      (req.body.voucherNumber && String(req.body.voucherNumber).trim()) ||
      (await generateVoucherNumber(req.company._id, req.body.voucherType));

    const rawRef = req.body.reference;
    const refNumber =
      typeof rawRef === 'object' && rawRef !== null
        ? String(rawRef.number || '').trim()
        : rawRef != null
          ? String(rawRef).trim()
          : '';
    const isMoneyVoucher = ['receipt', 'payment'].includes(req.body.voucherType);
    const referenceForTally =
      refNumber || (isItemInvoice ? voucherNumber : '');

    const voucherData = {
      ...req.body,
      company: req.company._id,
      voucherNumber,
      createdBy: req.user.id,
      partyName: req.body.partyName || req.body.partyLedgerName || '',
      hasInventory: isItemInvoice ? true : req.body.hasInventory,
      ...(referenceForTally
        ? { reference: { number: referenceForTally } }
        : {})
    };

    if (isMoneyVoucher) {
      const bankLedger = String(req.body.bankLedgerName || '').trim();
      const payMode = String(req.body.paymentMode || '').trim().toLowerCase();
      const methodMap = {
        cash: 'cash',
        cheque: 'cheque',
        neft: 'neft',
        rtgs: 'rtgs',
        upi: 'upi',
        card: 'card',
        dd: 'dd',
        other: 'other'
      };
      voucherData.payment = {
        method: methodMap[payMode] || (bankLedger ? 'bank' : 'cash'),
        bank: bankLedger,
        transactionId: req.body.transactionId || req.body.instrumentNumber || ''
      };
    }

    if (isItemInvoice) {
      voucherData.ledgerEntries = (extraLedgerEntries || []).map((row) => ({
        ledger: row.ledger || row.ledgerName || row.name || '',
        amount: Number(row.amount || row.credit || row.debit || 0),
        credit: Number(row.credit || row.amount || 0),
        debit: Number(row.debit || 0)
      }));
    }

    if (isItemInvoice) {
      voucherData.tallyVoucherTypeName =
        req.body.tallyVoucherTypeName || voucherData.tallyVoucherTypeName;
      voucherData.salesLedgerName = req.body.salesLedgerName;
      voucherData.purchaseLedgerName = req.body.purchaseLedgerName;
    }

    // Calculate totals for item vouchers (sales, purchase, orders)
    if (isItemInvoice) {
      const calculations = calculateVoucherTotals(req.body.items || []);
      voucherData.totals = formatTotalsForSchema(calculations);
      const bodyAmount = Number(req.body.amount);
      if (bodyAmount > 0) {
        voucherData.totals.grandTotal = bodyAmount;
        voucherData.amount = bodyAmount;
      } else {
        voucherData.amount = calculations.grandTotal;
      }
    } else if (Number(req.body.amount) > 0) {
      voucherData.totals = {
        subtotal: Number(req.body.amount),
        discount: 0,
        taxableAmount: Number(req.body.amount),
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        totalTax: 0,
        roundOff: 0,
        grandTotal: Number(req.body.amount)
      };
      voucherData.amount = Number(req.body.amount);
    }

    const voucher = await Voucher.create(voucherData);

    // Update party balance if applicable
    if (voucher.party && ['sales', 'purchase', 'receipt', 'payment'].includes(voucher.voucherType)) {
      await updatePartyBalance(voucher);
    }

    // Update inventory if applicable
    if (['sales', 'purchase'].includes(voucher.voucherType) && voucher.items) {
      await updateInventory(voucher);
    }

    const populatedVoucher = await Voucher.findById(voucher._id)
      .populate('party', 'name displayName type gstin')
      .populate('items.item', 'name displayName code units')
      .populate('createdBy', 'name email');

    const shouldPushTally =
      req.body.pushToTally !== false &&
      supportsTallyImport(req.body.voucherType) &&
      (isItemInvoice ||
        ['receipt', 'payment', 'journal'].includes(req.body.voucherType));

    let tallyPush = { status: 'skipped', message: 'Tally push not requested or unsupported type' };

    if (shouldPushTally) {
      tallyPush = await pushVoucherToTallyWithResult(
        populatedVoucher,
        req.company,
        req.body,
        extraLedgerEntries
      );
    }

    res.status(201).json({
      success: true,
      data: populatedVoucher,
      tallyPush
    });
  } catch (error) {
    logger.error('Create voucher error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get voucher types
// @route   GET /api/vouchers/types
// @access  Private
export const getVoucherTypes = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body.companyId || req.params.companyId || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const voucherTypes = [
      { type: 'sales', label: 'Sales', description: 'Sales invoice / customer invoice' },
      { type: 'purchase', label: 'Purchase', description: 'Purchase invoice / supplier invoice' },
      { type: 'receipt', label: 'Receipt', description: 'Receipt voucher for collections' },
      { type: 'payment', label: 'Payment', description: 'Payment voucher for supplier payments' },
      { type: 'journal', label: 'Journal', description: 'Journal entry for general ledger adjustments' },
      { type: 'contra', label: 'Contra', description: 'Contra voucher for bank/cash transfers' },
      { type: 'debit_note', label: 'Debit Note', description: 'Debit note for returns and adjustments' },
      { type: 'credit_note', label: 'Credit Note', description: 'Credit note for returns and adjustments' },
      { type: 'sales_order', label: 'Sales Order', description: 'Sales order from Tally' },
      { type: 'purchase_order', label: 'Purchase Order', description: 'Purchase order from Tally' },
      { type: 'receipt_note', label: 'Receipt Note', description: 'Receipt note / delivery challan (not Receipt voucher)' },
      { type: 'delivery_note', label: 'Delivery Note', description: 'Delivery note from Tally' }
    ];

    res.status(200).json({
      success: true,
      data: voucherTypes
    });
  } catch (error) {
    logger.error('Get voucher types error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get next voucher number
// @route   GET /api/vouchers/next-number
// @access  Private
export const getNextVoucherNumber = async (req, res) => {
  try {
    const companyId = req.query.companyId || req.body.companyId || req.params.companyId || req.companyId;
    const type = req.query.type;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Voucher type is required'
      });
    }

    const nextNumber = await generateVoucherNumber(req.company._id, type);
    const sequence = parseInt(nextNumber.split('-').pop(), 10) || 0;

    res.status(200).json({
      success: true,
      data: {
        nextNumber,
        prefix: type.toUpperCase().substring(0, 3),
        sequence
      }
    });
  } catch (error) {
    logger.error('Get next voucher number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update voucher
// @route   PUT /api/vouchers/:id
// @access  Private
export const updateVoucher = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    let voucher = await Voucher.findOne({
      _id: req.params.id,
      company: req.company._id
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    // Check if voucher can be updated
    if (voucher.status === 'approved' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot update approved voucher'
      });
    }

    // Store original data for reversal
    const originalVoucher = voucher.toObject();

    // Update voucher data
    const updateData = {
      ...req.body,
      updatedBy: req.user.id
    };

    const updateIsItemInvoice =
      ['sales', 'purchase', 'sales_order', 'purchase_order'].includes(voucher.voucherType) &&
      Array.isArray(req.body.items) &&
      req.body.items.length > 0;

    if (updateIsItemInvoice) {
      const calculations = calculateVoucherTotals(req.body.items || []);
      updateData.totals = formatTotalsForSchema(calculations);
      if (Number(req.body.amount) > 0) {
        updateData.totals.grandTotal = Number(req.body.amount);
        updateData.amount = Number(req.body.amount);
      }
    }

    voucher = await Voucher.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('party', 'name displayName type gstin')
    .populate('items.item', 'name displayName code units')
    .populate('updatedBy', 'name email');

    // Reverse original effects and apply new ones
    if (originalVoucher.party && ['sales', 'purchase', 'receipt', 'payment'].includes(originalVoucher.voucherType)) {
      await reversePartyBalance(originalVoucher);
      await updatePartyBalance(voucher);
    }

    if (['sales', 'purchase'].includes(originalVoucher.voucherType) && originalVoucher.items) {
      await reverseInventory(originalVoucher);
      await updateInventory(voucher);
    }

    res.status(200).json({
      success: true,
      data: voucher
    });
  } catch (error) {
    logger.error('Update voucher error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Delete voucher
// @route   DELETE /api/vouchers/:id
// @access  Private
export const deleteVoucher = async (req, res) => {
  try {
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      company: req.company._id
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    // Check if voucher can be deleted
    if (voucher.status === 'approved' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete approved voucher'
      });
    }

    // Reverse effects before deletion
    if (voucher.party && ['sales', 'purchase', 'receipt', 'payment'].includes(voucher.voucherType)) {
      await reversePartyBalance(voucher);
    }

    if (['sales', 'purchase'].includes(voucher.voucherType) && voucher.items) {
      await reverseInventory(voucher);
    }

    await voucher.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Voucher deleted successfully'
    });
  } catch (error) {
    logger.error('Delete voucher error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Generate PDF for voucher
// @route   GET /api/vouchers/:id/pdf
// @access  Private
export const generateVoucherPDF = async (req, res) => {
  try {
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      company: req.company._id
    })
    .populate('party', 'name displayName type gstin contact addresses')
    .populate('items.item', 'name displayName code units pricing taxation')
    .populate('company', 'name displayName gstin addresses contact');

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    const pdfBuffer = await PDFService.generateVoucherPDF(voucher);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${voucher.formattedNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    logger.error('Generate voucher PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Helper Functions

const VOUCHER_NUMBER_PREFIX = {
  sales: 'SAL',
  purchase: 'PUR',
  sales_order: 'SO',
  purchase_order: 'PO',
  receipt: 'REC',
  payment: 'PAY',
  journal: 'JRN'
};

// Generate voucher number
const generateVoucherNumber = async (companyId, voucherType) => {
  const currentYear = new Date().getFullYear();
  const prefix =
    VOUCHER_NUMBER_PREFIX[voucherType] ||
    voucherType.toUpperCase().replace(/_/g, '').substring(0, 3);

  const lastVoucher = await Voucher.findOne({
    company: companyId,
    voucherType,
    voucherNumber: { $regex: `^${prefix}${currentYear}` }
  }).sort({ voucherNumber: -1 });

  let nextNumber = 1;
  if (lastVoucher) {
    const lastNumber = parseInt(lastVoucher.voucherNumber.split('-').pop());
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${currentYear}-${nextNumber.toString().padStart(4, '0')}`;
};

/** Map calculator output → Voucher schema totals shape */
const formatTotalsForSchema = (calculations) => {
  const taxBreakup = calculations.taxBreakup || {};
  const discount = calculations.totalDiscount ?? calculations.discount ?? 0;
  const subtotal = calculations.subtotal ?? 0;
  const totalTax = calculations.totalTax ?? 0;
  const taxableAmount = subtotal - discount;
  const grandTotal = calculations.grandTotal ?? taxableAmount + totalTax;

  return {
    subtotal,
    discount,
    taxableAmount,
    cgst: taxBreakup.cgst ?? 0,
    sgst: taxBreakup.sgst ?? 0,
    igst: taxBreakup.igst ?? 0,
    cess: taxBreakup.cess ?? 0,
    totalTax,
    roundOff: 0,
    grandTotal
  };
};

// Calculate voucher totals
const calculateVoucherTotals = (items) => {
  let subtotal = 0;
  let totalTax = 0;
  let totalDiscount = 0;

  items.forEach(item => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.rate) || 0;
    const itemTotal =
      Number(item.amount) > 0 ? Number(item.amount) : qty * rate;
    const discountPct =
      item.discountPercentage ??
      item.discount?.percentage ??
      0;
    const itemDiscount = (itemTotal * discountPct) / 100;
    const itemTaxableAmount = itemTotal - itemDiscount;

    const gst = item.gst || {};
    const cgst = (itemTaxableAmount * (item.cgst ?? gst.cgst ?? 0)) / 100;
    const sgst = (itemTaxableAmount * (item.sgst ?? gst.sgst ?? 0)) / 100;
    const igst = (itemTaxableAmount * (item.igst ?? gst.igst ?? item.taxPercent ?? 0)) / 100;
    const cess = (itemTaxableAmount * (item.cess ?? gst.cess ?? 0)) / 100;

    const itemTax = cgst + sgst + igst + cess;

    subtotal += itemTotal;
    totalDiscount += itemDiscount;
    totalTax += itemTax;
  });

  const grandTotal = subtotal - totalDiscount + totalTax;

  return {
    subtotal,
    totalDiscount,
    totalTax,
    grandTotal,
    taxBreakup: {
      cgst: items.reduce((sum, item) => {
        const gst = item.gst || {};
        const taxable = item.quantity * item.rate * (1 - (item.discountPercentage ?? item.discount?.percentage ?? 0) / 100);
        return sum + (taxable * (item.cgst ?? gst.cgst ?? 0)) / 100;
      }, 0),
      sgst: items.reduce((sum, item) => {
        const gst = item.gst || {};
        const taxable = item.quantity * item.rate * (1 - (item.discountPercentage ?? item.discount?.percentage ?? 0) / 100);
        return sum + (taxable * (item.sgst ?? gst.sgst ?? 0)) / 100;
      }, 0),
      igst: items.reduce((sum, item) => {
        const gst = item.gst || {};
        const taxable = item.quantity * item.rate * (1 - (item.discountPercentage ?? item.discount?.percentage ?? 0) / 100);
        return sum + (taxable * (item.igst ?? gst.igst ?? item.taxPercent ?? 0)) / 100;
      }, 0),
      cess: items.reduce((sum, item) => {
        const gst = item.gst || {};
        const taxable = item.quantity * item.rate * (1 - (item.discountPercentage ?? item.discount?.percentage ?? 0) / 100);
        return sum + (taxable * (item.cess ?? gst.cess ?? 0)) / 100;
      }, 0)
    }
  };
};

// Update party balance
const updatePartyBalance = async (voucher) => {
  if (!voucher.party) return;

  const party = await Party.findById(voucher.party);
  if (!party) return;

  if (!party.balances?.current) {
    party.balances = party.balances || {};
    party.balances.current = { amount: 0, type: 'debit', lastUpdated: new Date() };
  }

  let balanceChange = 0;
  let balanceType = 'debit';

  switch (voucher.voucherType) {
    case 'sales':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'debit'; // Customer owes us
      break;
    case 'purchase':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'credit'; // We owe supplier
      break;
    case 'receipt':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'credit'; // Reduce customer balance
      break;
    case 'payment':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'debit'; // Reduce supplier balance
      break;
  }

  // Update party balance
  if (party.balances.current.type === balanceType) {
    party.balances.current.amount += balanceChange;
  } else {
    if (party.balances.current.amount >= balanceChange) {
      party.balances.current.amount -= balanceChange;
    } else {
      party.balances.current.amount = balanceChange - party.balances.current.amount;
      party.balances.current.type = balanceType;
    }
  }

  party.balances.current.lastUpdated = new Date();
  await party.save();
};

// Reverse party balance
const reversePartyBalance = async (voucher) => {
  if (!voucher.party) return;

  const party = await Party.findById(voucher.party);
  if (!party) return;

  if (!party.balances?.current) {
    return;
  }

  let balanceChange = 0;
  let balanceType = 'debit';

  switch (voucher.voucherType) {
    case 'sales':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'credit'; // Reverse debit
      break;
    case 'purchase':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'debit'; // Reverse credit
      break;
    case 'receipt':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'debit'; // Reverse credit
      break;
    case 'payment':
      balanceChange = voucher.totals?.grandTotal ?? voucher.amount ?? 0;
      balanceType = 'credit'; // Reverse debit
      break;
  }

  // Reverse party balance
  if (party.balances.current.type === balanceType) {
    party.balances.current.amount += balanceChange;
  } else {
    if (party.balances.current.amount >= balanceChange) {
      party.balances.current.amount -= balanceChange;
    } else {
      party.balances.current.amount = balanceChange - party.balances.current.amount;
      party.balances.current.type = balanceType;
    }
  }

  party.balances.current.lastUpdated = new Date();
  await party.save();
};

// Update inventory
const updateInventory = async (voucher) => {
  if (!voucher.items || voucher.items.length === 0) return;

  for (const voucherItem of voucher.items) {
    const item = await Item.findById(voucherItem.item);
    if (!item || !item.inventory?.trackInventory) continue;

    const quantityChange = voucher.voucherType === 'sales' ? -voucherItem.quantity : voucherItem.quantity;

    if (!Array.isArray(item.inventory.currentStock)) {
      item.inventory.currentStock = [];
    }

    // Update stock in default godown (first godown or create default)
    let stockEntry = item.inventory.currentStock.find(stock =>
      stock.godown?.toString() === voucherItem.godown?.toString()
    );

    if (!stockEntry) {
      stockEntry = {
        godown: voucherItem.godown,
        quantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
        lastUpdated: new Date()
      };
      item.inventory.currentStock.push(stockEntry);
    }

    stockEntry.quantity += quantityChange;
    stockEntry.availableQuantity = stockEntry.quantity - stockEntry.reservedQuantity;
    stockEntry.lastUpdated = new Date();

    await item.save();
  }
};

// Reverse inventory
const reverseInventory = async (voucher) => {
  if (!voucher.items || voucher.items.length === 0) return;

  for (const voucherItem of voucher.items) {
    const item = await Item.findById(voucherItem.item);
    if (!item || !item.inventory?.trackInventory) continue;
    if (!Array.isArray(item.inventory.currentStock)) continue;

    const quantityChange = voucher.voucherType === 'sales' ? voucherItem.quantity : -voucherItem.quantity;

    const stockEntry = item.inventory.currentStock.find(stock =>
      stock.godown?.toString() === voucherItem.godown?.toString()
    );

    if (stockEntry) {
      stockEntry.quantity += quantityChange;
      stockEntry.availableQuantity = stockEntry.quantity - stockEntry.reservedQuantity;
      stockEntry.lastUpdated = new Date();

      await item.save();
    }
  }
};
