/**
 * View-model types for the premium Inventory command-center screen.
 */

export interface InventoryOverview {
  totalItems: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  totalValue: number;
}

export type AttentionStatus = 'out' | 'low';

export interface AttentionItemVM {
  id: string;
  name: string;
  code?: string;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  status: AttentionStatus;
}

export interface CategoryVM {
  name: string;
  count: number;
}

export type InventoryStatKind = 'total' | 'in' | 'low' | 'out';
