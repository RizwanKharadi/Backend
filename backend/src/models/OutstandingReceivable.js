import mongoose from 'mongoose';

const InventoryLineSchema = new mongoose.Schema(
  {
    item: String,
    quantity: String,
    rate: String
  },
  { _id: false }
);

const BillSchema = new mongoose.Schema(
  {
    billRef: { type: String, required: true },
    billDate: Date,
    billDue: Date,
    billOverdue: Number,
    closingBalance: { type: Number, default: 0 },
    vchDate: Date,
    vchType: String,
    vchNumber: String,
    vchAmount: Number,
    inventoryLines: [InventoryLineSchema]
  },
  { _id: false }
);

const LedgerSchema = new mongoose.Schema(
  {
    partyName: { type: String, required: true },
    totalOutstanding: { type: Number, default: 0 },
    billCount: { type: Number, default: 0 },
    oldestBillDue: Date,
    oldestOverdueDays: Number,
    bills: [BillSchema]
  },
  { _id: false }
);

const OutstandingReceivableSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    reportName: { type: String, default: 'Bills Receivable', required: true },
    fromDate: Date,
    toDate: Date,
    asOfDate: { type: Date, default: Date.now },
    totalOutstanding: { type: Number, default: 0 },
    ledgers: [LedgerSchema],
    tallySync: {
      synced: { type: Boolean, default: true },
      lastSyncDate: { type: Date, default: Date.now },
      syncError: { type: String, default: '' }
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

OutstandingReceivableSchema.index({ company: 1, reportName: 1 }, { unique: true });

export default mongoose.model('OutstandingReceivable', OutstandingReceivableSchema);
