/**
 * Bill references must survive the trip from Tally.
 *
 * A receipt against an invoice arrived in the app as "On Account" with an empty
 * billType, because BILLALLOCATIONS.LIST was never in the voucher FETCH list.
 * 'On Account' is the parser's fallback when it finds neither a bill type nor a
 * reference name — so a real "Agst Ref AISPL/871/26-27" was being reported as
 * an unallocated payment. That silently breaks outstanding receivables and
 * bill-wise ageing, since the link between a receipt and the invoice it settles
 * is the reference.
 */
const TallyService = require('../TallyService');

const service = new TallyService();

// Exactly the shape Tally returns inside a ledger entry.
const AGST_REF_XML = `<ALLLEDGERENTRIES.LIST>
 <LEDGERNAME>Thrimuthy Enterprises</LEDGERNAME>
 <AMOUNT>1534.00</AMOUNT>
 <BILLALLOCATIONS.LIST>
  <NAME>AISPL/871/26-27</NAME>
  <BILLTYPE>Agst Ref</BILLTYPE>
  <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
  <AMOUNT>1534.00</AMOUNT>
  <INTERESTCOLLECTION.LIST>        </INTERESTCOLLECTION.LIST>
  <STBILLCATEGORIES.LIST>        </STBILLCATEGORIES.LIST>
 </BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>`;

const parseEntry = (xml) => {
  const parsed = service.parseXmlResponse(xml);
  return parsed['ALLLEDGERENTRIES.LIST'];
};

describe('bill allocations from Tally', () => {
  test('keeps the bill type and reference name', () => {
    const subLines = service.parseBillAllocationsFromEntry(parseEntry(AGST_REF_XML));

    expect(subLines).toHaveLength(1);
    expect(subLines[0].billType).toBe('Agst Ref');
    expect(subLines[0].text).toContain('AISPL/871/26-27');
    expect(subLines[0].amount).toBe(1534);
  });

  test('does not report a referenced receipt as On Account', () => {
    const subLines = service.parseBillAllocationsFromEntry(parseEntry(AGST_REF_XML));

    expect(subLines[0].text).not.toContain('On Account');
  });

  test('reads the label the way Tally shows it', () => {
    const subLines = service.parseBillAllocationsFromEntry(parseEntry(AGST_REF_XML));

    expect(subLines[0].text).toBe('Agst Ref AISPL/871/26-27 | 1,534.00 Cr');
    expect(subLines[0].side).toBe('Cr');
  });

  test('a genuinely unallocated receipt is still On Account', () => {
    const xml = `<ALLLEDGERENTRIES.LIST>
 <LEDGERNAME>Some Party</LEDGERNAME>
 <BILLALLOCATIONS.LIST>
  <NAME></NAME>
  <BILLTYPE></BILLTYPE>
  <AMOUNT>500.00</AMOUNT>
 </BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>`;

    const subLines = service.parseBillAllocationsFromEntry(parseEntry(xml));

    expect(subLines[0].text).toContain('On Account');
  });

  test('a New Ref keeps its own type rather than collapsing to Agst Ref', () => {
    const xml = `<ALLLEDGERENTRIES.LIST>
 <LEDGERNAME>Some Party</LEDGERNAME>
 <BILLALLOCATIONS.LIST>
  <NAME>INV/001</NAME>
  <BILLTYPE>New Ref</BILLTYPE>
  <AMOUNT>-2500.00</AMOUNT>
 </BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>`;

    const subLines = service.parseBillAllocationsFromEntry(parseEntry(xml));

    expect(subLines[0].billType).toBe('New Ref');
    expect(subLines[0].side).toBe('Dr');
    expect(subLines[0].amount).toBe(2500);
  });

  test('several bills against one receipt all come through', () => {
    const xml = `<ALLLEDGERENTRIES.LIST>
 <LEDGERNAME>Some Party</LEDGERNAME>
 <BILLALLOCATIONS.LIST>
  <NAME>INV/001</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>1000.00</AMOUNT>
 </BILLALLOCATIONS.LIST>
 <BILLALLOCATIONS.LIST>
  <NAME>INV/002</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>534.00</AMOUNT>
 </BILLALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>`;

    const subLines = service.parseBillAllocationsFromEntry(parseEntry(xml));

    expect(subLines.map((s) => s.text)).toEqual([
      'Agst Ref INV/001 | 1,000.00 Cr',
      'Agst Ref INV/002 | 534.00 Cr',
    ]);
  });
});

describe('the voucher export asks Tally for bill allocations', () => {
  test('BILLALLOCATIONS.LIST is in the full-detail FETCH list', () => {
    const xml = service.buildCustomVoucherColXml(
      'AIM INFOCOM SERVICES PVT.LTD',
      '2026-04-01',
      '2026-08-12',
      { detailLevel: 'full' }
    );

    expect(xml).toContain('BILLALLOCATIONS.LIST');
  });
});
