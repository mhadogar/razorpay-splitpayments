# CoffeeSooq Razorpay Split Scheduler

Node.js scheduler that:

1. Fetches captured payments from Razorpay.
2. Holds settlement for `15` days (refund window).
3. Creates Razorpay Route transfers for one or many sellers in a payment.
4. Keeps marketplace commission in the main account automatically.
5. Creates seller linked accounts when missing.

## Prerequisites

- Razorpay account with Route enabled.
- API keys with access to Payments and Route APIs.
- Node.js 18+.

## Setup

```bash
npm install
cp .env.example .env
```

Update `.env`:

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `VTEX_ENABLED=true` (if you want dynamic splits from VTEX order)
- `VTEX_BASE_URL`, `VTEX_APP_KEY`, `VTEX_APP_TOKEN` (all three must be for the **same** VTEX account: the hostname in `VTEX_BASE_URL` should match the account segment in your app key, e.g. `...alraisholdingb2bcoffeesooq...` with `https://alraisholdingb2bcoffeesooq.vtexcommercestable.com.br`)

### VTEX 404 on order fetch

- **Wrong account**: B2C base URL (`b2ccoffeesooq`) with B2B app key (`b2bcoffeesooq`) will not find orders from the other account.
- **Order id shape**: If `notes.vtexOrderId` is only the order group (numeric), the code retries automatically with `-01` (e.g. `1619500500632-01`) per [VTEX Orders API](https://developers.vtex.com/docs/api-reference/orders-api#get-/api/oms/pvt/orders/-orderId-?endpoint=get-/api/oms/pvt/orders/-orderId-).
- `HOLD_DAYS=15`
- `PAYMENT_WINDOW_FROM_DAYS_AGO=45`
- `PAYMENT_WINDOW_TO_DAYS_AGO=15`
- `SCHEDULER_CRON` (default every 10 minutes)
- `MAX_PAYMENTS_PER_PAGE` (Razorpay max is 100)
- `MAX_PAGES_PER_RUN` (total pages fetched in one cycle)
- `LOG_RAZORPAY_PAYLOADS=true` to print full request/response payloads

Update `data/vendors.json`:

- define sellers under `vendors`
- add `vtexSellerId` for each vendor to map VTEX item seller -> Razorpay linked account
- define `orderSplits` as `orderId -> splits[]`
- each split supports either:
  - `sharePercent` (recommended), or
  - fixed `amount` (in paise)
- the sum of split amounts must be <= payment amount
- leftover amount automatically stays in CoffeeSooq main account as commission
- either provide existing `accountId` or leave empty and provide linked account creation fields (`email`, `phone`, `legalBusinessName`, `businessType`, `referenceId`, `profile`)

When VTEX is enabled and payment contains `notes.vtexOrderId`, the app fetches VTEX order details and derives seller splits from order items. Static `orderSplits` acts as fallback.

## Run

Run once:

```bash
npm run start:once
```

Start seller onboarding portal:

```bash
npm run portal:start
```

Portal stores seller KYC data in VTEX Master Data and scheduler syncs it before linked account creation.

Fetch-only test:

```bash
npm run test:fetch-payments
```

For full/latest logs without lookback window filtering:

```bash
FETCH_USE_TIME_WINDOW=false npm run test:fetch-payments
```

Run scheduler continuously:

```bash
npm start
```

## Files

- `src/index.js`: scheduler + orchestration
- `src/paymentProcessor.js`: payment maturity and split logic
- `src/linkedAccountService.js`: linked account create/fetch helpers
- `src/razorpayClient.js`: Razorpay API wrapper
- `data/vendors.json`: sellers + per-order split mapping
- `data/state.json`: idempotency state (`transferredPayments`)

## Notes for production

- Replace file-based state with DB/Redis for multi-instance deployments.
- Prefer webhooks (`payment.captured`) + queue for high volume.
- Add retry/backoff + dead-letter handling for transfer failures.
- Keep order-to-vendor mapping in your order service instead of static JSON.
- In production, consider setting `LOG_RAZORPAY_PAYLOADS=false` to reduce sensitive payload logging.
