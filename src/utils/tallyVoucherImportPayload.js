/**
 * Map MongoDB Voucher document → desktop-agent Tally import payload.
 */

import { getVoucherImportMeta } from './tallyVoucherImportTypes.js';

function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapItems(voucher, options = {}) {
  return (voucher.items || []).map((line) => ({
    itemName: line.itemName || line.description || 'Item',
    quantity: Number(line.quantity) || 0,
    unit: line.unit || 'Nos',
    rate: Number(line.rate) || 0,
    amount: Number(line.amount) || 0,
    hsnCode: line.hsnCode || '',
    godownName: line.godownName || line.godown || options.defaultGodown || 'Main Location',
    taxType: line.taxType || (line.gst?.igst > 0 ? 'IGST' : 'CGST/SGST'),
    taxPercent:
      line.taxPercent ??
      line.taxPercentage ??
      (line.gst?.igst || 0) + (line.gst?.cgst || 0) + (line.gst?.sgst || 0),
    igstLedgerName: line.igstLedgerName,
    cgstLedgerName: line.cgstLedgerName,
    sgstLedgerName: line.sgstLedgerName,
    description: line.description || '',
    salesLedgerName: line.salesLedgerName || options.salesLedgerName,
    purchaseLedgerName: line.purchaseLedgerName || options.purchaseLedgerName
  }));
}

/** Tally order no. / reference — same as FinSync voucher number when not set explicitly */
function resolveTallyReference(voucher) {
  const ref = voucher.reference;
  const explicit =
    typeof ref === 'object' && ref !== null
      ? String(ref.number || '').trim()
      : ref != null
        ? String(ref).trim()
        : '';
  if (explicit) return explicit;
  return String(voucher.voucherNumber || '').trim();
}

function mapLedgerEntries(voucher, options = {}) {
  const rawLedgerRows = options.extraLedgerEntries || voucher.ledgerEntries || [];
  return rawLedgerRows.map((row) => ({
    ledgerName:
      row.ledger ||
      row.ledgerName ||
      row.accountName ||
      (typeof row.ledger === 'object' ? row.ledger?.name : ''),
    amount: Number(row.amount || row.credit || row.debit || 0),
    debit: Number(row.debit || row.debitAmount || 0),
    credit: Number(row.credit || row.creditAmount || 0),
    isPartyLedger: Boolean(row.isPartyLedger),
    isDeemedPositive: row.isDeemedPositive,
    methodType: row.methodType || (row.credit ? 'GST' : undefined)
  }));
}

export function buildVoucherImportPayload(voucher, company, options = {}) {
  const meta = getVoucherImportMeta(voucher.voucherType);
  if (!meta) {
    throw new Error(`Voucher type "${voucher.voucherType}" is not supported for Tally import`);
  }

  const companyName =
    options.companyName ||
    company?.tallyIntegration?.companyName ||
    company?.displayName ||
    company?.name ||
    '';

  const party =
    voucher.partyName ||
    (typeof voucher.party === 'object' && voucher.party?.name) ||
    options.partyLedgerName ||
    '';

  const reference = resolveTallyReference(voucher);
  const isItemVoucher = ['sales', 'purchase', 'sales_order', 'purchase_order'].includes(
    voucher.voucherType
  );

  const vchType =
    options.voucherTypeName?.split(' ')[0] ||
    meta.vchType;
  const voucherTypeName =
    options.voucherTypeName ||
    voucher.tallyVoucherTypeName ||
    meta.defaultVoucherTypeName;

  const accountLedger =
    options.salesLedgerName ||
    options.purchaseLedgerName ||
    options.accountLedgerName ||
    voucher.salesLedgerName ||
    voucher.purchaseLedgerName ||
    meta.defaultAccountLedger;

  const isOrder = ['sales_order', 'purchase_order'].includes(voucher.voucherType);

  const base = {
    remoteId: voucher._id?.toString(),
    companyName,
    voucherType: voucher.voucherType,
    vchType: options.vchType || meta.vchType || vchType,
    voucherMode: meta.voucherMode || voucher.voucherType,
    voucherTypeName,
    date: formatDate(voucher.date),
    partyLedgerName: party,
    partyName: party,
    // voucherNumber always sent for REFERENCE fallback; XML omits VOUCHERNUMBER tag for orders
    voucherNumber: voucher.voucherNumber,
    useManualVoucherNumber: Boolean(options.useManualVoucherNumber) && !isOrder,
    reference: isItemVoucher ? reference : reference || undefined,
    narration: voucher.narration || '',
    isOptional: Boolean(options.isOptional ?? voucher.isOptional),
    placeOfSupply: options.placeOfSupply || voucher.placeOfSupply || '',
    partyGstin:
      options.partyGstin ||
      voucher.partyGstin ||
      (typeof voucher.party === 'object' ? voucher.party?.gstin : '') ||
      '',
    billName:
      options.billName ||
      (['purchase', 'purchase_order'].includes(voucher.voucherType) ? reference : '') ||
      voucher.voucherNumber
  };

  if (meta.accounting) {
    return buildAccountingImportPayload(voucher, base, options);
  }

  const ledgerEntries = mapLedgerEntries(voucher, options);
  const grandTotal =
    Number(options.amount) ||
    Number(voucher.amount) ||
    Number(voucher.totals?.grandTotal) ||
    0;

  const payload = {
    ...base,
    amount: grandTotal > 0 ? grandTotal : undefined,
    items: mapItems(voucher, options),
    ledgerEntries: ledgerEntries.length > 0 ? ledgerEntries : undefined
  };

  if (meta.accountLedgerField === 'purchaseLedgerName') {
    payload.purchaseLedgerName = accountLedger;
  } else {
    payload.salesLedgerName = accountLedger;
  }

  return payload;
}

function resolveBankLedgerName(voucher, party, options = {}) {
  const explicit =
    options.bankLedgerName ||
    voucher.payment?.bank ||
    options.bankLedger ||
    '';
  if (explicit) return String(explicit).trim();

  const entries = options.ledgerEntries || voucher.ledgerEntries || voucher.entries || [];
  const partyLower = String(party || '').toLowerCase();
  for (const row of entries) {
    const name = String(row.ledger || row.ledgerName || row.accountName || '').trim();
    if (name && name.toLowerCase() !== partyLower) return name;
  }
  return '';
}

function buildAccountingImportPayload(voucher, base, options = {}) {
  const party = base.partyLedgerName || base.partyName || '';
  const reference = resolveTallyReference(voucher);
  const billName = options.billName || reference || '';
  const amount =
    Number(options.amount) ||
    Number(voucher.amount) ||
    Number(voucher.totals?.grandTotal) ||
    0;

  return {
    ...base,
    amount,
    bankLedgerName: resolveBankLedgerName(voucher, party, options),
    billName,
    billType: billName ? options.billType || 'Agst Ref' : 'New Ref',
    paymentMode:
      options.paymentMode ||
      voucher.payment?.method ||
      options.payment?.method ||
      '',
    instrumentNumber:
      options.instrumentNumber ||
      voucher.payment?.transactionId ||
      voucher.payment?.chequeNumber ||
      '',
    reference,
    ledgerEntries: options.ledgerEntries || voucher.ledgerEntries || voucher.entries || []
  };
}

/** @alias buildVoucherImportPayload for sales */
export function buildSalesImportPayload(voucher, company, options = {}) {
  return buildVoucherImportPayload(
    { ...voucher.toObject?.() || voucher, voucherType: voucher.voucherType || 'sales' },
    company,
    options
  );
}
