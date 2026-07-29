/**
 * Types for the Transactions screen view models (derived from live vouchers).
 */
import { TransactionGroup } from '../constants/transactionTypes';

export interface TxnTypeSummary {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  group: TransactionGroup;
  amount: number;
  count: number;
  growthLabel: string;
  /** undefined = no comparison available (neutral). */
  growthPositive?: boolean;
  /** Daily totals across the active period (empty/short = no sparkline). */
  spark: number[];
}

export interface TxnTotals {
  moneyIn: { amount: number; count: number };
  moneyOut: { amount: number; count: number };
  netAmount: number;
  netPositive: boolean;
}
