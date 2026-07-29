# iOS parity QA checklist

Use this checklist on a **Mac** with Xcode after `bash scripts/setup-ios.sh` and a successful `npm run ios` build.

## Environment

- [ ] macOS with Xcode 14+
- [ ] `cd mobile/ios && pod install` completed without errors
- [ ] Open **`ios/FinSync360Mobile.xcworkspace`** (not `.xcodeproj`)
- [ ] Signing team selected; bundle id `com.finsync360`
- [ ] `.env` or `.env.production` has correct `API_BASE_URL`

## Sync stack (same as Android)

1. TallyPrime open on Windows PC (port 9000)
2. desktop-agent logged in, company linked, sync complete
3. MongoDB Atlas has data for the company
4. Mobile logged in with **same user account**

## Feature parity

| Area | Test | Pass |
|------|------|------|
| Auth | Email/password login | |
| Auth | Token refresh / session restore | |
| Auth | Logout | |
| Auth | Face ID / Touch ID (physical device) | |
| Company | Company list after sync | |
| Company | Switch active company | |
| Dashboard | Metrics load from API | |
| Transactions | Voucher type cards open filtered lists | |
| Transactions | DayBook date range | |
| Vouchers | List, detail, search | |
| Inventory | Item list and detail | |
| Reports | P&L, Balance Sheet, Outstanding, Top 10 | |
| Settings | Profile, change password | |
| Offline | SQLite cache / sync screen | |
| Share | Voucher PDF share sheet (iOS) | |
| Realtime | Socket.IO connect (optional) | |
| Notifications | Local notification on sync event | |

## API smoke test (platform-agnostic)

```bash
cd mobile
node test-full-integration.js
```

Expected: all production API tests pass (same as Android).

## Release path

1. Xcode → Product → Archive
2. Upload to App Store Connect / TestFlight
3. Internal testing → App Store review

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Pod install fails | `cd ios && pod deintegrate && pod install` |
| Metro port conflict | App uses port 8082: `npm start` |
| Simulator cannot reach local backend | Backend on Mac: use `localhost:5000` in `.env.development` |
| Physical device + local backend | Use Mac LAN IP instead of `localhost` |
| Missing icons | Run `npx react-native-asset` from `mobile/` |
