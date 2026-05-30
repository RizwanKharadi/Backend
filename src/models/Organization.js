import mongoose from 'mongoose';

const OrganizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Organization name is required'],
    trim: true,
    maxlength: [120, 'Organization name cannot exceed 120 characters']
  },
  billingEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['trial', 'active', 'past_due', 'suspended', 'cancelled'],
    default: 'trial'
  },
  subscription: {
    type: mongoose.Schema.ObjectId,
    ref: 'Subscription'
  },
  mobileIncluded: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

OrganizationSchema.index({ billingEmail: 1 });
OrganizationSchema.index({ status: 1 });
OrganizationSchema.index({ createdBy: 1 });

export default mongoose.model('Organization', OrganizationSchema);
