/** Tally import defaults per FinSync voucher slug */
export const VOUCHER_TALLY_IMPORT = {
  sales: {
    vchType: 'Sales',
    defaultVoucherTypeName: 'Sales',
    voucherMode: 'sales',
    accountLedgerField: 'salesLedgerName',
    defaultAccountLedger: 'Sales GST'
  },
  purchase: {
    vchType: 'Purchase',
    defaultVoucherTypeName: 'Purchase',
    voucherMode: 'purchase',
    accountLedgerField: 'purchaseLedgerName',
    defaultAccountLedger: 'Purchase'
  },
  sales_order: {
    vchType: 'Sales Order',
    defaultVoucherTypeName: 'Sales Order',
    voucherMode: 'sales_order',
    accountLedgerField: 'salesLedgerName',
    defaultAccountLedger: 'Sales GST'
  },
  purchase_order: {
    vchType: 'Purchase Order',
    defaultVoucherTypeName: 'Purchase Order',
    voucherMode: 'purchase_order',
    accountLedgerField: 'purchaseLedgerName',
    defaultAccountLedger: 'Purchase'
  },
  receipt: {
    vchType: 'Receipt',
    defaultVoucherTypeName: 'Receipt',
    accounting: true
  },
  payment: {
    vchType: 'Payment',
    defaultVoucherTypeName: 'Payment',
    accounting: true
  },
  journal: {
    vchType: 'Journal',
    defaultVoucherTypeName: 'Journal',
    accounting: true
  }
};

export function getVoucherImportMeta(voucherType) {
  return VOUCHER_TALLY_IMPORT[voucherType] || null;
}

export function supportsTallyImport(voucherType) {
  return Boolean(getVoucherImportMeta(voucherType));
}
