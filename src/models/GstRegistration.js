import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const RegistrationDetailSchema = new mongoose.Schema(
  {
    applicableFrom: { type: String, trim: true },
    gstRegistrationType: { type: String, trim: true },
    state: { type: String, trim: true },
    placeOfSupply: { type: String, trim: true }
  },
  { _id: false }
);

const GstRegistrationSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.ObjectId,
      ref: 'Company',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    stateName: { type: String, trim: true },
    priorStateName: { type: String, trim: true },
    gstin: {
      type: String,
      trim: true,
      uppercase: true
    },
    eWayApplicableType: { type: String, trim: true },
    gstUserName: { type: String, trim: true },
    eSignMethod: { type: String, trim: true },
    isOtherTerritoryAssessee: { type: Boolean, default: false },
    isEwayBillApplicable: { type: Boolean, default: false },
    isEwayBillApplicableForIntra: { type: Boolean, default: false },
    registrationDetails: [RegistrationDetailSchema],
    tallySync: {
      synced: { type: Boolean, default: true },
      tallyId: { type: String, trim: true },
      masterId: { type: String, trim: true },
      alterId: { type: String, trim: true },
      lastSyncDate: { type: Date, default: Date.now },
      syncError: { type: String, default: '' }
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

GstRegistrationSchema.index({ company: 1, name: 1 }, { unique: true });
GstRegistrationSchema.index({ company: 1, gstin: 1 });

GstRegistrationSchema.plugin(mongoosePaginate);

export default mongoose.model('GstRegistration', GstRegistrationSchema);
