import type { Voucher, VoucherEntry, VoucherItem } from '../types';
import {
  type VoucherDocumentContext,
  prepareVoucherDocumentData,
  formatDDMMYYYY,
  formatTableAmount,
  formatInr,
  formatReference,
  rupeesToWords,
  resolveVoucherDisplayAmount,
  entryDisplayAmount,
  tallyByToPrefix,
} from './voucherDocument';

function escapeHtml(text: string | number | undefined | null): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'posted':
    case 'approved':
    case 'paid':
      return 'badge-success';
    case 'cancelled':
      return 'badge-danger';
    default:
      return 'badge-muted';
  }
}

function renderGstLine(item: VoucherItem): string {
  const g = item.gst;
  if (!g) return '';
  const parts = [
    g.cgst ? `CGST ${g.cgst}%` : '',
    g.sgst ? `SGST ${g.sgst}%` : '',
    g.igst ? `IGST ${g.igst}%` : '',
    g.cess ? `Cess ${g.cess}%` : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  return `<div class="sub-line">${escapeHtml(parts.join(' · '))}</div>`;
}

function renderItemsTable(items: VoucherItem[]): string {
  if (!items.length) {
    return '<p class="empty-note">No inventory line items on this voucher.</p>';
  }
  const rows = items
    .map(
      (item, idx) => `
      <tr class="${idx % 2 === 1 ? 'row-alt' : ''}">
        <td class="col-sn">${idx + 1}</td>
        <td class="col-item">
          <div class="item-name">${escapeHtml(item.itemName || 'Item')}</div>
          ${item.description ? `<div class="sub-line">${escapeHtml(item.description)}</div>` : ''}
          ${item.hsnCode ? `<div class="sub-line">HSN/SAC: ${escapeHtml(item.hsnCode)}</div>` : ''}
          ${renderGstLine(item)}
        </td>
        <td class="col-qty num">${escapeHtml(formatTableAmount(item.quantity))} ${escapeHtml(item.unit || 'Nos')}</td>
        <td class="col-rate num">${escapeHtml(formatTableAmount(item.rate))}</td>
        <td class="col-amt num">${escapeHtml(formatTableAmount(item.amount))}</td>
      </tr>`
    )
    .join('');

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th class="col-sn">#</th>
          <th class="col-item">Item / Description</th>
          <th class="col-qty">Qty</th>
          <th class="col-rate">Rate</th>
          <th class="col-amt">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAsVoucherLedger(
  ledgerRows: VoucherEntry[],
  debitTotal: number,
  creditTotal: number
): string {
  if (!ledgerRows.length) {
    return '<p class="empty-note">No ledger particulars.</p>';
  }
  const rows = ledgerRows
    .map((entry) => {
      const prefix = tallyByToPrefix(entry);
      const subLines = (entry.subLines || [])
        .map((s) => `<div class="sub-line indent">${escapeHtml(s.text)}</div>`)
        .join('');
      const narr =
        entry.narration && !(entry.subLines || []).some((s) => s.isNarration)
          ? `<div class="sub-line indent">${escapeHtml(entry.narration)}</div>`
          : '';
      return `
      <tr>
        <td class="col-part">
          <span class="prefix">${escapeHtml(prefix)}</span> ${escapeHtml(entry.accountName)}
          ${subLines}${narr}
        </td>
        <td class="col-dr num">${entry.debitAmount > 0 ? escapeHtml(formatTableAmount(entry.debitAmount)) : ''}</td>
        <td class="col-cr num">${entry.creditAmount > 0 ? escapeHtml(formatTableAmount(entry.creditAmount)) : ''}</td>
      </tr>`;
    })
    .join('');

  return `
    <table class="data-table ledger-dr-cr">
      <thead>
        <tr>
          <th class="col-part">Particulars</th>
          <th class="col-dr">Debit</th>
          <th class="col-cr">Credit</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td class="col-part"><strong>Total</strong></td>
          <td class="col-dr num"><strong>${escapeHtml(formatTableAmount(debitTotal))}</strong></td>
          <td class="col-cr num"><strong>${escapeHtml(formatTableAmount(creditTotal))}</strong></td>
        </tr>
      </tbody>
    </table>`;
}

function renderInvoiceLedger(ledgerRows: VoucherEntry[], headerLabel: string): string {
  if (!ledgerRows.length) {
    return '<p class="empty-note">No ledger lines.</p>';
  }
  const rows = ledgerRows
    .map(
      (entry) => `
      <tr>
        <td class="col-part">${escapeHtml(entry.accountName)}</td>
        <td class="col-amt num">${escapeHtml(formatTableAmount(entryDisplayAmount(entry)))}</td>
      </tr>`
    )
    .join('');

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th class="col-part">${escapeHtml(headerLabel)}</th>
          <th class="col-amt">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTaxSummary(voucher: Voucher): string {
  const t = voucher.totals;
  if (!t) return '';
  const lines: string[] = [];
  if (t.subtotal != null && t.subtotal !== 0) {
    lines.push(row('Subtotal', t.subtotal));
  }
  if (t.discount != null && t.discount !== 0) {
    lines.push(row('Discount', -Math.abs(t.discount)));
  }
  if (t.taxableAmount != null && t.taxableAmount !== 0) {
    lines.push(row('Taxable Amount', t.taxableAmount));
  }
  if (t.cgst) lines.push(row('CGST', t.cgst));
  if (t.sgst) lines.push(row('SGST', t.sgst));
  if (t.igst) lines.push(row('IGST', t.igst));
  if (t.cess) lines.push(row('Cess', t.cess));
  if (t.roundOff) lines.push(row('Round Off', t.roundOff));
  if (!lines.length) return '';

  function row(label: string, value: number) {
    return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td class="num">${escapeHtml(formatTableAmount(value))}</td>
      </tr>`;
  }

  return `
    <div class="tax-box">
      <div class="section-title">Tax Summary</div>
      <table class="summary-table">${lines.join('')}</table>
    </div>`;
}

/**
 * Print- and PDF-ready HTML document for any voucher type (Tally-synced).
 */
export function buildVoucherInvoiceHtml(
  voucher: Voucher,
  context: VoucherDocumentContext = {}
): string {
  const doc = prepareVoucherDocumentData(voucher);
  const displayAmount = resolveVoucherDisplayAmount(voucher);
  const companyName = context.companyName?.trim() || 'FinSync360';
  const refStr = formatReference(voucher.reference);
  const generatedAt = new Date().toLocaleString('en-IN');
  const accent = doc.accent;

  const metaRows: string[] = [
    metaCell('Voucher No.', voucher.voucherNumber),
    metaCell('Date', formatDDMMYYYY(voucher.date)),
    metaCell('Due Date', doc.dueStr),
    metaCell('Entry Mode', doc.entryMode),
    metaCell('Status', voucher.status),
    metaCell('Party', voucher.partyName?.trim() || '—'),
  ];
  if (refStr) metaRows.push(metaCell('Reference', refStr));
  if (voucher.tallyPersistedView) {
    metaRows.push(metaCell('Tally View', voucher.tallyPersistedView));
  }

  const ledgerSectionTitle = doc.isAsVoucher
    ? 'Particulars (As Voucher)'
    : doc.isAccountingInvoice
      ? 'Particulars'
      : 'Ledger Entries';

  const ledgerHtml = doc.isAsVoucher
    ? renderAsVoucherLedger(doc.ledgerRows, doc.ledgerDebitTotal, doc.ledgerCreditTotal)
    : renderInvoiceLedger(doc.ledgerRows, ledgerSectionTitle);

  const itemsHtml = doc.showItemsSection
    ? `<div class="section">
        <div class="section-title">Items</div>
        ${renderItemsTable(doc.items)}
      </div>`
    : '';

  const companyBlock = `
    <div class="company-block">
      <div class="company-name">${escapeHtml(companyName)}</div>
      ${context.companyAddress ? `<div class="company-meta">${escapeHtml(context.companyAddress)}</div>` : ''}
      ${context.companyGst ? `<div class="company-meta">GSTIN: ${escapeHtml(context.companyGst)}</div>` : ''}
      ${context.companyPhone ? `<div class="company-meta">Phone: ${escapeHtml(context.companyPhone)}</div>` : ''}
      ${context.companyEmail ? `<div class="company-meta">Email: ${escapeHtml(context.companyEmail)}</div>` : ''}
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(doc.title)} — ${escapeHtml(voucher.voucherNumber)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
      font-size: 11pt;
      color: #1a237e;
      margin: 0;
      padding: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { max-width: 210mm; margin: 0 auto; padding: 8px 4px 24px; }
    .top-bar {
      height: 6px;
      background: linear-gradient(90deg, ${accent} 0%, #0D47A1 100%);
      border-radius: 4px;
      margin-bottom: 18px;
    }
    .header {
      display: table;
      width: 100%;
      margin-bottom: 20px;
    }
    .header-left, .header-right {
      display: table-cell;
      vertical-align: top;
    }
    .header-right { text-align: right; width: 42%; }
    .company-name {
      font-size: 20pt;
      font-weight: 700;
      color: #0D47A1;
      letter-spacing: -0.3px;
      margin-bottom: 6px;
    }
    .company-meta { font-size: 9pt; color: #546e7a; line-height: 1.45; }
    .voucher-badge {
      display: inline-block;
      background: ${accent};
      color: #fff;
      font-size: 11pt;
      font-weight: 700;
      padding: 8px 16px;
      border-radius: 6px;
      letter-spacing: 0.3px;
      margin-bottom: 8px;
    }
    .voucher-sub { font-size: 9pt; color: #607d8b; }
    .status-pill {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
    .badge-danger { background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; }
    .badge-muted { background: #eceff1; color: #546e7a; border: 1px solid #cfd8dc; }
    .meta-grid {
      display: table;
      width: 100%;
      border: 1px solid #e3eaf2;
      border-radius: 8px;
      background: #f8fafc;
      margin-bottom: 18px;
      border-collapse: separate;
    }
    .meta-row { display: table-row; }
    .meta-cell {
      display: table-cell;
      width: 33.33%;
      padding: 10px 12px;
      border-bottom: 1px solid #e8eef5;
      vertical-align: top;
    }
    .meta-label {
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #78909c;
      font-weight: 700;
      margin-bottom: 3px;
    }
    .meta-value { font-size: 10pt; font-weight: 600; color: #263238; }
    .section { margin-bottom: 18px; }
    .section-title {
      font-size: 9pt;
      font-weight: 800;
      letter-spacing: 1px;
      color: #546e7a;
      text-transform: uppercase;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 2px solid ${accent};
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
    }
    .data-table thead th {
      background: #eceff1;
      color: #37474f;
      font-weight: 700;
      text-align: left;
      padding: 8px 8px;
      border: 1px solid #cfd8dc;
    }
    .data-table tbody td {
      padding: 7px 8px;
      border: 1px solid #e0e0e0;
      vertical-align: top;
    }
    .data-table .row-alt td { background: #fafbfc; }
    .data-table .total-row td {
      background: #e8eaf6;
      border-top: 2px solid ${accent};
      font-weight: 700;
    }
    .col-sn { width: 28px; text-align: center; }
    .col-item { min-width: 140px; }
    .col-qty { width: 72px; }
    .col-rate { width: 72px; }
    .col-amt { width: 88px; }
    .col-part { min-width: 200px; }
    .col-dr, .col-cr { width: 80px; }
    .num { text-align: right; white-space: nowrap; }
    .item-name { font-weight: 600; color: #263238; }
    .sub-line { font-size: 8.5pt; color: #607d8b; margin-top: 2px; }
    .sub-line.indent { margin-left: 12px; }
    .prefix { font-weight: 800; color: ${accent}; }
    .empty-note { color: #90a4ae; font-style: italic; padding: 8px 0; }
    .amount-hero {
      display: table;
      width: 100%;
      margin: 16px 0;
      border: 2px solid ${accent};
      border-radius: 10px;
      overflow: hidden;
    }
    .amount-hero-inner {
      display: table-cell;
      padding: 16px 20px;
      background: linear-gradient(135deg, #f5f9ff 0%, #e8f0fe 100%);
      vertical-align: middle;
    }
    .amount-label { font-size: 9pt; color: #546e7a; font-weight: 700; text-transform: uppercase; }
    .amount-value { font-size: 22pt; font-weight: 800; color: ${accent}; margin-top: 4px; }
    .words-box {
      margin-top: 10px;
      padding: 12px 14px;
      background: #fffde7;
      border-left: 4px solid #fbc02d;
      border-radius: 0 6px 6px 0;
      font-size: 9.5pt;
      color: #5d4037;
      line-height: 1.5;
    }
    .words-label { font-weight: 700; color: #f57f17; font-size: 8pt; text-transform: uppercase; }
    .tax-box { margin-top: 12px; }
    .summary-table { width: 100%; max-width: 280px; margin-left: auto; border-collapse: collapse; }
    .summary-table td { padding: 5px 8px; border-bottom: 1px solid #e0e0e0; }
    .summary-table td:first-child { color: #546e7a; }
    .notes-grid { display: table; width: 100%; }
    .notes-col { display: table-cell; width: 50%; padding-right: 12px; vertical-align: top; }
    .notes-body {
      font-size: 9.5pt;
      color: #455a64;
      line-height: 1.55;
      white-space: pre-wrap;
      min-height: 40px;
      padding: 10px;
      background: #fafafa;
      border: 1px solid #eee;
      border-radius: 6px;
    }
    .footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #cfd8dc;
      font-size: 8pt;
      color: #90a4ae;
      text-align: center;
    }
    .sign-row {
      display: table;
      width: 100%;
      margin-top: 32px;
    }
    .sign-cell {
      display: table-cell;
      width: 50%;
      text-align: center;
      padding-top: 40px;
      border-top: 1px solid #90a4ae;
      font-size: 9pt;
      color: #546e7a;
    }
    @media print {
      body { padding: 0; }
      .page { padding: 0; }
      .section { page-break-inside: avoid; }
      .amount-hero { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top-bar"></div>
    <div class="header">
      <div class="header-left">${companyBlock}</div>
      <div class="header-right">
        <div class="voucher-badge">${escapeHtml(doc.title)}</div>
        <div class="voucher-sub">${escapeHtml(voucher.voucherType.replace(/_/g, ' ').toUpperCase())}</div>
        <span class="status-pill ${statusBadgeClass(voucher.status)}">${escapeHtml(voucher.status)}</span>
      </div>
    </div>

    <div class="meta-grid">
      ${chunkMetaRows(metaRows, 3)}
    </div>

    ${itemsHtml}

    <div class="section">
      <div class="section-title">${escapeHtml(ledgerSectionTitle)}</div>
      ${ledgerHtml}
    </div>

    <div class="amount-hero">
      <div class="amount-hero-inner">
        <div class="amount-label">Total Amount</div>
        <div class="amount-value">${escapeHtml(formatInr(displayAmount))}</div>
        <div class="words-box">
          <div class="words-label">Amount in words</div>
          ${escapeHtml(rupeesToWords(displayAmount))}
        </div>
      </div>
    </div>

    ${renderTaxSummary(voucher)}

    <div class="section">
      <div class="notes-grid">
        <div class="notes-col">
          <div class="section-title">Terms &amp; Conditions</div>
          <div class="notes-body">${escapeHtml(doc.termsText.trim() || '—')}</div>
        </div>
        <div class="notes-col">
          <div class="section-title">Narration / Notes</div>
          <div class="notes-body">${escapeHtml(voucher.narration?.trim() || '—')}</div>
        </div>
      </div>
    </div>

    ${
      voucher.tallyId
        ? `<div class="section">
        <div class="section-title">Sync</div>
        <div class="notes-body" style="min-height:auto">
          Tally ID: ${escapeHtml(voucher.tallyId)}
          ${voucher.lastSyncedAt ? `\nLast synced: ${escapeHtml(new Date(voucher.lastSyncedAt).toLocaleString('en-IN'))}` : ''}
        </div>
      </div>`
        : ''
    }

    <div class="sign-row">
      <div class="sign-cell">Prepared by</div>
      <div class="sign-cell">Authorized Signatory</div>
    </div>

    <div class="footer">
      Generated by FinSync360 · ${escapeHtml(generatedAt)} · This is a computer-generated document.
    </div>
  </div>
</body>
</html>`;
}

function metaCell(label: string, value: string): string {
  return `
    <div class="meta-cell">
      <div class="meta-label">${escapeHtml(label)}</div>
      <div class="meta-value">${escapeHtml(value)}</div>
    </div>`;
}

function chunkMetaRows(cellsHtml: string[], perRow: number): string {
  const rows: string[] = [];
  for (let i = 0; i < cellsHtml.length; i += perRow) {
    const chunk = cellsHtml.slice(i, i + perRow);
    while (chunk.length < perRow) {
      chunk.push('<div class="meta-cell"></div>');
    }
    rows.push(`<div class="meta-row">${chunk.join('')}</div>`);
  }
  return rows.join('');
}
