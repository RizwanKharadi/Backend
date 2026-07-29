import { apiClient } from './apiClient';
import { store } from '../store';

export interface MasterNameRow {
  id: string;
  name: string;
  parent?: string;
  parentGroup?: string;
  reservedName?: string;
}

class MasterService {
  private readonly baseURL = '/masters';

  private getCompanyId(): string | undefined {
    return store.getState().company?.selectedCompany?.id;
  }

  async getVoucherTypes(params?: {
    parent?: string;
    search?: string;
  }): Promise<{ success: boolean; data: MasterNameRow[] }> {
    const companyId = this.getCompanyId();
    const response = await apiClient.get(`${this.baseURL}/voucher-types`, {
      params: { companyId, ...params },
    });
    return {
      success: response.data.success,
      data: (response.data.data || []).map((r: any) => ({
        id: r.id || r._id,
        name: r.name,
        parent: r.parent,
        reservedName: r.reservedName,
      })),
    };
  }

  async getGodowns(params?: { search?: string }): Promise<{
    success: boolean;
    data: MasterNameRow[];
  }> {
    const companyId = this.getCompanyId();
    const response = await apiClient.get(`${this.baseURL}/godowns`, {
      params: { companyId, ...params },
    });
    return {
      success: response.data.success,
      data: (response.data.data || []).map((r: any) => ({
        id: r.id || r._id,
        name: r.name,
        reservedName: r.reservedName,
      })),
    };
  }

  async getUnits(params?: { search?: string }): Promise<{
    success: boolean;
    data: MasterNameRow[];
  }> {
    const companyId = this.getCompanyId();
    const response = await apiClient.get(`${this.baseURL}/units`, {
      params: { companyId, ...params },
    });
    return {
      success: response.data.success,
      data: (response.data.data || []).map((r: any) => ({
        id: r.id || r._id,
        name: r.name,
        reservedName: r.reservedName,
      })),
    };
  }

  async getAccountLedgers(parentGroup: string): Promise<{
    success: boolean;
    data: MasterNameRow[];
  }> {
    const companyId = this.getCompanyId();
    const response = await apiClient.get(`${this.baseURL}/account-ledgers`, {
      params: { companyId, parentGroup },
    });
    return {
      success: response.data.success,
      data: (response.data.data || []).map((r: any) => ({
        id: r.id || r._id,
        name: r.name,
        parentGroup: r.parentGroup,
      })),
    };
  }

  async getLedgers(params?: {
    excludeSundry?: boolean;
    search?: string;
    limit?: number;
  }): Promise<{ success: boolean; data: MasterNameRow[] }> {
    const companyId = this.getCompanyId();
    const response = await apiClient.get(`${this.baseURL}/ledgers`, {
      params: {
        companyId,
        excludeSundry: params?.excludeSundry ? 'true' : undefined,
        search: params?.search,
        limit: params?.limit,
      },
    });
    return {
      success: response.data.success,
      data: (response.data.data || []).map((r: any) => ({
        id: r.id || r._id,
        name: r.name,
        parentGroup: r.parentGroup,
      })),
    };
  }
}

export const masterService = new MasterService();
