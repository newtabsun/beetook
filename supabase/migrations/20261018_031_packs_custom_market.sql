-- 031: 16 coin packs per provider + purchase limits (single config source), custom amounts,
-- Google Play custom = combination of configured consumable SKUs, marketplace Purchased-only spend
-- and 5% platform fee on marketplace refunds (credited to Purchased).
BEGIN;

DELETE FROM app_9e1318caf6_wallet_config WHERE key IN ('coin_packs', 'purchase_limits', 'market');
INSERT INTO app_9e1318caf6_wallet_config(key, value) VALUES
('coin_packs', $j${
  "google_play": [
    {"productId":"coins_10","priceEtb":10,"recommended":true},{"productId":"coins_20","priceEtb":20},
    {"productId":"coins_30","priceEtb":30},{"productId":"coins_50","priceEtb":50},
    {"productId":"coins_100","priceEtb":100},{"productId":"coins_150","priceEtb":150},
    {"productId":"coins_200","priceEtb":200},{"productId":"coins_300","priceEtb":300},
    {"productId":"coins_500","priceEtb":500,"recommended":true},{"productId":"coins_750","priceEtb":750},
    {"productId":"coins_1000","priceEtb":1000},{"productId":"coins_1500","priceEtb":1500},
    {"productId":"coins_2000","priceEtb":2000,"recommended":true},{"productId":"coins_3000","priceEtb":3000},
    {"productId":"coins_5000","priceEtb":5000},{"productId":"coins_10000","priceEtb":10000}],
  "chapa": [
    {"productId":"chapa_50","priceEtb":50,"recommended":true},{"productId":"chapa_100","priceEtb":100},
    {"productId":"chapa_150","priceEtb":150},{"productId":"chapa_200","priceEtb":200},
    {"productId":"chapa_300","priceEtb":300},{"productId":"chapa_500","priceEtb":500,"recommended":true},
    {"productId":"chapa_750","priceEtb":750},{"productId":"chapa_1000","priceEtb":1000},
    {"productId":"chapa_1500","priceEtb":1500},{"productId":"chapa_2000","priceEtb":2000,"recommended":true},
    {"productId":"chapa_3000","priceEtb":3000},{"productId":"chapa_5000","priceEtb":5000},
    {"productId":"chapa_7500","priceEtb":7500},{"productId":"chapa_10000","priceEtb":10000},
    {"productId":"chapa_15000","priceEtb":15000},{"productId":"chapa_20000","priceEtb":20000}],
  "usdt_bep20": [
    {"productId":"usdt_1","priceUsdt":1,"recommended":true},{"productId":"usdt_2","priceUsdt":2},
    {"productId":"usdt_3","priceUsdt":3},{"productId":"usdt_5","priceUsdt":5},
    {"productId":"usdt_10","priceUsdt":10,"recommended":true},{"productId":"usdt_15","priceUsdt":15},
    {"productId":"usdt_20","priceUsdt":20},{"productId":"usdt_25","priceUsdt":25},
    {"productId":"usdt_30","priceUsdt":30},{"productId":"usdt_50","priceUsdt":50,"recommended":true},
    {"productId":"usdt_75","priceUsdt":75},{"productId":"usdt_100","priceUsdt":100},
    {"productId":"usdt_150","priceUsdt":150},{"productId":"usdt_200","priceUsdt":200},
    {"productId":"usdt_300","priceUsdt":300},{"productId":"usdt_500","priceUsdt":500}]
}$j$::jsonb),
('purchase_limits', $j${
  "google_play": {"currency":"ETB","min":10,"max":20000,"step":10,"max_parts":5},
  "chapa":       {"currency":"ETB","min":50,"max":100000,"step":1},
  "usdt_bep20":  {"currency":"USDT","min":1,"max":5000,"step":0.01}
}$j$::jsonb),
('market', '{"return_fee_pct":5}'::jsonb);

-- ---------- purchases: packs + custom amounts (coins always derived from the shared rates) ----------
DROP FUNCTION IF EXISTS app_9e1318caf6_purchase_create(text, text, text);
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
    IF p_provider = 'google_play' THEN RAISE EXCEPTION 'Google Play custom amounts are bought as a set of packs'; END IF;
    amt := p_amount; pid := 'custom';
  ELSE
    SELECT value INTO pack FROM jsonb_array_elements(coalesce(s->'coin_packs'->p_provider, '[]'::jsonb))
      WHERE value->>'productId' = p_product_id LIMIT 1;
    IF pack IS NULL THEN RAISE EXCEPTION 'Unknown product'; END IF;
    amt := CASE WHEN p_provider = 'usdt_bep20' THEN (pack->>'priceUsdt')::numeric ELSE (pack->>'priceEtb')::numeric END;
    pid := p_product_id;
  END IF;
  IF amt IS NULL OR amt <= 0 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  IF p_provider = 'usdt_bep20' THEN
    amt := round(amt, 2); cur := 'USD'; n_coins := round(amt * (s->'rates'->>'coins_per_usdt')::numeric);
  ELSE
    IF amt <> trunc(amt) THEN RAISE EXCEPTION 'Enter a whole ETB amount'; END IF;
    cur := 'ETB'; n_coins := round(amt * (s->'rates'->>'coins_per_etb')::numeric);
  END IF;
  -- Chapa packs and every custom amount must respect the configured min/max.
  IF pid = 'custom' OR p_provider = 'chapa' THEN
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

-- Google Play only sells configured SKUs: a custom ETB amount is split (largest first) into configured packs.
CREATE OR REPLACE FUNCTION app_9e1318caf6_purchase_gp_plan(p_etb numeric)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s jsonb := app_9e1318caf6_wallet_settings(); lim jsonb := s->'purchase_limits'->'google_play';
        rest numeric := p_etb; parts jsonb := '[]'::jsonb; p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_etb IS NULL OR p_etb <= 0 OR p_etb <> trunc(p_etb) THEN RAISE EXCEPTION 'Enter a whole ETB amount'; END IF;
  IF p_etb < (lim->>'min')::numeric THEN RAISE EXCEPTION 'Minimum is % ETB', lim->>'min'; END IF;
  IF p_etb > (lim->>'max')::numeric THEN RAISE EXCEPTION 'Maximum is % ETB', lim->>'max'; END IF;
  FOR p IN SELECT value->>'productId' AS id, (value->>'priceEtb')::numeric AS price
           FROM jsonb_array_elements(s->'coin_packs'->'google_play') ORDER BY 2 DESC LOOP
    WHILE rest >= p.price LOOP parts := parts || to_jsonb(p.id); rest := rest - p.price; END LOOP;
  END LOOP;
  IF rest <> 0 THEN RAISE EXCEPTION 'Use a multiple of % ETB', lim->>'step'; END IF;
  IF jsonb_array_length(parts) > (lim->>'max_parts')::int THEN
    RAISE EXCEPTION 'Too many Google Play payments for this amount — pick a rounder amount';
  END IF;
  RETURN json_build_object('parts', parts, 'amount', p_etb, 'coins', round(p_etb * (s->'rates'->>'coins_per_etb')::numeric));
END $f$;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_purchase_gp_plan(numeric) TO authenticated;

-- ---------- marketplace ----------
-- Purchased-only debit (no Earnings fallback). Internal helper, not callable by clients.
CREATE OR REPLACE FUNCTION app_9e1318caf6_spend_purchased(p_user uuid, p_amount bigint, p_cat text, p_title text, p_sub text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE w app_9e1318caf6_wallets;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (p_user) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = p_user FOR UPDATE;
  IF w.purchased_balance < p_amount THEN
    RAISE EXCEPTION 'Not enough Purchased coins — marketplace uses Purchased balance only';
  END IF;
  UPDATE app_9e1318caf6_wallets SET purchased_balance = purchased_balance - p_amount, updated_at = now() WHERE user_id = p_user;
  INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
    VALUES (p_user, 'out', p_cat, p_title, coalesce(p_sub, ''), p_amount, 'completed', -p_amount, 0);
  RETURN json_build_object('purchased', w.purchased_balance - p_amount, 'earnings', w.earnings_balance, 'spent', p_amount);
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_spend_purchased(uuid, bigint, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_transfer(p_dir text, p_amount bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE b bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  INSERT INTO app_9e1318caf6_market_balances(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT balance INTO b FROM app_9e1318caf6_market_balances WHERE user_id = auth.uid() FOR UPDATE;
  IF p_dir = 'in' THEN
    PERFORM app_9e1318caf6_spend_purchased(auth.uid(), p_amount, 'market', 'To market balance', 'Purchased → Market');
    UPDATE app_9e1318caf6_market_balances SET balance = balance + p_amount, updated_at = now() WHERE user_id = auth.uid();
  ELSIF p_dir = 'out' THEN
    -- Unspent market balance (never paid to anyone) goes back to Purchased unchanged.
    IF b - app_9e1318caf6_mkt_locked(auth.uid()) < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
    UPDATE app_9e1318caf6_market_balances SET balance = balance - p_amount, updated_at = now() WHERE user_id = auth.uid();
    PERFORM app_9e1318caf6_credit(auth.uid(), p_amount, 'market', 'From market balance', 'Market → Purchased', 'purchased');
  ELSE RAISE EXCEPTION 'invalid direction'; END IF;
  RETURN app_9e1318caf6_mkt_balance();
END $f$;

ALTER TABLE app_9e1318caf6_market_orders ADD COLUMN IF NOT EXISTS refund_fee bigint;
ALTER TABLE app_9e1318caf6_market_orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- Refund of a paid (escrowed, shipped/disputed) order: price leaves the buyer's market escrow,
-- price − 5% is credited to Purchased, the fee is recorded in the ledger. Runs once per order.
CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_refund(p_order uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record; pct numeric; fee bigint; net bigint;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_market_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.refunded_at IS NOT NULL THEN RETURN; END IF;
  IF o.status NOT IN ('disputed', 'admin_review') THEN RAISE EXCEPTION 'This order cannot be refunded now'; END IF;
  pct := coalesce((app_9e1318caf6_wallet_settings()->'market'->>'return_fee_pct')::numeric, 5);
  fee := floor(o.price * pct / 100); net := o.price - fee;
  UPDATE app_9e1318caf6_market_balances SET balance = balance - o.price, updated_at = now() WHERE user_id = o.buyer_id;
  IF net > 0 THEN
    PERFORM app_9e1318caf6_credit(o.buyer_id, net, 'market', 'Marketplace refund', left(o.item_title, 60), 'purchased');
  END IF;
  IF fee > 0 THEN
    INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
      VALUES (o.buyer_id, 'out', 'market', 'Marketplace return fee', format('%s%% of %s coins', pct, o.price), fee, 'completed', 0, 0);
  END IF;
  UPDATE app_9e1318caf6_market_orders SET refund_fee = fee, refunded_at = now() WHERE id = p_order;
  PERFORM app_9e1318caf6_mkt_step(p_order, 'cancelled', format('%s · %s coins back to Purchased (%s%% fee)', p_note, net, pct));
  UPDATE app_9e1318caf6_market_items SET status = 'active' WHERE id = o.item_id;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_mkt_refund(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_release(p_order uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_market_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status = 'completed' THEN RETURN; END IF;
  IF o.status NOT IN ('shipped', 'disputed', 'admin_review') THEN RAISE EXCEPTION 'This order cannot be released now'; END IF;
  PERFORM app_9e1318caf6_mkt_step(p_order, 'completed', p_note);
  UPDATE app_9e1318caf6_market_balances SET balance = balance - o.price, updated_at = now() WHERE user_id = o.buyer_id;
  PERFORM app_9e1318caf6_credit(o.seller_id, o.price, 'market', 'Marketplace sale', p_note, 'earnings');
  UPDATE app_9e1318caf6_market_items SET status = 'sold' WHERE id = o.item_id;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_mkt_release(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
