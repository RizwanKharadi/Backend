/**
 * SaaS billing: price is per device (seat) per billing period.
 * Amounts in INR paise (Razorpay).
 */
export const BILLING_PLANS = {
  monthly: {
    id: 'monthly',
    name: 'FinSync360 — Monthly (per device)',
    billingCycle: 'monthly',
    period: 'monthly',
    interval: 1,
    /** Price per device per month (paise) */
    unitAmountPaise: parseInt(process.env.BILLING_MONTHLY_PRICE_PAISE || '99900', 10),
    description: 'Tally sync + mobile app per desktop device, billed monthly'
  },
  yearly: {
    id: 'yearly',
    name: 'FinSync360 — Yearly (per device)',
    billingCycle: 'yearly',
    period: 'yearly',
    interval: 1,
    unitAmountPaise: parseInt(process.env.BILLING_YEARLY_PRICE_PAISE || '999900', 10),
    description: 'Tally sync + mobile app per desktop device, billed yearly'
  }
};

export const MIN_SEATS = 1;
export const MAX_SEATS = parseInt(process.env.BILLING_MAX_SEATS || '50', 10);

export function getBillingPlan(billingCycle) {
  return BILLING_PLANS[billingCycle] || null;
}

export function listBillingPlans() {
  return Object.values(BILLING_PLANS).map((plan) => ({
    id: plan.id,
    name: plan.name,
    billingCycle: plan.billingCycle,
    unitAmountPaise: plan.unitAmountPaise,
    unitAmountInr: plan.unitAmountPaise / 100,
    currency: 'INR',
    description: plan.description,
    mobileIncluded: true
  }));
}
