/**
 * Maps tally-sync-ts export models → FinSync360 sync DTOs (MongoDB upload shape).
 */

const { resolveVoucherTypeFromTally } = require('./tallyVoucherType');

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = s.replace(/\D/g, '');
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseQtyUnit(quantity) {
  const raw = String(quantity ?? '').trim();
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) {
    return { qty: Number(raw) || 0, unit: 'Nos' };
  }
  return {
    qty: Math.abs(Number(match[1]) || 0),
    unit: String(match[2] || 'Nos').trim() || 'Nos'
  };
}

function parseRateValue(rate) {
  const raw = String(rate ?? '').trim();
  const match = raw.match(/(-?\d+(?:\.\d+)?)/);
  return Math.abs(Number(match?.[1]) || 0);
}

function isSundryPartyLedger(parent) {
  const p = String(parent || '').toLowerCase();
  if (!p) return false;
  return (
    p.includes('sundry debtor') ||
    p.includes('sundry creditor') ||
    p === 'debtors' ||
    p === 'creditors' ||
    (p.includes('debtor') && !p.includes('duties')) ||
    (p.includes('creditor') && !p.includes('duties'))
  );
}

function resolvePartyTypeFromParent(parent) {
  const p = String(parent || '').toLowerCase();
  if (p.includes('creditor') || p.includes('sundry creditor')) return 'supplier';
  if (p.includes('both')) return 'both';
  return 'customer';
}

function mapStockItemRow(item = {}) {
  const name = String(item.name || '').trim();
  if (!name) return null;

  const gstRates = {};
  if (Array.isArray(item.gstDetails)) {
    for (const gst of item.gstDetails) {
      const rate = Number(gst?.gstRate);
      if (rate > 0 && gst.dutyHead) {
        gstRates[String(gst.dutyHead).toLowerCase()] = rate;
      }
    }
  }

  const hsn = Array.isArray(item.hsnDetails) && item.hsnDetails[0] ? item.hsnDetails[0] : {};

  const partNo = String(item.partNo || item.mailingNames?.[0] || '').trim();

  return {
    name,
    alias: item.alias || '',
    partNo: partNo || '',
    parent: item.parent || item.stockGroup || '',
    category: item.stockCategory || '',
    baseUnits: item.baseUnit || item.baseUnits || 'Nos',
    openingBalance: Number(item.openingBalance) || 0,
    openingValue: Number(item.openingValue) || 0,
    guid: item.guid || item.remoteId || null,
    alterid: item.alterId != null ? String(item.alterId) : '',
    remoteid: item.remoteId || null,
    gstRates,
    hsnCode: hsn.hsnCode || hsn.code || '',
    hsn: hsn.hsn || ''
  };
}

function mapSimpleMasterRow(row = {}) {
  const name = String(row.name || '').trim();
  if (!name) return null;
  return {
    name,
    parent: row.parent || '',
    reservedName: row.reservedName || row.alias || ''
  };
}

function mapLedgerToPartySyncRow(ledger = {}) {
  const name = String(ledger.name || '').trim();
  if (!name) return null;

  const parent = String(ledger.group || ledger.parent || '').trim();
  if (!isSundryPartyLedger(parent)) {
    return {
      name,
      guid: ledger.guid || ledger.remoteId || null,
      tallyParent: parent,
      parent,
      recordType: 'ledger',
      type: 'both'
    };
  }

  const gstReg =
    Array.isArray(ledger.gstRegistrationDetails) && ledger.gstRegistrationDetails.length
      ? ledger.gstRegistrationDetails[ledger.gstRegistrationDetails.length - 1]
      : {};
  const mail =
    Array.isArray(ledger.mailingDetails) && ledger.mailingDetails.length
      ? ledger.mailingDetails[ledger.mailingDetails.length - 1]
      : {};
  const addressLines = mail.addressLines || [];
  const line1 = addressLines[0] || mail.mailingName || name;
  const state = gstReg.state || mail.state || gstReg.placeOfSupply || '';

  return {
    name,
    displayName: mail.mailingName || name,
    type: resolvePartyTypeFromParent(parent),
    category: 'business',
    phone: ledger.phone || ledger.mobile || '',
    email: ledger.email || ledger.emailCc || '',
    address: line1,
    line2: addressLines.slice(1).join(', '),
    city: addressLines.length > 1 ? addressLines[addressLines.length - 1] : state || 'Unknown',
    state,
    pincode: mail.pinCode || mail.pincode || '',
    country: mail.country || 'India',
    gstin: gstReg.gstin || '',
    gstRegistrationType: gstReg.gstRegistrationType || '',
    placeOfSupply: gstReg.placeOfSupply || state,
    pan: ledger.panNumber || '',
    parent,
    tallyParent: parent,
    guid: ledger.guid || ledger.remoteId || null,
    alterid: ledger.alterId != null ? String(ledger.alterId) : '',
    masterId: ledger.masterId != null ? String(ledger.masterId) : '',
    remoteId: ledger.remoteId || null,
    openingBalance: Math.abs(Number(ledger.openingBalance) || 0),
    openingBalanceType: Number(ledger.openingBalance) < 0 ? 'credit' : 'debit',
    recordType: 'party',
    isActive: true
  };
}

function mapGstRegistrationRow(reg = {}) {
  const name = String(reg.name || reg.stateName || '').trim();
  if (!name) return null;

  const details = Array.isArray(reg.registrationDetails) ? reg.registrationDetails : [];

  return {
    name,
    stateName: reg.stateName || name,
    priorStateName: reg.priorStateName || '',
    gstin: String(reg.gstin || '').trim().toUpperCase(),
    guid: reg.guid || reg.remoteId || null,
    alterid: reg.alterId != null ? String(reg.alterId) : '',
    remoteId: reg.remoteId || null,
    eWayApplicableType: reg.eWayApplicableType || '',
    gstUserName: reg.gstUserName || '',
    eSignMethod: reg.eSignMethod || '',
    isOtherTerritoryAssessee: Boolean(reg.isOtherTerritoryAssessee),
    isEwayBillApplicable: Boolean(reg.isEwayBillApplicable),
    isEwayBillApplicableForIntra: Boolean(reg.isEwayBillApplicableForIntra),
    registrationDetails: details.map((d) => ({
      applicableFrom: toIsoDate(d.applicableFrom),
      gstRegistrationType: d.gstRegistrationType || '',
      state: d.state || '',
      placeOfSupply: d.placeOfSupply || ''
    }))
  };
}

function mapInventoryLine(inv = {}) {
  const { qty, unit } = parseQtyUnit(inv.quantity ?? inv.actualQuantity);
  const rate = parseRateValue(inv.rate);
  const amount = Math.abs(Number(inv.amount) || qty * rate);

  const gst = { cgst: 0, sgst: 0, igst: 0, cess: 0 };
  let taxPercent = 0;
  if (Array.isArray(inv.gstRateDetails)) {
    for (const row of inv.gstRateDetails) {
      const head = String(row.dutyHead || '').toUpperCase();
      const pct = Number(row.rate) || 0;
      if (head.includes('IGST')) {
        gst.igst = pct;
        taxPercent = pct;
      } else if (head.includes('CGST')) {
        gst.cgst = pct;
        taxPercent += pct;
      } else if (head.includes('SGST')) {
        gst.sgst = pct;
        taxPercent += pct;
      } else if (head.includes('CESS')) {
        gst.cess = pct;
      }
    }
  }

  const accountLedger =
    inv.accountingAllocations?.[0]?.ledgerName ||
    inv.ledgers?.[0]?.ledgerName ||
    '';

  return {
    itemName: inv.stockItemName || '',
    stockItemName: inv.stockItemName || '',
    quantity: qty,
    unit,
    rate,
    amount,
    taxType: gst.igst > 0 ? 'IGST' : 'CGST/SGST',
    taxPercent,
    gst,
    igstLedgerName: gst.igst > 0 ? accountLedger : undefined,
    cgstLedgerName: gst.cgst > 0 ? accountLedger : undefined,
    sgstLedgerName: gst.sgst > 0 ? accountLedger : undefined,
    godownName: inv.batchAllocations?.[0]?.godownName || ''
  };
}

function mapLedgerEntryLine(entry = {}) {
  const amount = Number(entry.amount) || 0;
  const abs = Math.abs(amount);
  return {
    ledgerName: entry.ledgerName || '',
    name: entry.ledgerName || '',
    amount: abs,
    debit: entry.isDeemedPositive ? abs : 0,
    credit: entry.isDeemedPositive ? 0 : abs,
    isPartyLedger: Boolean(entry.isPartyLedger)
  };
}

function mapVoucherFromLibrary(voucher = {}) {
  const items = (voucher.inventoryAllocations || []).map(mapInventoryLine).filter((i) => i.itemName);
  const ledgerEntries = (voucher.ledgerEntries || []).map(mapLedgerEntryLine);
  const typeFields = resolveVoucherTypeFromTally(
    voucher.voucherType || voucher.voucherTypeName,
    voucher.parentType || voucher.voucherTypeParent
  );

  const subtotal = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const taxTotal = ledgerEntries
    .filter((e) => !e.isPartyLedger)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const grandTotal = subtotal + taxTotal;

  return {
    voucherNumber: voucher.voucherNumber || '',
    voucherType: typeFields.voucherType,
    tallyVoucherTypeParent: typeFields.tallyVoucherTypeParent,
    tallyVoucherTypeName: typeFields.tallyVoucherTypeName,
    date: toIsoDate(voucher.date),
    amount: grandTotal,
    partyName: voucher.partyName || '',
    gstRegistration: voucher.gstRegistration || '',
    placeOfSupply: voucher.placeOfSupply || '',
    gstIn: voucher.partyGSTIN || '',
    reference: voucher.reference || '',
    referenceDate: toIsoDate(voucher.referenceDate),
    narration: voucher.narration || '',
    guid: voucher.guid || voucher.remoteId || '',
    alterId: voucher.alterId != null ? String(voucher.alterId) : '',
    alterid: voucher.alterId != null ? String(voucher.alterId) : '',
    masterId: voucher.masterId != null ? String(voucher.masterId) : '',
    totals: {
      subtotal,
      taxTotal,
      grandTotal,
      cgst: 0,
      sgst: 0,
      igst: 0
    },
    items,
    ledgerEntries,
    ledgerNames: ledgerEntries.map((e) => e.ledgerName).filter(Boolean),
    hasInventory: items.length > 0,
    detailLevel: items.length || ledgerEntries.length ? 'full' : 'summary',
    tallyId: voucher.guid || voucher.remoteId || ''
  };
}

function mapLicenseInfoForServer(info = {}) {
  if (!info || typeof info !== 'object') return null;
  return {
    serialNumber: info.serialNumber || '',
    remoteSerialNumber: info.remoteSerialNumber || '',
    planName: info.planName || (info.isGold ? 'Gold' : info.isSilver ? 'Silver' : ''),
    isEducationalMode: Boolean(info.isEducationalMode),
    isGold: Boolean(info.isGold),
    isSilver: Boolean(info.isSilver),
    tallyVersion: info.tallyVersion || '',
    tallyShortVersion: info.tallyShortVersion || '',
    isTallyPrime: Boolean(info.isTallyPrime),
    isTallyPrimeServer: Boolean(info.isTallyPrimeServer),
    userName: info.userName || '',
    accountId: info.accountId || ''
  };
}

module.exports = {
  toIsoDate,
  mapStockItemRow,
  mapSimpleMasterRow,
  mapLedgerToPartySyncRow,
  mapGstRegistrationRow,
  mapVoucherFromLibrary,
  mapLicenseInfoForServer,
  isSundryPartyLedger
};
