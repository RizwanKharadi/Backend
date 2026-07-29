import api from '@/lib/api';

export type BillingCycle = 'monthly' | 'yearly';

export const billingService = {
  async getPlans() {
    const res = await api.get('/billing/plans');
    return res.data.data.plans;
  },

  async getStatus() {
    const res = await api.get('/billing/status');
    return res.data.data;
  },

  async subscribe(billingCycle: BillingCycle, seatLimit: number) {
    const res = await api.post('/billing/subscribe', { billingCycle, seatLimit });
    return res.data.data;
  },

  async sync() {
    const res = await api.post('/billing/sync');
    return res.data.data;
  },

  async cancel(cancelAtCycleEnd = true) {
    const res = await api.post('/billing/cancel', { cancelAtCycleEnd });
    return res.data;
  }
};

export default billingService;
