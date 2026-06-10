import mongoose from 'mongoose';

/**
 * Binds a Tally installation serial number to one FinSync360 account (email/org).
 */
const TallySerialRegistrationSchema = new mongoose.Schema({
  serialNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  organization: {
    type: mongoose.Schema.ObjectId,
    ref: 'Organization',
    required: true
  },
  registeredEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  licenseDetails: {
    planName: String,
    tallyVersion: String,
    tallyShortVersion: String,
    isGold: Boolean,
    isSilver: Boolean,
    isTallyPrime: Boolean,
    isEducationalMode: Boolean,
    remoteSerialNumber: String,
    accountId: String,
    userName: String
  },
  lastSeenAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

TallySerialRegistrationSchema.index({ serialNumber: 1 }, { unique: true });
TallySerialRegistrationSchema.index({ user: 1 });
TallySerialRegistrationSchema.index({ organization: 1 });

export default mongoose.model('TallySerialRegistration', TallySerialRegistrationSchema);
