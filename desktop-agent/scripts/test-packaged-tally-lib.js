/**
 * Test tally-sync-ts loader inside packaged Electron app.
 * Usage (from installed agent folder):
 *   electron scripts/test-packaged-tally-lib.js
 */
const { app } = require('electron');
const fs = require('fs');

app.whenReady().then(async () => {
  const { resolveTallySyncTsEntryPath, importTallyClientClass } = require('../src/utils/tallySyncTsModuleLoader');

  console.log('isPackaged:', app.isPackaged);
  console.log('resourcesPath:', process.resourcesPath);
  console.log('__dirname:', __dirname);

  const entry = resolveTallySyncTsEntryPath();
  console.log('resolved entry:', entry);
  console.log('entry exists:', entry ? fs.existsSync(entry) : false);

  try {
    const Client = await importTallyClientClass();
    console.log('TallyClient loaded:', typeof Client);
  } catch (error) {
    console.error('LOAD FAILED:', error.message);
    process.exitCode = 1;
  }

  app.quit();
});
