# FinSync360 Licensing (Phase 1)

## Product rules

| Setting | Value |
|---------|--------|
| Trial | **7 days**, **1 device** seat |
| Grace after failed payment | **2 days** (`past_due` status) |
| Mobile app | **Included** with organization subscription |

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/devices/activate` | User JWT | Register this PC (`agentId`) as a licensed device |
| GET | `/api/devices/license-status` | User JWT | Org subscription + seat usage |
| GET | `/api/devices/license-status/agent` | Optional device token / `agentId` | Agent heartbeat |
| GET | `/api/devices` | User JWT | List devices for org |
| DELETE | `/api/devices/:agentId` | User JWT | Revoke a device seat |

## Environment

```env
LICENSE_ENFORCEMENT=true   # default on in production
DEVICE_TOKEN_EXPIRE=30d
JWT_EXPIRE=30d             # access token (desktop/mobile auto-refresh before this)
JWT_REFRESH_EXPIRE=90d     # refresh token — customer signs in again only after this
```

Desktop and mobile apps call `POST /api/auth/refresh` with the stored refresh token when the access token expires, so customers do not need to know what a JWT is.

Set `LICENSE_ENFORCEMENT=false` for local development without device activation.

## Desktop agent flow

1. User logs in → JWT stored.
2. On WebSocket connect, agent calls `POST /api/devices/activate` and stores `deviceToken`.
3. WebSocket connects with `?agentId=...&deviceToken=...`.
4. Sync is rejected if trial expired, seat limit exceeded, or device revoked.

## Registration

New users receive an **Organization** and **trial subscription** automatically (7 days, 1 seat).

Legacy users without an organization get one lazily on first licensed API call.

---

## Phase 2 — Razorpay billing

### API (`/api/billing`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/plans` | Public | Monthly/yearly per-device prices |
| POST | `/webhook` | Razorpay signature | Subscription lifecycle events |
| GET | `/status` | JWT | License + billing summary |
| POST | `/subscribe` | JWT | Create Razorpay subscription checkout |
| POST | `/sync` | JWT | Refresh status from Razorpay after payment |
| POST | `/cancel` | JWT | Cancel subscription |

`/subscribe` and `/status` work **without** an active subscription so customers can pay after trial expiry.

### Request: start checkout

```http
POST /api/billing/subscribe
Authorization: Bearer <token>
Content-Type: application/json

{
  "billingCycle": "monthly",
  "seatLimit": 2
}
```

Response includes `shortUrl` — open in browser to complete Razorpay payment. `quantity` = number of Tally PCs (devices). Mobile is included.

### Razorpay Dashboard

1. Enable **Subscriptions** on your Razorpay account.
2. Add webhook URL: `https://<your-backend>/api/billing/webhook`
3. Subscribe to events:
   - `subscription.authenticated`
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.halted`
   - `subscription.cancelled`
   - `subscription.completed`
   - `payment.failed`
4. Use the same webhook secret as `RAZORPAY_WEBHOOK_SECRET` (or `RAZORPAY_BILLING_WEBHOOK_SECRET`).

### Environment

```env
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
BILLING_MONTHLY_PRICE_PAISE=99900
BILLING_YEARLY_PRICE_PAISE=999900
BILLING_CALLBACK_URL=https://your-app.com/billing/success
RAZORPAY_PLAN_MONTHLY_ID=   # optional
RAZORPAY_PLAN_YEARLY_ID=    # optional
```

### Webhook → license state

| Event | Local `Subscription.status` |
|-------|----------------------------|
| `subscription.activated` / `charged` | `active` — `seatLimit` from Razorpay `quantity` |
| `payment.failed` | `past_due` — **2-day grace** (Phase 1) |
| `subscription.halted` | `suspended` |
| `subscription.cancelled` | `cancelled` |

After payment, call `POST /api/billing/sync` if the UI does not update immediately.

---

## Phase 3 — Admin & customer UI

| Surface | Path / location |
|---------|-----------------|
| Web admin (superadmin) | `/admin` in frontend-nextjs |
| Web billing (customers) | `/settings/billing` |
| Desktop agent | Sidebar → **Subscription** |
| Mobile | Settings → **Subscription & billing** |
| Admin API | `/api/admin/*` (superadmin JWT only) |

### Admin device transfer

When a PC was activated under one organization and the user signs in under another, activation fails with *"This device is registered to another organization"*. Revoking the device from the old org does **not** fix this — the `agentId` row must be reassigned.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/devices/:agentId/transfer` | Superadmin: move device to `targetOrganizationId` |

```http
POST /api/admin/devices/<agentId>/transfer
Authorization: Bearer <superadmin-jwt>
Content-Type: application/json

{
  "targetOrganizationId": "<organization-object-id>",
  "reason": "Customer moved to new account"
}
```

After transfer, the user must **sign in again** on the desktop agent so a new `deviceToken` is issued.

See [HEROKU_SCALING.md](HEROKU_SCALING.md) for deployment limits on Heroku.
