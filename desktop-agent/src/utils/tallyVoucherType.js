/**
 * Resolve FinSync360 voucherType from Tally VOUCHERTYPENAME + ZVOUCHERPARENT (parent type).
 * Parent is preferred so renamed types (e.g. "Sales Order 26-27") still classify as sales_order.
 */

const SUPPORTED_VOUCHER_TYPES = [
  'sales',
  'purchase',
  'receipt',
  'payment',
  'contra',
  'journal',
  'debit_note',
  'credit_note',
  'sales_order',
  'purchase_order',
  'receipt_note',
  'delivery_note'
];

function extractText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return extractText(value[0]);
  if (typeof value === 'object') {
    if (typeof value['#text'] !== 'undefined') return String(value['#text']).trim();
    if (typeof value['@_NAME'] !== 'undefined') return String(value['@_NAME']).trim();
    return '';
  }
  return String(value).trim();
}

function compactLabel(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-\/\.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Longest / most specific patterns first — avoids "Receipt Note" → receipt */
const LABEL_PATTERNS = [
  ['receipt_note', 'receipt_note'],
  ['delivery_note', 'delivery_note'],
  ['debit_note', 'debit_note'],
  ['credit_note', 'credit_note'],
  ['sales_order', 'sales_order'],
  ['purchase_order', 'purchase_order'],
  ['sales_return', 'credit_note'],
  ['purchase_return', 'debit_note'],
  ['sales', 'sales'],
  ['purchase', 'purchase'],
  ['payment', 'payment'],
  ['contra', 'contra'],
  ['journal', 'journal'],
  ['receipt', 'receipt']
];

const EXACT_LABELS = {
  receipt_note: 'receipt_note',
  delivery_note: 'delivery_note',
  debit_note: 'debit_note',
  credit_note: 'credit_note',
  sales_order: 'sales_order',
  purchase_order: 'purchase_order',
  sales: 'sales',
  purchase: 'purchase',
  receipt: 'receipt',
  payment: 'payment',
  contra: 'contra',
  journal: 'journal'
};

function resolveSingleVoucherTypeLabel(label) {
  const compact = compactLabel(label);
  if (!compact) return null;

  if (EXACT_LABELS[compact]) return EXACT_LABELS[compact];

  for (const [pattern, type] of LABEL_PATTERNS) {
    if (compact === pattern || compact.includes(pattern)) {
      return type;
    }
  }

  return null;
}

function getTallyVoucherTypeFields(voucher = {}) {
  const parent = extractText(
      voucher.ZVOUCHERPARENT ??
      voucher.zVoucherParent ??
      voucher.ZVoucherParent
  );
  const displayName = extractText(
    voucher.VOUCHERTYPENAME ?? voucher['@_VCHTYPE'] ?? voucher['@_VCHTYPENAME']
  );
  return { parent, displayName };
}

function resolveVoucherTypeFromTally(voucherOrFields = {}) {
  const fields =
    voucherOrFields.parent !== undefined || voucherOrFields.displayName !== undefined
      ? {
          parent: voucherOrFields.parent || '',
          displayName: voucherOrFields.displayName || ''
        }
      : getTallyVoucherTypeFields(voucherOrFields);

  const { parent, displayName } = fields;
  const candidates = [parent, displayName].filter(Boolean);

  for (const label of candidates) {
    const type = resolveSingleVoucherTypeLabel(label);
    if (type) {
      return {
        voucherType: type,
        tallyVoucherTypeParent: parent,
        tallyVoucherTypeName: displayName
      };
    }
  }

  return {
    voucherType: 'journal',
    tallyVoucherTypeParent: parent,
    tallyVoucherTypeName: displayName
  };
}

function normalizeVoucherTypeSlug(value = '') {
  const compact = compactLabel(value);
  if (!compact) return 'journal';
  const resolved = resolveSingleVoucherTypeLabel(value);
  if (resolved) return resolved;
  if (SUPPORTED_VOUCHER_TYPES.includes(compact)) return compact;
  return 'journal';
}

module.exports = {
  SUPPORTED_VOUCHER_TYPES,
  getTallyVoucherTypeFields,
  resolveVoucherTypeFromTally,
  normalizeVoucherTypeSlug,
  resolveSingleVoucherTypeLabel
};
