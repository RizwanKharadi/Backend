// Navigation Parameter Lists
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { SalesVoucherItemLine } from './index';

export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token: string };
  BiometricSetup: undefined;
};

export type MainStackParamList = {
  Tabs: undefined;
  Settings: undefined;
  Profile: undefined;
  LoginHistory: undefined;
  ChangePassword: undefined;
  CompanySelection: undefined;
  InventoryList: { initialFilter?: 'all' | 'ok' | 'low' | 'out' } | undefined;
  VoucherDetail: { voucherId: string };
  CreateVoucher: { type?: string };
  CreateNewVoucher: { initialType?: string };
  CreateJournal: undefined;
  CreateItemVoucher: {
    voucherType: 'sales' | 'purchase' | 'sales_order' | 'purchase_order';
    partyId: string;
    partyName: string;
    partyGstin?: string;
    placeOfSupply?: string;
    savedItem?: SalesVoucherItemLine;
    itemIndex?: number;
  };
  CreateReceiptPayment: {
    voucherType: 'receipt' | 'payment';
    partyId: string;
    partyName: string;
    partyGstin?: string;
  };
  /** @deprecated use CreateItemVoucher with voucherType sales */
  CreateSalesInvoice: {
    partyId: string;
    partyName: string;
    partyGstin?: string;
    placeOfSupply?: string;
    savedItem?: SalesVoucherItemLine;
    itemIndex?: number;
  };
  AddInvoiceItem: {
    voucherType: 'sales' | 'purchase' | 'sales_order' | 'purchase_order';
    itemIndex?: number;
    item?: SalesVoucherItemLine;
  };
  /** @deprecated use AddInvoiceItem */
  AddSalesItem: {
    itemIndex?: number;
    item?: SalesVoucherItemLine;
  };
  ItemDetail: { itemId: string };
  CreateItem: { barcode?: string } | undefined;
  BarcodeScanner: {
    title?: string;
    onScanned: (barcode: string) => void;
  };
  CreateLedger: undefined;
  AskYourBusiness: undefined;
  PaymentPrediction: undefined;
  RiskAssessment: undefined;
  InventoryForecast: undefined;
  Payment: undefined;
  Notifications: undefined;
  TallyIntegration: undefined;
  Billing: undefined;
  Sync: undefined;
  VoucherTypes: undefined;
  FilteredVouchers: { voucherType: string; title: string };
  DayBook: { fromDate?: string; toDate?: string };
};

export type ReportsStackParamList = {
  ReportsHome: undefined;
  VouchersList: undefined;
  ProfitLoss: undefined;
  ProfitLossGroup: {
    groupName: string;
    periodKey?: string;
    groupAmount?: number;
    reportKind?: 'profit_loss' | 'balance_sheet';
  };
  ProfitLossLedgerVouchers: {
    ledgerName: string;
    periodKey?: string;
    groupName?: string;
    reportKind?: 'profit_loss' | 'balance_sheet';
  };
  BalanceSheet: undefined;
  CashBankBook: undefined;
  CashBankBookLedgers: {
    parentGroup: string;
    periodKey?: string;
    groupDebit?: number;
    groupCredit?: number;
  };
  CashBankBookVouchers: {
    ledgerName: string;
    periodKey?: string;
    parentGroup?: string;
  };
  TopTenReport: undefined;
  FastMovingItems: undefined;
  OutstandingReceivable: undefined;
  OutstandingLedgerDetail: { partyName: string };
  InactiveCustomer: undefined;
  InactiveItem: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Transactions: undefined;
  Inventory: undefined;
  Reports: NavigatorScreenParams<ReportsStackParamList>;
  AskYourBusiness: undefined;
};

// Screen Props Types
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

export type RootStackScreenProps<T extends keyof RootStackParamList> = 
  NativeStackScreenProps<RootStackParamList, T>;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = 
  NativeStackScreenProps<AuthStackParamList, T>;

export type MainStackScreenProps<T extends keyof MainStackParamList> = 
  NativeStackScreenProps<MainStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = 
  BottomTabScreenProps<MainTabParamList, T>;

export type ReportsStackScreenProps<T extends keyof ReportsStackParamList> =
  NativeStackScreenProps<ReportsStackParamList, T>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
