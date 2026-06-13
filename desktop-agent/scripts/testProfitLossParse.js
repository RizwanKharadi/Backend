const { XMLParser } = require('fast-xml-parser');
const TallyService = require('../src/services/TallyService');

const plXml = `<?xml version="1.0"?>
<ENVELOPE>
  <DSPACCNAME><DSPDISPNAME>Sales Accounts</DSPDISPNAME></DSPACCNAME>
  <PLAMT><PLSUBAMT></PLSUBAMT><BSMAINAMT>4680380.40</BSMAINAMT></PLAMT>
  <DSPACCNAME><DSPDISPNAME>Indirect Expenses</DSPDISPNAME></DSPACCNAME>
  <PLAMT><PLSUBAMT></PLSUBAMT><BSMAINAMT>-1447964.32</BSMAINAMT></PLAMT>
</ENVELOPE>`;

const gsXml = `<?xml version="1.0"?>
<ENVELOPE>
  <DSPACCNAME><DSPDISPNAME>Sales GST</DSPDISPNAME></DSPACCNAME>
  <DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>3832698.40</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>
  <DSPACCNAME><DSPDISPNAME>Sales IGST</DSPDISPNAME></DSPACCNAME>
  <DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>837181.00</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>
</ENVELOPE>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

const tally = new TallyService();
const pl = tally.parseProfitAndLoss(parser.parse(plXml), '2026-04-01', '2026-05-21');
const gs = tally.parseGroupSummaryFromEnvelope(parser.parse(gsXml).ENVELOPE);

console.log('P&L entries:', pl.entries);
console.log('Group ledgers:', gs);
process.exit(pl.entries.length === 2 && gs.length === 2 ? 0 : 1);
