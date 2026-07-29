# Legacy Web Frontend (Create React App)

**Status: deprecated**

This folder contains the original **Create React App** (`react-scripts`) web UI. It is **not** used in production and is **not** required for the Tally sync flow.

## Use instead

**[frontend-nextjs/](../frontend-nextjs/)** — Next.js 15 web app with:

- Dashboard, vouchers, inventory, companies, reports
- Superadmin portal (`/admin`)
- Razorpay billing (`/settings/billing`)
- Production deployment (Heroku `finsync-frontend-nextjs`)

## Commands

| Purpose | Command |
|---------|---------|
| Active web app | `npm run frontend:dev` (from repo root → runs **frontend-nextjs**) |
| This legacy app only | `npm run frontend-legacy:dev` |

## Tally → mobile flow

TallyPrime data reaches the mobile app via **desktop-agent → backend → MongoDB Atlas**. Neither this folder nor `frontend-nextjs` participates in sync. See [docs/SYNC_STACK_VERIFICATION.md](../docs/SYNC_STACK_VERIFICATION.md).
