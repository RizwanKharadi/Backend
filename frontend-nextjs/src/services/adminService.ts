import api from '@/lib/api';

export const adminService = {
  async getOverview() {
    const res = await api.get('/admin/overview');
    return res.data.data;
  },

  async listOrganizations(params?: { page?: number; limit?: number; status?: string }) {
    const res = await api.get('/admin/organizations', { params });
    return res.data;
  },

  async getOrganization(id: string) {
    const res = await api.get(`/admin/organizations/${id}`);
    return res.data.data;
  },

  async updateSubscription(
    orgId: string,
    body: {
      status?: string;
      seatLimit?: number;
      extendTrialDays?: number;
      billingCycle?: string;
    }
  ) {
    const res = await api.patch(`/admin/organizations/${orgId}/subscription`, body);
    return res.data.data;
  },

  async listDevices(params?: { page?: number; status?: string; organizationId?: string }) {
    const res = await api.get('/admin/devices', { params });
    return res.data;
  },

  async revokeDevice(agentId: string, reason?: string) {
    const res = await api.delete(`/admin/devices/${agentId}`, { data: { reason } });
    return res.data;
  },

  async transferDevice(
    agentId: string,
    targetOrganizationId: string,
    reason?: string
  ) {
    const res = await api.post(`/admin/devices/${agentId}/transfer`, {
      targetOrganizationId,
      reason
    });
    return res.data;
  }
};

export default adminService;
