import mongoose from 'mongoose';

const SubscriptionSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true
  },
  planId: {
    type: String,
    default: 'trial'
  },
  billingCycle: {
    type: String,
    enum: ['trial', 'monthly', 'yearly'],
    default: 'trial'
  },
  status: {
    type: String,
    enum: ['trial', 'active', 'past_due', 'suspended', 'cancelled'],
    default: 'trial'
  },
  seatLimit: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  trialEndsAt: {
    type: Date
  },
  currentPeriodStart: {
    type: Date
  },
  currentPeriodEnd: {
    type: Date
  },
  /** When last payment failed; grace window starts here. */
  paymentFailedAt: {
    type: Date
  },
  razorpaySubscriptionId: {
    type: String
  },
  razorpayPlanId: {
    type: String
  },
  razorpayCustomerId: {
    type: String
  },
  /** Seats requested at checkout before Razorpay confirms payment */
  pendingSeatLimit: {
    type: Number,
    min: 1
  },
  cancelledAt: {
    type: Date
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

SubscriptionSchema.index({ organization: 1 });
SubscriptionSchema.index({ status: 1 });
SubscriptionSchema.index({ trialEndsAt: 1 });
SubscriptionSchema.index({ currentPeriodEnd: 1 });
SubscriptionSchema.index({ razorpaySubscriptionId: 1 }, { sparse: true });

export default mongoose.model('Subscription', SubscriptionSchema);
