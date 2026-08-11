/**
 * Print/PDF invoice laid out to match TallyPrime's "Tax Invoice" format.
 *
 * The point of this document is that a customer who has seen the Tally print
 * should not be able to tell this one came from somewhere else. That means a
 * hairline-bordered table grid — not cards, not accent colours, not rounded
 * corners — with the same field names in the same boxes.
 *
 * Where Tally has a field we do not sync (Delivery Note, Dispatched through,
 * Terms of Delivery …) the box is still drawn and simply left empty, which is
 * exactly what Tally does when those fields are blank.
 *
 * Deliberately English-only. This follows the printed-document rule in
 * docs/I18N.md: an invoice's layout and wording belong to the invoice, not to
 * whatever language the app is currently displaying.
 */
import type { Voucher, VoucherEntry, VoucherItem } from '../types';
import {
  type VoucherDocumentContext,
  prepareVoucherDocumentData,
  formatTableAmount,
  formatReference,
  rupeesToWords,
  resolveVoucherDisplayAmount,
  entryDisplayAmount,
  voucherDisplayType,
} from './voucherDocument';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string | number | undefined | null): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Tally prints dates as 10-Aug-26. */
function tallyDate(value: string | Date | undefined | null): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}

/** Tally prints quantities to three decimals with the unit: "1.000 No." */
function tallyQty(qty: number | undefined, unit?: string): string {
  const n = Number(qty);
  if (!Number.isFinite(n) || n === 0) return '';
  return `${n.toFixed(3)}${unit ? ' ' + unit : ''}`;
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The company address arrives as a JSON object from the server
 * ({line1, line2, city, state, pincode, country}) but older records and some
 * callers still pass a plain string. Rendering the object directly is what
 * produced the literal "[object Object]" on the previous invoice.
 */
function addressLines(address: unknown): string[] {
  if (!address) return [];
  if (typeof address === 'string') {
    return address.split(/\r?\n|,\s*/).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof address !== 'object') return [];
  const a = address as Record<string, unknown>;
  const cityLine = [a.city, a.pincode].map((x) => (x ? String(x).trim() : '')).filter(Boolean).join('-');
  return [a.line1, a.line2, a.street, cityLine, a.country]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter((x) => x && x.toLowerCase() !== 'unknown');
}

/** First non-empty value across the alternative key spellings the API uses. */
function pick(source: Record<string, unknown> | undefined, ...keys: string[]): string {
  if (!source) return '';
  for (const k of keys) {
    const v = source[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** A tax ledger line (CGST / SGST / IGST / Cess), as opposed to a charge. */
function isTaxLedger(name: string): boolean {
  return /\b(cgst|sgst|utgst|igst|cess|central tax|state tax|integrated tax)\b/i.test(name || '');
}

// ---------------------------------------------------------------------------
// Item rows
// ---------------------------------------------------------------------------

/**
 * Tally shows a Disc. % column. We do not sync a discount field, but it is
 * recoverable: when the line amount is below rate x quantity, the difference is
 * the discount. Anything under 0.01% is treated as rounding, not a discount.
 */
function discountPercent(item: VoucherItem): number | null {
  const gross = num(item.rate) * num(item.quantity);
  const net = num(item.amount);
  if (gross <= 0 || net <= 0 || net >= gross) return null;
  const pct = ((gross - net) / gross) * 100;
  return pct < 0.01 ? null : pct;
}

function renderItemRows(items: VoucherItem[]): string {
  return items
    .map((item, idx) => {
      const disc = discountPercent(item);
      const subLines = [
        item.description ? escapeHtml(item.description) : '',
      ]
        .filter(Boolean)
        .map((line) => `<div class="sub">${line}</div>`)
        .join('');

      return `
      <tr>
        <td class="c-sl">${idx + 1}</td>
        <td class="c-desc"><span class="item-name">${escapeHtml(item.itemName)}</span>${subLines}</td>
        <td class="c-hsn">${escapeHtml(item.hsnCode || '')}</td>
        <td class="c-qty b">${escapeHtml(tallyQty(item.quantity, item.unit))}</td>
        <td class="c-rate">${item.rate ? formatTableAmount(num(item.rate)) : ''}</td>
        <td class="c-per">${escapeHtml(item.unit || '')}</td>
        <td class="c-disc">${disc == null ? '' : `${disc.toFixed(disc % 1 === 0 ? 0 : 2)} %`}</td>
        <td class="c-amt b">${formatTableAmount(num(item.amount))}</td>
      </tr>`;
    })
    .join('');
}

/**
 * Ledger lines (taxes, freight, round off) print under the items, right-aligned
 * against the description column, exactly as Tally stacks them.
 */
function renderLedgerRows(rows: VoucherEntry[]): string {
  return rows
    .map(
      (entry) => `
      <tr>
        <td class="c-sl"></td>
        <td class="c-desc ledger-name">${escapeHtml(entry.accountName)}</td>
        <td class="c-hsn"></td>
        <td class="c-qty"></td>
        <td class="c-rate"></td>
        <td class="c-per"></td>
        <td class="c-disc"></td>
        <td class="c-amt b">${formatTableAmount(entryDisplayAmount(entry))}</td>
      </tr>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// HSN / tax summary
// ---------------------------------------------------------------------------

interface HsnRow {
  hsn: string;
  taxable: number;
  cgstRate: number;
  cgst: number;
  sgstRate: number;
  sgst: number;
  igstRate: number;
  igst: number;
}

/**
 * Build the HSN-wise tax table.
 *
 * Preferred source is each item's own GST rates. Tally-synced vouchers often
 * carry the tax only as ledger lines, though, so when the items have no rates
 * the voucher totals are apportioned across the HSN groups by taxable value and
 * the rate is derived back from that. Either way the column totals tie out to
 * the voucher, which is the property that matters on a tax document.
 */
function buildHsnRows(voucher: Voucher, items: VoucherItem[]): HsnRow[] {
  if (!items.length) return [];

  const groups = new Map<string, { taxable: number; item: VoucherItem }>();
  for (const item of items) {
    const key = item.hsnCode || '';
    const existing = groups.get(key);
    if (existing) existing.taxable += num(item.amount);
    else groups.set(key, { taxable: num(item.amount), item });
  }

  const totalTaxable = [...groups.values()].reduce((s, g) => s + g.taxable, 0);
  const t = voucher.totals || {};
  const voucherCgst = num(t.cgst);
  const voucherSgst = num(t.sgst);
  const voucherIgst = num(t.igst);
  const itemsCarryRates = items.some(
    (i) => num(i.gst?.cgst) || num(i.gst?.sgst) || num(i.gst?.igst)
  );

  return [...groups.entries()].map(([hsn, g]) => {
    if (itemsCarryRates) {
      const cgstRate = num(g.item.gst?.cgst);
      const sgstRate = num(g.item.gst?.sgst);
      const igstRate = num(g.item.gst?.igst);
      return {
        hsn,
        taxable: g.taxable,
        cgstRate,
        cgst: (g.taxable * cgstRate) / 100,
        sgstRate,
        sgst: (g.taxable * sgstRate) / 100,
        igstRate,
        igst: (g.taxable * igstRate) / 100,
      };
    }
    const share = totalTaxable > 0 ? g.taxable / totalTaxable : 0;
    const cgst = voucherCgst * share;
    const sgst = voucherSgst * share;
    const igst = voucherIgst * share;
    const rateOf = (amount: number) => (g.taxable > 0 ? (amount / g.taxable) * 100 : 0);
    return {
      hsn,
      taxable: g.taxable,
      cgstRate: rateOf(cgst),
      cgst,
      sgstRate: rateOf(sgst),
      sgst,
      igstRate: rateOf(igst),
      igst,
    };
  });
}

function rateLabel(rate: number): string {
  if (!rate) return '';
  return `${Number(rate.toFixed(2))}%`;
}

function renderHsnTable(rows: HsnRow[], useIgst: boolean): string {
  if (!rows.length) return '';

  const totals = rows.reduce(
    (acc, r) => ({
      taxable: acc.taxable + r.taxable,
      cgst: acc.cgst + r.cgst,
      sgst: acc.sgst + r.sgst,
      igst: acc.igst + r.igst,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
  );

  const head = useIgst
    ? `<th class="ctr" colspan="2">IGST</th>`
    : `<th class="ctr" colspan="2">CGST</th><th class="ctr" colspan="2">SGST/UTGST</th>`;

  const subHead = useIgst
    ? `<th class="ctr sm">Rate</th><th class="ctr sm">Amount</th>`
    : `<th class="ctr sm">Rate</th><th class="ctr sm">Amount</th><th class="ctr sm">Rate</th><th class="ctr sm">Amount</th>`;

  const body = rows
    .map((r) => {
      const cells = useIgst
        ? `<td class="ctr">${rateLabel(r.igstRate)}</td><td class="num">${r.igst ? formatTableAmount(r.igst) : ''}</td>`
        : `<td class="ctr">${rateLabel(r.cgstRate)}</td><td class="num">${r.cgst ? formatTableAmount(r.cgst) : ''}</td>` +
          `<td class="ctr">${rateLabel(r.sgstRate)}</td><td class="num">${r.sgst ? formatTableAmount(r.sgst) : ''}</td>`;
      const total = useIgst ? r.igst : r.cgst + r.sgst;
      return `<tr>
        <td>${escapeHtml(r.hsn)}</td>
        <td class="num">${formatTableAmount(r.taxable)}</td>
        ${cells}
        <td class="num">${formatTableAmount(total)}</td>
      </tr>`;
    })
    .join('');

  const totalCells = useIgst
    ? `<td></td><td class="num b">${formatTableAmount(totals.igst)}</td>`
    : `<td></td><td class="num b">${formatTableAmount(totals.cgst)}</td>` +
      `<td></td><td class="num b">${formatTableAmount(totals.sgst)}</td>`;
  const grandTax = useIgst ? totals.igst : totals.cgst + totals.sgst;

  return `
  <table class="grid hsn">
    <thead>
      <tr>
        <th class="ctr" rowspan="2">HSN/SAC</th>
        <th class="ctr" rowspan="2">Taxable<br/>Value</th>
        ${head}
        <th class="ctr" rowspan="2">Total<br/>Tax Amount</th>
      </tr>
      <tr>${subHead}</tr>
    </thead>
    <tbody>
      ${body}
      <tr>
        <td class="num b">Total</td>
        <td class="num b">${formatTableAmount(totals.taxable)}</td>
        ${totalCells}
        <td class="num b">${formatTableAmount(grandTax)}</td>
      </tr>
    </tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// Party blocks
// ---------------------------------------------------------------------------

function partyBlock(
  heading: string,
  name: string,
  lines: string[],
  gstin: string,
  stateName: string
): string {
  const addr = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  return `
  <div class="party">
    <div class="party-head">${escapeHtml(heading)}</div>
    <div class="party-name">${escapeHtml(name)}</div>
    ${addr}
    ${gstin ? `<div class="kv"><span class="k">GSTIN/UIN</span><span class="s">:</span><span>${escapeHtml(gstin)}</span></div>` : ''}
    ${stateName ? `<div class="kv"><span class="k">State Name</span><span class="s">:</span><span>${escapeHtml(stateName)}</span></div>` : ''}
  </div>`;
}

/** One labelled cell of the top-right meta grid. */
function metaCell(label: string, value: string): string {
  return `<td class="meta"><div class="meta-l">${escapeHtml(label)}</div><div class="meta-v">${escapeHtml(value)}</div></td>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function buildVoucherInvoiceHtml(
  voucher: Voucher,
  context: VoucherDocumentContext = {}
): string {
  const doc = prepareVoucherDocumentData(voucher);
  const items = doc.items || [];
  const ctx = context as unknown as Record<string, unknown>;

  const companyName = pick(ctx, 'companyName') || 'Company';
  const companyAddr = addressLines((ctx as { companyAddress?: unknown }).companyAddress);
  const companyGstin = pick(ctx, 'companyGst', 'companyGstin', 'gstin', 'gstNumber');
  const companyState = pick(ctx, 'companyState', 'state');
  // Tally prints "SUBJECT TO <CITY> JURISDICTION". Fall back to the state name
  // with its ", Code : 27" suffix stripped — that suffix belongs in the address
  // block, not in a jurisdiction line.
  const jurisdiction =
    (typeof (ctx as { companyAddress?: { city?: string } }).companyAddress === 'object'
      ? String(
          (ctx as { companyAddress?: { city?: string } }).companyAddress?.city || ''
        ).trim()
      : '') || companyState.split(',')[0].trim();
  const companyPan = pick(ctx, 'companyPan', 'pan', 'panNumber');
  const companyEmail = pick(ctx, 'companyEmail', 'email');
  const companyPhone = pick(ctx, 'companyPhone', 'phone');

  const partyName = (voucher.partyName || '').trim();
  const partyGstin = (voucher.partyGstin || '').trim();
  const partyState = (voucher.placeOfSupply || '').trim();
  const shipping = (
    voucher as unknown as { shipping?: { address?: unknown; method?: string } }
  ).shipping;
  const partyAddr = addressLines(shipping?.address);

  const refStr = formatReference(voucher.reference);
  const refDate =
    voucher.reference && typeof voucher.reference === 'object'
      ? tallyDate((voucher.reference as { date?: string }).date)
      : '';

  // Taxes and charges print as rows beneath the items, taxes first — Tally's
  // order — so the eye runs items → tax → total.
  const ledgerRows = (doc.ledgerRows || []).filter((e) => entryDisplayAmount(e) !== 0);
  const taxRows = ledgerRows.filter((e) => isTaxLedger(e.accountName));
  const otherRows = ledgerRows.filter((e) => !isTaxLedger(e.accountName));

  const totalQty = items.reduce((s, i) => s + num(i.quantity), 0);
  const unit = items.find((i) => i.unit)?.unit || '';
  const grandTotal = resolveVoucherDisplayAmount(voucher);

  const t = voucher.totals || {};
  const hsnRows = buildHsnRows(voucher, items);
  const useIgst = num(t.igst) > 0 || items.some((i) => num(i.gst?.igst) > 0);
  const totalTax = hsnRows.reduce(
    (s, r) => s + (useIgst ? r.igst : r.cgst + r.sgst),
    0
  );

  const title = /sales/i.test(voucher.voucherType) ? 'Tax Invoice' : voucherDisplayType(voucher);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} ${escapeHtml(voucher.voucherNumber || '')}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10.5px;
    color: #000;
    margin: 0;
    -webkit-print-color-adjust: exact;
  }
  .doc-title { text-align: center; font-size: 15px; font-weight: bold; margin: 0 0 6px; }
  table { border-collapse: collapse; width: 100%; }
  .outer, .grid { border: 1px solid #000; }
  .outer td, .grid td, .grid th { border: 1px solid #000; vertical-align: top; padding: 2px 4px; }
  .no-b { border: 0 !important; }
  .b { font-weight: bold; }
  .ctr { text-align: center; }
  .num { text-align: right; }
  .sm { font-size: 9.5px; }

  /* Seller / consignee / buyer */
  .seller-name { font-size: 13px; font-weight: bold; }
  .seller-line { font-size: 9.5px; line-height: 1.35; }
  .party { padding: 2px 0; }
  .party-head { font-size: 10.5px; }
  .party-name { font-size: 12px; font-weight: bold; margin: 1px 0; }
  .party div { line-height: 1.4; }
  .kv { display: flex; }
  .kv .k { display: inline-block; min-width: 96px; }
  .kv .s { width: 10px; }

  /* Top-right meta grid */
  .meta { height: 34px; }
  .meta-l { font-size: 10px; }
  .meta-v { font-weight: bold; font-size: 11px; }

  /* Items */
  .items th { border: 1px solid #000; padding: 3px 4px; font-weight: normal; text-align: center; }
  .items td { border-left: 1px solid #000; border-right: 1px solid #000; border-top: 0; border-bottom: 0; }
  .items .head-row th { vertical-align: middle; }
  .item-name { font-weight: bold; }
  .sub { font-style: italic; padding-left: 10px; }
  .ledger-name { text-align: right; font-style: italic; font-weight: bold; }
  .c-sl { width: 4%; text-align: center; }
  .c-desc { width: 38%; }
  .c-hsn { width: 10%; text-align: center; }
  .c-qty { width: 11%; text-align: right; }
  .c-rate { width: 11%; text-align: right; }
  .c-per { width: 5%; text-align: center; }
  .c-disc { width: 8%; text-align: center; }
  .c-amt { width: 13%; text-align: right; }
  .spacer td { height: 46px; }
  .total-row td { border-top: 1px solid #000; border-bottom: 1px solid #000; font-weight: bold; }

  .words { font-size: 12px; font-weight: bold; }
  .eoe { text-align: right; font-style: italic; }
  .hsn th { font-weight: normal; }
  .decl { font-size: 10px; line-height: 1.35; }
  .sign { text-align: right; height: 62px; position: relative; }
  .sign .for { font-weight: bold; }
  .sign .auth { position: absolute; right: 4px; bottom: 2px; }
  .foot { text-align: center; margin-top: 6px; font-size: 11px; }
  .foot .small { font-size: 10.5px; margin-top: 4px; }
</style>
</head>
<body>
  <div class="doc-title">${escapeHtml(title)}</div>

  <table class="outer">
    <tr>
      <!-- Left: seller + consignee + buyer -->
      <td style="width:55%; padding:0;">
        <table style="width:100%; border:0;">
          <tr>
            <td class="no-b" style="border-bottom:1px solid #000 !important;">
              <div class="seller-name">${escapeHtml(companyName)}</div>
              <div class="seller-line">
                ${companyAddr.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}
                ${companyGstin ? `<div>GSTIN/UIN: ${escapeHtml(companyGstin)}</div>` : ''}
                ${companyState ? `<div>State Name : ${escapeHtml(companyState)}</div>` : ''}
                ${companyEmail ? `<div>E-Mail : ${escapeHtml(companyEmail)}</div>` : ''}
                ${companyPhone ? `<div>Phone : ${escapeHtml(companyPhone)}</div>` : ''}
              </div>
            </td>
          </tr>
          <tr>
            <td class="no-b" style="border-bottom:1px solid #000 !important;">
              ${partyBlock('Consignee (Ship to)', partyName, partyAddr, partyGstin, partyState)}
            </td>
          </tr>
          <tr>
            <td class="no-b" style="height:150px;">
              ${partyBlock('Buyer (Bill to)', partyName, partyAddr, partyGstin, partyState)}
            </td>
          </tr>
        </table>
      </td>

      <!-- Right: meta grid -->
      <td style="width:45%; padding:0;">
        <table style="width:100%; border:0;">
          <tr>
            ${metaCell('Invoice No.', voucher.voucherNumber || '')}
            ${metaCell('Dated', tallyDate(voucher.date))}
          </tr>
          <tr>
            ${metaCell('Delivery Note', '')}
            ${metaCell('Mode/Terms of Payment', voucher.terms?.paymentTerms || '')}
          </tr>
          <tr>
            ${metaCell('Reference No. & Date.', refStr + (refDate ? `  dt. ${refDate}` : ''))}
            ${metaCell('Other References', '')}
          </tr>
          <tr>
            ${metaCell("Buyer's Order No.", refStr)}
            ${metaCell('Dated', refDate)}
          </tr>
          <tr>
            ${metaCell('Dispatch Doc No.', '')}
            ${metaCell('Delivery Note Date', '')}
          </tr>
          <tr>
            ${metaCell('Dispatched through', shipping?.method || '')}
            ${/* Destination is the delivery place, which we do not sync — Tally
                  leaves it blank too rather than substituting place of supply. */ ''}
            ${metaCell('Destination', '')}
          </tr>
          <tr>
            <td class="meta" colspan="2" style="height:auto;">
              <div class="meta-l">Terms of Delivery</div>
              <div class="meta-v">${escapeHtml(voucher.terms?.deliveryTerms || '')}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Items -->
  <table class="grid items" style="border-top:0;">
    <thead>
      <tr class="head-row">
        <th class="c-sl">Sl<br/>No.</th>
        <th class="c-desc">Description of<br/>Goods and Services</th>
        <th class="c-hsn">HSN/SAC</th>
        <th class="c-qty">Quantity</th>
        <th class="c-rate">Rate</th>
        <th class="c-per">per</th>
        <th class="c-disc">Disc. %</th>
        <th class="c-amt">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${renderItemRows(items)}
      ${taxRows.length || otherRows.length ? '<tr><td class="c-sl">&nbsp;</td><td colspan="7"></td></tr>' : ''}
      ${renderLedgerRows(taxRows)}
      ${renderLedgerRows(otherRows)}
      <tr class="spacer"><td class="c-sl"></td><td colspan="7"></td></tr>
      <tr class="total-row">
        <td class="c-sl"></td>
        <td class="num">Total</td>
        <td class="c-hsn"></td>
        <td class="c-qty">${escapeHtml(tallyQty(totalQty, unit))}</td>
        <td class="c-rate"></td>
        <td class="c-per"></td>
        <td class="c-disc"></td>
        <td class="c-amt">&#8377; ${formatTableAmount(grandTotal)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Amount in words -->
  <table class="grid" style="border-top:0;">
    <tr>
      <td style="border-right:0;">Amount Chargeable (in words)</td>
      <td class="eoe" style="border-left:0;">E. &amp; O.E</td>
    </tr>
    <tr>
      <td class="words" colspan="2" style="border-top:0;">INR ${escapeHtml(rupeesToWords(grandTotal).replace(/\s*Rupees/i, '').replace(/\s+/g, ' ').trim())}</td>
    </tr>
  </table>

  ${renderHsnTable(hsnRows, useIgst)}

  ${
    totalTax > 0
      ? `<table class="grid" style="border-top:0;">
    <tr><td>Tax Amount (in words) : <span class="b">INR ${escapeHtml(
      rupeesToWords(totalTax).replace(/\s*Rupees/i, '').replace(/\s+/g, ' ').trim()
    )}</span></td></tr>
  </table>`
      : ''
  }

  <table class="grid" style="border-top:0;">
    ${
      companyPan
        ? `<tr><td colspan="2">Company's PAN <span style="display:inline-block;width:60px"></span>: <span class="b">${escapeHtml(companyPan)}</span></td></tr>`
        : ''
    }
    <tr>
      <td style="width:55%;">
        <div>Declaration</div>
        <div class="decl">We declare that this invoice shows the actual price of the
        goods described and that all particulars are true and correct.</div>
      </td>
      <td class="sign" style="width:45%;">
        <div class="for">for ${escapeHtml(companyName)}</div>
        <div class="auth">Authorised Signatory</div>
      </td>
    </tr>
  </table>

  <div class="foot">
    ${jurisdiction ? `SUBJECT TO ${escapeHtml(jurisdiction.toUpperCase())} JURISDICTION` : ''}
    <div class="small">This is a Computer Generated Invoice</div>
  </div>
</body>
</html>`;
}
