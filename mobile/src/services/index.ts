import { databaseService } from './databaseService';
import { webSocketService } from './webSocketService';
import { syncService } from './syncService';
import { authService } from './authService';
import { userService } from './userService';
import { mlService } from './mlService';
import { companyService } from './companyService';
import { voucherService } from './voucherService';
import { partyService } from './partyService';
import { inventoryService } from './inventoryService';
import { paymentService } from './paymentService';
import { reportService } from './reportService';
import { notificationService } from './notificationService';
import { tallyService } from './tallyService';
import { billingService } from './billingService';
import { offlineManager } from './offlineManager';
import { offlineCacheService } from './offlineCacheService';
import { biometricService } from './biometricService';
import { realTimeManager } from './realTimeManager';
import { collaborativeEditingService } from './collaborativeEditingService';
import { configurePushNotifications } from './pushNotificationSetup';

/**
 * Core startup (database only). Real-time services run after company bootstrap.
 */
export const initializeServices = async (): Promise<void> => {
  try {
    console.log('Initializing core services...');
    configurePushNotifications();
    await databaseService.initialize();
    console.log('✓ Database service initialized');
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
};

/**
 * WebSocket / real-time — call only after auth + company context are ready.
 */
export const initializeRealtimeServices = async (): Promise<void> => {
  try {
    const isAuthenticated = await authService.isAuthenticated();
    if (!isAuthenticated) {
      return;
    }

    await webSocketService.initialize();
    await realTimeManager.initialize();
    if (webSocketService.connected) {
      console.log('✓ Real-time services connected');
    } else if (__DEV__) {
      console.log('✓ App ready (real-time sync optional, not connected)');
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('Real-time services skipped:', error);
    }
  }
};

/**
 * Cleanup all services
 */
export const cleanupServices = async (): Promise<void> => {
  try {
    console.log('Cleaning up services...');

    // Cleanup real-time manager
    realTimeManager.cleanup();
    console.log('✓ Real-time manager cleaned up');

    // Cleanup collaborative editing
    collaborativeEditingService.cleanup();
    console.log('✓ Collaborative editing cleaned up');

    // Disconnect WebSocket
    webSocketService.disconnect();
    console.log('✓ WebSocket disconnected');

    // Close database
    await databaseService.close();
    console.log('✓ Database closed');

    console.log('Services cleaned up successfully');
  } catch (error) {
    console.error('Failed to cleanup services:', error);
  }
};

// Export services
export {
  databaseService,
  webSocketService,
  syncService,
  authService,
  userService,
  mlService,
  companyService,
  voucherService,
  partyService,
  inventoryService,
  paymentService,
  reportService,
  notificationService,
  tallyService,
  billingService,
  offlineManager,
  offlineCacheService,
  biometricService,
  realTimeManager,
  collaborativeEditingService,
};

// Export API client
export { apiClient } from './apiClient';
