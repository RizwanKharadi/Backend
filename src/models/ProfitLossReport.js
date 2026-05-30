import mongoose from 'mongoose';

const ProfitLossReportSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  reportName: { type: String, required: true },
  periodKey: {
    type: String,
    enum: ['this_month', 'last_month', 'this_quarter', 'this_year', 'last_year'],
    index: true
  },
  fromDate: { type: Date },
  toDate: { type: Date },
  entries: [
    {
      name: String,
      displayName: String,
      subAmount: Number,
      mainAmount: Number,
      isGroup: { type: Boolean, default: false }
    }
  ],
  groupSummaries: [
    {
      groupName: String,
      groupAmount: Number,
      parentGroup: { type: String, default: '' },
      ledgers: [
        {
          name: String,
          displayName: String,
          debit: Number,
          credit: Number,
          amount: Number,
          isGroup: { type: Boolean, default: false }
        }
      ]
    }
  ],
  totals: {
    subtotal: Number,
    grandTotal: Number
  },
  tallySync: {
    synced: { type: Boolean, default: true },
    tallyId: { type: String },
    lastSyncDate: { type: Date, default: Date.now },
    syncError: { type: String, default: '' }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

ProfitLossReportSchema.index(
  { company: 1, reportName: 1, periodKey: 1 },
  { unique: true, partialFilterExpression: { periodKey: { $exists: true, $type: 'string' } } }
);

export default mongoose.model('ProfitLossReport', ProfitLossReportSchema);
