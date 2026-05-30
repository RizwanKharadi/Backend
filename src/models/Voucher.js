import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const VoucherSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.ObjectId,
    ref: 'Company',
    required: true
  },
  voucherType: {
    type: String,
    enum: [
      'sales',
      'purchase',
      'receipt',
      'payment',
      'contra',
      'journal',
      'debit_note',
      'credit_note',
      'sales_order',
      'purchase_order',
      'receipt_note',
      'delivery_note'
    ],
    required: true
  },
  /** Tally parent voucher type (ZVOUCHERPARENT) — stable when display name is renamed */
  tallyVoucherTypeParent: {
    type: String,
    trim: true,
    default: ''
  },
  /** Tally display voucher type name (VOUCHERTYPENAME) */
  tallyVoucherTypeName: {
    type: String,
    trim: true,
    default: ''
  },
  /** Sales / purchase account ledger used on Tally import */
  salesLedgerName: { type: String, trim: true, default: '' },
  purchaseLedgerName: { type: String, trim: true, default: '' },
  placeOfSupply: { type: String, trim: true, default: '' },
  isOptional: { type: Boolean, default: false },
  voucherNumber: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  reference: {
    number: String,
    date: Date
  },
  party: {
    type: mongoose.Schema.ObjectId,
    ref: 'Party'
  },
  partyName: {
    type: String,
    trim: true,
    default: ''
  },
  narration: {
    type: String,
    maxlength: [500, 'Narration cannot be more than 500 characters']
  },
  // For sales/purchase vouchers
  items: [{
    item: {
      type: mongoose.Schema.ObjectId,
      ref: 'Item'
    },
    itemName: {
      type: String,
      trim: true,
      default: ''
    },
    description: String,
    quantity: {
      type: Number,
      default: 1
    },
    unit: String,
    rate: {
      type: Number,
      required: true
    },
    discount: {
      percentage: { type: Number, default: 0 },
      amount: { type: Number, default: 0 }
    },
    taxable: {
      type: Boolean,
      default: true
    },
    hsnCode: String,
    gst: {
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
      cess: { type: Number, default: 0 }
    },
    amount: {
      type: Number,
      required: true
    }
  }],
  /** Ledger names from ALLLEDGERENTRIES (summary sync index for P&L drill-down) */
  ledgerNames: [{
    type: String,
    trim: true
  }],
  hasInventory: {
    type: Boolean,
    default: false
  },
  // For accounting entries (all voucher types)
  ledgerEntries: [{
    ledger: {
      type: String,
      required: true,
      trim: true
    },
    debit: {
      type: Number,
      default: 0
    },
    credit: {
      type: Number,
      default: 0
    },
    narration: String,
    /** Tally INVENTORYENTRIES → ACCOUNTINGALLOCATIONS.LIST */
    fromInventoryAccounting: { type: Boolean, default: false },
    /** Bill-wise refs / line narration (Tally As Voucher sub-lines) */
    subLines: [{
      text: String,
      billType: String,
      amount: Number,
      side: String,
      isNarration: { type: Boolean, default: false }
    }]
  }],
  totals: {
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    taxableAmount: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    cess: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    grandTotal: {
      type: Number,
      required: true
    }
  },
  payment: {
    method: {
      type: String,
      enum: ['cash', 'bank', 'upi', 'card', 'cheque', 'dd', 'neft', 'rtgs', 'other']
    },
    bank: {
      type: String,
      trim: true
    },
    chequeNumber: String,
    chequeDate: Date,
    transactionId: String,
    upiId: String
  },
  shipping: {
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' }
    },
    method: String,
    charges: { type: Number, default: 0 },
    trackingNumber: String
  },
  terms: {
    paymentTerms: String,
    deliveryTerms: String,
    otherTerms: String
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'cancelled', 'paid', 'partially_paid'],
    default: 'pending'
  },
  /** Tally PERSISTEDVIEW: Accounting Voucher View | Invoice Voucher View */
  tallyPersistedView: {
    type: String,
    trim: true,
    default: ''
  },
  /** Tally VCHENTRYMODE: item_invoice | accounting_invoice | as_voucher */
  tallyEntryMode: {
    type: String,
    enum: ['item_invoice', 'accounting_invoice', 'as_voucher'],
    default: 'item_invoice'
  },
  dueDate: Date,
  attachments: [{
    filename: String,
    originalName: String,
    path: String,
    size: Number,
    mimetype: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  tallySync: {
    synced: { type: Boolean, default: false },
    tallyId: String,
    tallyAlterId: String,
    isSummaryOnly: { type: Boolean, default: false },
    lastSyncDate: Date,
    syncError: String
  },
  workflow: {
    approvalRequired: { type: Boolean, default: false },
    approvedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    approvedAt: Date,
    rejectedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    rejectedAt: Date,
    rejectionReason: String
  },
  recurring: {
    isRecurring: { type: Boolean, default: false },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
    },
    interval: { type: Number, default: 1 },
    endDate: Date,
    nextDate: Date,
    parentVoucher: {
      type: mongoose.Schema.ObjectId,
      ref: 'Voucher'
    }
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
VoucherSchema.index({ company: 1, voucherType: 1, voucherNumber: 1 }, { unique: true });
VoucherSchema.index({ company: 1, date: -1 });
VoucherSchema.index({ company: 1, party: 1 });
VoucherSchema.index({ company: 1, status: 1 });
VoucherSchema.index({ company: 1, dueDate: 1 });
VoucherSchema.index({ 'tallySync.synced': 1 });

// Virtual for formatted voucher number
VoucherSchema.virtual('formattedNumber').get(function() {
  return `${this.voucherType.toUpperCase()}-${this.voucherNumber}`;
});

// Virtual for overdue status
VoucherSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || this.status === 'paid' || this.status === 'cancelled') {
    return false;
  }
  return new Date() > this.dueDate;
});

// Virtual for days overdue
VoucherSchema.virtual('daysOverdue').get(function() {
  if (!this.isOverdue) return 0;
  const diffTime = Math.abs(new Date() - this.dueDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Compute totals before schema validation (grandTotal is required on totals)
VoucherSchema.pre('validate', function(next) {
  if (this.items && this.items.length > 0) {
    this.calculateTotals();
  } else if (this.amount != null && (!this.totals || this.totals.grandTotal == null)) {
    const amt = Number(this.amount) || 0;
    this.totals = {
      subtotal: amt,
      discount: 0,
      taxableAmount: amt,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      totalTax: 0,
      roundOff: 0,
      grandTotal: amt
    };
  }
  next();
});

// Pre-save middleware
VoucherSchema.pre('save', function(next) {
  const isItemInvoice =
    ['sales', 'purchase', 'sales_order', 'purchase_order'].includes(this.voucherType) &&
    Array.isArray(this.items) &&
    this.items.length > 0;

  if (this.ledgerEntries && this.ledgerEntries.length > 0 && !isItemInvoice) {
    const totalDebit = this.ledgerEntries.reduce((sum, entry) => sum + (entry.debit || 0), 0);
    const totalCredit = this.ledgerEntries.reduce((sum, entry) => sum + (entry.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return next(new Error('Debit and Credit amounts must be equal'));
    }
  }

  next();
});

// Method to calculate totals
VoucherSchema.methods.calculateTotals = function() {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalCess = 0;
  
  this.items.forEach(item => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.rate) || 0;
    const itemTotal = Number(item.amount) > 0 ? Number(item.amount) : qty * rate;
    subtotal += itemTotal;

    if (!item.discount) {
      item.discount = { percentage: 0, amount: 0 };
    }
    if (!item.gst) {
      item.gst = { cgst: 0, sgst: 0, igst: 0, cess: 0 };
    }

    // Calculate discount
    if (item.discount.percentage > 0) {
      item.discount.amount = (itemTotal * item.discount.percentage) / 100;
    }
    totalDiscount += item.discount.amount || 0;

    // Calculate tax
    const taxableAmount = itemTotal - (item.discount.amount || 0);
    if (item.taxable !== false) {
      const cgstAmount = (taxableAmount * (item.gst.cgst || 0)) / 100;
      const sgstAmount = (taxableAmount * (item.gst.sgst || 0)) / 100;
      const igstAmount = (taxableAmount * (item.gst.igst || 0)) / 100;
      const cessAmount = (taxableAmount * (item.gst.cess || 0)) / 100;
      
      totalCgst += cgstAmount;
      totalSgst += sgstAmount;
      totalIgst += igstAmount;
      totalCess += cessAmount;
    }
    
    // Update item amount
    item.amount =
      taxableAmount +
      (taxableAmount *
        ((item.gst.cgst || 0) + (item.gst.sgst || 0) + (item.gst.igst || 0) + (item.gst.cess || 0))) /
        100;
  });

  if (!this.totals) {
    this.totals = {};
  }

  this.totals.subtotal = subtotal;
  this.totals.discount = totalDiscount;
  this.totals.taxableAmount = subtotal - totalDiscount;
  this.totals.cgst = totalCgst;
  this.totals.sgst = totalSgst;
  this.totals.igst = totalIgst;
  this.totals.cess = totalCess;
  this.totals.totalTax = totalCgst + totalSgst + totalIgst + totalCess;
  
  const beforeRoundOff = this.totals.taxableAmount + this.totals.totalTax;
  this.totals.grandTotal = Math.round(beforeRoundOff);
  this.totals.roundOff = this.totals.grandTotal - beforeRoundOff;
};

// Method to generate ledger entries for sales/purchase vouchers
VoucherSchema.methods.generateLedgerEntries = function() {
  this.ledgerEntries = [];
  
  if (this.voucherType === 'sales') {
    // Debit: Party/Cash
    this.ledgerEntries.push({
      ledger: this.party,
      debit: this.totals.grandTotal,
      credit: 0,
      narration: `Sales to ${this.party.name}`
    });
    
    // Credit: Sales
    this.ledgerEntries.push({
      ledger: 'sales_ledger_id', // This should be the sales ledger ID
      debit: 0,
      credit: this.totals.taxableAmount,
      narration: 'Sales'
    });
    
    // Credit: Tax ledgers
    if (this.totals.cgst > 0) {
      this.ledgerEntries.push({
        ledger: 'cgst_ledger_id',
        debit: 0,
        credit: this.totals.cgst,
        narration: 'CGST'
      });
    }
    
    if (this.totals.sgst > 0) {
      this.ledgerEntries.push({
        ledger: 'sgst_ledger_id',
        debit: 0,
        credit: this.totals.sgst,
        narration: 'SGST'
      });
    }
    
    if (this.totals.igst > 0) {
      this.ledgerEntries.push({
        ledger: 'igst_ledger_id',
        debit: 0,
        credit: this.totals.igst,
        narration: 'IGST'
      });
    }
  }
  
  // Similar logic for purchase vouchers (reverse the debit/credit)
  if (this.voucherType === 'purchase') {
    // Credit: Party/Cash
    this.ledgerEntries.push({
      ledger: this.party,
      debit: 0,
      credit: this.totals.grandTotal,
      narration: `Purchase from ${this.party.name}`
    });
    
    // Debit: Purchase
    this.ledgerEntries.push({
      ledger: 'purchase_ledger_id',
      debit: this.totals.taxableAmount,
      credit: 0,
      narration: 'Purchase'
    });
    
    // Debit: Tax ledgers
    if (this.totals.cgst > 0) {
      this.ledgerEntries.push({
        ledger: 'cgst_input_ledger_id',
        debit: this.totals.cgst,
        credit: 0,
        narration: 'CGST Input'
      });
    }
  }
};

VoucherSchema.index({ company: 1, ledgerNames: 1, date: -1 });
VoucherSchema.index({ company: 1, date: -1, 'ledgerEntries.ledger': 1 });

// Add pagination plugin
VoucherSchema.plugin(mongoosePaginate);

export default mongoose.model('Voucher', VoucherSchema);
