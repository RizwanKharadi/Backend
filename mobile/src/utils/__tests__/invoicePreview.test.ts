/**
 * Renders the printed invoice with a fixture copied from a real TallyPrime
 * print, so the layout can be eyeballed side by side with Tally's own PDF.
 *
 * Set INVOICE_PREVIEW_OUT to a path to dump the HTML:
 *   INVOICE_PREVIEW_OUT=/tmp/invoice.html npx jest invoicePreview
 */
import fs from 'fs';
import { buildVoucherInvoiceHtml } from '../voucherInvoiceHtml';
import type { Voucher } from '../../types';

const voucher = {
  id: 'v1',
  voucherNumber: 'AISPL/857/26-27',
  voucherType: 'sales',
  tallyVoucherTypeName: 'Sales GST (26-27)',
  tallyPersistedView: 'Invoice Voucher View',
  tallyEntryMode: 'item_invoice',
  date: '2026-08-10',
  partyName: 'Elite Housekeeping and Hospitality Service',
  partyGstin: '27AZDPS8901J1ZY',
  placeOfSupply: 'Maharashtra, Code : 27',
  reference: { number: 'AIM/SO/880/26-27', date: '2026-08-07' },
  amount: 9558,
  status: 'posted',
  shipping: {
    address: {
      line1: 'TPS III, 4, Laxmi Krupa,',
      line2: '24th Road, Bandra West, Mumbai',
    },
  },
  items: [
    {
      id: 'i1',
      itemName: 'Tally Software Services-Silver',
      description: 'Tally Sr. No. 718942824 — 2 Years Renewal',
      quantity: 1,
      unit: 'No.',
      rate: 9000,
      amount: 8100,
      hsnCode: '998313',
    },
  ],
  entries: [
    {
      id: 'e0',
      accountName: 'Elite Housekeeping and Hospitality Service',
      debitAmount: 9558,
      creditAmount: 0,
    },
    { id: 'e1', accountName: 'SGST-State Tax', debitAmount: 0, creditAmount: 729 },
    { id: 'e2', accountName: 'CGST Central Tax', debitAmount: 0, creditAmount: 729 },
  ],
  totals: {
    subtotal: 8100,
    taxableAmount: 8100,
    cgst: 729,
    sgst: 729,
    totalTax: 1458,
    grandTotal: 9558,
  },
  companyId: 'c1',
  createdBy: 'u1',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
} as unknown as Voucher;

const context = {
  companyName: 'AIM INFOCOM SERVICES PVT.LTD',
  companyAddress: {
    line1: '12C, 1st Floor, Mehta Chamber,',
    line2: 'Kalyan Street, Dana Bunder, Masjid Bunder (East)',
    city: 'Mumbai',
    pincode: '400009',
    country: 'India',
  },
  companyGst: '27AALCA9378B1ZE',
  companyPan: 'AALCA9378B',
  companyState: 'Maharashtra, Code : 27',
  companyEmail: 'info@aiminfocom.com',
};

describe('printed invoice', () => {
  const html = buildVoucherInvoiceHtml(voucher, context);

  it('renders the Tally field labels', () => {
    for (const label of [
      'Tax Invoice',
      'Invoice No.',
      'Dated',
      'Consignee (Ship to)',
      'Buyer (Bill to)',
      'HSN/SAC',
      'Disc. %',
      'Amount Chargeable (in words)',
      'E. &amp; O.E',
      'Taxable',
      'Declaration',
      'Authorised Signatory',
      'This is a Computer Generated Invoice',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('never prints [object Object] for an address', () => {
    // The previous invoice interpolated the address object straight into the
    // template. This is the regression guard for that.
    expect(html).not.toContain('[object Object]');
    expect(html).toContain('12C, 1st Floor, Mehta Chamber,');
    expect(html).toContain('Mumbai-400009');
  });

  it('shows the figures Tally shows', () => {
    expect(html).toContain('9,000.00'); // rate
    expect(html).toContain('8,100.00'); // taxable / line amount
    expect(html).toContain('729.00'); // each GST half
    expect(html).toContain('9,558.00'); // grand total
    expect(html).toContain('1,458.00'); // total tax
    expect(html).toContain('10 %'); // discount derived from rate vs amount
    expect(html).toContain('1.000 No.'); // Tally quantity format
    expect(html).toContain('10-Aug-26'); // Tally date format
  });

  it('states both amounts in words', () => {
    expect(html).toContain('Nine Thousand Five Hundred Fifty Eight');
    expect(html).toContain('One Thousand Four Hundred Fifty Eight');
  });

  it('splits CGST and SGST rather than showing IGST', () => {
    expect(html).toContain('SGST/UTGST');
    expect(html).not.toContain('>IGST<');
    // 9% each, derived from the tax ledgers against the taxable value.
    expect(html).toContain('9%');
  });

  it('drops the party ledger from the printed lines', () => {
    const body = html.split('Description of')[1] || '';
    expect(body).not.toContain('Elite Housekeeping and Hospitality Service</td>');
  });

  it('optionally writes the HTML out for visual comparison', () => {
    const out = process.env.INVOICE_PREVIEW_OUT;
    if (out) fs.writeFileSync(out, html);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});
