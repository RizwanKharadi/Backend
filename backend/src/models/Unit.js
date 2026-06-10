import mongoose from 'mongoose';

const UnitSchema = new mongoose.Schema(
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

UnitSchema.index({ company: 1, name: 1 }, { unique: true });

export default mongoose.model('Unit', UnitSchema);
