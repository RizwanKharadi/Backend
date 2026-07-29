import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { inventoryService } from '../../services/inventoryService';
import { databaseService } from '../../services/databaseService';
import { offlineCacheService } from '../../services/offlineCacheService';
import { InventoryItem, CreateInventoryItemData, UpdateInventoryItemData } from '../../types';

interface InventoryState {
  items: InventoryItem[];
  selectedItem: InventoryItem | null;
  isLoading: boolean;
  error: string | null;
  filters: {
    category?: string;
    search?: string;
    lowStock?: boolean;
    outOfStock?: boolean;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  lastFetchedAt: number;
  statsFetchedAt: number;
  stats: {
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

const initialState: InventoryState = {
  items: [],
  selectedItem: null,
  isLoading: false,
  error: null,
  filters: {},
  pagination: {
    page: 1,
    limit: 30,
    total: 0,
    hasMore: true,
  },
  lastFetchedAt: 0,
  statsFetchedAt: 0,
  stats: {
    total: 0,
    lowStock: 0,
    outOfStock: 0,
    totalValue: 0,
    categories: {},
    topItems: [],
  },
};

// Async thunks
export const fetchInventoryItems = createAsyncThunk(
  'inventory/fetchItems',
  async (params: { page?: number; refresh?: boolean } = {}, { getState, rejectWithValue }) => {
    const state = getState() as any;
    const { filters, pagination } = state.inventory;
    const companyId = state.company?.selectedCompany?.id;

    try {
      if (!companyId) {
        return {
          items: [] as InventoryItem[],
          pagination: { page: 1, limit: pagination.limit, total: 0, pages: 0 },
          refresh: true,
        };
      }

      const page = params.page ?? (params.refresh ? 1 : pagination.page);

      const response = await inventoryService.getItems({
        page,
        limit: pagination.limit,
        companyId,
        search: filters.search,
        category: filters.category && filters.category !== 'all' ? filters.category : undefined,
        lowStock: filters.lowStock,
        outOfStock: filters.outOfStock,
      });

      if (companyId) {
        void offlineCacheService.saveInventoryItems(companyId, response.data);
      }

      return {
        items: response.data,
        pagination: response.pagination!,
        refresh: params.refresh ?? page === 1,
      };
    } catch (error: any) {
      const cached = companyId ? await offlineCacheService.loadInventoryItems(companyId) : null;
      if (cached?.length) {
        return {
          items: cached,
          pagination: {
            page: 1,
            limit: pagination.limit,
            total: cached.length,
            pages: 1,
          },
          refresh: true,
        };
      }
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch inventory items');
    }
  }
);

export const fetchInventoryStats = createAsyncThunk(
  'inventory/fetchStats',
  async (companyId: string | undefined = undefined, { rejectWithValue }) => {
    try {
      const stats = await inventoryService.getInventoryStats(companyId);
      if (companyId) {
        void offlineCacheService.saveInventoryStats(companyId, stats);
      }
      return stats;
    } catch (error: any) {
      if (companyId) {
        const cached = await offlineCacheService.loadInventoryStats(companyId);
        if (cached) return cached as typeof initialState.stats;
      }
      return rejectWithValue(error.message || 'Failed to fetch inventory stats');
    }
  }
);

export const fetchItemById = createAsyncThunk(
  'inventory/fetchItemById',
  async (itemId: string, { rejectWithValue }) => {
    try {
      const response = await inventoryService.getItemById(itemId);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch item');
    }
  }
);

export const createItem = createAsyncThunk(
  'inventory/createItem',
  async (itemData: CreateInventoryItemData, { rejectWithValue }) => {
    try {
      const response = await inventoryService.createItem(itemData);

      // Also store locally for offline access
      await databaseService.upsertInventoryItem(response.data);

      return response.data;
    } catch (error: any) {
      // Store as pending change if offline
      const isOffline = typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
      if (isOffline) {
        await databaseService.addPendingChange({
          type: 'item',
          action: 'create',
          data: itemData,
        });
        
        // Create temporary item for UI
        const tempItem: InventoryItem = {
          id: `temp_${Date.now()}`,
          name: itemData.name || 'New Item',
          code: itemData.code || '',
          category: itemData.category || 'General',
          unit: itemData.unit || 'Nos',
          rate: itemData.rate || 0,
          openingStock: itemData.openingStock || 0,
          currentStock: itemData.openingStock || 0,
          reorderLevel: itemData.reorderLevel || 0,
          isActive: true,
          companyId: itemData.companyId || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        return tempItem;
      }
      
      return rejectWithValue(error.response?.data?.message || 'Failed to create item');
    }
  }
);

export const updateItem = createAsyncThunk(
  'inventory/updateItem',
  async ({ id, data }: { id: string; data: UpdateInventoryItemData }, { rejectWithValue }) => {
    try {
      const response = await inventoryService.updateItem(id, data);

      // Also update locally
      await databaseService.upsertInventoryItem(response.data);

      return response.data;
    } catch (error: any) {
      // Store as pending change if offline
      const isOffline = typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
      if (isOffline) {
        await databaseService.addPendingChange({
          type: 'item',
          action: 'update',
          data: { id, ...data },
        });
      }
      
      return rejectWithValue(error.response?.data?.message || 'Failed to update item');
    }
  }
);

export const deleteItem = createAsyncThunk(
  'inventory/deleteItem',
  async (itemId: string, { rejectWithValue }) => {
    try {
      await inventoryService.deleteItem(itemId);
      return itemId;
    } catch (error: any) {
      // Store as pending change if offline
      const isOffline = typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
      if (isOffline) {
        await databaseService.addPendingChange({
          type: 'item',
          action: 'delete',
          data: { id: itemId },
        });
        return itemId;
      }
      
      return rejectWithValue(error.response?.data?.message || 'Failed to delete item');
    }
  }
);

export const updateStock = createAsyncThunk(
  'inventory/updateStock',
  async (
    { itemId, quantity, type, reference, notes }: {
      itemId: string;
      quantity: number;
      type: 'in' | 'out' | 'adjustment';
      reference?: string;
      notes?: string;
    },
    { rejectWithValue }
  ) => {
    try {
      const response = await inventoryService.updateStock(itemId, {
        quantity,
        type,
        reference,
        notes,
      });

      return response.data;
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update stock');
    }
  }
);

const inventorySlice = createSlice({
  name: 'inventory',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setSelectedItem: (state, action: PayloadAction<InventoryItem | null>) => {
      state.selectedItem = action.payload;
    },
    setFilters: (state, action: PayloadAction<typeof initialState.filters>) => {
      state.filters = action.payload;
      state.pagination.page = 1;
      state.pagination.hasMore = true;
    },
    clearFilters: (state) => {
      state.filters = {};
      state.pagination.page = 1;
      state.pagination.hasMore = true;
    },
    resetPagination: (state) => {
      state.pagination = initialState.pagination;
    },
    updateItemStock: (state, action: PayloadAction<{ itemId: string; newStock: number }>) => {
      const { itemId, newStock } = action.payload;
      const item = state.items.find(i => i.id === itemId);
      if (item) {
        item.currentStock = newStock;
      }
      if (state.selectedItem?.id === itemId) {
        state.selectedItem.currentStock = newStock;
      }
    },
  },
  extraReducers: (builder) => {
    // Fetch items
    builder
      .addCase(fetchInventoryItems.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchInventoryItems.fulfilled, (state, action) => {
        state.isLoading = false;
        const { items, pagination, refresh } = action.payload;
        const pg = pagination as { page: number; limit: number; total: number; pages: number };

        if (refresh || pg.page === 1) {
          state.items = items;
        } else {
          const existingIds = new Set(state.items.map((i) => i.id));
          const merged = items.filter((i) => !existingIds.has(i.id));
          state.items = [...state.items, ...merged];
        }

        state.pagination = {
          page: pg.page,
          limit: pg.limit,
          total: pg.total,
          hasMore: pg.page < pg.pages,
        };
        state.lastFetchedAt = Date.now();
        state.error = null;
      })
      .addCase(fetchInventoryItems.rejected, (state, action) => {
        state.isLoading = false;
        if (state.items.length === 0) {
          state.error = action.payload as string;
        }
      });

    // Fetch stats
    builder
      .addCase(fetchInventoryStats.fulfilled, (state, action) => {
        state.stats = action.payload;
        state.statsFetchedAt = Date.now();
      });

    // Fetch item by ID
    builder
      .addCase(fetchItemById.fulfilled, (state, action) => {
        state.selectedItem = action.payload;
        
        // Update in list if exists
        const index = state.items.findIndex(i => i.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      });

    // Create item
    builder
      .addCase(createItem.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
        state.stats.total += 1;
      });

    // Update item
    builder
      .addCase(updateItem.fulfilled, (state, action) => {
        const index = state.items.findIndex(i => i.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
        if (state.selectedItem?.id === action.payload.id) {
          state.selectedItem = action.payload;
        }
      });

    // Delete item
    builder
      .addCase(deleteItem.fulfilled, (state, action) => {
        state.items = state.items.filter(i => i.id !== action.payload);
        if (state.selectedItem?.id === action.payload) {
          state.selectedItem = null;
        }
        state.stats.total = Math.max(0, state.stats.total - 1);
      });

    // Update stock
    builder
      .addCase(updateStock.fulfilled, (state, action) => {
        const item = action.payload;
        const index = state.items.findIndex(i => i.id === item.id);
        if (index !== -1) {
          state.items[index] = item;
        }
        if (state.selectedItem?.id === item.id) {
          state.selectedItem = item;
        }
      });
  },
});

export const {
  clearError,
  setSelectedItem,
  setFilters,
  clearFilters,
  resetPagination,
  updateItemStock,
} = inventorySlice.actions;

export default inventorySlice.reducer;
