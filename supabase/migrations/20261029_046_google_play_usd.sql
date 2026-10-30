-- 046: Google Play packs in USD ($1 = 1,600 coins), 16 consumable SKUs from $0.99 to $399.99,
-- no custom amounts on Google Play, and refund (voided purchase) clawback.
--   * Prices end in .99 like Google's price templates and never exceed $399.99 (inside Google's in-app limits).
--   * Product IDs are new (coins_099 … coins_39999 = price in cents) so they never clash with older SKUs.
--   * Coins are always price × coins_per_usd, calculated on the server from this single config.
BEGIN;

UPDATE app_9e1318caf6_wallet_config
   SET value = value || '{"coins_per_usd": 1600}'::jsonb, updated_at = now()
 WHERE key = 'rates';

UPDATE app_9e1318caf6_wallet_config
   SET value = jsonb_set(value, '{google_play}', $j$[
     {"productId":"coins_099","priceUsd":0.99},
     {"productId":"coins_199","priceUsd":1.99},
     {"productId":"coins_299","priceUsd":2.99},
     {"productId":"coins_499","priceUsd":4.99,"recommended":true},
     {"productId":"coins_999","priceUsd":9.99},
     {"productId":"coins_1499","priceUsd":14.99},
     {"productId":"coins_1999","priceUsd":19.99,"recommended":true},
     {"productId":"coins_2499","priceUsd":24.99},
     {"productId":"coins_4999","priceUsd":49.99},
     {"productId":"coins_7499","priceUsd":74.99},
     {"productId":"coins_9999","priceUsd":99.99,"recommended":true},
     {"productId":"coins_14999","priceUsd":149.99},
     {"productId":"coins_19999","priceUsd":199.99},
     {"productId":"coins_24999","priceUsd":249.99},
     {"productId":"coins_29999","priceUsd":299.99},
     {"productId":"coins_39999","priceUsd":399.99}]$j$::jsonb),
       updated_at = now()
 WHERE key = 'coin_packs';

UPDATE app_9e1318caf6_wallet_config
   SET value = jsonb_set(value, '{google_play}', '{"currency":"USD","min":0.99,"max":399.99}'::jsonb), updated_at = now()
 WHERE key = 'purchase_limits';

-- Orders may now end as 'refunded' (Google Play voided the purchase).
ALTER TABLE app_9e1318caf6_purchase_orders DROP CONSTRAINT IF EXISTS app_9e1318caf6_purchase_orders_status_check;
ALTER TABLE app_9e1318caf6_purchase_orders ADD CONSTRAINT app_9e1318caf6_purchase_orders_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'refunded'));

-- Unpaid Google Play orders for the old ETB SKUs can never complete any more.
UPDATE app_9e1318caf6_purchase_orders SET status = 'failed', updated_at = now()
 WHERE provider = 'google_play' AND status = 'pending'
   AND product_id NOT IN ('coins_099','coins_199','coins_299','coins_499','coins_999','coins_1499','coins_1999','coins_2499',
                          'coins_4999','coins_7499','coins_9999','coins_14999','coins_19999','coins_24999','coins_29999','coins_39999');

-- Google Play sells fixed SKUs only: no custom amount, so the split planner is removed.
DROP FUNCTION IF EXISTS app_9e1318caf6_purchase_gp_plan(numeric);

CREATE OR REPLACE FUNCTION app_9e1318caf6_purchase_create(p_provider text, p_product_id text, p_idempotency text DEFAULT NULL, p_amount numeric DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); s jsonb := app_9e1318caf6_wallet_settings(); lim jsonb; pack jsonb;
        o app_9e1318caf6_purchase_orders; n_coins bigint; amt numeric; cur text; idem text; pid text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_provider NOT IN ('google_play', 'chapa', 'usdt_bep20') THEN RAISE EXCEPTION 'Unknown payment provider'; END IF;
  idem := coalesce(nullif(trim(p_idempotency), ''), gen_random_uuid()::text);
  SELECT * INTO o FROM app_9e1318caf6_purchase_orders WHERE user_id = me AND idempotency_key = idem;
  IF FOUND THEN
    RETURN json_build_object('id', o.id, 'status', o.status, 'coins', o.coins, 'amount', o.amount, 'currency', o.currency,
                             'provider', o.provider, 'product_id', o.product_id, 'created_at', o.created_at, 'duplicate', true);
  END IF;
  lim := s->'purchase_limits'->p_provider;
  IF coalesce(p_product_id, '') = 'custom' THEN
    IF p_provider = 'google_play' THEN RAISE EXCEPTION 'Google Play sells fixed coin packs only'; END IF;
    amt := p_amount; pid := 'custom';
  ELSE
    SELECT value INTO pack FROM jsonb_array_elements(coalesce(s->'coin_packs'->p_provider, '[]'::jsonb))
      WHERE value->>'productId' = p_product_id LIMIT 1;
    IF pack IS NULL THEN RAISE EXCEPTION 'Unknown product'; END IF;
    amt := CASE p_provider WHEN 'usdt_bep20' THEN (pack->>'priceUsdt')::numeric
                           WHEN 'google_play' THEN (pack->>'priceUsd')::numeric
                           ELSE (pack->>'priceEtb')::numeric END;
    pid := p_product_id;
  END IF;
  IF amt IS NULL OR amt <= 0 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  IF p_provider IN ('usdt_bep20', 'google_play') THEN
    amt := round(amt, 2); cur := 'USD';
    n_coins := round(amt * (s->'rates'->>(CASE WHEN p_provider = 'google_play' THEN 'coins_per_usd' ELSE 'coins_per_usdt' END))::numeric);
  ELSE
    IF amt <> trunc(amt) THEN RAISE EXCEPTION 'Enter a whole ETB amount'; END IF;
    cur := 'ETB'; n_coins := round(amt * (s->'rates'->>'coins_per_etb')::numeric);
  END IF;
  IF pid = 'custom' OR p_provider IN ('chapa', 'google_play') THEN
    IF amt < (lim->>'min')::numeric THEN RAISE EXCEPTION 'Minimum is % %', lim->>'min', lim->>'currency'; END IF;
    IF amt > (lim->>'max')::numeric THEN RAISE EXCEPTION 'Maximum is % %', lim->>'max', lim->>'currency'; END IF;
  END IF;
  IF n_coins <= 0 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  INSERT INTO app_9e1318caf6_purchase_orders(user_id, provider, product_id, coins, amount, currency, idempotency_key)
    VALUES (me, p_provider, pid, n_coins, amt, cur, idem) RETURNING * INTO o;
  RETURN json_build_object('id', o.id, 'status', 'pending', 'coins', o.coins, 'amount', o.amount, 'currency', o.currency,
                           'provider', o.provider, 'product_id', o.product_id, 'created_at', o.created_at);
END $f$;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_purchase_create(text, text, text, numeric) TO authenticated;

-- Google voided a paid purchase (refund / chargeback): take the coins back, once.
-- Purchased is used first, then Earnings; whatever was already spent is recorded as `shortfall` on the order.
CREATE OR REPLACE FUNCTION app_9e1318caf6_purchase_void(p_order uuid, p_reason text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o app_9e1318caf6_purchase_orders; w app_9e1318caf6_wallets; from_p bigint; from_e bigint; short bigint;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_purchase_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status = 'refunded' THEN RETURN json_build_object('status', 'refunded', 'duplicate', true); END IF;
  IF o.status <> 'paid' THEN RETURN json_build_object('status', o.status, 'skipped', true); END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (o.user_id) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = o.user_id FOR UPDATE;
  from_p := LEAST(w.purchased_balance, o.coins);
  from_e := LEAST(w.earnings_balance, o.coins - from_p);
  short := o.coins - from_p - from_e;
  UPDATE app_9e1318caf6_wallets
     SET purchased_balance = purchased_balance - from_p, earnings_balance = earnings_balance - from_e, updated_at = now()
   WHERE user_id = o.user_id;
  UPDATE app_9e1318caf6_purchase_orders
     SET status = 'refunded', updated_at = now(),
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('void_reason', p_reason, 'void_at', now(),
                                                                'clawed_back', from_p + from_e, 'shortfall', short)
   WHERE id = o.id;
  IF from_p + from_e > 0 THEN
    INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
      VALUES (o.user_id, 'out', 'recharge', 'Purchase refunded', o.provider || ' · ' || o.product_id,
              from_p + from_e, 'completed', -from_p, -from_e);
  END IF;
  RETURN json_build_object('status', 'refunded', 'clawed_back', from_p + from_e, 'shortfall', short);
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_purchase_void(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_purchase_void(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
