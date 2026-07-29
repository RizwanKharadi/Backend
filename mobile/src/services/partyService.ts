import { apiClient } from './apiClient';
import { store } from '../store';

export interface Party {
  id: string;
  name: string;
  displayName?: string;
  type: 'customer' | 'supplier' | 'both';
  gstin?: string;
  state?: string;
  pincode?: string;
}

export interface CreatePartyData {
  name: string;
  type: 'customer' | 'supplier' | 'both';
  tallyParent?: string;
  parent?: string;
  pushToTally?: boolean;
  contact?: { phone: string; email?: string };
  addresses?: Array<{
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
    type?: string;
  }>;
  gstin?: string;
  state?: string;
  pincode?: string;
  mobile?: string;
}

export interface TallyPushResult {
  status: string;
  message?: string;
  tallyGuid?: string;
  masterName?: string;
}

class PartyService {
  private readonly baseURL = '/parties';

  private getCompanyId(): string | undefined {
    return store.getState().company?.selectedCompany?.id;
  }

  private mapParty(row: any): Party {
    const addr = row.addresses?.[0] || row.address || {};
    return {
      id: row._id || row.id,
      name: row.displayName || row.name,
      displayName: row.displayName,
      type: row.type,
      gstin: row.gstin,
      state: addr.state || row.state,
      pincode: addr.pincode || row.pincode,
    };
  }

  async getParties(params?: {
    page?: number;
    limit?: number;
    search?: string;
    type?: 'customer' | 'supplier' | 'both';
  }): Promise<{ success: boolean; data: Party[]; total: number }> {
    const companyId = this.getCompanyId();
    const query: Record<string, string | number> = {
      page: params?.page ?? 1,
      limit: params?.limit ?? 300,
      companyId: companyId || '',
    };
    if (params?.search) query.search = params.search;
    if (params?.type) query.type = params.type;

    const response = await apiClient.get(this.baseURL, { params: query });
    const pageData = response.data?.data || {};
    const docs = pageData.docs || pageData || [];
    const list = Array.isArray(docs) ? docs : [];
    return {
      success: !!response.data?.success,
      data: list.map((p: any) => this.mapParty(p)),
      total: pageData.totalDocs ?? list.length,
    };
  }

  async createParty(data: CreatePartyData): Promise<{
    success: boolean;
    data: Party;
    tallyPush?: TallyPushResult;
  }> {
    const companyId = this.getCompanyId();
    const response = await apiClient.post(this.baseURL, {
      ...data,
      companyId,
    });
    return {
      success: !!response.data?.success,
      data: this.mapParty(response.data?.data),
      tallyPush: response.data?.tallyPush,
    };
  }
}

export const partyService = new PartyService();
