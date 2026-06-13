import { apiClient } from './apiClient';
import {
  Voucher,
  CreateVoucherData,
  UpdateVoucherData,
  VoucherEntry,
  CreateVoucherResponse,
} from '../types';
import { store } from '../store';

export interface VoucherListResponse {
  success: boolean;
  data: Voucher[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface VoucherResponse {
  success: boolean;
  data: Voucher;
}

export interface VoucherStatsResponse {
  success: boolean;
  data: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    totalAmount: number;
    thisMonth: number;
    lastMonth: number;
    salesThisMonth?: number;
    purchasesThisMonth?: number;
  };
}

class VoucherService {
  private readonly baseURL = '/vouchers';
  private getCompanyId(): string | undefined {
  return store.getState().company?.selectedCompany?.id;
}

  private mapVoucher(voucher: any): Voucher {
    const ref = voucher.reference;
    const reference =
      typeof ref === 'object' && ref !== null
        ? ref
        : ref != null && ref !== ''
          ? String(ref)
          : '';

    return {
      id: voucher._id || voucher.id,
      voucherNumber: voucher.voucherNumber,
      voucherType: voucher.voucherType,
      date: voucher.date,
      dueDate: voucher.dueDate,
      partyName: voucher.partyName || voucher.party?.name || voucher.party?.displayName || '',
      reference,
      narration: voucher.narration || '',
      amount: voucher.totals?.grandTotal || voucher.amount || 0,
      status: voucher.status,
      totals: voucher.totals
        ? {
            subtotal: Number(voucher.totals.subtotal ?? 0),
            discount: Number(voucher.totals.discount ?? 0),
            taxableAmount: Number(voucher.totals.taxableAmount ?? 0),
            cgst: Number(voucher.totals.cgst ?? 0),
            sgst: Number(voucher.totals.sgst ?? 0),
            igst: Number(voucher.totals.igst ?? 0),
            cess: Number(voucher.totals.cess ?? 0),
            totalTax: Number(voucher.totals.totalTax ?? 0),
            roundOff: Number(voucher.totals.roundOff ?? 0),
            grandTotal: Number(voucher.totals.grandTotal ?? 0),
          }
        : undefined,
      terms: voucher.terms
        ? {
            paymentTerms: voucher.terms.paymentTerms || '',
            deliveryTerms: voucher.terms.deliveryTerms || '',
            otherTerms: voucher.terms.otherTerms || '',
          }
        : undefined,
      tallyPersistedView: voucher.tallyPersistedView || '',
      tallyEntryMode: voucher.tallyEntryMode || voucher.vchEntryMode,
      items: Array.isArray(voucher.items)
        ? voucher.items.map((item: any, index: number) => ({
            id: item._id || item.id || index.toString(),
            itemId: item.item?._id || item.itemId || item.item || '',
            itemName: item.itemName || item.item?.name || item.description || 'Item',
            description: item.description || '',
            quantity: Number(item.quantity || 0),
            unit: item.unit || 'Nos',
            rate: Number(item.rate || 0),
            amount: Number(item.amount || 0),
            hsnCode: item.hsnCode || item.HSN || '',
            gst: {
              cgst: Number(item.gst?.cgst || item.gst?.CGST || 0),
              sgst: Number(item.gst?.sgst || item.gst?.SGST || 0),
              igst: Number(item.gst?.igst || item.gst?.IGST || 0),
              cess: Number(item.gst?.cess || item.gst?.CESS || 0)
            }
          }))
        : [],
      entries: (voucher.entries || voucher.ledgerEntries || []).map(
        (entry: any, index: number) => ({
          id: entry._id || entry.id || index.toString(),
          accountId:
            typeof entry.ledger === 'object' && entry.ledger?._id
              ? String(entry.ledger._id)
              : entry.accountId != null
                ? String(entry.accountId)
                : typeof entry.ledger === 'string'
                  ? entry.ledger
                  : '',
          accountName:
            entry.accountName ||
            entry.ledgerName ||
            (typeof entry.ledger === 'object' && entry.ledger?.name
              ? entry.ledger.name
              : typeof entry.ledger === 'string'
                ? entry.ledger
                : '') ||
            'Ledger Entry',
          debitAmount:
            entry.debitAmount ||
            entry.debit ||
            0,
          creditAmount:
            entry.creditAmount ||
            entry.credit ||
            0,
          narration:
            entry.narration || '',
          isAccountingAllocation: Boolean(
            entry.isAccountingAllocation || entry.fromInventoryAccounting
          ),
          subLines: Array.isArray(entry.subLines)
            ? entry.subLines.map((s: any) => ({
                text: String(s.text || ''),
                billType: s.billType,
                amount: Number(s.amount || 0),
                side: s.side,
                isNarration: Boolean(s.isNarration)
              }))
            : []
        })
      ),
      companyId: voucher.company?._id || voucher.companyId || voucher.company,
      createdBy: voucher.createdBy?._id || voucher.createdBy || '',
      createdAt: voucher.createdAt,
      updatedAt: voucher.updatedAt,
      tallyId: voucher.tallySync?.tallyId || voucher.tallyId,
      lastSyncedAt: voucher.tallySync?.lastSyncDate || voucher.lastSyncedAt,
      tallySyncError: voucher.tallySync?.syncError || '',
      salesLedgerName: voucher.salesLedgerName,
      purchaseLedgerName: voucher.purchaseLedgerName,
      tallyVoucherTypeName: voucher.tallyVoucherTypeName,
      placeOfSupply: voucher.placeOfSupply,
      isSummaryOnly: Boolean(voucher.isSummaryOnly ?? voucher.tallySync?.isSummaryOnly),
      detailCached: Boolean(voucher.detailCached),
    };
  }

  /**
   * Push an existing voucher to TallyPrime (desktop agent must be online).
   */
  async pushVoucherToTally(
    voucherId: string,
    options?: {
      salesLedgerName?: string;
      purchaseLedgerName?: string;
      tallyVoucherTypeName?: string;
      tallyCompanyName?: string;
      partyName?: string;
      isOptional?: boolean;
      placeOfSupply?: string;
    }
  ): Promise<{
    success: boolean;
    message?: string;
    data?: { tallyGuid?: string; voucherNumber?: string; alreadyExisted?: boolean };
  }> {
    const companyId = this.getCompanyId();
    const response = await apiClient.post(
      `${this.baseURL}/${voucherId}/push-to-tally`,
      { companyId, ...options }
    );
    return response.data;
  }

  /**
   * Lazy-load full voucher lines from Tally via desktop agent.
   */
  async hydrateVoucherFromTally(voucherId: string): Promise<VoucherResponse> {
    const companyId = this.getCompanyId();
    const response = await apiClient.post(
      `${this.baseURL}/${voucherId}/hydrate`,
      {},
      { params: companyId ? { companyId } : {} }
    );
    return {
      success: !!response.data?.success,
      data: this.mapVoucher(response.data?.data),
    };
  }

  /**
   * Get vouchers with filtering and pagination
   */
  async getVouchers(params?: {
    page?: number;
    limit?: number;
    type?: string;
    voucherType?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
    companyId?: string;
  }): Promise<VoucherListResponse> {
    const queryParams = { ...params } as Record<string, unknown>;
    if (queryParams.type) {
      queryParams.voucherType = queryParams.type;
      delete queryParams.type;
    }
    // 'all' is a UI placeholder, not a real filter value — sending it matches nothing.
    for (const k of ['voucherType', 'status']) {
      if (queryParams[k] === 'all' || queryParams[k] === '') {
        delete queryParams[k];
      }
    }
    delete queryParams.dateRange;
    if (queryParams.dateFrom && !queryParams.fromDate) {
      queryParams.fromDate = queryParams.dateFrom;
      delete queryParams.dateFrom;
    }
    if (queryParams.dateTo && !queryParams.toDate) {
      queryParams.toDate = queryParams.dateTo;
      delete queryParams.dateTo;
    }
    // YYYY-MM-DD calendar dates pass through unchanged — the backend resolves them as
    // inclusive UTC calendar days, matching how Tally voucher dates are stored.

    const companyId =
      (queryParams.companyId as string | undefined) || this.getCompanyId();
    if (!companyId) {
      throw new Error('Company ID is required. Please select a company first.');
    }
    queryParams.companyId = companyId;

    const response = await apiClient.get(this.baseURL, { params: queryParams });
    const pageData = response.data?.data || {};
    const docs = pageData.docs || [];

    return {
      success: !!response.data?.success,
      data: docs.map((voucher: any) => this.mapVoucher(voucher)),
      pagination: {
        page: pageData.page || 1,
        limit: pageData.limit || docs.length,
        total: pageData.totalDocs || docs.length,
        pages: pageData.totalPages || 1,
      },
    };
  }

  /**
   * Aggregated voucher statistics (fast; no full list download)
   */
  async getVoucherStats(companyId?: string): Promise<VoucherStatsResponse['data']> {
    const id = companyId || this.getCompanyId();
    const response = await apiClient.get(`${this.baseURL}/stats`, {
      params: id ? { companyId: id } : {},
    });
    return response.data?.data ?? response.data;
  }

  /**
   * Get voucher by ID
   */
  async getVoucherById(voucherId: string): Promise<VoucherResponse> {

  const companyId = this.getCompanyId();

  console.log('GET VOUCHER DETAIL');
  console.log('Voucher ID:', voucherId);
  console.log('Company ID:', companyId);

  const response = await apiClient.get(
    `${this.baseURL}/${voucherId}`,
    {
      params: { companyId }
    }
  );

  return {
    success: !!response.data?.success,
    data: this.mapVoucher(response.data?.data),
  };
}

  /**
   * Create new voucher
   */
  async createVoucher(voucherData: CreateVoucherData): Promise<CreateVoucherResponse> {
    const companyId = this.getCompanyId();

    const response = await apiClient.post(this.baseURL, {
      ...voucherData,
      companyId,
    });

    return {
      success: !!response.data?.success,
      data: this.mapVoucher(response.data?.data),
      tallyPush: response.data?.tallyPush,
    };
  }

  /**
   * Update voucher
   */
  async updateVoucher(
  voucherId: string,
  voucherData: UpdateVoucherData
): Promise<VoucherResponse> {

  const companyId = this.getCompanyId();

  const response = await apiClient.put(
    `${this.baseURL}/${voucherId}`,
    {
      ...voucherData,
      companyId,
    }
  );

  return {
    success: !!response.data?.success,
    data: this.mapVoucher(response.data?.data),
  };
}

  /**
   * Delete voucher
   */
  async deleteVoucher(voucherId: string): Promise<{
  success: boolean;
  message: string;
}> {

  const companyId = this.getCompanyId();

  const response = await apiClient.delete(
    `${this.baseURL}/${voucherId}`,
    {
      params: { companyId }
    }
  );

  return response.data;
}

  /**
   * Get voucher statistics
   */
  async getVoucherStats(companyId?: string): Promise<VoucherStatsResponse> {
    const params = companyId ? { companyId } : {};
    const response = await apiClient.get(`${this.baseURL}/stats`, { params });
    return response.data;
  }

  /**
   * Generate voucher PDF
   */
  async generateVoucherPDF(voucherId: string): Promise<Blob> {

  const companyId = this.getCompanyId();

  const response = await apiClient.download(
    `${this.baseURL}/${voucherId}/pdf`,
    {
      params: { companyId }
    }
  );

  return response.data;
}

  /**
   * Duplicate voucher
   */
  async duplicateVoucher(voucherId: string): Promise<VoucherResponse> {

  const companyId = this.getCompanyId();

  const response = await apiClient.post(
    `${this.baseURL}/${voucherId}/duplicate`,
    {
      companyId,
    }
  );

  return response.data;
}

  /**
   * Get voucher types
   */
  async getVoucherTypes(companyId?: string): Promise<{
    success: boolean;
    data: Array<{
      type: string;
      label: string;
      description: string;
    }>;
  }> {
    const resolvedCompanyId = companyId || this.getCompanyId();
    const params = resolvedCompanyId ? { companyId: resolvedCompanyId } : {};
    const response = await apiClient.get(`${this.baseURL}/types`, { params });
    return response.data;
  }

  /**
   * Validate voucher entries
   */
  async validateVoucherEntries(entries: VoucherEntry[]): Promise<{
    success: boolean;
    isValid: boolean;
    errors?: string[];
  }> {
    const response = await apiClient.post(`${this.baseURL}/validate-entries`, { entries });
    return response.data;
  }

  /**
   * Get next voucher number
   */
  async getNextVoucherNumber(type: string, companyId: string): Promise<{
    success: boolean;
    data: {
      nextNumber: string;
      prefix: string;
      sequence: number;
    };
  }> {
    const response = await apiClient.get(`${this.baseURL}/next-number`, {
      params: { type, companyId }
    });
    return response.data;
  }

  /**
   * Search vouchers
   */
  async searchVouchers(query: string, filters?: {
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    companyId?: string;
  }): Promise<VoucherListResponse> {
    const response = await apiClient.get(`${this.baseURL}/search`, {
      params: { q: query, ...filters }
    });
    return response.data;
  }

  /**
   * Get recent vouchers
   */
  async getRecentVouchers(limit: number = 10, companyId?: string): Promise<VoucherListResponse> {
    const params = { limit, ...(companyId && { companyId }) };
    const response = await apiClient.get(`${this.baseURL}/recent`, { params });
    return response.data;
  }

  /**
   * Bulk delete vouchers
   */
  async bulkDeleteVouchers(voucherIds: string[]): Promise<{
    success: boolean;
    message: string;
    deleted: number;
  }> {
    const response = await apiClient.post(`${this.baseURL}/bulk-delete`, { voucherIds });
    return response.data;
  }

  /**
   * Export vouchers
   */
  async exportVouchers(format: 'csv' | 'excel', filters?: {
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    companyId?: string;
  }): Promise<Blob> {
    const response = await apiClient.download(`${this.baseURL}/export`, {
      params: { format, ...filters }
    });
    return response.data;
  }
}

export const voucherService = new VoucherService();
