const TallyService = require('../src/services/TallyService');
const SyncManager = require('../src/services/SyncManager');

(async () => {
  try {
    const companyName = process.argv[2] || 'KINJAL CIVILCON LLP';
    const fromDate = process.argv[3] || '2026-04-01';
    const toDate = process.argv[4] || '2026-05-31';

    const tally = new TallyService();
    const sync = new SyncManager();

    // Minimal stub webSocketClient so syncReportToServer queues when not connected
    sync.setServices(tally, { isConnected: false, sendMessage: () => {} }, null);

    console.log('Requesting Profit & Loss from Tally for', companyName, fromDate, toDate);
    const report = await tally.getProfitAndLoss(companyName, fromDate, toDate);

    console.log('Parsed report entries:', report.entries.length);
    console.log(JSON.stringify(report, null, 2));

    // Queue to be sent to backend when WS connects
    await sync.syncReportToServer(report, companyName);
    console.log('Report queued for sync (or sent if websocket connected).');
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  }
})();
