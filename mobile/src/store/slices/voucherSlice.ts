import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { voucherService } from '../../services/voucherService';
import { databaseService } from '../../services/databaseService';
import { offlineCacheService } from '../../services/offlineCacheService';
import { Voucher, CreateVoucherData, UpdateVoucherData } from '../../types';

interface VoucherState {
  vouchers: Voucher[];
  selectedVoucher: Voucher | null;
  isLoading: boolean;
  error: string | null;
  stats: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    totalAmount: number;
    thisMonth: number;
    salesThisMonth?: number;
    purchasesThisMonth?: number;
    lastMonth: number;
  };
  filters: {
    type?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  statsFetchedAt: number;
}

const initialState: VoucherState = {
  vouchers: [],
  selectedVoucher: null,
  isLoading: false,
  error: null,
  stats: {
    total: 0,
    byType: {},
    byStatus: {},
    totalAmount: 0,
    thisMonth: 0,
    lastMonth: 0,
  },
  filters: {},
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    hasMore: true,
  },
  statsFetchedAt: 0,
};

// Async thunks
export const fetchVouchers = createAsyncThunk(
  'voucher/fetchVouchers',
  async (params: { page?: number; refresh?: boolean } = {}, { getState, rejectWithValue }) => {
    const state = getState() as any;
    const { filters, pagination } = state.voucher;
    const companyId = state.company?.selectedCompany?.id;

    try {
      console.log('=================================');
console.log('FETCH VOUCHERS DEBUG');
console.log('Selected Company:', state.company?.selectedCompany);
console.log('Company ID:', companyId);
console.log('Filters:', filters);
console.log('Pagination:', pagination);
console.log('=================================');
      const page = params.page || (params.refresh ? 1 : pagination.page);

      const response = await voucherService.getVouchers({
        page,
        limit: pagination.limit,
        companyId,
        ...filters,
      });

      console.log('=================================');
console.log('VOUCHERS API RESPONSE');
console.log(JSON.stringify(response, null, 2));
console.log('=================================');

      if (companyId) {
        void offlineCacheService.saveVouchers(companyId, response.data);
      }

      return {
        vouchers: response.data,
        pagination: response.pagination,
        refresh: params.refresh,
      };
    } catch (error: any) {
      const cached = companyId ? await offlineCacheService.loadVouchers(companyId) : null;
      if (cached?.length) {
        return {
          vouchers: cached,
          pagination: {
            page: 1,
            limit: pagination.limit,
            total: cached.length,
            pages: 1,
          },
          refresh: true,
        };
      }
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch vouchers');
    }
  }
);

export const fetchVoucherById = createAsyncThunk(
  'voucher/fetchVoucherById',
  async (voucherId: string, { getState, rejectWithValue }) => {
    try {
      const response = await voucherService.getVoucherById(voucherId);
      return response.data;
    } catch (error: any) {
      const state = getState() as { voucher: { vouchers: Voucher[] }; company: { selectedCompany?: { id: string } } };
      const inList = state.voucher.vouchers.find((v) => v.id === voucherId);
      if (inList) return inList;
      const companyId = state.company?.selectedCompany?.id;
      const cached = companyId ? await offlineCacheService.loadVouchers(companyId) : null;
      const fromCache = cached?.find((v) => v.id === voucherId);
      if (fromCache) return fromCache;
      return rejectWithValue(error.message || 'Failed to fetch voucher');
    }
  }
);

export const hydrateVoucherFromTally = createAsyncThunk(
  'voucher/hydrateFromTally',
  async (voucherId: string, { rejectWithValue }) => {
    try {
      const response = await voucherService.hydrateVoucherFromTally(voucherId);
      return response.data;
    } catch (error: any) {
      const msg =
        error?.response?.data?.message ||
        error.message ||
        'Failed to load voucher detail from Tally';
      return rejectWithValue(msg);
    }
  }
);

export const fetchVoucherStats = createAsyncThunk(
  'voucher/fetchStats',
  async (companyId: string | undefined = undefined, { rejectWithValue }) => {
    try {
      const stats = await voucherService.getVoucherStats(companyId);
      if (companyId) {
        void offlineCacheService.saveVoucherStats(companyId, stats);
      }
      return stats;
    } catch (error: any) {
      if (companyId) {
        const cached = await offlineCacheService.loadVoucherStats(companyId);
        if (cached) return cached;
      }
      return rejectWithValue(error.message || 'Failed to fetch voucher stats');
    }
  }
);

export const createVoucher = createAsyncThunk(
  'voucher/createVoucher',
  async (voucherData: CreateVoucherData, { rejectWithValue }) => {
    try {
      const response = await voucherService.createVoucher(voucherData);

      // Also store locally for offline access
      await databaseService.upsertVoucher(response.data);

      return response.data;
    } catch (error: any) {
      // Store as pending change if offline
      const isOffline = typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
      if (isOffline) {
        await databaseService.addPendingChange({
          type: 'voucher',
          action: 'create',
          data: voucherData,
        });
        
        // Create temporary voucher for UI
        const tempVoucher: Voucher = {
          id: `temp_${Date.now()}`,
          voucherNumber: voucherData.voucherNumber || 'TEMP',
          voucherType: voucherData.voucherType || 'journal',
          date: voucherData.date || new Date().toISOString(),
          amount: voucherData.amount || 0,
          status: 'draft',
          entries: voucherData.entries || [],
          companyId: voucherData.companyId || '',
          createdBy: voucherData.createdBy || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        return tempVoucher;
      }
      
      return rejectWithValue(error.response?.data?.message || 'Failed to create voucher');
    }
  }
);

export const updateVoucher = createAsyncThunk(
  'voucher/updateVoucher',
  async ({ id, data }: { id: string; data: UpdateVoucherData }, { rejectWithValue }) => {
    try {
      const response = await voucherService.updateVoucher(id, data);

      // Also update locally
      await databaseService.upsertVoucher(response.data);

      return response.data;
    } catch (error: any) {
      // Store as pending change if offline
      const isOffline = typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
      if (isOffline) {
        await databaseService.addPendingChange({
          type: 'voucher',
          action: 'update',
          data: { id, ...data },
        });
      }
      
      return rejectWithValue(error.response?.data?.message || 'Failed to update voucher');
    }
  }
);

export const pushVoucherToTally = createAsyncThunk(
  'voucher/pushVoucherToTally',
  async (
    payload: {
      voucherId: string;
      options?: Parameters<typeof voucherService.pushVoucherToTally>[1];
    },
    { rejectWithValue }
  ) => {
    try {
      const response = await voucherService.pushVoucherToTally(
        payload.voucherId,
        payload.options
      );
      if (!response.success) {
        return rejectWithValue(response.message || 'Failed to push voucher to Tally');
      }
      const refreshed = await voucherService.getVoucherById(payload.voucherId);
      return refreshed.data;
    } catch (error: any) {
      const msg =
        error.response?.data?.message || error.message || 'Failed to push voucher to Tally';
      return rejectWithValue(msg);
    }
  }
);

export const deleteVoucher = createAsyncThunk(
  'voucher/deleteVoucher',
  async (voucherId: string, { rejectWithValue }) => {
    try {
      await voucherService.deleteVoucher(voucherId);
      return voucherId;
    } catch (error: any) {
      // Store as pending change if offline
      const isOffline = typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
      if (isOffline) {
        await databaseService.addPendingChange({
          type: 'voucher',
          action: 'delete',
          data: { id: voucherId },
        });
        return voucherId;
      }
      
      return rejectWithValue(error.response?.data?.message || 'Failed to delete voucher');
    }
  }
);

const voucherSlice = createSlice({
  name: 'voucher',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setSelectedVoucher: (state, action: PayloadAction<Voucher | null>) => {
      state.selectedVoucher = action.payload;
    },
    setFilters: (state, action: PayloadAction<typeof initialState.filters>) => {
      state.filters = action.payload;
      state.pagination.page = 1; // Reset pagination when filters change
    },
    clearFilters: (state) => {
      state.filters = {};
      state.pagination.page = 1;
    },
    resetPagination: (state) => {
      state.pagination = initialState.pagination;
    },
  },
  extraReducers: (builder) => {
    // Fetch vouchers
    builder
      .addCase(fetchVouchers.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchVouchers.fulfilled, (state, action) => {
        state.isLoading = false;
        const { vouchers, pagination, refresh } = action.payload;
        
        if (refresh || pagination.page === 1) {
          state.vouchers = vouchers;
        } else {
          state.vouchers = [...state.vouchers, ...vouchers];
        }
        
        state.pagination = {
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
          hasMore: pagination.page < pagination.pages,
        };
        state.error = null;
      })
      .addCase(fetchVouchers.rejected, (state, action) => {
        state.isLoading = false;
        if (state.vouchers.length === 0) {
          state.error = action.payload as string;
        }
      });

    // Fetch voucher by ID
    builder
      .addCase(fetchVoucherById.fulfilled, (state, action) => {
        state.selectedVoucher = action.payload;
        
        // Update in list if exists
        const index = state.vouchers.findIndex(v => v.id === action.payload.id);
        if (index !== -1) {
          state.vouchers[index] = action.payload;
        }
      });

    builder
      .addCase(hydrateVoucherFromTally.fulfilled, (state, action) => {
        state.selectedVoucher = action.payload;
        const index = state.vouchers.findIndex(v => v.id === action.payload.id);
        if (index !== -1) {
          state.vouchers[index] = action.payload;
        }
        state.error = null;
      })
      .addCase(hydrateVoucherFromTally.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    builder
      .addCase(fetchVoucherStats.fulfilled, (state, action) => {
        state.stats = action.payload;
        state.statsFetchedAt = Date.now();
      });

    // Create voucher
    builder
      .addCase(createVoucher.fulfilled, (state, action) => {
        state.vouchers.unshift(action.payload);
        state.pagination.total += 1;
      });

    // Update voucher
    builder
      .addCase(updateVoucher.fulfilled, (state, action) => {
        const index = state.vouchers.findIndex(v => v.id === action.payload.id);
        if (index !== -1) {
          state.vouchers[index] = action.payload;
        }
        if (state.selectedVoucher?.id === action.payload.id) {
          state.selectedVoucher = action.payload;
        }
      });

    builder
      .addCase(pushVoucherToTally.fulfilled, (state, action) => {
        const index = state.vouchers.findIndex(v => v.id === action.payload.id);
        if (index !== -1) {
          state.vouchers[index] = action.payload;
        }
        if (state.selectedVoucher?.id === action.payload.id) {
          state.selectedVoucher = action.payload;
        }
        state.error = null;
      })
      .addCase(pushVoucherToTally.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    // Delete voucher
    builder
      .addCase(deleteVoucher.fulfilled, (state, action) => {
        state.vouchers = state.vouchers.filter(v => v.id !== action.payload);
        if (state.selectedVoucher?.id === action.payload) {
          state.selectedVoucher = null;
        }
        state.pagination.total = Math.max(0, state.pagination.total - 1);
      });
  },
});

export const {
  clearError,
  setSelectedVoucher,
  setFilters,
  clearFilters,
  resetPagination,
} = voucherSlice.actions;

export default voucherSlice.reducer;
