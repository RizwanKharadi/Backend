#!/usr/bin/env node
/**
 * Validates iOS native scaffold files (runs on any OS; does not require Xcode).
 */
const fs = require('fs');
const path = require('path');

const mobileRoot = path.join(__dirname, '..');
const iosRoot = path.join(mobileRoot, 'ios');

const required = [
  'Podfile',
  'FinSync360Mobile.xcodeproj/project.pbxproj',
  'FinSync360Mobile/Info.plist',
  'FinSync360Mobile/AppDelegate.mm',
  'FinSync360Mobile/AppDelegate.h',
  'FinSync360Mobile/main.m',
  'FinSync360Mobile/LaunchScreen.storyboard',
  'FinSync360Mobile.xcodeproj/xcshareddata/xcschemes/FinSync360Mobile.xcscheme',
  '.xcode.env',
];

let failed = 0;

console.log('FinSync360 iOS scaffold verification\n');

for (const rel of required) {
  const full = path.join(iosRoot, rel);
  if (fs.existsSync(full)) {
    console.log(`  OK  ${rel}`);
  } else {
    console.log(`  FAIL  ${rel}`);
    failed += 1;
  }
}

const pbx = fs.readFileSync(path.join(iosRoot, 'FinSync360Mobile.xcodeproj/project.pbxproj'), 'utf8');
const checks = [
  ['moduleName FinSync360Mobile in AppDelegate', fs.readFileSync(path.join(iosRoot, 'FinSync360Mobile/AppDelegate.mm'), 'utf8').includes('@"FinSync360Mobile"')],
  ['bundle id com.finsync360', pbx.includes('PRODUCT_BUNDLE_IDENTIFIER = com.finsync360;')],
  ['Face ID usage string', fs.readFileSync(path.join(iosRoot, 'FinSync360Mobile/Info.plist'), 'utf8').includes('NSFaceIDUsageDescription')],
  ['Podfile permissions setup', fs.readFileSync(path.join(iosRoot, 'Podfile'), 'utf8').includes('setup_permissions')],
  ['app.json name match', JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).name === 'FinSync360Mobile'],
];

console.log('');
for (const [label, ok] of checks) {
  console.log(ok ? `  OK  ${label}` : `  FAIL  ${label}`);
  if (!ok) failed += 1;
}

const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));
if (pkg.dependencies['@react-native-community/push-notification-ios']) {
  console.log('  OK  push-notification-ios dependency');
} else {
  console.log('  FAIL  push-notification-ios dependency');
  failed += 1;
}

console.log('');
if (failed === 0) {
  console.log('All checks passed. Run `bash scripts/setup-ios.sh` on macOS for pod install + build.');
  process.exit(0);
}

console.log(`${failed} check(s) failed.`);
process.exit(1);
