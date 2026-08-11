// User and Authentication Types
export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'user' | 'admin' | 'superadmin';
  isEmailVerified: boolean;
  isActive: boolean;
  companies: string[];
  createdAt: string;
  updatedAt: string;
  lastLogin?: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
  /** Set only after the user agrees to sign their other device out. */
  forceLogin?: boolean;
}

/** The device already holding the session, shown before a takeover. */
export interface ActiveDevice {
  deviceId: string;
  deviceName: string;
  platform: string | null;
  lastSeenAt: string | null;
}

export interface RegisterData {
  name: string;
  email: string;
  phone: string;
  password: string;
  /** Omit or leave empty — real books come from Tally via desktop sync */
  companyName?: string;
}

export interface AuthResponse {
  success: boolean;
  /** Null when the account still needs OTP verification. */
  token: string | null;
  user: User | null;
  refreshToken?: string | null;
  message?: string;
  /** Set when the caller must collect an emailed OTP before a session exists. */
  requiresVerification?: boolean;
  email?: string;
}

/** Which flow an OTP belongs to. Must match the backend's OTP_PURPOSES. */
export type OtpPurpose = 'email_verification' | 'password_reset';

// Company Types
export interface Company {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  gstNumber?: string;
  panNumber?: string;
  isActive: boolean;
  settings: CompanySettings;
  createdAt: string;
  updatedAt: string;
  tallyIntegration?: {
    enabled?: boolean;
    companyPath?: string;
    companyName?: string;
    lastSyncDate?: string;
  };
}

export interface CompanySettings {
  currency?: string;
  timezone?: string;
  dateFormat?: string;
  fiscalYearStart?: string;
  gstEnabled?: boolean;
  inventoryEnabled?: boolean;
  multiCurrencyEnabled?: boolean;
  [key: string]: any;
}

// Voucher Types
export interface VoucherTotals {
  subtotal?: number;
  discount?: number;
  taxableAmount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
  totalTax?: number;
  roundOff?: number;
  grandTotal?: number;
}

export interface VoucherTerms {
  paymentTerms?: string;
  deliveryTerms?: string;
  otherTerms?: string;
}

export type TallyVoucherEntryMode =
  | 'item_invoice'
  | 'accounting_invoice'
  | 'as_voucher';

export interface Voucher {
  id: string;
  voucherNumber: string;
  voucherType: VoucherType;
  /** Tally parent type (ZVOUCHERPARENT) when synced from agent */
  tallyVoucherTypeParent?: string;
  /** Tally display type name (VOUCHERTYPENAME) */
  tallyVoucherTypeName?: string;
  date: string;
  dueDate?: string;
  partyName?: string;
  partyGstin?: string;
  salesLedgerName?: string;
  reference?: string | { number?: string; date?: string };
  narration?: string;
  amount: number;
  status: 'draft' | 'posted' | 'cancelled' | 'pending' | 'approved' | 'paid' | 'partially_paid';
  items?: VoucherItem[];
  entries: VoucherEntry[];
  /** Tally PERSISTEDVIEW — Accounting Voucher View | Invoice Voucher View */
  tallyPersistedView?: string;
  tallyEntryMode?: TallyVoucherEntryMode;
  totals?: VoucherTotals;
  terms?: VoucherTerms;
  companyId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tallyId?: string;
  lastSyncedAt?: string;
  tallySyncError?: string;
  salesLedgerName?: string;
  purchaseLedgerName?: string;
  tallyVoucherTypeName?: string;
  placeOfSupply?: string;
  /** Tally consignee/dispatch details, used by the printed invoice. */
  shipping?: {
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    };
    method?: string;
    trackingNumber?: string;
  };
  isSummaryOnly?: boolean;
  detailCached?: boolean;
}

export interface VoucherItem {
  id: string;
  itemId?: string;
  itemName: string;
  description?: string;
  quantity: number;
  unit?: string;
  rate: number;
  amount: number;
  hsnCode?: string;
  gst?: {
    cgst?: number;
    sgst?: number;
    igst?: number;
    cess?: number;
  };
}

export interface VoucherEntrySubLine {
  text: string;
  billType?: string;
  amount?: number;
  side?: string;
  isNarration?: boolean;
}

export interface VoucherEntry {
  id: string;
  accountId?: string;
  accountName: string;
  debitAmount: number;
  creditAmount: number;
  narration?: string;
  /** From Tally INVENTORYENTRIES → ACCOUNTINGALLOCATIONS.LIST (hide on item invoices) */
  isAccountingAllocation?: boolean;
  /** Tally bill refs / sub-lines under a ledger (As Voucher mode) */
  subLines?: VoucherEntrySubLine[];
}

export type VoucherType = 
  | 'sales' 
  | 'purchase' 
  | 'receipt' 
  | 'payment' 
  | 'journal' 
  | 'contra' 
  | 'debit_note' 
  | 'credit_note'
  | 'sales_order'
  | 'purchase_order'
  | 'receipt_note'
  | 'delivery_note';

// Inventory Types
export interface InventoryItem {
  id: string;
  name: string;
  code: string;
  description?: string;
  category: string;
  unit: string;
  rate: number;
  openingStock: number;
  currentStock: number;
  tallyStock?: {
    unit?: string;
    openingBalance?: number;
    inwardQuantity?: number;
    outwardQuantity?: number;
    closingBalance?: number;
  };
  reorderLevel: number;
  maxLevel?: number;
  location?: string;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  tallyId?: string;
  lastSyncedAt?: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  movementType: 'in' | 'out' | 'adjustment';
  quantity: number;
  rate: number;
  amount: number;
  reference: string;
  date: string;
  companyId: string;
  createdAt: string;
}

// Sync Types
export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'uploading' | 'completed' | 'error';

export interface SyncProgress {
  type: string;
  current: number;
  total: number;
  percentage: number;
  message: string;
}

export interface SyncSession {
  id: string;
  startTime: string;
  endTime?: string;
  status: SyncStatus;
  totalItems: number;
  processedItems: number;
  errors: SyncError[];
  summary: SyncSummary;
  conflicts?: SyncConflict[];
}

export interface SyncError {
  type: string;
  item: string;
  error: string;
  timestamp: string;
}

export interface SyncSummary {
  companies?: { total: number; processed: number; errors: number };
  vouchers?: { total: number; processed: number; errors: number };
  items?: { total: number; processed: number; errors: number };
  parties?: { total: number; processed: number; errors: number };
}

export interface SyncConflict {
  id: string;
  entityType: 'voucher' | 'item' | 'company' | 'party';
  entityId: string;
  conflictType: 'data_mismatch' | 'duplicate' | 'missing';
  localData: Record<string, any>;
  remoteData: Record<string, any>;
  status: 'pending' | 'resolved';
  createdAt: string;
}

// Network Types
export interface NetworkState {
  isConnected: boolean;
  type: string;
  isInternetReachable: boolean;
}

// Settings Types
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: string;
  autoSync: boolean;
  syncInterval: number;
  biometricEnabled: boolean;
  notificationsEnabled: boolean;
  offlineMode: boolean;
  debugMode: boolean;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Error Types
export interface AppError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
}

// Redux State Types
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  refreshToken: string | null;
  error: string | null;
}

export interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  autoSync: boolean;
  syncInterval: number;
  biometricEnabled: boolean;
  notificationsEnabled: boolean;
  offlineMode: boolean;
  debugMode: boolean;
  isFirstLaunch: boolean;
}

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  pendingChanges: number;
  currentSession: SyncSession | null;
  sessions: SyncSession[];
  progress: SyncProgress | null;
  error: string | null;
}

export interface InventoryState {
  items: InventoryItem[];
  isLoading: boolean;
  error: string | null;
  filters: {
    category: string;
    search: string;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
}

export interface MLState {
  isMLServiceAvailable: boolean;
  businessMetrics: BusinessMetrics | null;
  predictions: MLPrediction[];
  isLoading: boolean;
  error: string | null;
}

export interface CompanyState {
  companies: Company[];
  selectedCompany: Company | null;
  isLoading: boolean;
  error: string | null;
}

export interface VoucherState {
  vouchers: Voucher[];
  isLoading: boolean;
  error: string | null;
  filters: {
    type: string;
    dateFrom: string;
    dateTo: string;
    search: string;
  };
}

export interface OfflineState {
  queuedActions: any[];
  pendingUploads: any[];
  lastSyncAttempt: string | null;
  conflictResolution: 'server' | 'local' | 'manual';
}

// ML Types
export interface MLPrediction {
  id: string;
  type: 'payment' | 'risk' | 'forecast';
  input: any;
  output: any;
  confidence: number;
  timestamp: string;
}

export interface BusinessMetrics {
  revenue: number;
  expenses: number;
  profit: number;
  cashFlow: number;
  period: string;
  trends: {
    revenue: number;
    expenses: number;
    profit: number;
  };
}

// Additional types for services
export interface CreateCompanyData {
  name: string;
  email: string;
  phone: string;
  address: string;
  gstNumber?: string;
  panNumber?: string;
  settings?: Partial<CompanySettings>;
}

export interface UpdateCompanyData {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  gstNumber?: string;
  panNumber?: string;
  settings?: Partial<CompanySettings>;
}

/** Line item for mobile sales invoice → Tally import */
export interface SalesVoucherItemLine {
  itemId?: string;
  itemName: string;
  description?: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  godownName?: string;
  hsnCode?: string;
  taxType: 'IGST' | 'CGST/SGST';
  taxPercent: number;
  discountPercent?: number;
  igstLedgerName?: string;
  cgstLedgerName?: string;
  sgstLedgerName?: string;
}

export interface SalesExtraLedgerLine {
  ledgerName: string;
  amount: number;
  isPercent?: boolean;
}

export interface CreateVoucherData {
  voucherNumber?: string;
  voucherType: VoucherType;
  date: string;
  reference?: string;
  narration?: string;
  amount?: number;
  entries?: VoucherEntry[];
  companyId: string;
  createdBy?: string;
  tallyCompanyName?: string;
  bankLedgerName?: string;
  paymentMode?: string;
  /** Sales → Tally */
  party?: string;
  partyName?: string;
  items?: Array<{
    item?: string;
    itemName: string;
    description?: string;
    quantity: number;
    unit?: string;
    rate: number;
    amount: number;
    hsnCode?: string;
    godownName?: string;
    taxType?: string;
    taxPercent?: number;
    gst?: { cgst?: number; sgst?: number; igst?: number };
  }>;
  ledgerEntries?: Array<{
    ledger: string;
    debit?: number;
    credit?: number;
    amount?: number;
  }>;
  salesLedgerName?: string;
  tallyVoucherTypeName?: string;
  isOptional?: boolean;
  placeOfSupply?: string;
  partyGstin?: string;
}

export interface TallyPushResult {
  status: 'completed' | 'failed' | 'skipped' | 'queued';
  message?: string;
  tallyGuid?: string;
  voucherNumber?: string;
}

export interface CreateVoucherResponse {
  success: boolean;
  data: Voucher;
  tallyPush?: TallyPushResult;
}

export interface UpdateVoucherData {
  voucherType?: VoucherType;
  date?: string;
  reference?: string;
  narration?: string;
  entries?: VoucherEntry[];
  status?: 'draft' | 'posted' | 'cancelled';
}

export interface CreateInventoryItemData {
  name: string;
  code: string;
  description?: string;
  category: string;
  unit: string;
  rate: number;
  openingStock: number;
  reorderLevel: number;
  maxLevel?: number;
  location?: string;
  companyId: string;
}

export interface UpdateInventoryItemData {
  name?: string;
  code?: string;
  description?: string;
  category?: string;
  unit?: string;
  rate?: number;
  reorderLevel?: number;
  maxLevel?: number;
  location?: string;
}
