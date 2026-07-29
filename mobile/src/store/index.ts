import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EncryptedStorage from 'react-native-encrypted-storage';

// Import reducers
import authReducer from './slices/authSlice';
import mlReducer from './slices/mlSlice';
import offlineReducer from './slices/offlineSlice';
import settingsReducer from './slices/settingsSlice';
import companyReducer from './slices/companySlice';
import syncReducer from './slices/syncSlice';
import voucherReducer from './slices/voucherSlice';
import inventoryReducer from './slices/inventorySlice';
import networkReducer from './slices/networkSlice';
import paymentReducer from './slices/paymentSlice';
import reportReducer from './slices/reportSlice';
import aiReducer from './slices/aiSlice';
import notificationReducer from './slices/notificationSlice';
import tallyReducer from './slices/tallySlice';

const companyPersistConfig = {
  key: 'company',
  storage: AsyncStorage,
  whitelist: ['selectedCompany', 'companies'],
};

const voucherPersistConfig = {
  key: 'voucher',
  storage: AsyncStorage,
  whitelist: ['vouchers', 'stats', 'statsFetchedAt', 'pagination', 'filters'],
};

const inventoryPersistConfig = {
  key: 'inventory',
  storage: AsyncStorage,
  whitelist: ['items', 'stats', 'lastFetchedAt', 'statsFetchedAt', 'pagination', 'filters'],
};

const syncPersistConfig = {
  key: 'sync',
  storage: AsyncStorage,
  whitelist: ['lastSyncTime', 'syncHistory', 'pendingChanges'],
};

const offlinePersistConfig = {
  key: 'offline',
  storage: AsyncStorage,
  blacklist: ['isOfflineMode'],
};

// Persist configuration
const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['settings'],
};

// Secure persist configuration for sensitive data
const authPersistConfig = {
  key: 'auth',
  storage: EncryptedStorage,
};

// Root reducer
const rootReducer = combineReducers({
  auth: persistReducer(authPersistConfig, authReducer),
  ml: mlReducer,
  offline: persistReducer(offlinePersistConfig, offlineReducer),
  settings: settingsReducer,
  company: persistReducer(companyPersistConfig, companyReducer),
  sync: persistReducer(syncPersistConfig, syncReducer),
  voucher: persistReducer(voucherPersistConfig, voucherReducer),
  inventory: persistReducer(inventoryPersistConfig, inventoryReducer),
  network: networkReducer,
  payment: paymentReducer,
  report: reportReducer,
  notification: notificationReducer,
  tally: tallyReducer,
  ai: aiReducer,
});

// Persisted reducer
const persistedReducer = persistReducer(persistConfig, rootReducer);

// Configure store
export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
  devTools: __DEV__,
});

// Persistor
export const persistor = persistStore(store);

// Types
export type RootState = ReturnType<typeof rootReducer>;
export type PersistedRootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
