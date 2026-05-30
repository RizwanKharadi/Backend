import mongoose from 'mongoose';

const VoucherTypeSchema = new mongoose.Schema(
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
    parent: {
      type: String,
      trim: true,
      default: ''
    },
    reservedName: {
      type: String,
      trim: true,
      default: ''
    },
    tallySync: {
      synced: { type: Boolean, default: true },
      lastSyncDate: { type: Date, default: Date.now }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

VoucherTypeSchema.index({ company: 1, name: 1 }, { unique: true });
VoucherTypeSchema.index({ company: 1, parent: 1 });

export default mongoose.model('VoucherType', VoucherTypeSchema);
