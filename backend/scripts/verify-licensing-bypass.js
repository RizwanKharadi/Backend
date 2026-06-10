/**
 * Verify activateDevice skips seat limit when LICENSE_ENFORCEMENT=false.
 * Run: LICENSE_ENFORCEMENT=false node scripts/verify-licensing-bypass.js
 */
import { isLicenseEnforcementEnabled } from '../src/constants/licensing.js';

process.env.LICENSE_ENFORCEMENT = 'false';

const enabled = isLicenseEnforcementEnabled();
if (enabled) {
  console.error('FAIL: isLicenseEnforcementEnabled() should be false');
  process.exit(1);
}

// Static check: activateDevice gates enforcement with isLicenseEnforcementEnabled()
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'licenseService.js'), 'utf8');

const checks = [
  'const enforcementEnabled = isLicenseEnforcementEnabled()',
  'if (enforcementEnabled && !access.allowed)',
  'if (enforcementEnabled) {',
];

for (const c of checks) {
  if (!src.includes(c)) {
    console.error(`FAIL: missing expected guard: ${c}`);
    process.exit(1);
  }
}

console.log('OK: licensing bypass guards present; isLicenseEnforcementEnabled() returns false');
