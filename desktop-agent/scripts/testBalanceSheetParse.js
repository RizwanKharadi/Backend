const TallyService = require('../src/services/TallyService');
const { XMLParser } = require('fast-xml-parser');

const sampleXml = `<?xml version="1.0"?>
<ENVELOPE>
  <BSNAME><DSPACCNAME><DSPDISPNAME>Capital Account</DSPDISPNAME></DSPACCNAME></BSNAME>
  <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT>-861357.95</BSMAINAMT></BSAMT>
  <BSNAME><DSPACCNAME><DSPDISPNAME>Loans (Liability)</DSPDISPNAME></DSPACCNAME></BSNAME>
  <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT>3490439.38</BSMAINAMT></BSAMT>
  <BSNAME><DSPACCNAME><DSPDISPNAME>Current Liabilities</DSPDISPNAME></DSPACCNAME></BSNAME>
  <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT>2255085.44</BSMAINAMT></BSAMT>
  <BSNAME><DSPACCNAME><DSPDISPNAME>Fixed Assets</DSPDISPNAME></DSPACCNAME></BSNAME>
  <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT>-326572.02</BSMAINAMT></BSAMT>
  <BSNAME><DSPACCNAME><DSPDISPNAME>Current Assets</DSPDISPNAME></DSPACCNAME></BSNAME>
  <BSAMT><BSSUBAMT></BSSUBAMT><BSMAINAMT>-7281290.28</BSMAINAMT></BSAMT>
</ENVELOPE>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

const parsed = parser.parse(sampleXml);
const tally = new TallyService();
const report = tally.parseBalanceSheet(parsed, '2026-05-21');

console.log('entries:', report.entries.length);
report.entries.forEach((e) => {
  console.log(`- ${e.displayName}: ${e.mainAmount}`);
});

const ok =
  report.entries[0]?.displayName === 'Capital Account' &&
  report.entries[0]?.mainAmount === -861357.95 &&
  report.entries[2]?.displayName === 'Current Liabilities' &&
  report.entries[2]?.mainAmount === 2255085.44;

process.exit(ok ? 0 : 1);
