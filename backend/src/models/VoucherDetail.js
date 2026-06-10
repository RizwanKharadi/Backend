import mongoose from 'mongoose';

const VoucherDetailSchema = new mongoose.Schema(
  {
    voucherId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Voucher',
      required: true,
      unique: true
    },
    company: {
      type: mongoose.Schema.ObjectId,
      ref: 'Company',
      required: true
    },
    items: [
      {
        item: { type: mongoose.Schema.ObjectId, ref: 'Item' },
        itemName: String,
        description: String,
        quantity: { type: Number, default: 0 },
        unit: String,
        rate: { type: Number, default: 0 },
        discount: {
          percentage: { type: Number, default: 0 },
          amount: { type: Number, default: 0 }
        },
        taxable: { type: Boolean, default: true },
        hsnCode: String,
        gst: {
          cgst: { type: Number, default: 0 },
          sgst: { type: Number, default: 0 },
          igst: { type: Number, default: 0 },
          cess: { type: Number, default: 0 }
        },
        taxRate: Number,
        taxAmount: Number,
        amount: { type: Number, default: 0 }
      }
    ],
    ledgerEntries: [
      {
        ledger: { type: String, trim: true },
        debit: { type: Number, default: 0 },
        credit: { type: Number, default: 0 },
        narration: String,
        subLines: [{
          text: String,
          billType: String,
          amount: Number,
          side: String,
          isNarration: { type: Boolean, default: false }
        }]
      }
    ],
    taxes: [
      {
        name: String,
        rate: Number,
        amount: Number
      }
    ],
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
    narration: { type: String, maxlength: 2000 },
    fullVoucherData: { type: mongoose.Schema.Types.Mixed },
    lastFetchedAt: { type: Date, default: Date.now },
    lastAccessedAt: { type: Date, default: Date.now }
  },
  {
    timestamps: true
  }
);

VoucherDetailSchema.index({ company: 1, lastAccessedAt: -1 });

/**
 * LRU / age cleanup for voucher detail cache.
 */
VoucherDetailSchema.statics.cleanupStale = async function cleanupStale(options = {}) {
  const ttlDays = Number(process.env.VOUCHER_DETAIL_TTL_DAYS) || 90;
  const maxPerCompany = Number(process.env.VOUCHER_DETAIL_MAX_PER_COMPANY) || 5000;
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

  const ttlResult = await this.deleteMany({ lastAccessedAt: { $lt: cutoff } });

  const companies = await this.distinct('company');
  let cappedRemoved = 0;
  for (const companyId of companies) {
    const count = await this.countDocuments({ company: companyId });
    if (count <= maxPerCompany) continue;
    const excess = count - maxPerCompany;
    const oldest = await this.find({ company: companyId })
      .sort({ lastAccessedAt: 1 })
      .limit(excess)
      .select('_id')
      .lean();
    if (oldest.length) {
      const ids = oldest.map((r) => r._id);
      const del = await this.deleteMany({ _id: { $in: ids } });
      cappedRemoved += del.deletedCount || 0;
    }
  }

  return {
    ttlRemoved: ttlResult.deletedCount || 0,
    lruRemoved: cappedRemoved,
    cutoff
  };
};

export default mongoose.model('VoucherDetail', VoucherDetailSchema);
