import { apiClient } from './apiClient';
import { InventoryItem, CreateInventoryItemData, UpdateInventoryItemData } from '../types';
import { store } from '../store';
export interface InventoryListResponse {
  success: boolean;
  data: InventoryItem[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}


export interface InventoryResponse {
  success: boolean;
  data: InventoryItem;
}

export interface BarcodeLookupResponse {
  success: boolean;
  data: InventoryItem;
}

export interface InventoryStatsResponse {
  success: boolean;
  data: {
    total: number;
    lowStock: number;
    outOfStock: number;
    totalValue: number;
    categories: Record<string, number>;
    topItems: Array<{
      id: string;
      name: string;
      currentStock: number;
      value: number;
    }>;
  };
}

export interface StockMovementResponse {
  success: boolean;
  data: Array<{
    id: string;
    itemId: string;
    type: 'in' | 'out' | 'adjustment';
    quantity: number;
    reference: string;
    date: string;
    notes?: string;
  }>;
}

class InventoryService {
  private readonly baseURL = '/inventory';

  private mapItem(item: any): InventoryItem {
    const stockEntries = item.inventory?.currentStock || [];
    const currentStock = Array.isArray(stockEntries)
      ? stockEntries.reduce((sum: number, stock: any) => sum + Number(stock.quantity || 0), 0)
      : 0;

    return {
      id: item._id || item.id,
      name: item.displayName || item.name,
      code: item.code || '',
      description: item.description || '',
      category: item.categoryName || item.category?.name || item.category || 'General',
      unit: item.units?.primary?.name || item.unit || 'Nos',
      rate: item.pricing?.sellingPrice || item.rate || 0,
      openingStock: currentStock,
      currentStock,
      tallyStock: item.tallyStock
        ? {
            unit: item.tallyStock.unit || item.units?.primary?.name || item.unit || 'Nos',
            openingBalance: Number(item.tallyStock.openingBalance || 0),
            inwardQuantity: Number(item.tallyStock.inwardQuantity || 0),
            outwardQuantity: Number(item.tallyStock.outwardQuantity || 0),
            closingBalance: Number(item.tallyStock.closingBalance || currentStock || 0),
          }
        : undefined,
      reorderLevel: item.inventory?.stockLevels?.reorderLevel || item.reorderLevel || 0,
      maxLevel: item.inventory?.stockLevels?.maximum || item.maxLevel,
      location: item.inventory?.currentStock?.[0]?.godown || item.location,
      isActive: item.isActive ?? true,
      companyId: item.company?._id || item.companyId || item.company,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      tallyId: item.tallySync?.tallyId || item.tallyId,
      lastSyncedAt: item.tallySync?.lastSyncDate || item.lastSyncedAt,
    };
  }

  /**
   * Get inventory items with filtering and pagination
   */
  async getItems(params?: {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  lowStock?: boolean;
  outOfStock?: boolean;
  companyId?: string;
}): Promise<InventoryListResponse> {

  const companyId =
    params?.companyId ||
    store.getState().company?.selectedCompany?.id;

  console.log('📦 INVENTORY COMPANY ID:', companyId);

  if (!companyId) {
    throw new Error('Company ID missing');
  }

  const { lowStock, outOfStock, ...rest } = params || {};
  const finalParams = {
    ...rest,
    companyId,
    ...(lowStock && { lowStock: 'true' }),
    ...(outOfStock && { outOfStock: 'true' }),
  };

  console.log('📦 INVENTORY API CALL PARAMS:', finalParams);

  const response = await apiClient.get(`${this.baseURL}/items`, {
    params: finalParams,
  });

  console.log('📥 INVENTORY RESPONSE:', response.data);

  const pageData = response.data?.data || {};
  const docs = pageData.docs || [];

  return {
    success: !!response.data?.success,
    data: docs.map((item: any) => this.mapItem(item)),
    pagination: {
      page: pageData.page || 1,
      limit: pageData.limit || docs.length,
      total: pageData.totalDocs || docs.length,
      pages: pageData.totalPages || 1,
    },
  };
}

  /**
   * Get inventory item by ID
   */
  async getItemById(itemId: string): Promise<InventoryResponse> {
  const companyId = store.getState().company?.selectedCompany?.id;

  console.log('🔍 ITEM DETAIL COMPANY ID:', companyId);

  if (!companyId) {
    throw new Error('Company ID missing');
  }

  const response = await apiClient.get(
    `${this.baseURL}/items/${itemId}`,
    {
      params: { companyId },
    }
  );

  console.log('📥 ITEM DETAIL RESPONSE:', response.data);

  return {
    success: !!response.data?.success,
    data: this.mapItem(response.data?.data),
  };
}

  /**
   * Get inventory item by barcode (exact match, company-scoped)
   */
  async getItemByBarcode(barcode: string): Promise<BarcodeLookupResponse> {
    const companyId = store.getState().company?.selectedCompany?.id;
    if (!companyId) {
      throw new Error('Company ID missing');
    }
    const trimmed = String(barcode || '').trim();
    if (!trimmed) {
      throw new Error('Barcode is required');
    }
    const encoded = encodeURIComponent(trimmed);
    const response = await apiClient.get(
      `${this.baseURL}/items/barcode/${encoded}`,
      { params: { companyId } }
    );
    return {
      success: !!response.data?.success,
      data: this.mapItem(response.data?.data),
    };
  }

  /**
   * Create new inventory item
   */
  async createItem(
    itemData: CreateInventoryItemData & {
      pushToTally?: boolean;
      units?: { primary: { name: string } };
      baseUnits?: string;
    }
  ): Promise<InventoryResponse & { tallyPush?: { status: string; message?: string } }> {
  const companyId = store.getState().company?.selectedCompany?.id;

  const response = await apiClient.post(`${this.baseURL}/items`, {
    ...itemData,
    companyId,
  });

  return {
    success: !!response.data?.success,
    data: this.mapItem(response.data?.data),
    tallyPush: response.data?.tallyPush,
  };
}

  /**
   * Update inventory item
   */
  async updateItem(itemId: string, itemData: UpdateInventoryItemData) {
  const companyId = store.getState().company?.selectedCompany?.id;

  return apiClient.put(`${this.baseURL}/items/${itemId}`, {
    ...itemData,
    companyId,
  });
}

  /**
   * Delete inventory item
   */
  async deleteItem(itemId: string) {
  const companyId = store.getState().company?.selectedCompany?.id;

  return apiClient.delete(`${this.baseURL}/items/${itemId}`, {
    params: { companyId },
  });
}

  /**
   * Get inventory statistics
   */
  async getInventoryStats(companyId?: string): Promise<InventoryStatsResponse['data']> {
    const params = companyId ? { companyId } : {};
    const response = await apiClient.get(`${this.baseURL}/stats`, { params });
    return response.data?.data ?? response.data;
  }

  /**
   * Update item stock
   */
  async updateStock(itemId: string, data: any): Promise<InventoryResponse> {
  const companyId = store.getState().company?.selectedCompany?.id;

  const response = await apiClient.post(
    `${this.baseURL}/items/${itemId}/stock`,
    {
      ...data,
      companyId,
    }
  );

  return response.data;
}

  /**
   * Get stock movements for an item
   */
  async getStockMovements(
  itemId: string,
  params?: any
): Promise<StockMovementResponse> {

  const companyId = store.getState().company?.selectedCompany?.id;

  if (!companyId) {
    throw new Error('Company ID missing');
  }

  console.log('📦 STOCK MOVEMENT COMPANY ID:', companyId);

  const response = await apiClient.get(
    `${this.baseURL}/items/${itemId}/movements`,
    {
      params: {
        ...params,
        companyId,
      },
    }
  );

  console.log('📥 STOCK MOVEMENT RESPONSE:', response.data);

  return response.data;
}

  /**
   * Get low stock items
   */
  async getLowStockItems(companyId?: string): Promise<InventoryListResponse> {
    const params = companyId ? { companyId } : {};
    const response = await apiClient.get(`${this.baseURL}/low-stock`, { params });
    return response.data;
  }

  /**
   * Get item categories
   */
  async getCategories(companyId?: string): Promise<{
    success: boolean;
    data: Array<{
      name: string;
      count: number;
    }>;
  }> {
    const params = companyId ? { companyId } : {};
    const response = await apiClient.get(`${this.baseURL}/categories`, { params });
    return response.data;
  }

  /**
   * Search inventory items
   */
 async searchItems(
  query: string,
  filters?: any
): Promise<InventoryListResponse> {

  const companyId = store.getState().company?.selectedCompany?.id;

  if (!companyId) {
    throw new Error('Company ID missing');
  }

  console.log('🔍 SEARCH COMPANY ID:', companyId);

  const response = await apiClient.get(`${this.baseURL}/search`, {
    params: {
      q: query,
      ...filters,
      companyId,
    },
  });

  console.log('📥 SEARCH RESPONSE:', response.data);

  return response.data;
}

  /**
   * Bulk update items
   */
  async bulkUpdateItems(updates: Array<{
    id: string;
    data: Partial<InventoryItem>;
  }>): Promise<{
    success: boolean;
    message: string;
    updated: number;
  }> {
    const response = await apiClient.post(`${this.baseURL}/bulk-update`, { updates });
    return response.data;
  }

  /**
   * Import items from CSV/Excel
   */
  async importItems(file: FormData): Promise<{
    success: boolean;
    message: string;
    imported: number;
    errors?: string[];
  }> {
    const response = await apiClient.upload(`${this.baseURL}/import`, file);
    return response.data;
  }

  /**
   * Export items
   */
  async exportItems(format: 'csv' | 'excel', filters?: {
    category?: string;
    companyId?: string;
  }): Promise<Blob> {
    const response = await apiClient.download(`${this.baseURL}/export`, {
      params: { format, ...filters }
    });
    return response.data;
  }

  /**
   * Generate barcode for item
   */
  async generateBarcode(itemId: string, format: 'code128' | 'qr' = 'code128'): Promise<{
    success: boolean;
    data: {
      barcode: string;
      image: string; // base64 encoded image
    };
  }> {
    const response = await apiClient.post(`${this.baseURL}/items/${itemId}/barcode`, { format });
    return response.data;
  }

  /**
   * Get item valuation
   */
  async getItemValuation(companyId?: string, method: 'fifo' | 'lifo' | 'average' = 'fifo'): Promise<{
    success: boolean;
    data: {
      totalValue: number;
      items: Array<{
        id: string;
        name: string;
        quantity: number;
        rate: number;
        value: number;
      }>;
    };
  }> {
    const params = { method, ...(companyId && { companyId }) };
    const response = await apiClient.get(`${this.baseURL}/valuation`, { params });
    return response.data;
  }
}

export const inventoryService = new InventoryService();
