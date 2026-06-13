/**
 * Loads tally-sync-ts (ESM-only) from Electron main / Node (CJS).
 *
 * Packaged Windows builds must import via file:// URL and prefer app.asar.unpacked
 * because ESM cannot be required() and raw Windows paths break dynamic import().
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let cachedModule = null;
let loadPromise = null;

function getElectronApp() {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}

function isPackagedApp() {
  const app = getElectronApp();
  if (app?.isPackaged) {
    return true;
  }
  if (typeof __dirname === 'string' && __dirname.includes('app.asar')) {
    return true;
  }
  return Boolean(process.resourcesPath && process.env.NODE_ENV === 'production');
}

function resolveResourcesPath() {
  if (process.resourcesPath) {
    return process.resourcesPath;
  }
  const normalizedDir = String(__dirname).replace(/\\/g, '/');
  const marker = '/resources/app.asar/';
  const idx = normalizedDir.indexOf(marker);
  if (idx >= 0) {
    return normalizedDir.slice(0, idx + '/resources'.length);
  }
  return null;
}

function resolveTallySyncTsEntryPath() {
  const relParts = ['node_modules', 'tally-sync-ts', 'dist', 'index.js'];
  const packaged = isPackagedApp();
  const resourcesPath = resolveResourcesPath();

  if (packaged && resourcesPath) {
    const unpackedEntry = path.join(resourcesPath, 'app.asar.unpacked', ...relParts);
    if (fs.existsSync(unpackedEntry)) {
      return unpackedEntry;
    }
  }

  const searchRoots = [
    path.join(__dirname, '..', '..'),
    path.join(__dirname, '..', '..', '..'),
    path.join(__dirname, '..', '..', '..', '..'),
    process.cwd()
  ];

  if (resourcesPath) {
    searchRoots.unshift(path.join(resourcesPath, 'app.asar.unpacked'));
  }

  for (const root of searchRoots) {
    const candidate = path.join(root, ...relParts);
    if (fs.existsSync(candidate)) {
      if (packaged && candidate.includes(`${path.sep}app.asar${path.sep}`)) {
        continue;
      }
      return candidate;
    }
  }

  if (!packaged) {
    try {
      const pkgJsonPath = require.resolve('tally-sync-ts/package.json');
      const entry = path.join(path.dirname(pkgJsonPath), 'dist', 'index.js');
      if (fs.existsSync(entry)) {
        return entry;
      }
    } catch {
      // not installed
    }
  }

  return null;
}

async function importTallySyncTsModule() {
  if (cachedModule) {
    return cachedModule;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const entryPath = resolveTallySyncTsEntryPath();
      if (!entryPath) {
        const resourcesPath = resolveResourcesPath();
        throw new Error(
          `tally-sync-ts is not installed or dist/index.js is missing in the packaged app. ` +
            `Expected: ${resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'tally-sync-ts', 'dist', 'index.js') : '(unknown resources path)'}. ` +
            'Rebuild the desktop agent with: cd desktop-agent && npm run prepare-tally-lib && npm run electron:dist'
        );
      }

      const mod = await import(pathToFileURL(entryPath).href);
      const libDir = path.dirname(entryPath);

      // index.js does not re-export parsePostResponse (used for master/voucher POST imports)
      let parsePostResponse = mod.parsePostResponse;
      if (typeof parsePostResponse !== 'function') {
        const parserMod = await import(pathToFileURL(path.join(libDir, 'xmlParser.js')).href);
        parsePostResponse = parserMod.parsePostResponse;
      }

      if (typeof mod.buildPostXml !== 'function') {
        const builderMod = await import(pathToFileURL(path.join(libDir, 'xmlBuilder.js')).href);
        cachedModule = { ...mod, ...builderMod, parsePostResponse };
      } else {
        cachedModule = { ...mod, parsePostResponse };
      }

      return cachedModule;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

async function importTallyClientClass() {
  const mod = await importTallySyncTsModule();
  const Client = mod?.TallyClient || mod?.default;
  if (!Client) {
    throw new Error('tally-sync-ts did not export TallyClient');
  }
  return Client;
}

module.exports = {
  resolveTallySyncTsEntryPath,
  importTallySyncTsModule,
  importTallyClientClass
};
