import { apiClient } from './apiClient';

export type BillingCycle = 'monthly' | 'yearly';

export interface BillingPlan {
  id: string;
  name: string;
  billingCycle: BillingCycle;
  unitAmountPaise: number;
  unitAmountInr: number;
  currency: string;
  description: string;
  mobileIncluded: boolean;
}

export const billingService = {
  async getPlans() {
    const res = await apiClient.get('/billing/plans');
    return res.data?.data?.plans as BillingPlan[];
  },

  async getStatus() {
    const res = await apiClient.get('/billing/status');
    return res.data?.data;
  },

  async subscribe(billingCycle: BillingCycle, seatLimit: number) {
    const res = await apiClient.post('/billing/subscribe', { billingCycle, seatLimit });
    return res.data?.data as {
      shortUrl: string;
      razorpayKeyId: string;
      razorpaySubscriptionId: string;
      seatLimit: number;
      billingCycle: BillingCycle;
    };
  },

  async syncSubscription() {
    const res = await apiClient.post('/billing/sync');
    return res.data?.data;
  },

  async cancel(cancelAtCycleEnd = true) {
    const res = await apiClient.post('/billing/cancel', { cancelAtCycleEnd });
    return res.data;
  }
};

export default billingService;
