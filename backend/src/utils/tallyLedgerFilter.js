/**
 * Whether a Tally ledger parent group is Sundry Debtors / Creditors (party ledgers).
 */
/** Strip Tally control chars (e.g. "&#4; ") from group names. */
export function normalizeTallyParentName(parent) {
  return String(parent || '')
    .replace(/&#\d+;/g, '')
    .replace(/\u0004/g, '')
    .trim();
}

export function isSundryPartyParent(parent) {
  const p = normalizeTallyParentName(parent).toLowerCase();
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

export function normalizeParentGroup(parent) {
  return normalizeTallyParentName(parent);
}

export function matchesAccountLedgerParent(parentGroup, expectedParent) {
  const parent = normalizeParentGroup(parentGroup).toLowerCase();
  const expected = normalizeParentGroup(expectedParent).toLowerCase();
  if (!expected) return false;
  return parent === expected || parent.includes(expected);
}
