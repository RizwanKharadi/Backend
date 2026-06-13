const fs = require('fs');
const path = require('path');
const { resolveTallySyncTsEntryPath } = require('../tallySyncTsModuleLoader');

describe('tallySyncTsModuleLoader', () => {
  it('resolves dist/index.js in development', () => {
    const entry = resolveTallySyncTsEntryPath();
    expect(entry).toBeTruthy();
    expect(fs.existsSync(entry)).toBe(true);
    expect(entry.replace(/\\/g, '/')).toMatch(/tally-sync-ts\/dist\/index\.js$/);
  });

  it('resolves app.asar.unpacked entry when packaged', () => {
    const distRoot = path.join(__dirname, '..', '..', '..', 'dist', 'win-unpacked', 'resources');
    const unpackedEntry = path.join(
      distRoot,
      'app.asar.unpacked',
      'node_modules',
      'tally-sync-ts',
      'dist',
      'index.js'
    );
    if (!fs.existsSync(unpackedEntry)) {
      return;
    }

    const previousResourcesPath = process.resourcesPath;
    process.resourcesPath = distRoot;
    try {
      const entry = resolveTallySyncTsEntryPath();
      expect(entry).toBe(unpackedEntry);
    } finally {
      process.resourcesPath = previousResourcesPath;
    }
  });

});
