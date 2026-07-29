#!/usr/bin/env bash
# Run on macOS after cloning the repo to prepare the iOS native project.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> TallyFin iOS setup (React Native 0.73.2)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: iOS builds require macOS with Xcode." >&2
  exit 1
fi

if ! command -v pod >/dev/null 2>&1; then
  echo "Error: CocoaPods not found. Run: sudo gem install cocoapods" >&2
  exit 1
fi

echo "==> Installing npm dependencies"
npm install

echo "==> Linking vector icon fonts"
npx react-native-asset

echo "==> Installing CocoaPods"
cd ios
pod install
cd ..

echo ""
echo "Done. Next steps:"
echo "  1. Open ios/FinSync360Mobile.xcworkspace in Xcode"
echo "  2. Select your Team under Signing & Capabilities (bundle id: com.finsync360)"
echo "  3. npm run ios"
echo ""
echo "Production API is in .env.production — copy to .env before release builds."
