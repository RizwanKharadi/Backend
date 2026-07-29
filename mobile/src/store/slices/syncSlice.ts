import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { syncService } from '../../services/syncService';
import { SyncStatus, SyncSession, SyncProgress } from '../../types';

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  syncProgress: SyncProgress | null;
  syncHistory: SyncSession[];
  pendingChanges: number;
  syncStatus: SyncStatus;
  error: string | null;
  autoSyncEnabled: boolean;
  syncInterval: number; // in minutes
}

const initialState: SyncState = {
  isOnline: false,
  isSyncing: false,
  lastSyncTime: null,
  syncProgress: null,
  syncHistory: [],
  pendingChanges: 0,
  syncStatus: 'idle',
  error: null,
  autoSyncEnabled: true,
  syncInterval: 5,
};

// Async thunks
export const startSync = createAsyncThunk(
  'sync/startSync',
  async (_, { rejectWithValue }) => {
    try {
      const result = await syncService.startSync();
      return result;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Sync failed');
    }
  }
);

export const stopSync = createAsyncThunk(
  'sync/stopSync',
  async (_, { rejectWithValue }) => {
    try {
      await syncService.stopSync();
      return true;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to stop sync');
    }
  }
);

export const forceSync = createAsyncThunk(
  'sync/forceSync',
  async (_, { rejectWithValue }) => {
    try {
      const result = await syncService.forceSync();
      return result;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Force sync failed');
    }
  }
);

export const getSyncStatus = createAsyncThunk(
  'sync/getSyncStatus',
  async (_, { rejectWithValue }) => {
    try {
      const status = await syncService.getSyncStatus();
      return status;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to get sync status');
    }
  }
);

export const uploadPendingChanges = createAsyncThunk(
  'sync/uploadPendingChanges',
  async (_, { rejectWithValue }) => {
    try {
      const result = await syncService.uploadPendingChanges();
      return result;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to upload pending changes');
    }
  }
);

export const updateSyncSettings = createAsyncThunk(
  'sync/updateSyncSettings',
  async (settings: { autoSync?: boolean; syncInterval?: number }, { rejectWithValue }) => {
    try {
      if (typeof settings.autoSync === 'boolean') {
        // Placeholder for persisted settings update when backend/settings endpoint is wired.
      }
      if (typeof settings.syncInterval === 'number') {
        // Placeholder for persisted settings update when backend/settings endpoint is wired.
      }
      return settings;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to update sync settings');
    }
  }
);

// Sync slice
const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    setOnlineStatus: (state, action: PayloadAction<boolean>) => {
      state.isOnline = action.payload;
      if (action.payload && state.autoSyncEnabled && state.pendingChanges > 0) {
        // Trigger sync when coming online with pending changes
        state.syncStatus = 'pending';
      }
    },
    setSyncProgress: (state, action: PayloadAction<SyncProgress>) => {
      state.syncProgress = action.payload;
    },
    addPendingChange: (state) => {
      state.pendingChanges += 1;
    },
    removePendingChanges: (state, action: PayloadAction<number>) => {
      state.pendingChanges = Math.max(0, state.pendingChanges - action.payload);
    },
    clearPendingChanges: (state) => {
      state.pendingChanges = 0;
    },
    setAutoSyncEnabled: (state, action: PayloadAction<boolean>) => {
      state.autoSyncEnabled = action.payload;
    },
    setSyncInterval: (state, action: PayloadAction<number>) => {
      state.syncInterval = action.payload;
    },
    addSyncSession: (state, action: PayloadAction<SyncSession>) => {
      state.syncHistory.unshift(action.payload);
      // Keep only last 50 sessions
      if (state.syncHistory.length > 50) {
        state.syncHistory = state.syncHistory.slice(0, 50);
      }
    },
    clearSyncError: (state) => {
      state.error = null;
    },
    pauseSync: (state) => {
      state.isSyncing = false;
      state.syncStatus = 'paused';
    },
    resumeSync: (state) => {
      state.syncStatus = 'pending';
    },
    updateSyncStatus: (state, action: PayloadAction<SyncStatus>) => {
      state.syncStatus = action.payload;
    },
  },
  extraReducers: (builder) => {
    // Start sync
    builder
      .addCase(startSync.pending, (state) => {
        state.isSyncing = true;
        state.syncStatus = 'syncing';
        state.error = null;
      })
      .addCase(startSync.fulfilled, (state, action) => {
        state.isSyncing = false;
        state.syncStatus = 'completed';
        state.lastSyncTime = new Date().toISOString();
        if (action.payload.session) {
          state.syncHistory.unshift(action.payload.session);
        }
      })
      .addCase(startSync.rejected, (state, action) => {
        state.isSyncing = false;
        state.syncStatus = 'error';
        state.error = action.payload as string;
      });

    // Stop sync
    builder
      .addCase(stopSync.fulfilled, (state) => {
        state.isSyncing = false;
        state.syncStatus = 'idle';
        state.syncProgress = null;
      });

    // Force sync
    builder
      .addCase(forceSync.pending, (state) => {
        state.isSyncing = true;
        state.syncStatus = 'syncing';
        state.error = null;
      })
      .addCase(forceSync.fulfilled, (state, action) => {
        state.isSyncing = false;
        state.syncStatus = 'completed';
        state.lastSyncTime = new Date().toISOString();
        if (action.payload.session) {
          state.syncHistory.unshift(action.payload.session);
        }
      })
      .addCase(forceSync.rejected, (state, action) => {
        state.isSyncing = false;
        state.syncStatus = 'error';
        state.error = action.payload as string;
      });

    // Get sync status
    builder
      .addCase(getSyncStatus.fulfilled, (state, action) => {
        state.syncStatus = action.payload.status;
        state.lastSyncTime = action.payload.lastSyncTime;
        state.pendingChanges = action.payload.pendingChanges || 0;
        if (action.payload.history) {
          state.syncHistory = action.payload.history;
        }
      });

    // Upload pending changes
    builder
      .addCase(uploadPendingChanges.pending, (state) => {
        state.isSyncing = true;
        state.syncStatus = 'uploading';
      })
      .addCase(uploadPendingChanges.fulfilled, (state, action) => {
        state.isSyncing = false;
        state.syncStatus = 'completed';
        state.pendingChanges = Math.max(0, state.pendingChanges - (action.payload.uploaded || 0));
        state.lastSyncTime = new Date().toISOString();
      })
      .addCase(uploadPendingChanges.rejected, (state, action) => {
        state.isSyncing = false;
        state.syncStatus = 'error';
        state.error = action.payload as string;
      });

    builder
      .addCase(updateSyncSettings.fulfilled, (state, action) => {
        if (typeof action.payload.autoSync === 'boolean') {
          state.autoSyncEnabled = action.payload.autoSync;
        }
        if (typeof action.payload.syncInterval === 'number') {
          state.syncInterval = action.payload.syncInterval;
        }
      });
  },
});

export const {
  setOnlineStatus,
  setSyncProgress,
  addPendingChange,
  removePendingChanges,
  clearPendingChanges,
  setAutoSyncEnabled,
  setSyncInterval,
  addSyncSession,
  clearSyncError,
  pauseSync,
  resumeSync,
  updateSyncStatus,
} = syncSlice.actions;

export default syncSlice.reducer;
