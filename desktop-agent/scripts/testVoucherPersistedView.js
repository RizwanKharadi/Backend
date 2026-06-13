/**
 * Smoke test: PERSISTEDVIEW + VCHENTRYMODE → tallyEntryMode
 */
const { XMLParser } = require('fast-xml-parser');
const TallyService = require('../src/services/TallyService');

const paymentXml = `<?xml version="1.0"?>
<ENVELOPE><BODY><DATA><COLLECTION>
<VOUCHER VCHTYPE="Payment" OBJVIEW="Accounting Voucher View">
  <DATE>20250506</DATE>
  <GUID>pay-1</GUID>
  <VOUCHERNUMBER>PAY/0155</VOUCHERNUMBER>
  <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
  <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
  <VCHENTRYMODE></VCHENTRYMODE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>H.D.F.C Bank</LEDGERNAME><AMOUNT>-26550.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>C C Avenue</LEDGERNAME><AMOUNT>26550.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
</COLLECTION></DATA></BODY></ENVELOPE>`;

const salesOrderXml = `<?xml version="1.0"?>
<ENVELOPE><BODY><DATA><COLLECTION>
<VOUCHER VCHTYPE="Sales Order" OBJVIEW="Accounting Voucher View">
  <DATE>20250506</DATE>
  <GUID>so-1</GUID>
  <VOUCHERNUMBER>AISPL/25-26/0244</VOUCHERNUMBER>
  <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
  <VCHENTRYMODE></VCHENTRYMODE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales GST</LEDGERNAME><AMOUNT>8000.00</AMOUNT>
    <INVENTORYALLOCATIONS.LIST>
      <STOCKITEMNAME>Annual Support Contract</STOCKITEMNAME>
      <AMOUNT>8000.00</AMOUNT>
      <RATE>8000.00/No.</RATE>
      <ACTUALQTY> 1.000 No.</ACTUALQTY>
    </INVENTORYALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
</COLLECTION></DATA></BODY></ENVELOPE>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

const tally = new TallyService();
const pay = tally.extractVouchersFromResponse(parser.parse(paymentXml))[0];
const so = tally.extractVouchersFromResponse(parser.parse(salesOrderXml))[0];

console.log('Payment:', {
  tallyPersistedView: pay.tallyPersistedView,
  tallyEntryMode: pay.tallyEntryMode,
  ledgerCount: pay.ledgerEntries?.length
});
console.log('Sales order:', {
  tallyPersistedView: so.tallyPersistedView,
  tallyEntryMode: so.tallyEntryMode,
  itemCount: so.items?.length
});

const journalXml = `<?xml version="1.0"?>
<ENVELOPE><BODY><DATA><COLLECTION>
<VOUCHER VCHTYPE="Journal">
  <DATE>20260502</DATE>
  <GUID>jv-026</GUID>
  <VOUCHERNUMBER>JV/026</VOUCHERNUMBER>
  <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
  <VCHENTRYMODE>As Voucher</VCHENTRYMODE>
  <NARRATION>Rent Month Of May 2026</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-50000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Mahesh K Bhanushali</LEDGERNAME><AMOUNT>45000.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>JV/026</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>50000.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
    <BILLALLOCATIONS.LIST>
      <NAME>JV/026</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-5000.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>TDS on Rent</LEDGERNAME><AMOUNT>5000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
</COLLECTION></DATA></BODY></ENVELOPE>`;

const jv = tally.extractVouchersFromResponse(parser.parse(journalXml))[0];
console.log('Journal JV/026:', {
  tallyEntryMode: jv.tallyEntryMode,
  ledgers: jv.ledgerEntries?.map((e) => ({
    name: e.name,
    debit: e.debit,
    credit: e.credit,
    subLines: e.subLines?.length
  }))
});

const ok =
  pay.tallyEntryMode === 'as_voucher' &&
  so.tallyEntryMode === 'item_invoice' &&
  (so.items?.length || 0) > 0 &&
  jv.tallyEntryMode === 'as_voucher' &&
  (jv.ledgerEntries?.length || 0) === 3 &&
  (jv.ledgerEntries?.[1]?.subLines?.length || 0) >= 1;

if (!ok) {
  console.error('FAIL');
  process.exit(1);
}
console.log('OK: PERSISTEDVIEW mapping');
