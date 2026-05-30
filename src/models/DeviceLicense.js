import mongoose from 'mongoose';

const DeviceLicenseSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.ObjectId,
    ref: 'Organization',
    required: true
  },
  agentId: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'revoked'],
    default: 'active'
  },
  machineFingerprint: {
    type: String,
    trim: true
  },
  hostname: {
    type: String,
    trim: true
  },
  os: {
    type: String,
    trim: true
  },
  agentVersion: {
    type: String,
    trim: true
  },
  linkedCompanies: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Company'
  }],
  activatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  activatedAt: {
    type: Date,
    default: Date.now
  },
  lastSeenAt: {
    type: Date,
    default: Date.now
  },
  revokedAt: {
    type: Date
  },
  revokedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  revokeReason: {
    type: String
  }
}, {
  timestamps: true
});

DeviceLicenseSchema.index({ agentId: 1 }, { unique: true });
DeviceLicenseSchema.index({ organization: 1, status: 1 });

export default mongoose.model('DeviceLicense', DeviceLicenseSchema);
