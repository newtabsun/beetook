# Bee Took Wallet — Integration Guide

The wallet has **two balances**. Every rule is enforced in Supabase: `SECURITY DEFINER` functions, row locks (`FOR UPDATE`) and atomic transactions. The app only previews the rules.

| Balance | Comes from | Used for | Redeem | Convert |
|---|---|---|---|---|
| `purchased_balance` | Verified purchases (Google Play / Chapa / USDT BEP20), stake refunds | Gifts, VIP, joining fees, game GAS/BRAKE, boosts, group fees | ❌ | ❌ never → Earnings |
| `earnings_balance` | Gifts received (70%), joining fees received (70%), game supporter rewards (20%), game winnings, group/market income | Same as Purchased (used after Purchased runs out) | ✅ only from here | ✅ → Purchased (free) |

**Spending priority:** `app_9e1318caf6_spend()` takes coins from Purchased first and the rest from Earnings. If the two together are not enough, it takes nothing. Every ledger row (`wallet_txns`) records `purchased_delta` and `earnings_delta`.

The existing rules are unchanged: gifts are charged once with a 70/30 split, joining fees once per room, GAS costs 10 and BRAKE 30 (deduplicated by action ID), and history is deduplicated by transaction ID.

## Migrations
- `supabase/migrations/20261018_029_wallet_split_balances.sql`: adds the balances, config, `redeem_requests` and `purchase_orders`, migrates existing coins, and keeps a backup in `app_9e1318caf6_wallets_backup_029`.
- `supabase/migrations/20261018_030_wallet_earnings_purchased.sql`: adds `spend`/`credit`, convert, redeem, purchase settle/fail, and rewrites every function that moves coins.
- Tests: `supabase/tests/wallet_rules.sql` (all changes roll back; read the `WALLET_TEST_REPORT` message).

## Configuration (one source)
Table `app_9e1318caf6_wallet_config`, read by the app via RPC `wallet_settings`:
- `rates`: `coins_per_etb` (10), `coins_per_usdt` (1600). Buying and redeeming use the same rate.
- `redeem`: `min_coins` 25000, `fee_pct` 10, `daily_max_coins` 50000, `timezone` Africa/Addis_Ababa.
- `coin_packs`: 16 packs per provider, sorted from lowest price to highest (`productId`, `priceEtb` or `priceUsdt`, optional `recommended: true`). Coins are always `price × rate`. The cheapest pack is marked Recommended. The app shows them in a 4×4 grid.
- `purchase_limits`: per provider `{currency, min, max, step}`. Chapa `min` = 50 ETB: Chapa packs below it are hidden in the app and rejected by the server. Google Play also has `max_parts` (default 5).
- `market`: `{return_fee_pct: 5}`.

## Custom amount (all three providers)
- **Chapa / USDT BEP20:** `purchase_create(provider, 'custom', key, p_amount)`. The server checks min/max (Chapa: whole ETB only; USDT: 2 decimals) and calculates coins from `rates`. Idempotency works the same as for packs.
- **Google Play (migration 046):** Google Play sells only the 16 fixed consumable packs priced in **USD** (`$0.99` … `$399.99`, `$1 = 1,600 coins`, rate `coins_per_usd`). There is **no custom amount** on Google Play and `purchase_gp_plan` was removed. The SKUs are `coins_099, coins_199, coins_299, coins_499, coins_999, coins_1499, coins_1999, coins_2499, coins_4999, coins_7499, coins_9999, coins_14999, coins_19999, coins_24999, coins_29999, coins_39999` (number = price in cents). Coins are calculated on the server (`price × coins_per_usd`).
- **Refunds:** if Google voids a purchase (refund/chargeback), `purchase_void` takes the coins back once (Purchased first, then Earnings) and marks the order `refunded`; any part already spent is stored as `shortfall` in `purchase_orders.raw`.

## Marketplace ↔ wallet
- Moving coins into the market balance (`mkt_transfer('in')`) uses `spend_purchased`: **Purchased only**. There is no Earnings fallback. If Purchased is too low, the error is "Not enough Purchased coins — marketplace uses Purchased balance only".
- Order requests hold the price in escrow inside `market_balances`.
- Release: the seller receives the price in Earnings.
- Refund or return (dispute agreement or admin decision): `mkt_refund` puts **price − 5%** into the buyer's Purchased balance. The fee is recorded as a ledger row "Marketplace return fee", and `market_orders.refund_fee`/`refunded_at` are set. A second refund call does nothing.
- Requests cancelled before payment (requested → cancelled) never charged anyone, so they have no fee. Unspent market balance moved back with `mkt_transfer('out')` returns to Purchased in full.
- `mkt_refund`, `mkt_release` and `spend_purchased` cannot be called directly by clients.
- Migration: `supabase/migrations/20261018_031_packs_custom_market.sql`. Tests: `supabase/tests/market_wallet.sql` (`MARKET_TEST_REPORT`).

Example: `UPDATE app_9e1318caf6_wallet_config SET value = jsonb_set(value,'{coins_per_usdt}','1700') WHERE key='rates';`

## Purchase flow
1. The app calls `purchase_create(provider, productId, idempotencyKey)`, which creates a `pending` order.
2. The provider flow runs: Google Play Billing (Android, `expo-iap`), Chapa checkout (web), or a USDT BEP20 transfer (web).
3. The edge function verifies the payment, then calls `purchase_settle(order, external_id)` (service role only). Coins go to **Purchased** exactly once. The same `external_id` (purchase token, Chapa reference or tx hash) cannot be used on another order.

Platforms: the **Android app shows Google Play only**. **Web shows Google Play** (marked "Android app"), **Chapa** (telebirr, CBE Birr, M-Pesa, cards…) and **USDT BEP20**.

## Redeem flow
`redeem_create(method, coins, fields, idempotencyKey)` checks every rule:
- Minimum, daily cap, Earnings-only.
- Field rules: telebirr = name + phone; CBE/BOA = full name + account number; USDT = `0x` + 40 hex.
- Fee: 10%.

The coins are held (removed from Earnings) and the request is saved as `pending`. Status moves through `processing` → `paid`; `rejected` or `failed` returns the coins to Earnings atomically. Repeating the same idempotency key returns the original request.

## Chapa (web) — complete flow
1. `purchase_create('chapa', pack|'custom', key, amount)` makes a `pending` ETB order (min 50 ETB, whole birr). The order id is the Chapa `tx_ref`.
2. `chapa_init` calls `transaction/initialize` once, saves `checkout_url` in the order (re-opened instead of re-initialised) and redirects the web tab to Chapa's hosted checkout. Chapa shows every method enabled on the merchant account (telebirr, CBE Birr, M-Pesa, Awash Birr, Amole, Coopay-eBirr, bank transfer, cards, PayPal).
3. Chapa returns the user to `/?wallet=chapa`; the Wallet then runs `chapa_sync` and credits automatically. The Chapa `callback_url` (GET) and the signed webhook (POST) hit `chapa-webhook` and also trigger a check.
4. Credit happens only in `chapaVerifyOrder`: `transaction/verify` must say `success`, with matching `tx_ref`, ETB currency, amount ≥ order amount and mode (test/live) equal to `PAYMENTS_CHAPA_MODE`. `purchase_settle` is idempotent, so webhook + callback + button can never double-credit.
5. Failure handling: Chapa outage → stays `pending` and retries; `failed/cancelled` → closed after the 60 min retry window; unpaid after 24 h → `failed`; user **Cancel** button (`chapa_cancel`) re-checks, expires the Chapa link and closes the order; `charge.refunded` / `charge.reversed` webhooks (confirmed with verify) call `purchase_void` and take the coins back. Admin/cron `chapa_reconcile` re-checks all pending orders. Every event is logged in `purchase_events` (migration 047).
6. Webhook signature: `x-chapa-signature` / `chapa-signature` HMAC-SHA256, checked with `CHAPA_WEBHOOK_SECRET` (and the secret key). Chapa dashboard → Settings → Webhooks: URL `https://klxynisbmxqmyszkdrxj.supabase.co/functions/v1/verify-purchase?fn=chapa-webhook`. This single function already serves that route (deployed, JWT off), so no extra deployment is needed.

**Android:** Chapa is never offered in the Android app (`providersForPlatform` returns Google Play only) and the server refuses `chapa_init` when the request carries `x-client-platform: android`, so Google Play billing rules are not bypassed.

## Troubleshooting Chapa

**"419 Page Expired" on the Chapa page.** The hosted checkout needs its own first-party cookies, and every checkout session is single-use.
- Cause 1: the checkout was opened inside an iframe (app preview / embedded webview). The wallet now opens it as a top-level page — a new tab when framed, otherwise the same tab — so cookies work.
- Cause 2: a stale link. A saved `checkout_url` is reused for at most 20 minutes; after that the order is closed and the app creates a fresh order automatically (Chapa allows only one `transaction/initialize` per `tx_ref`).
- After both cases the Wallet verifies on return (and on window focus) via `chapa_sync`, so a paid order is still credited.

**Only "Card" and "Test Bank" appear on Chapa.** The checkout shows the payment channels **enabled on the merchant account**, not every channel Chapa supports. In Test mode Chapa typically exposes card + test bank until telebirr / CBE Birr / M-Pesa / Awash / Amole channels are activated for the account (Chapa dashboard → Settings → payment channels, subject to their KYC). No code change makes a channel appear that the account cannot accept; the wallet already passes no channel filter, so every enabled method is offered. Test values: cards `4200 0000 0000 0000` (CVV `123`, expiry `12/34`) and mobile numbers `0900123456` / `0900112233` / `0900881111` (OTP `12345`).

## Edge functions
Code: `supabase/functions/_shared/wallet_payments.ts`, with entry points `verify-purchase`, `chapa-webhook`, `usdt-verify` and `payout`.

Deploy with the Supabase CLI:
```bash
cd app/mobile
supabase functions deploy verify-purchase chapa-webhook usdt-verify payout --project-ref klxynisbmxqmyszkdrxj
```
`chapa-webhook` and the payout `callback` action must be deployed with `--no-verify-jwt`; they check HMAC signatures instead.

If the functions are not deployed, the app shows "The payment service is not deployed yet". No coins are ever added without verification.

### Webhook URLs
- Chapa callback: `https://klxynisbmxqmyszkdrxj.supabase.co/functions/v1/verify-purchase?fn=chapa-webhook` (the deployed function answers both the GET callback and the signed POST webhook; no separate function needed). Override with `CHAPA_CALLBACK_URL`.
- Payout gateway callback: `https://klxynisbmxqmyszkdrxj.supabase.co/functions/v1/payout`, body `{ "action": "callback", "payload": { "request_id", "status": "paid|failed|rejected", "reference", "reason" } }`, header `x-payout-signature: hex(HMAC-SHA256(PAYOUT_WEBHOOK_SECRET, JSON(payload)))`.

## Secrets and flags (Supabase → Edge Functions → Secrets)
| Provider | Flag (off / sandbox / live) | Required keys |
|---|---|---|
| Google Play | `PAYMENTS_GOOGLE_PLAY_MODE` | `GOOGLE_PLAY_SERVICE_ACCOUNT` (service-account JSON with Android Publisher access), optional `GOOGLE_PLAY_PACKAGE_NAME` (default `com.beetook.app`) |
| Chapa | `PAYMENTS_CHAPA_MODE` (optional: derived from the key) | `CHAPA_SECRET_KEY` — paste the dashboard's **Test Secret key** (`CHASECK_TEST-…`) or Live Secret key. Optional: `CHAPA_WEBHOOK_SECRET` (webhook secret hash), `CHAPA_CALLBACK_URL`, `PAYMENTS_CRON_SECRET` |
| USDT BEP20 (NOWPayments) | `PAYMENTS_USDT_MODE` (optional: `live` is derived from the key; `sandbox` uses api-sandbox.nowpayments.io) | `NOWPAYMENTS_API_KEY`; optional `NOWPAYMENTS_IPN_SECRET` (IPN secret from the NOWPayments dashboard, HMAC-SHA512 check), `NOWPAYMENTS_PAY_CURRENCY` (default `usdtbsc`), `NOWPAYMENTS_IPN_URL` |
| Payouts | `PAYOUT_MODE` = off / manual / live | live: `TELEBIRR_PAYOUT_URL/KEY`, `CBE_PAYOUT_URL/KEY`, `BOA_PAYOUT_URL/KEY`, `USDT_PAYOUT_URL/KEY`; `PAYOUT_WEBHOOK_SECRET` |

**USDT flow (NOWPayments):** `usdt_prepare` creates a NOWPayments payment for the order (own deposit address + exact amount, saved in the order); the customer sends USDT (BEP20) and taps "Check payment"; coins are credited only when NOWPayments reports `finished` (checked via the API, IPN `?fn=usdt-webhook`, wallet open/focus sync, or the `chapa_reconcile` cron). Set the IPN URL in NOWPayments to `https://klxynisbmxqmyszkdrxj.supabase.co/functions/v1/verify-purchase?fn=usdt-webhook`. Chapa custom amounts have a minimum of 50 ETB and no maximum.

**Chapa keys:** only the Secret key is used server-side. The dashboard's **Public key** and **Encryption key** are for inline JS and direct-charge OTP encryption, which this wallet does not use — do not add them. The function also accepts the key under `CHAPA_TEST_SECRET_KEY`, `CHAPA_LIVE_SECRET_KEY` or `CHAPA_SECRET`, or any secret whose value starts with `CHASECK`, so an existing label keeps working. Without `PAYMENTS_CHAPA_MODE` the mode is taken from the key (`CHASECK_TEST-…` = sandbox).

All flags default to `off`, which returns `{status:"not_configured", missing:[…]}`.

Payout actions on `payout` require an Atoms-authenticated user with `profiles.is_admin = true`:
- `list`, `status`, `reject`
- `mark_paid` (manual mode only)
- `process` (live mode): posts `{request_id, method, amount, currency, recipient}` with an `Idempotency-Key` header to the method's gateway URL.

## Google Play setup
Full step-by-step guide (Amharic): `docs/google-play-setup.md`.
1. In Play Console, create the 16 one-time in-app products listed above (IDs exactly as in `coin_packs.google_play`), price in USD.
2. Link a service account (Android Publisher API, "View financial data" + "Manage orders"). Put its JSON in `GOOGLE_PLAY_SERVICE_ACCOUNT`.
3. Deploy `verify-purchase`, `google-play-rtdn` (with `--no-verify-jwt`) and set `GOOGLE_PLAY_RTDN_SECRET`; connect Pub/Sub push to `…/functions/v1/google-play-rtdn?key=<secret>` for automatic credit and refund clawback.
4. Rebuild the Android app (versionCode 45). Test with license testers (`PAYMENTS_GOOGLE_PLAY_MODE=sandbox`). Live mode rejects test purchases.

### Safety rules (no loss of money or coins)
- The app creates a `pending` order first; the purchase carries the order id as `obfuscatedProfileId`.
- Coins are credited only by `purchase_settle` after the Google API confirms `purchaseState=0`; the purchase token is unique per order, so it can never be credited twice.
- Consume happens after the credit (client `finishTransaction` and server `:consume`). If the app dies after payment, the Wallet restores owned purchases (`getAvailablePurchases`) on the next open; Google also auto-refunds unacknowledged purchases after 3 days.
- RTDN credits the order even if the app never reports back, and voided purchases are clawed back (`google_play_sync_voided` action is a manual/cron fallback).
