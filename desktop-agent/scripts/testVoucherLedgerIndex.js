/**
 * Smoke test: ledger index from ALLLEDGERENTRIES (P&L Sales GST drill-down).
 */
const { XMLParser } = require('fast-xml-parser');
const TallyService = require('../src/services/TallyService');

const sampleXml = `<?xml version="1.0"?>
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        <VOUCHER>
          <DATE TYPE="Date">20250506</DATE>
          <GUID>test-guid-1</GUID>
          <VOUCHERNUMBER>AISPL/25-26/0244</VOUCHERNUMBER>
          <VOUCHERTYPENAME>Sales Order (25-26)</VOUCHERTYPENAME>
          <AMOUNT TYPE="Amount">-9440.00</AMOUNT>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME TYPE="String">Kohinoor Rice Traders</LEDGERNAME>
            <AMOUNT TYPE="Amount">-9440.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME TYPE="String">Sales GST</LEDGERNAME>
            <AMOUNT TYPE="Amount">8000.00</AMOUNT>
            <INVENTORYALLOCATIONS.LIST>
              <STOCKITEMNAME TYPE="String">Annual Support Contract</STOCKITEMNAME>
              <AMOUNT TYPE="Amount">8000.00</AMOUNT>
            </INVENTORYALLOCATIONS.LIST>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

const tally = new TallyService();
const parsed = parser.parse(sampleXml);
const vouchers = tally.extractVoucherSummariesFromResponse(parsed);
const row = vouchers[0];

const hasSalesGst = row.ledgerNames.includes('Sales GST');
const hasInventory = row.hasInventory === true;

console.log('Summary row:', {
  voucherNumber: row.voucherNumber,
  ledgerNames: row.ledgerNames,
  hasInventory: row.hasInventory,
  detailLevel: row.detailLevel,
  itemCount: row.items?.length,
  ledgerEntryCount: row.ledgerEntries?.length
});

const hasLines =
  (row.items?.length || 0) > 0 && (row.ledgerEntries?.length || 0) > 0;

if (!hasSalesGst || !hasInventory || !hasLines) {
  console.error('FAIL: expected Sales GST in ledgerNames, hasInventory, and parsed lines');
  process.exit(1);
}
console.log('OK: voucher ledger index + line parsing');
