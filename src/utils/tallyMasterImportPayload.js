/**
 * Map MongoDB Party / Item → desktop-agent master import payload.
 */

export function buildLedgerImportPayload(party, company, options = {}) {
  const companyName =
    options.companyName ||
    company?.tallyIntegration?.companyName ||
    company?.displayName ||
    company?.name ||
    '';

  const addr = party.addresses?.[0] || {};
  const addressLines = [addr.line1, addr.line2].filter(Boolean);
  const parent =
    options.parent ||
    party.tallyParent ||
    (party.type === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors');

  return {
    remoteId: party._id?.toString(),
    companyName,
    name: party.name || party.displayName,
    parent,
    mobile: party.contact?.phone || party.mobile || options.mobile || '',
    addressLines,
    pincode: addr.pincode || party.pincode || '',
    state: addr.state || party.state || '',
    country: addr.country || 'India',
    mailingName: party.displayName || party.name
  };
}

export function buildStockItemImportPayload(item, company, options = {}) {
  const companyName =
    options.companyName ||
    company?.tallyIntegration?.companyName ||
    company?.displayName ||
    company?.name ||
    '';

  return {
    remoteId: item._id?.toString(),
    companyName,
    name: item.name || item.displayName,
    baseUnits:
      options.baseUnits ||
      item.units?.primary?.name ||
      item.unit ||
      'Nos'
  };
}
