/**
 * Ensures tally-sync-ts is built (dist/) and ships with all runtime deps nested
 * under tally-sync-ts/node_modules for Electron asar.unpacked resolution.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const agentRoot = path.join(__dirname, '..');

const libCandidates = [
  path.join(agentRoot, 'node_modules', 'tally-sync-ts'),
  path.join(agentRoot, '..', 'node_modules', 'tally-sync-ts'),
  path.join(agentRoot, '..', '..', 'node_modules', 'tally-sync-ts')
];

const moduleSearchRoots = [
  path.join(agentRoot, 'node_modules'),
  path.join(agentRoot, '..', 'node_modules'),
  path.join(agentRoot, '..', '..', 'node_modules')
];

/** fast-xml-parser v5 runtime deps — must live beside unpacked tally-sync-ts */
const RUNTIME_DEP_PATHS = [
  'fast-xml-builder',
  path.join('@nodable', 'entities'),
  'path-expression-matcher',
  'strnum',
  'xml-naming'
];

const NPM_INSTALL_SPECS = [
  'fast-xml-builder@^1.2.0',
  '@nodable/entities@^2.1.0',
  'path-expression-matcher@^1.5.0',
  'strnum@^2.3.0',
  'xml-naming@^0.1.0'
];

function depExists(depPath) {
  return fs.existsSync(path.join(depPath, 'package.json'));
}

function resolveDepSource(rel) {
  for (const root of moduleSearchRoots) {
    const candidate = path.join(root, rel);
    if (depExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function copyDir(src, dest) {
  if (!depExists(src) && !fs.existsSync(src)) {
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

function ensureRuntimeDepsInstalled() {
  const missing = RUNTIME_DEP_PATHS.filter((rel) => !resolveDepSource(rel));
  if (missing.length === 0) {
    return;
  }

  console.log('[prepare-tally-sync-ts] Installing missing runtime deps:', missing.join(', '));
  execSync(`npm install ${NPM_INSTALL_SPECS.join(' ')} --ignore-scripts --no-audit --no-fund`, {
    cwd: agentRoot,
    stdio: 'inherit',
    shell: true
  });
}

function vendorRuntimeDeps(libRoot) {
  ensureRuntimeDepsInstalled();

  const tallyModules = path.join(libRoot, 'node_modules');
  const missing = [];

  fs.mkdirSync(tallyModules, { recursive: true });

  for (const rel of RUNTIME_DEP_PATHS) {
    const src = resolveDepSource(rel);
    const dest = path.join(tallyModules, rel);
    if (!src || !copyDir(src, dest)) {
      missing.push(rel);
    }
  }

  const fxpNested = path.join(tallyModules, 'fast-xml-parser', 'node_modules');
  fs.mkdirSync(fxpNested, { recursive: true });
  for (const rel of [
    'fast-xml-builder',
    path.join('@nodable', 'entities'),
    'path-expression-matcher',
    'xml-naming'
  ]) {
    const src = resolveDepSource(rel);
    const dest = path.join(fxpNested, rel);
    if (src) {
      copyDir(src, dest);
    }
  }

  if (missing.length > 0) {
    console.error(
      '[prepare-tally-sync-ts] Could not vendor:',
      missing.join(', '),
      '\nRun: cd desktop-agent && npm install && npm run prepare-tally-lib'
    );
    process.exit(1);
  }

  console.log('[prepare-tally-sync-ts] Vendored runtime deps into', tallyModules);
}

const libRoot = libCandidates.find((p) => fs.existsSync(path.join(p, 'package.json')));
if (!libRoot) {
  console.warn('[prepare-tally-sync-ts] tally-sync-ts not installed; skip');
  process.exit(0);
}

const distIndex = path.join(libRoot, 'dist', 'index.js');
if (!fs.existsSync(distIndex)) {
  console.log('[prepare-tally-sync-ts] Building tally-sync-ts at', libRoot);
  execSync('npm run build', { cwd: libRoot, stdio: 'inherit' });
}

if (!fs.existsSync(distIndex)) {
  console.error('[prepare-tally-sync-ts] dist/index.js still missing after build');
  process.exit(1);
}

vendorRuntimeDeps(libRoot);
console.log('[prepare-tally-sync-ts] OK:', distIndex);
