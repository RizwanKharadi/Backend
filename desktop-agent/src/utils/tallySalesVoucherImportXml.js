/**
 * Build TallyPrime IMPORT XML for Sales vouchers (Item Invoice view).
 * Structure aligned with Tally export samples (ALLINVENTORYENTRIES + LEDGERENTRIES).
 */

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatYyyyMmDd(value) {
  if (!value) return '';
  const asString = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}${month}${day}`;
  }
  const compact = asString.replace(/\D/g, '');
  if (compact.length === 8) return compact;
  return asString;
}

const TALLY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse ISO / YYYYMMDD / Date → local Date (midnight) */
function parseToLocalDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const compact = s.replace(/\D/g, '');
  if (compact.length === 8) {
    return new Date(
      Number(compact.slice(0, 4)),
      Number(compact.slice(4, 6)) - 1,
      Number(compact.slice(6, 8))
    );
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Tally JD serial (days from 30-Dec-1899, same as Excel) */
function tallyJulianDay(date) {
  const d = parseToLocalDate(date);
  const epoch = new Date(1899, 11, 30);
  return Math.floor((d.getTime() - epoch.getTime()) / 86400000);
}

/** e.g. 1-May-26 for ORDERDUEDATE (matches Tally export) */
function formatTallyOrderDueDate(value) {
  const d = parseToLocalDate(value);
  const label = `${d.getDate()}-${TALLY_MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  const jd = tallyJulianDay(d);
  return { label, jd };
}

function buildOrderDueDateXml(value) {
  const { label, jd } = formatTallyOrderDueDate(value);
  return `<ORDERDUEDATE JD="${jd}" P="${escapeXml(label)}">${escapeXml(label)}</ORDERDUEDATE>`;
}

function formatQty(qty, unit = 'Nos') {
  const n = Number(qty) || 0;
  const u = String(unit || 'Nos').trim() || 'Nos';
  return ` ${n.toFixed(3)} ${u}`;
}

function formatRate(rate, unit = 'Nos') {
  const n = Number(rate) || 0;
  const u = String(unit || 'Nos').trim() || 'Nos';
  return `${n.toFixed(2)}/${u}`;
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function buildRateDetailsList(taxType, taxPercent) {
  const pct = Number(taxPercent) || 0;
  const type = String(taxType || 'IGST').toUpperCase();
  const blocks = [];

  if (type === 'IGST' || type.includes('IGST')) {
    blocks.push(`
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD>
        <GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
        <GSTRATE> ${pct}</GSTRATE>
       </RATEDETAILS.LIST>`);
  } else {
    const half = pct / 2;
    blocks.push(`
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD>
        <GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
        <GSTRATE> ${half}</GSTRATE>
       </RATEDETAILS.LIST>
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD>
        <GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
        <GSTRATE> ${half}</GSTRATE>
       </RATEDETAILS.LIST>`);
  }

  blocks.push(`
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Cess</GSTRATEDUTYHEAD>
        <GSTRATEVALUATIONTYPE>&#4; Not Applicable</GSTRATEVALUATIONTYPE>
       </RATEDETAILS.LIST>`);

  return blocks.join('');
}

function isPurchaseMode(mode) {
  return String(mode || '').includes('purchase');
}

/** Tally item invoice: sales = positive amounts; purchase/purchase_order = negative */
function formatSignedAmount(amount, purchase) {
  const n = Math.abs(Number(amount) || 0);
  return (purchase ? -n : n).toFixed(2);
}

function buildInventoryLine(item, accountLedgerName, options = {}) {
  const mode = options.voucherMode || 'sales';
  const isOrder = Boolean(options.isOrder);
  const purchase = isPurchaseMode(mode);
  const qty = Number(item.quantity) || 0;
  const rate = Number(item.rate) || 0;
  const unit = item.unit || 'Nos';
  const amount = Number(item.amount) > 0 ? Number(item.amount) : qty * rate;
  const stockName = escapeXml(item.itemName || item.stockItemName || item.name);
  const godown = escapeXml(item.godownName || item.godown || 'Main Location');
  const accountLedger = escapeXml(
    accountLedgerName || item.salesLedgerName || item.purchaseLedgerName || (purchase ? 'Purchase' : 'Sales GST')
  );
  const invDeemed = purchase ? 'Yes' : 'No';
  const allocDeemed = purchase ? 'Yes' : 'No';
  const hsn = escapeXml(item.hsnCode || item.hsn || '');
  const taxType = item.taxType || options.defaultTaxType || 'IGST';
  const taxPercent =
    item.taxPercent ??
    item.taxPercentage ??
    options.inferredTaxPercent ??
    0;
  const qtyStr = formatQty(qty, unit);
  const rateStr = formatRate(rate, unit);
  const amountStr = formatSignedAmount(amount, purchase);

  const descriptions = Array.isArray(item.descriptions)
    ? item.descriptions
    : item.description
      ? [item.description]
      : [];

  const descBlocks = descriptions.length
    ? `
       <BASICUSERDESCRIPTION.LIST TYPE="String">
        ${descriptions.map((d) => `<BASICUSERDESCRIPTION>${escapeXml(d)}</BASICUSERDESCRIPTION>`).join('\n        ')}
       </BASICUSERDESCRIPTION.LIST>`
    : '';

  const orderNo = String(options.orderNo || item.orderNo || '').trim();
  const orderDueDateValue = options.orderDueDate ?? new Date();
  const orderDueDateXml = isOrder ? `\n        ${buildOrderDueDateXml(orderDueDateValue)}` : '';
  const orderNoXml = isOrder && orderNo ? `\n        <ORDERNO>${escapeXml(orderNo)}</ORDERNO>` : '';
  const hasGodown = Boolean(item.godownName || item.godown);
  const needsBatch = hasGodown || isOrder;

  const batchBlock = needsBatch
    ? `
       <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>${godown}</GODOWNNAME>
        <BATCHNAME>${escapeXml(item.batchName || '')}</BATCHNAME>
        <DESTINATIONGODOWNNAME>${godown}</DESTINATIONGODOWNNAME>${orderNoXml}
        <AMOUNT>${amountStr}</AMOUNT>
        <ACTUALQTY>${qtyStr}</ACTUALQTY>
        <BILLEDQTY>${qtyStr}</BILLEDQTY>${orderDueDateXml}
       </BATCHALLOCATIONS.LIST>`
    : '';

  return `
      <ALLINVENTORYENTRIES.LIST>${descBlocks}
       <STOCKITEMNAME>${stockName}</STOCKITEMNAME>
       <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
       ${hsn ? `<GSTHSNNAME>${hsn}</GSTHSNNAME>` : ''}
       <ISDEEMEDPOSITIVE>${invDeemed}</ISDEEMEDPOSITIVE>
       <RATE>${rateStr}</RATE>
       <AMOUNT>${amountStr}</AMOUNT>
       <ACTUALQTY>${qtyStr}</ACTUALQTY>
       <BILLEDQTY>${qtyStr}</BILLEDQTY>${batchBlock}
       <ACCOUNTINGALLOCATIONS.LIST>
        <OLDAUDITENTRYIDS.LIST TYPE="Number">
         <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
        </OLDAUDITENTRYIDS.LIST>
        <LEDGERNAME>${accountLedger}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${allocDeemed}</ISDEEMEDPOSITIVE>
        <ISPARTYLEDGER>No</ISPARTYLEDGER>
        <AMOUNT>${amountStr}</AMOUNT>
       </ACCOUNTINGALLOCATIONS.LIST>
       ${buildRateDetailsList(taxType, taxPercent)}
      </ALLINVENTORYENTRIES.LIST>`;
}

function buildLedgerEntryLine(entry) {
  const name = escapeXml(entry.ledgerName || entry.ledger || entry.name);
  const rawAmount = Number(entry.amount) || 0;
  const isParty = Boolean(entry.isPartyLedger);
  const isDeemedPositive = entry.isDeemedPositive != null ? entry.isDeemedPositive : isParty;
  const amount =
    entry.amount != null
      ? rawAmount
      : isParty
        ? -Math.abs(rawAmount)
        : Math.abs(rawAmount);
  const amountStr = Number(amount).toFixed(2);

  const billBlock =
    entry.billName && isParty && !entry.skipBillAllocations
      ? `
       <BILLALLOCATIONS.LIST>
        <NAME>${escapeXml(entry.billName)}</NAME>
        <BILLTYPE>${escapeXml(entry.billType || 'New Ref')}</BILLTYPE>
        <AMOUNT>${amountStr}</AMOUNT>
       </BILLALLOCATIONS.LIST>`
      : '';

  return `
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>${name}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${yesNo(isDeemedPositive)}</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>${yesNo(isParty)}</ISPARTYLEDGER>
       ${entry.methodType ? `<METHODTYPE>${escapeXml(entry.methodType)}</METHODTYPE>` : ''}
       <AMOUNT>${amountStr}</AMOUNT>${billBlock}
      </LEDGERENTRIES.LIST>`;
}

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

/**
 * Build party + tax ledger lines.
 * When the app sends explicit tax ledgers (Ledger → ADD), party must be -(items + tax).
 */
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

  const partyAmount = (subtotal, taxTotal) =>
    purchase ? subtotal + taxTotal : -(subtotal + taxTotal);

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
    const lines = [
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
    return lines;
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

/** @deprecated use buildItemLedgerEntries */
function buildSalesLedgerEntries(items, partyState, extraLedgers = []) {
  return buildItemLedgerEntries(items, partyState, extraLedgers, 'sales');
}

/** Infer IGST/CGST rate for inventory XML when tax is only on ledger lines */
function inferTaxPercentFromExtras(subtotal, extraLedgers) {
  if (!subtotal) return 0;
  const taxTotal = (extraLedgers || [])
    .map(normalizeExtraLedgerRow)
    .filter((e) => !e.isPartyLedger)
    .reduce((s, e) => s + e.amount, 0);
  if (!taxTotal) return 0;
  return Math.round((taxTotal / subtotal) * 10000) / 100;
}

/**
 * @param {object} payload
 * @param {string} payload.companyName
 * @param {string} [payload.voucherTypeName] - e.g. "Sales GST (26-27)"
 * @param {string} [payload.vchType] - default Sales
 * @param {string|Date} payload.date
 * @param {string} payload.partyLedgerName
 * @param {string} [payload.voucherNumber]
 * @param {string} [payload.reference]
 * @param {string} [payload.narration]
 * @param {boolean} [payload.isOptional]
 * @param {string} [payload.placeOfSupply]
 * @param {string} [payload.partyGstin]
 * @param {string} [payload.salesLedgerName]
 * @param {string} [payload.remoteId] - Mongo id for traceability
 * @param {Array} payload.items
 * @param {Array} [payload.ledgerEntries] - extra ledgers; party+tax auto-added if omitted
 */
function resolveVoucherMode(payload = {}) {
  if (payload.voucherMode) return payload.voucherMode;
  const vt = String(payload.vchType || payload.voucherType || 'sales').toLowerCase();
  if (vt.includes('purchase_order')) return 'purchase_order';
  if (vt.includes('sales_order')) return 'sales_order';
  if (vt.includes('purchase')) return 'purchase';
  return 'sales';
}

function buildItemVoucherImportXml(payload = {}) {
  const voucherMode = resolveVoucherMode(payload);
  const isOrder = voucherMode.includes('order');
  const purchase = isPurchaseMode(voucherMode);
  const companyName = escapeXml(payload.companyName || '');
  const voucherTypeName = escapeXml(payload.voucherTypeName || payload.vchType || 'Sales');
  const vchType = escapeXml(payload.vchType || voucherTypeName);
  const dateYmd = formatYyyyMmDd(payload.date);
  const party = escapeXml(payload.partyLedgerName || payload.partyName || '');
  // Sales/Purchase: VOUCHERNUMBER + REFERENCE (order no.). Orders: order no. = REFERENCE only; Tally assigns voucher no.
  const includeVoucherNumber = !isOrder || Boolean(payload.useManualVoucherNumber);
  const voucherNumber =
    includeVoucherNumber && payload.voucherNumber
      ? `<VOUCHERNUMBER>${escapeXml(payload.voucherNumber)}</VOUCHERNUMBER>`
      : '';
  const orderReference = String(payload.reference || payload.voucherNumber || '').trim();
  const reference = orderReference
    ? `<REFERENCE>${escapeXml(orderReference)}</REFERENCE>`
    : '';
  const referenceDate =
    orderReference && (purchase || isOrder)
      ? `<REFERENCEDATE>${dateYmd}</REFERENCEDATE>`
      : '';
  const narration = payload.narration
    ? `<NARRATION>${escapeXml(payload.narration)}</NARRATION>`
    : '';
  const placeOfSupply = payload.placeOfSupply
    ? `<PLACEOFSUPPLY>${escapeXml(payload.placeOfSupply)}</PLACEOFSUPPLY>`
    : '';
  const partyGstin = payload.partyGstin
    ? `<PARTYGSTIN>${escapeXml(payload.partyGstin)}</PARTYGSTIN>`
    : '';
  const remoteId = payload.remoteId
    ? `<REMOTEID>${escapeXml(payload.remoteId)}</REMOTEID>`
    : '';

  const accountLedgerName =
    payload.salesLedgerName ||
    payload.purchaseLedgerName ||
    payload.accountLedgerName ||
    (isPurchaseMode(voucherMode) ? 'Purchase' : 'Sales GST');
  const items = Array.isArray(payload.items) ? payload.items : [];
  const extraLedgers = Array.isArray(payload.ledgerEntries) ? payload.ledgerEntries : [];
  const subtotal = itemsSubtotal(items);
  const inferredTaxPercent = inferTaxPercentFromExtras(subtotal, extraLedgers);
  // Order due date: today when importing (override with payload.orderDueDate or voucher date)
  const orderDueDate = payload.orderDueDate || new Date();
  const inventoryXml = items
    .map((item) =>
      buildInventoryLine(item, accountLedgerName, {
        voucherMode,
        isOrder,
        orderNo: orderReference,
        orderDueDate,
        inferredTaxPercent,
        defaultTaxType: extraLedgers.length ? 'IGST' : 'IGST'
      })
    )
    .join('');

  let ledgerXml = '';
  if (items.length > 0 && party) {
    const ledgerLines = buildItemLedgerEntries(
      items,
      {
        partyLedgerName: party,
        billName: payload.billName || orderReference || payload.voucherNumber,
        billType: payload.billType || (orderReference ? 'New Ref' : 'New Ref'),
        grossTotal:
          Number(payload.amount) > 0 ? Number(payload.amount) : undefined
      },
      extraLedgers,
      voucherMode
    );
    ledgerXml = ledgerLines.map(buildLedgerEntryLine).join('');
  } else if (extraLedgers.length > 0) {
    ledgerXml = extraLedgers.map((row) => buildLedgerEntryLine(normalizeExtraLedgerRow(row))).join('');
  }

  const staticVars = companyName
    ? `<STATICVARIABLES>
          <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
        </STATICVARIABLES>`
    : '<STATICVARIABLES />';

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE Action="">
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>IMPORT</TALLYREQUEST>
    <TYPE>DATA</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      ${staticVars}
    </DESC>
    <DATA>
      <TALLYMESSAGE>
     <VOUCHER Action="Create" DATE="${dateYmd}" VCHTYPE="${vchType}" VCHENTRYMODE="Item Invoice">
      ${remoteId}
      <DATE>${dateYmd}</DATE>
      <EFFECTIVEDATE>${dateYmd}</EFFECTIVEDATE>
      <VOUCHERTYPENAME>${voucherTypeName}</VOUCHERTYPENAME>
      <PARTYNAME>${party}</PARTYNAME>
      <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
      <BASICBASEPARTYNAME>${party}</BASICBASEPARTYNAME>
      <PARTYMAILINGNAME>${party}</PARTYMAILINGNAME>
      ${voucherNumber}
      ${reference}
      ${referenceDate}
      ${narration}
      ${placeOfSupply}
      ${partyGstin}
      <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
      <VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
      <ISINVOICE>${yesNo(!isOrder && (purchase || payload.isInvoice !== false))}</ISINVOICE>
      ${isOrder && voucherMode === 'sales_order' ? '<ISORDER>Yes</ISORDER>' : ''}
      ${isOrder && voucherMode === 'purchase_order' ? '<ISORDER>Yes</ISORDER>' : ''}
      <ISOPTIONAL>${yesNo(payload.isOptional)}</ISOPTIONAL>
      <DIFFACTUALQTY>No</DIFFACTUALQTY>
      ${inventoryXml}
      ${ledgerXml}
     </VOUCHER>
    </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

/** @alias buildItemVoucherImportXml */
function buildSalesVoucherImportXml(payload = {}) {
  return buildItemVoucherImportXml(payload);
}

module.exports = {
  buildItemVoucherImportXml,
  buildSalesVoucherImportXml,
  buildItemLedgerEntries,
  buildSalesLedgerEntries,
  escapeXml,
  formatYyyyMmDd,
  formatTallyOrderDueDate,
  buildOrderDueDateXml,
  formatQty,
  formatRate,
  yesNo
};
