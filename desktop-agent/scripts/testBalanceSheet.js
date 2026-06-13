const TallyService = require('../src/services/TallyService');
const { resolveBalanceSheetExportRange } = require('../src/utils/reportPeriods');

(async () => {
  try {
    const companyName = process.argv[2] || 'AIM INFOCOM SERVICES PVT.LTD';
    const periodKey = process.argv[3] || 'this_month';
    const company = { booksFrom: '2021-04-01', settings: { fiscalYearStart: '04-01' } };

    const range = resolveBalanceSheetExportRange(periodKey, company);
    const tally = new TallyService();

    console.log('Balance Sheet export range:', {
      periodKey: range.periodKey,
      label: range.label,
      booksFrom: range.booksFromDateIso,
      asOf: range.asOfDateIso
    });

    const report = await tally.getBalanceSheet(
      companyName,
      range.booksFromDateIso,
      range.asOfDateIso
    );

    console.log('Entries:', report.entries.length);
    console.log('Totals:', report.totals);
    if (report.entries.length > 0) {
      console.log('Sample lines:', report.entries.slice(0, 8));
    }
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  }
})();
