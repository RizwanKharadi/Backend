import mongoose from 'mongoose';

/** Chart-of-accounts groups for P&L / balance-sheet reports only. Ledgers sync into Party (recordType ledger). */
const TallyAccountSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    accountType: {
      type: String,
      enum: ['group', 'ledger'],
      required: true
    },
    parentGroup: {
      type: String,
      trim: true,
      default: ''
    },
    tallyGuid: {
      type: String,
      trim: true,
      default: ''
    },
    tallySync: {
      synced: { type: Boolean, default: true },
      lastSyncDate: { type: Date, default: Date.now }
    }
  },
  { timestamps: true }
);

TallyAccountSchema.index({ company: 1, name: 1, accountType: 1 }, { unique: true });
TallyAccountSchema.index({ company: 1, accountType: 1 });

export default mongoose.model('TallyAccount', TallyAccountSchema);
