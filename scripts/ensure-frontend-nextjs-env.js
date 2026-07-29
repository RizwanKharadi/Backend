#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'frontend-nextjs');
const example = path.join(dir, '.env.example');
const local = path.join(dir, '.env.local');

if (!fs.existsSync(local) && fs.existsSync(example)) {
  fs.copyFileSync(example, local);
  console.log('Created frontend-nextjs/.env.local from .env.example');
}

const nextLocal = path.join(dir, 'node_modules', 'next');
const nextRoot = path.join(__dirname, '..', 'node_modules', 'next');
if (!fs.existsSync(nextLocal) && !fs.existsSync(nextRoot)) {
  console.error(
    'frontend-nextjs dependencies missing. Run: npm run install:frontend'
  );
  process.exit(1);
}
