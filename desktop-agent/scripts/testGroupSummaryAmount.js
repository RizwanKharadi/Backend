/**
 * Smoke test: Group Summary net = credit − |debit| (Tally DSPCLCRAMTA / DSPCLDRAMTA).
 */
const { XMLParser } = require('fast-xml-parser');
const TallyService = require('../src/services/TallyService');

const provisionsXml = `<?xml version="1.0"?>
<ENVELOPE>
  <DSPACCNAME><DSPDISPNAME>Provisions</DSPDISPNAME></DSPACCNAME>
  <DSPACCINFO>
    <DSPCLDRAMT><DSPCLDRAMTA>-3500.00</DSPCLDRAMTA></DSPCLDRAMT>
    <DSPCLCRAMT><DSPCLCRAMTA>304858.00</DSPCLCRAMTA></DSPCLCRAMT>
  </DSPACCINFO>
  <DSPACCNAME><DSPDISPNAME>Deferred Tax Asset</DSPDISPNAME></DSPACCNAME>
  <DSPACCINFO>
    <DSPCLDRAMT><DSPCLDRAMTA>-40448.00</DSPCLDRAMTA></DSPCLDRAMT>
    <DSPCLCRAMT><DSPCLCRAMTA></DSPCLCRAMTA></DSPCLCRAMT>
  </DSPACCINFO>
</ENVELOPE>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

const tally = new TallyService();
const ledgers = tally.parseGroupSummaryFromEnvelope(parser.parse(provisionsXml).ENVELOPE);

const provisions = ledgers.find((l) => l.displayName === 'Provisions');
const deferred = ledgers.find((l) => l.displayName === 'Deferred Tax Asset');

console.log('Provisions:', provisions?.amount, '(expect 301358)');
console.log('Deferred Tax Asset:', deferred?.amount, '(expect -40448)');

const ok =
  provisions?.amount === 301358 &&
  deferred?.amount === -40448;

if (!ok) {
  console.error('FAIL');
  process.exit(1);
}
console.log('OK: Group Summary net amounts');
