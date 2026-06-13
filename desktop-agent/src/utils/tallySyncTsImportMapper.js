/**
 * Maps FinSync360 Tally import payloads to tally-sync-ts typed objects.
 * @see https://github.com/GreenHacker420/tally-sync-ts
 */

const {
  formatQty,
  formatRate,
  isPurchaseMode,
  formatSignedAmount
} = require('./tallyXmlShared');

function lineSubtotal(item) {
  const qty = Number(item.quantity) || 0;
  const rate = Number(item.rate) || 0;
  return Number(item.amount) > 0 ? Number(item.amount) : qty * rate;
}

function itemsSubtotal(items) {
  return (items || []).reduce((s, item) => s + lineSubtotal(item), 0);
}

function normalizeExtraLedgerRow(row) {
  const ledgerName = row.ledgerName || row.ledger || row.name || '';
  const amount = Math.abs(Number(row.amount || row.credit || row.debit || 0));
  return {
    ledgerName: String(ledgerName).trim(),
    amount,
    isPartyLedger: Boolean(row.isPartyLedger),
    isDeemedPositive: row.isDeemedPositive,
    methodType: row.methodType || 'GST'
  };
}

function resolveVoucherMode(payload = {}) {
  if (payload.voucherMode) return payload.voucherMode;
  const vt = String(payload.vchType || payload.voucherType || 'sales').toLowerCase();
  if (vt.includes('purchase_order')) return 'purchase_order';
  if (vt.includes('sales_order')) return 'sales_order';
  if (vt.includes('purchase')) return 'purchase';
  return 'sales';
}

function buildItemLedgerEntries(items, partyState, extraLedgers = [], voucherMode = 'sales') {
  const purchase = isPurchaseMode(voucherMode);
  const isOrder = String(voucherMode || '').includes('order');
  const partyName = partyState.partyLedgerName;
  const subtotal = itemsSubtotal(items);
  const partyBillOpts = isOrder
    ? { skipBillAllocations: true }
    : {
        billName: partyState.billName,
        billType: partyState.billType || 'New Ref'
      };
  const extras = (extraLedgers || [])
    .map(normalizeExtraLedgerRow)
    .filter((e) => e.ledgerName && !e.isPartyLedger);

  const partyAmount = (st, taxTotal) => (purchase ? st + taxTotal : -(st + taxTotal));
  const grossTotal = Number(partyState.grossTotal || 0);

  if (extras.length > 0) {
    const taxTotal = extras.reduce((s, e) => s + e.amount, 0);
    const computedGrand = subtotal + taxTotal;
    const useExplicitGrand =
      grossTotal > 0 && Math.abs(grossTotal - computedGrand) < 0.02;
    const partyLineAmount = useExplicitGrand
      ? purchase
        ? grossTotal
        : -grossTotal
      : partyAmount(subtotal, taxTotal);
    return [
      {
        ledgerName: partyName,
        amount: partyLineAmount,
        isPartyLedger: true,
        isDeemedPositive: !purchase,
        ...partyBillOpts
      },
      ...extras.map((e) => ({
        ledgerName: e.ledgerName,
        amount: purchase ? -Math.abs(e.amount) : Math.abs(e.amount),
        isPartyLedger: false,
        isDeemedPositive: purchase,
        methodType: e.methodType || 'GST'
      }))
    ];
  }

  const taxByLedger = new Map();
  for (const item of items || []) {
    const lineAmount = lineSubtotal(item);
    const pct = Number(item.taxPercent ?? item.taxPercentage ?? 0);
    const type = String(item.taxType || 'IGST').toUpperCase();
    const taxAmount = Number(((lineAmount * pct) / 100).toFixed(2));
    if (taxAmount <= 0) continue;

    if (type.includes('IGST')) {
      const name = item.igstLedgerName;
      if (!name) continue;
      taxByLedger.set(name, (taxByLedger.get(name) || 0) + taxAmount);
    } else {
      const cgstName = item.cgstLedgerName;
      const sgstName = item.sgstLedgerName;
      if (!cgstName || !sgstName) continue;
      const half = Number((taxAmount / 2).toFixed(2));
      taxByLedger.set(cgstName, (taxByLedger.get(cgstName) || 0) + half);
      taxByLedger.set(sgstName, (taxByLedger.get(sgstName) || 0) + (taxAmount - half));
    }
  }

  const taxTotal = [...taxByLedger.values()].reduce((s, v) => s + v, 0);
  const computedGrand = subtotal + taxTotal;
  const useExplicitGrand =
    grossTotal > 0 && Math.abs(grossTotal - computedGrand) < 0.02;
  const partyLineAmount = useExplicitGrand
    ? purchase
      ? grossTotal
      : -grossTotal
    : partyAmount(subtotal, taxTotal);

  const lines = [
    {
      ledgerName: partyName,
      amount: partyLineAmount,
      isPartyLedger: true,
      isDeemedPositive: !purchase,
      ...partyBillOpts
    }
  ];

  for (const [ledgerName, amount] of taxByLedger) {
    if (amount > 0) {
      lines.push({
        ledgerName,
        amount: purchase ? -amount : amount,
        isPartyLedger: false,
        isDeemedPositive: purchase,
        methodType: 'GST'
      });
    }
  }

  return lines;
}

function inferTaxPercentFromExtras(subtotal, extraLedgers) {
  if (!subtotal) return 0;
  const taxTotal = (extraLedgers || [])
    .map(normalizeExtraLedgerRow)
    .filter((e) => !e.isPartyLedger)
    .reduce((s, e) => s + e.amount, 0);
  if (!taxTotal) return 0;
  return Math.round((taxTotal / subtotal) * 10000) / 100;
}

function buildGstRateDetails(taxType, taxPercent) {
  const pct = Number(taxPercent) || 0;
  const type = String(taxType || 'IGST').toUpperCase();
  if (type.includes('IGST')) {
    return [
      { dutyHead: 'IGST', valuationType: 'Based on Value', rate: pct },
      { dutyHead: 'Cess', valuationType: 'Not Applicable' }
    ];
  }
  const half = pct / 2;
  return [
    { dutyHead: 'CGST', valuationType: 'Based on Value', rate: half },
    { dutyHead: 'SGST/UTGST', valuationType: 'Based on Value', rate: half },
    { dutyHead: 'Cess', valuationType: 'Not Applicable' }
  ];
}

function mapLedgerEntryLine(entry) {
  const amount = Number(entry.amount) || 0;
  const line = {
    ledgerName: entry.ledgerName,
    amount,
    isDeemedPositive: entry.isDeemedPositive != null ? Boolean(entry.isDeemedPositive) : Boolean(entry.isPartyLedger),
    isPartyLedger: Boolean(entry.isPartyLedger)
  };
  if (entry.billName && !entry.skipBillAllocations) {
    line.billAllocations = [
      {
        name: entry.billName,
        billType: entry.billType || 'New Ref',
        amount: Math.abs(amount)
      }
    ];
  }
  return line;
}

function mapInventoryLine(item, accountLedgerName, options = {}) {
  const mode = options.voucherMode || 'sales';
  const isOrder = Boolean(options.isOrder);
  const purchase = isPurchaseMode(mode);
  const qty = Number(item.quantity) || 0;
  const rate = Number(item.rate) || 0;
  const unit = item.unit || 'Nos';
  const amount = Number(item.amount) > 0 ? Number(item.amount) : qty * rate;
  const signedAmount = formatSignedAmount(amount, purchase);
  const taxType = item.taxType || options.defaultTaxType || 'IGST';
  const taxPercent =
    item.taxPercent ?? item.taxPercentage ?? options.inferredTaxPercent ?? 0;
  const accountLedger =
    accountLedgerName ||
    item.salesLedgerName ||
    item.purchaseLedgerName ||
    (purchase ? 'Purchase' : 'Sales GST');

  const inv = {
    stockItemName: item.itemName || item.stockItemName || item.name || '',
    quantity: formatQty(qty, unit),
    rate: formatRate(rate, unit),
    amount: signedAmount,
    isDeemedPositive: purchase,
    accountingAllocations: [
      {
        ledgerName: accountLedger,
        amount: signedAmount,
        isDeemedPositive: purchase
      }
    ],
    gstRateDetails: buildGstRateDetails(taxType, taxPercent)
  };

  const orderNo = String(options.orderNo || item.orderNo || '').trim();
  const hasGodown = Boolean(item.godownName || item.godown);
  if (hasGodown || isOrder) {
    inv.batchAllocations = [
      {
        godownName: item.godownName || item.godown || 'Main Location',
        batchName: item.batchName || '',
        orderNo: isOrder ? orderNo : undefined,
        actualQuantity: formatQty(qty, unit),
        billedQuantity: formatQty(qty, unit),
        amount: signedAmount
      }
    ];
  }

  return inv;
}

/**
 * FinSync item-invoice payload → tally-sync-ts Voucher.
 */
function mapItemVoucherPayload(payload = {}) {
  const voucherMode = resolveVoucherMode(payload);
  const isOrder = voucherMode.includes('order');
  const purchase = isPurchaseMode(voucherMode);
  const voucherType = payload.voucherTypeName || payload.vchType || 'Sales';
  const party = payload.partyLedgerName || payload.partyName || '';
  const items = Array.isArray(payload.items) ? payload.items : [];
  const extraLedgers = Array.isArray(payload.ledgerEntries) ? payload.ledgerEntries : [];
  const subtotal = itemsSubtotal(items);
  const inferredTaxPercent = inferTaxPercentFromExtras(subtotal, extraLedgers);
  const accountLedgerName =
    payload.salesLedgerName ||
    payload.purchaseLedgerName ||
    payload.accountLedgerName ||
    (purchase ? 'Purchase' : 'Sales GST');
  const orderReference = String(payload.reference || payload.voucherNumber || '').trim();

  const inventoryAllocations = items.map((item) =>
    mapInventoryLine(item, accountLedgerName, {
      voucherMode,
      isOrder,
      orderNo: orderReference,
      inferredTaxPercent,
      defaultTaxType: extraLedgers.length ? 'IGST' : 'IGST'
    })
  );

  let ledgerEntries = [];
  if (items.length > 0 && party) {
    const rawLines = buildItemLedgerEntries(
      items,
      {
        partyLedgerName: party,
        billName: payload.billName || orderReference || payload.voucherNumber,
        billType: payload.billType || 'New Ref',
        grossTotal: Number(payload.amount) > 0 ? Number(payload.amount) : undefined
      },
      extraLedgers,
      voucherMode
    );
    ledgerEntries = rawLines.map(mapLedgerEntryLine);
  } else if (extraLedgers.length > 0) {
    ledgerEntries = extraLedgers.map((row) => mapLedgerEntryLine(normalizeExtraLedgerRow(row)));
  }

  const includeVoucherNumber = !isOrder || Boolean(payload.useManualVoucherNumber);
  const voucher = {
    date: payload.date || new Date(),
    voucherType,
    partyName: party,
    narration: payload.narration || undefined,
    reference: orderReference || undefined,
    referenceDate: orderReference && (purchase || isOrder) ? payload.date : undefined,
    placeOfSupply: payload.placeOfSupply || undefined,
    partyGSTIN: payload.partyGstin || undefined,
    isInvoice: !isOrder && (purchase || payload.isInvoice !== false),
    isOptional: Boolean(payload.isOptional),
    inventoryAllocations,
    ledgerEntries,
    viewType: 'Invoice Voucher View'
  };

  if (includeVoucherNumber && payload.voucherNumber) {
    voucher.voucherNumber = String(payload.voucherNumber);
  }
  if (payload.remoteId) {
    voucher.remoteId = String(payload.remoteId);
  }

  return voucher;
}

function mapLedgerPayload(payload = {}) {
  const lines = Array.isArray(payload.addressLines)
    ? payload.addressLines.filter(Boolean)
    : payload.address
      ? [String(payload.address)]
      : [];

  const mailingDetails = lines.length
    ? [
        {
          applicableFrom: payload.applicableFrom || new Date(),
          mailingName: payload.mailingName || payload.name,
          addressLines: lines,
          pinCode: payload.pincode || undefined,
          state: payload.state || undefined,
          country: payload.country || 'India'
        }
      ]
    : undefined;

  return {
    name: payload.name,
    group: payload.parent || 'Sundry Debtors',
    mailingDetails,
    remoteId: payload.remoteId || undefined
  };
}

function mapStockItemPayload(payload = {}) {
  return {
    name: payload.name,
    parent: payload.parent || 'Primary',
    baseUnit: payload.baseUnits || payload.unit || 'Nos',
    remoteId: payload.remoteId || undefined
  };
}

module.exports = {
  resolveVoucherMode,
  buildItemLedgerEntries,
  mapItemVoucherPayload,
  mapLedgerPayload,
  mapStockItemPayload
};
