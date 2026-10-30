-- 029 (part A): split the single wallet balance into Purchased and Earnings balances.
-- Purchased = coins bought with money (gifts, VIP, joining fees, game support, boosts...).
-- Earnings  = coins received from other users / the platform; the only balance that can be redeemed.
-- `coins` stays as a generated total so rank lists and older readers keep working.
-- Existing coins are mapped without losing or duplicating any coin:
--   earnings_balance = LEAST(coins, total of earning inflows found in the ledger)
--   purchased_balance = coins - earnings_balance
BEGIN;

-- ---------- configuration: one source of truth for packs, rates and redeem limits ----------
CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_wallet_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_9e1318caf6_wallet_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_config_read ON public.app_9e1318caf6_wallet_config;
CREATE POLICY wallet_config_read ON public.app_9e1318caf6_wallet_config FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.app_9e1318caf6_wallet_config FROM anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_wallet_config TO authenticated;

INSERT INTO public.app_9e1318caf6_wallet_config(key, value) VALUES
  ('rates', '{"coins_per_etb": 10, "coins_per_usdt": 1600, "usdt_network": "BEP20"}'::jsonb),
  ('redeem', '{"min_coins": 25000, "fee_pct": 10, "daily_max_coins": 50000, "timezone": "Africa/Addis_Ababa",
               "methods": ["telebirr", "cbe", "boa", "usdt_bep20"]}'::jsonb),
  ('coin_packs', '{"google_play": [
      {"productId": "coins_100", "coins": 1000, "priceEtb": 100, "priceUsd": 0.99},
      {"productId": "coins_250", "coins": 2500, "priceEtb": 250, "priceUsd": 2.49},
      {"productId": "coins_500", "coins": 5000, "priceEtb": 500, "priceUsd": 4.99},
      {"productId": "coins_1000", "coins": 10000, "priceEtb": 1000, "priceUsd": 9.99},
      {"productId": "coins_2500", "coins": 25000, "priceEtb": 2500, "priceUsd": 24.99},
      {"productId": "coins_5000", "coins": 50000, "priceEtb": 5000, "priceUsd": 49.99}],
    "chapa": [
      {"productId": "chapa_100", "coins": 1000, "priceEtb": 100},
      {"productId": "chapa_250", "coins": 2500, "priceEtb": 250},
      {"productId": "chapa_500", "coins": 5000, "priceEtb": 500},
      {"productId": "chapa_1000", "coins": 10000, "priceEtb": 1000},
      {"productId": "chapa_2500", "coins": 25000, "priceEtb": 2500},
      {"productId": "chapa_5000", "coins": 50000, "priceEtb": 5000}],
    "usdt_bep20": [
      {"productId": "usdt_1", "coins": 1600, "priceUsdt": 1},
      {"productId": "usdt_5", "coins": 8000, "priceUsdt": 5},
      {"productId": "usdt_10", "coins": 16000, "priceUsdt": 10},
      {"productId": "usdt_25", "coins": 40000, "priceUsdt": 25},
      {"productId": "usdt_50", "coins": 80000, "priceUsdt": 50}]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------- wallets: two balances + generated total ----------
ALTER TABLE public.app_9e1318caf6_wallets ADD COLUMN IF NOT EXISTS purchased_balance bigint NOT NULL DEFAULT 0;
ALTER TABLE public.app_9e1318caf6_wallets ADD COLUMN IF NOT EXISTS earnings_balance bigint NOT NULL DEFAULT 0;

DO $$
DECLARE
  has_coins boolean;
BEGIN
  -- Only a plain (non-generated) `coins` column means the split has not run yet → safe to re-run.
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'app_9e1318caf6_wallets'
                    AND column_name = 'coins' AND is_generated = 'NEVER')
    INTO has_coins;
  IF has_coins THEN
    -- Untouched copy of every wallet before the split (audit / rollback).
    CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_wallets_backup_029 AS
      SELECT user_id, coins, vip_expires_at, vip_auto_renew, updated_at, now() AS backed_up_at
        FROM public.app_9e1318caf6_wallets;
    ALTER TABLE public.app_9e1318caf6_wallets_backup_029 ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.app_9e1318caf6_wallets_backup_029 FROM anon, authenticated;
    -- Map existing balances once. Earning inflows are recognised by category + ledger title.
    UPDATE public.app_9e1318caf6_wallets w
       SET earnings_balance = LEAST(w.coins, e.earn),
           purchased_balance = w.coins - LEAST(w.coins, e.earn)
      FROM (
        SELECT w2.user_id,
               COALESCE(sum(t.amount), 0) AS earn
          FROM public.app_9e1318caf6_wallets w2
          LEFT JOIN public.app_9e1318caf6_wallet_txns t
                 ON t.user_id = w2.user_id AND t.kind = 'in' AND (
                       t.category = 'gift_received'
                    OR (t.category IN ('live_join','game','game_action','group','market')
                        AND t.title IN ('Joining income','Game won','Supporter reward','Group message earning',
                                        'Group joining fee','Marketplace sale')))
         GROUP BY w2.user_id
      ) e
     WHERE e.user_id = w.user_id;
    ALTER TABLE public.app_9e1318caf6_wallets DROP COLUMN coins;
  END IF;
END $$;

ALTER TABLE public.app_9e1318caf6_wallets
  ADD COLUMN IF NOT EXISTS coins bigint GENERATED ALWAYS AS (purchased_balance + earnings_balance) STORED;

ALTER TABLE public.app_9e1318caf6_wallets ALTER COLUMN purchased_balance SET DEFAULT 5000;
ALTER TABLE public.app_9e1318caf6_wallets DROP CONSTRAINT IF EXISTS app_9e1318caf6_wallets_balances_nonneg;
ALTER TABLE public.app_9e1318caf6_wallets ADD CONSTRAINT app_9e1318caf6_wallets_balances_nonneg
  CHECK (purchased_balance >= 0 AND earnings_balance >= 0);

-- ---------- ledger: record how much came out of / went into each balance ----------
ALTER TABLE public.app_9e1318caf6_wallet_txns ADD COLUMN IF NOT EXISTS purchased_delta bigint NOT NULL DEFAULT 0;
ALTER TABLE public.app_9e1318caf6_wallet_txns ADD COLUMN IF NOT EXISTS earnings_delta bigint NOT NULL DEFAULT 0;

-- Backfill older rows with the same heuristic used for the balance mapping (display only).
UPDATE public.app_9e1318caf6_wallet_txns t
   SET earnings_delta = CASE WHEN x.earn THEN t.amount ELSE 0 END,
       purchased_delta = CASE WHEN t.kind = 'out' THEN -t.amount WHEN x.earn THEN 0 ELSE t.amount END
  FROM (SELECT id, (kind = 'in' AND (category = 'gift_received'
          OR (category IN ('live_join','game','game_action','group','market')
              AND title IN ('Joining income','Game won','Supporter reward','Group message earning','Group joining fee','Marketplace sale')))) AS earn
          FROM public.app_9e1318caf6_wallet_txns) x
 WHERE x.id = t.id AND t.purchased_delta = 0 AND t.earnings_delta = 0;

GRANT SELECT ON public.app_9e1318caf6_wallet_txns TO authenticated;

-- ---------- redeem requests (coins are held on creation, refunded on reject/fail) ----------
CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_redeem_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('telebirr','cbe','boa','usdt_bep20')),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  coins bigint NOT NULL CHECK (coins > 0),
  fee bigint NOT NULL DEFAULT 0,
  net_coins bigint NOT NULL DEFAULT 0,
  net_amount numeric(18,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ETB',
  rate numeric(18,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','rejected','failed')),
  idempotency_key text NOT NULL,
  note text,
  provider_ref text,
  hold_txn_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_redeem_requests_user_idx
  ON public.app_9e1318caf6_redeem_requests(user_id, created_at DESC);
ALTER TABLE public.app_9e1318caf6_redeem_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS redeem_own_read ON public.app_9e1318caf6_redeem_requests;
CREATE POLICY redeem_own_read ON public.app_9e1318caf6_redeem_requests FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.app_9e1318caf6_redeem_requests FROM anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_redeem_requests TO authenticated;

-- ---------- purchase orders (coins are credited only after a verified payment) ----------
CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google_play','chapa','usdt_bep20')),
  product_id text NOT NULL,
  coins bigint NOT NULL CHECK (coins > 0),
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL CHECK (currency IN ('ETB','USD')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  external_id text,
  idempotency_key text NOT NULL,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS app_9e1318caf6_purchase_orders_external_uidx
  ON public.app_9e1318caf6_purchase_orders(provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_9e1318caf6_purchase_orders_user_idx
  ON public.app_9e1318caf6_purchase_orders(user_id, created_at DESC);
ALTER TABLE public.app_9e1318caf6_purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_own_read ON public.app_9e1318caf6_purchase_orders;
CREATE POLICY purchase_own_read ON public.app_9e1318caf6_purchase_orders FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.app_9e1318caf6_purchase_orders FROM anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_purchase_orders TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
