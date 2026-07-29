#!/usr/bin/env node
/**
 * Verifies local config for Tally → agent → backend → Atlas → mobile flow.
 * Does not require TallyPrime to be running.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
let warned = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
  passed += 1;
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
  failed += 1;
}

function warn(msg) {
  console.log(`  ! ${msg}`);
  warned += 1;
}

function readEnvFile(relPath) {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) return null;
  const text = fs.readFileSync(full, 'utf8');
  const env = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function checkBackendEnv() {
  console.log('\nBackend (.env)');
  const env = readEnvFile('backend/.env');
  if (!env) {
    fail('backend/.env missing — copy from backend/.env.example');
    return;
  }
  ok('backend/.env exists');
  if (env.MONGODB_URI && env.MONGODB_URI.includes('mongodb')) {
    ok('MONGODB_URI is set');
  } else {
    fail('MONGODB_URI missing or invalid');
  }
  const port = env.PORT || '5000';
  ok(`PORT=${port}`);
  return port;
}

function checkMobileEnv() {
  console.log('\nMobile (.env.development)');
  const env =
    readEnvFile('mobile/.env.development') || readEnvFile('mobile/.env');
  if (!env) {
    warn('mobile/.env.development not found — use MOBILE_SETUP_GUIDE.md');
    return;
  }
  const api = env.API_BASE_URL || env.REACT_APP_API_URL;
  if (api && api.includes('localhost:5000')) {
    ok(`API points to local backend (${api})`);
  } else if (api) {
    warn(`API_BASE_URL is not localhost:5000 (${api}) — OK for production`);
  } else {
    fail('API_BASE_URL not set in mobile env');
  }
}

function checkHealth(port) {
  return new Promise((resolve) => {
    console.log('\nBackend health (optional)');
    const req = http.get(
      `http://127.0.0.1:${port}/health`,
      { timeout: 3000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            ok(`GET /health → ${res.statusCode}`);
          } else {
            warn(`GET /health → ${res.statusCode}`);
          }
          resolve();
        });
      }
    );
    req.on('error', () => {
      warn(
        `Backend not reachable on port ${port} — start with: npm run backend:dev`
      );
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      warn('Health check timed out');
      resolve();
    });
  });
}

async function main() {
  console.log('FinSync360 — Tally sync stack verification\n');
  const port = checkBackendEnv() || '5000';
  checkMobileEnv();
  await checkHealth(port);

  console.log('\n---');
  console.log(`Passed: ${passed}, Failed: ${failed}, Warnings: ${warned}`);
  console.log('Full checklist: docs/SYNC_STACK_VERIFICATION.md\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();
