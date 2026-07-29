/**
 * Generate TallyFin brand icons from the master Play Store PNG.
 * Run: node scripts/generate-brand-icons.js
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SOURCE = path.resolve(
  __dirname,
  '../assets/tallyfin-icon.png'
);

const WEBSITE_DIR =
  'D:/Rizwan/App website/App Website/kalanidhithemes.com/live-preview/landing-page/apper/all-demo/01-app-landing-page-defoult/images';

const ANDROID_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const IOS_SIZES = [
  { name: 'Icon-20@2x.png', size: 40 },
  { name: 'Icon-20@3x.png', size: 60 },
  { name: 'Icon-29@2x.png', size: 58 },
  { name: 'Icon-29@3x.png', size: 87 },
  { name: 'Icon-40@2x.png', size: 80 },
  { name: 'Icon-40@3x.png', size: 120 },
  { name: 'Icon-60@2x.png', size: 120 },
  { name: 'Icon-60@3x.png', size: 180 },
  { name: 'Icon-1024.png', size: 1024 },
];

async function resizePng(outPath, size, fit = 'cover') {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await sharp(SOURCE)
    .resize(size, size, { fit, background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(outPath);
}

async function writeIco(outPath, sizes = [16, 32, 48, 64, 128, 256]) {
  // sharp doesn't write ICO; write largest PNG and copy for electron-builder fallback
  const pngPath = outPath.replace(/\.ico$/, '.png');
  await resizePng(pngPath, 256);
  await fs.promises.copyFile(pngPath, outPath.replace(/\.ico$/, '-256.png'));
  // electron-builder accepts .png on Windows when .ico missing; also copy as .ico placeholder via png
  await fs.promises.copyFile(pngPath, outPath);
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Source icon missing:', SOURCE);
    process.exit(1);
  }

  const root = path.resolve(__dirname, '..');

  // Website logos
  await resizePng(path.join(WEBSITE_DIR, 'logo.png'), 180, 'contain');
  await resizePng(path.join(WEBSITE_DIR, 'footer_logo.png'), 160, 'contain');
  await resizePng(path.join(WEBSITE_DIR, 'favicon.png'), 64, 'contain');

  // Desktop agent
  const agentAssets = path.join(root, 'desktop-agent/assets');
  const agentBuild = path.join(root, 'desktop-agent/build');
  await resizePng(path.join(agentAssets, 'icon.png'), 512, 'contain');
  await resizePng(path.join(agentAssets, 'tray-icon.png'), 32, 'contain');
  await resizePng(path.join(agentBuild, 'icon.ico'), 256, 'contain');
  await fs.promises.copyFile(
    path.join(agentBuild, 'icon.ico'),
    path.join(root, 'desktop-agent/renderer/public/favicon.png')
  );

  // Android mipmaps
  const androidRes = path.join(root, 'mobile/android/app/src/main/res');
  for (const [folder, size] of Object.entries(ANDROID_SIZES)) {
    await resizePng(
      path.join(androidRes, folder, 'ic_launcher.png'),
      size,
      'contain'
    );
    await resizePng(
      path.join(androidRes, folder, 'ic_launcher_round.png'),
      size,
      'contain'
    );
    await resizePng(
      path.join(androidRes, folder, 'ic_launcher_foreground.png'),
      Math.round(size * 0.72),
      'contain'
    );
  }

  // Update adaptive icon background to white
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#FFFFFF" android:pathData="M0,0h108v108h-108z"/>
</vector>`;
  await fs.promises.writeFile(
    path.join(androidRes, 'drawable/ic_launcher_background.xml'),
    bgXml
  );

  // iOS AppIcon set
  const iosIconDir = path.join(
    root,
    'mobile/ios/FinSync360Mobile/Images.xcassets/AppIcon.appiconset'
  );
  for (const { name, size } of IOS_SIZES) {
    await resizePng(path.join(iosIconDir, name), size, 'contain');
  }

  const contentsJson = {
    images: [
      { filename: 'Icon-20@2x.png', idiom: 'iphone', scale: '2x', size: '20x20' },
      { filename: 'Icon-20@3x.png', idiom: 'iphone', scale: '3x', size: '20x20' },
      { filename: 'Icon-29@2x.png', idiom: 'iphone', scale: '2x', size: '29x29' },
      { filename: 'Icon-29@3x.png', idiom: 'iphone', scale: '3x', size: '29x29' },
      { filename: 'Icon-40@2x.png', idiom: 'iphone', scale: '2x', size: '40x40' },
      { filename: 'Icon-40@3x.png', idiom: 'iphone', scale: '3x', size: '40x40' },
      { filename: 'Icon-60@2x.png', idiom: 'iphone', scale: '2x', size: '60x60' },
      { filename: 'Icon-60@3x.png', idiom: 'iphone', scale: '3x', size: '60x60' },
      { filename: 'Icon-1024.png', idiom: 'ios-marketing', scale: '1x', size: '1024x1024' },
    ],
    info: { author: 'xcode', version: 1 },
  };
  await fs.promises.writeFile(
    path.join(iosIconDir, 'Contents.json'),
    JSON.stringify(contentsJson, null, 2)
  );

  // Mobile in-app asset
  const mobileAssets = path.join(root, 'mobile/src/assets');
  await fs.promises.mkdir(mobileAssets, { recursive: true });
  await resizePng(path.join(mobileAssets, 'tallyfin-icon.png'), 256, 'contain');

  // Tally_sync website folder
  const tallyWebsite = path.join(root, 'website/assets');
  await fs.promises.mkdir(tallyWebsite, { recursive: true });
  await resizePng(path.join(tallyWebsite, 'tallyfin-icon.png'), 256, 'contain');

  console.log('TallyFin icons generated successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
