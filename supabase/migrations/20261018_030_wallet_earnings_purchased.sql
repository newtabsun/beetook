-- 030 (part B): all coin movements go through two server functions.
--   spend():  takes from Purchased first, then Earnings; all-or-nothing.
--   credit(): adds to Earnings (platform/user income) or to Purchased (verified purchases).
-- Also: get_wallet returns both balances, convert / redeem / purchase RPCs, and every existing
-- coin function is rewritten on top of spend/credit. Gift, boost, joining fee and game costs keep
-- their previous prices and single-charge behaviour.
BEGIN;

-- ---------- core: spend ----------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_spend(
  p_user uuid, p_amount bigint, p_cat text, p_title text, p_sub text DEFAULT '', p_status text DEFAULT 'completed')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w app_9e1318caf6_wallets; from_p bigint; from_e bigint;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (p_user) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = p_user FOR UPDATE;
  IF w.purchased_balance + w.earnings_balance < p_amount THEN
    RAISE EXCEPTION 'Not enough coins — please recharge';
  END IF;
  from_p := LEAST(w.purchased_balance, p_amount);
  from_e := p_amount - from_p;
  UPDATE app_9e1318caf6_wallets
     SET purchased_balance = purchased_balance - from_p,
         earnings_balance  = earnings_balance - from_e,
         updated_at = now()
   WHERE user_id = p_user;
  INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
    VALUES (p_user, 'out', p_cat, p_title, coalesce(p_sub, ''), p_amount, p_status, -from_p, -from_e);
  RETURN json_build_object(
    'purchased', w.purchased_balance - from_p, 'earnings', w.earnings_balance - from_e,
    'coins', w.purchased_balance + w.earnings_balance - p_amount,
    'from_purchased', from_p, 'from_earnings', from_e, 'spent', p_amount);
END $$;

-- ---------- core: credit (p_balance: 'earnings' | 'purchased') ----------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_credit(
  p_user uuid, p_amount bigint, p_cat text, p_title text, p_sub text DEFAULT '', p_balance text DEFAULT 'earnings')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w app_9e1318caf6_wallets; to_p bigint := 0; to_e bigint := 0;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF p_balance NOT IN ('earnings', 'purchased') THEN RAISE EXCEPTION 'invalid balance'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (p_user) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = p_user FOR UPDATE;
  IF p_balance = 'purchased' THEN to_p := p_amount; ELSE to_e := p_amount; END IF;
  UPDATE app_9e1318caf6_wallets
     SET purchased_balance = purchased_balance + to_p,
         earnings_balance  = earnings_balance + to_e,
         updated_at = now()
   WHERE user_id = p_user;
  IF p_amount > 0 THEN
    INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
      VALUES (p_user, 'in', p_cat, p_title, coalesce(p_sub, ''), p_amount, 'completed', to_p, to_e);
  END IF;
  RETURN json_build_object(
    'purchased', w.purchased_balance + to_p, 'earnings', w.earnings_balance + to_e,
    'coins', w.purchased_balance + w.earnings_balance + p_amount, 'credited', p_amount);
END $$;

-- Legacy helper kept for every existing caller: negative → spend (Purchased first), positive → Earnings.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_ledger(
  p_user uuid, p_delta bigint, p_cat text, p_title text, p_sub text, p_status text DEFAULT 'completed')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r json;
BEGIN
  IF p_delta < 0 THEN
    r := app_9e1318caf6_spend(p_user, -p_delta, p_cat, p_title, p_sub, p_status);
  ELSE
    r := app_9e1318caf6_credit(p_user, p_delta, p_cat, p_title, p_sub, 'earnings');
  END IF;
  RETURN (r->>'coins')::bigint;
END $$;

-- ---------- wallet read ----------
DROP FUNCTION IF EXISTS public.app_9e1318caf6_get_wallet();
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_get_wallet()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w app_9e1318caf6_wallets;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = auth.uid();
  RETURN json_build_object('purchased', w.purchased_balance, 'earnings', w.earnings_balance, 'coins', w.coins);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_wallet_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_object_agg(key, value) FROM app_9e1318caf6_wallet_config;
$$;

-- ---------- history: ledger first, legacy rows only when no ledger row covers them ----------
DROP FUNCTION IF EXISTS public.app_9e1318caf6_wallet_history();
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_wallet_history()
RETURNS TABLE(id text, kind text, category text, title text, sub text, amount bigint, status text,
              created_at timestamptz, purchased_delta bigint, earnings_delta bigint, balance text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH rows AS (
    SELECT 't'||t.id AS id, t.kind, t.category, t.title, t.sub, t.amount, t.status, t.created_at,
           t.purchased_delta, t.earnings_delta
      FROM app_9e1318caf6_wallet_txns t WHERE t.user_id = auth.uid()
    UNION ALL
    SELECT 'gs'||g.id, 'out', 'gift_sent', 'Send gift', g.gift||' x'||g.qty, g.coins, 'completed', g.created_at, -g.coins, 0
      FROM app_9e1318caf6_gifts g
     WHERE g.sender_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = g.sender_id AND t.category = 'gift_sent' AND t.created_at = g.created_at)
    UNION ALL
    SELECT 'gr'||g.id, 'in', 'gift_received', 'Gift received', g.gift||' x'||g.qty, floor(g.coins * 0.7)::bigint,
           'completed', g.created_at, 0, floor(g.coins * 0.7)::bigint
      FROM app_9e1318caf6_gifts g
     WHERE g.recipient_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = g.recipient_id AND t.category = 'gift_received' AND t.created_at = g.created_at)
    UNION ALL
    SELECT 'b'||b.id, 'out', 'boost', 'Boost video', b.hours||'h promotion', b.coins, 'completed', b.created_at, -b.coins, 0
      FROM app_9e1318caf6_boosts b
     WHERE b.user_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = b.user_id AND t.category = 'boost' AND t.created_at = b.created_at)
    UNION ALL
    SELECT 'w'||w.id, CASE WHEN w.payout > 0 THEN 'in' ELSE 'out' END, 'game', 'Car Racing',
           'Lane '||(w.pick+1)||' · winner '||(w.winner+1), abs(w.payout - w.stake), 'completed', w.created_at,
           CASE WHEN w.payout > 0 THEN 0 ELSE -(w.stake) END, CASE WHEN w.payout > 0 THEN w.payout - w.stake ELSE 0 END
      FROM app_9e1318caf6_wagers w
     WHERE w.user_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = w.user_id AND t.category = 'game' AND t.created_at = w.created_at)
  )
  SELECT r.id, r.kind, r.category, r.title, r.sub, r.amount, r.status, r.created_at,
         r.purchased_delta, r.earnings_delta,
         CASE WHEN r.purchased_delta <> 0 AND r.earnings_delta <> 0 THEN 'mixed'
              WHEN r.earnings_delta <> 0 THEN 'earnings'
              ELSE 'purchased' END
    FROM rows r
   ORDER BY r.created_at DESC, r.id DESC LIMIT 300
$$;

-- ---------- convert: Earnings → Purchased only ----------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_wallet_convert(p_coins bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w app_9e1318caf6_wallets;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_coins IS NULL OR p_coins <= 0 THEN RAISE EXCEPTION 'Enter an amount to convert'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF w.earnings_balance < p_coins THEN RAISE EXCEPTION 'Not enough Earnings balance'; END IF;
  UPDATE app_9e1318caf6_wallets
     SET earnings_balance = earnings_balance - p_coins,
         purchased_balance = purchased_balance + p_coins,
         updated_at = now()
   WHERE user_id = auth.uid();
  INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
    VALUES (auth.uid(), 'in', 'convert', 'Convert to Purchased', 'Earnings → Purchased', p_coins, 'completed', p_coins, -p_coins);
  RETURN json_build_object('purchased', w.purchased_balance + p_coins, 'earnings', w.earnings_balance - p_coins,
                           'coins', w.coins, 'converted', p_coins);
END $$;

-- ---------- redeem ----------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_redeem_limits()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_9e1318caf6_wallet_settings()->'redeem' || jsonb_build_object('rates', app_9e1318caf6_wallet_settings()->'rates');
$$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_redeem_create(
  p_method text, p_coins bigint, p_fields jsonb, p_idempotency text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  cfg jsonb; rates jsonb; min_c bigint; fee_pct numeric; day_max bigint; tz text;
  day_start timestamptz; used bigint; w app_9e1318caf6_wallets;
  fee bigint; net_coins bigint; net_amount numeric; cur text; per_coin numeric;
  rid uuid; hold_txn bigint; existing app_9e1318caf6_redeem_requests;
  addr text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF coalesce(trim(p_idempotency), '') = '' THEN RAISE EXCEPTION 'Missing idempotency key'; END IF;

  -- Repeating the same request returns the original one instead of holding coins twice.
  SELECT * INTO existing FROM app_9e1318caf6_redeem_requests WHERE user_id = me AND idempotency_key = p_idempotency;
  IF FOUND THEN
    RETURN json_build_object('id', existing.id, 'coins', existing.coins, 'fee', existing.fee,
      'net_coins', existing.net_coins, 'net_amount', existing.net_amount, 'currency', existing.currency,
      'status', existing.status, 'duplicate', true);
  END IF;

  cfg := app_9e1318caf6_wallet_settings()->'redeem';
  rates := app_9e1318caf6_wallet_settings()->'rates';
  min_c := coalesce((cfg->>'min_coins')::bigint, 25000);
  fee_pct := coalesce((cfg->>'fee_pct')::numeric, 10);
  day_max := coalesce((cfg->>'daily_max_coins')::bigint, 50000);
  tz := coalesce(cfg->>'timezone', 'Africa/Addis_Ababa');

  IF p_method NOT IN ('telebirr', 'cbe', 'boa', 'usdt_bep20') THEN RAISE EXCEPTION 'Choose a payout method'; END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN RAISE EXCEPTION 'Payout details are missing'; END IF;

  IF p_method = 'telebirr' THEN
    IF coalesce(trim(p_fields->>'name'), '') = '' THEN RAISE EXCEPTION 'Enter the account holder name'; END IF;
    IF coalesce(p_fields->>'phone', '') !~ '^\+?[0-9]{9,15}$' THEN RAISE EXCEPTION 'Enter a valid phone number'; END IF;
  ELSIF p_method IN ('cbe', 'boa') THEN
    IF coalesce(trim(p_fields->>'full_name'), '') = '' THEN RAISE EXCEPTION 'Enter your full name'; END IF;
    IF coalesce(p_fields->>'account_number', '') !~ '^[0-9]{8,20}$' THEN RAISE EXCEPTION 'Enter a valid account number'; END IF;
  ELSE
    addr := coalesce(p_fields->>'address', '');
    IF addr !~ '^0x[0-9a-fA-F]{40}$' THEN RAISE EXCEPTION 'Enter a valid BEP20 address (0x + 40 hex characters)'; END IF;
  END IF;

  IF p_coins IS NULL OR p_coins < min_c THEN
    RAISE EXCEPTION 'Minimum redeem is % coins', to_char(min_c, 'FM999,999,999');
  END IF;
  IF p_coins > day_max THEN
    RAISE EXCEPTION 'Daily redeem limit is % coins', to_char(day_max, 'FM999,999,999');
  END IF;

  -- Daily cap counts pending + processing + paid requests in the platform timezone.
  day_start := date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz;
  SELECT coalesce(sum(coins), 0) INTO used FROM app_9e1318caf6_redeem_requests
   WHERE user_id = me AND status IN ('pending', 'processing', 'paid') AND created_at >= day_start;
  IF used + p_coins > day_max THEN
    RAISE EXCEPTION 'Daily redeem limit is % coins (used %)',
      to_char(day_max, 'FM999,999,999'), to_char(used, 'FM999,999,999');
  END IF;

  fee := floor(p_coins * fee_pct / 100.0);
  net_coins := p_coins - fee;
  cur := CASE WHEN p_method = 'usdt_bep20' THEN 'USDT' ELSE 'ETB' END;
  per_coin := CASE WHEN p_method = 'usdt_bep20'
                   THEN 1.0 / greatest(coalesce((rates->>'coins_per_usdt')::numeric, 1600), 1)
                   ELSE 1.0 / greatest(coalesce((rates->>'coins_per_etb')::numeric, 10), 1) END;
  net_amount := round(net_coins * per_coin, 2);

  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me FOR UPDATE;
  IF w.earnings_balance < p_coins THEN
    RAISE EXCEPTION 'Redeem is only available from your Earnings balance';
  END IF;
  UPDATE app_9e1318caf6_wallets
     SET earnings_balance = earnings_balance - p_coins, updated_at = now()
   WHERE user_id = me;

  INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
    VALUES (me, 'out', 'redeem', 'Redeem request',
            trim(both ' ' FROM p_method) || ' · fee ' || fee || ' coins', p_coins, 'pending', 0, -p_coins)
    RETURNING id INTO hold_txn;

  INSERT INTO app_9e1318caf6_redeem_requests(user_id, method, fields, coins, fee, net_coins, net_amount, currency, rate, idempotency_key, hold_txn_id)
    VALUES (me, p_method, p_fields, p_coins, fee, net_coins, net_amount, cur, per_coin, p_idempotency, hold_txn)
    RETURNING id INTO rid;

  RETURN json_build_object('id', rid, 'coins', p_coins, 'fee', fee, 'net_coins', net_coins,
                           'net_amount', net_amount, 'currency', cur, 'status', 'pending',
                           'earnings', w.earnings_balance - p_coins, 'purchased', w.purchased_balance,
                           'coins_total', w.coins - p_coins);
END $$;

-- Service-role only: payout provider (or admin) updates a request. Reject/fail refunds coins atomically.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_redeem_set_status(
  p_id uuid, p_status text, p_note text DEFAULT NULL, p_provider_ref text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r app_9e1318caf6_redeem_requests; w app_9e1318caf6_wallets;
BEGIN
  IF p_status NOT IN ('processing', 'paid', 'rejected', 'failed') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT * INTO r FROM app_9e1318caf6_redeem_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status = p_status THEN RETURN json_build_object('id', r.id, 'status', r.status, 'duplicate', true); END IF;
  IF r.status IN ('paid', 'rejected', 'failed') THEN RAISE EXCEPTION 'This request is already %', r.status; END IF;

  UPDATE app_9e1318caf6_redeem_requests
     SET status = p_status, note = coalesce(p_note, note), provider_ref = coalesce(p_provider_ref, provider_ref),
         updated_at = now()
   WHERE id = p_id RETURNING * INTO r;

  IF p_status IN ('rejected', 'failed') THEN
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (r.user_id) ON CONFLICT DO NOTHING;
    SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = r.user_id FOR UPDATE;
    UPDATE app_9e1318caf6_wallets SET earnings_balance = earnings_balance + r.coins, updated_at = now()
     WHERE user_id = r.user_id;
    INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta)
      VALUES (r.user_id, 'in', 'redeem', 'Redeem refunded', coalesce(p_note, p_status), r.coins, 'completed', 0, r.coins);
    UPDATE app_9e1318caf6_wallet_txns SET status = 'failed' WHERE id = r.hold_txn_id;
  ELSIF p_status = 'paid' THEN
    UPDATE app_9e1318caf6_wallet_txns SET status = 'completed' WHERE id = r.hold_txn_id;
  END IF;
  RETURN json_build_object('id', r.id, 'status', r.status);
END $$;

-- ---------- purchases (coins only after a verified payment) ----------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_purchase_create(
  p_provider text, p_product_id text, p_idempotency text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); cfg jsonb; pack jsonb; o app_9e1318caf6_purchase_orders;
        coins bigint; amount numeric; cur text; rid uuid; idem text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_provider NOT IN ('google_play', 'chapa', 'usdt_bep20') THEN RAISE EXCEPTION 'Unknown payment provider'; END IF;
  cfg := app_9e1318caf6_wallet_settings()->'coin_packs';
  SELECT value INTO pack FROM jsonb_array_elements(coalesce(cfg->p_provider, '[]'::jsonb)) WHERE value->>'productId' = p_product_id LIMIT 1;
  IF pack IS NULL THEN RAISE EXCEPTION 'Unknown product'; END IF;
  coins := (pack->>'coins')::bigint;
  amount := coalesce((pack->>'priceEtb')::numeric, 0);
  cur := 'ETB';
  IF p_provider = 'usdt_bep20' THEN
    amount := coalesce((pack->>'priceUsdt')::numeric, 0); cur := 'USD';
  END IF;
  idem := coalesce(nullif(trim(p_idempotency), ''), gen_random_uuid()::text);
  SELECT * INTO o FROM app_9e1318caf6_purchase_orders WHERE user_id = me AND idempotency_key = idem;
  IF FOUND THEN
    RETURN json_build_object('id', o.id, 'status', o.status, 'coins', o.coins, 'amount', o.amount,
                             'currency', o.currency, 'provider', o.provider, 'duplicate', true);
  END IF;
  INSERT INTO app_9e1318caf6_purchase_orders(user_id, provider, product_id, coins, amount, currency, idempotency_key)
    VALUES (me, p_provider, p_product_id, coins, amount, cur, idem) RETURNING id INTO rid;
  RETURN json_build_object('id', rid, 'status', 'pending', 'coins', coins, 'amount', amount,
                           'currency', cur, 'provider', p_provider);
END $$;

-- Service-role only (called by the edge functions after the store/bank/RPC check succeeds).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_purchase_settle(
  p_order uuid, p_external_id text, p_payload jsonb DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o app_9e1318caf6_purchase_orders; r json;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_purchase_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status = 'paid' THEN
    RETURN json_build_object('status', 'paid', 'coins', o.coins, 'duplicate', true);
  END IF;
  IF coalesce(trim(p_external_id), '') = '' THEN RAISE EXCEPTION 'Missing payment reference'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_purchase_orders
              WHERE provider = o.provider AND external_id = p_external_id AND id <> o.id) THEN
    RAISE EXCEPTION 'This payment was already used';
  END IF;
  UPDATE app_9e1318caf6_purchase_orders
     SET status = 'paid', external_id = p_external_id, paid_at = now(), raw = p_payload, updated_at = now()
   WHERE id = o.id RETURNING * INTO o;
  r := app_9e1318caf6_credit(o.user_id, o.coins, 'recharge', 'Coin purchase',
        o.provider || ' · ' || o.product_id, 'purchased');
  RETURN json_build_object('status', 'paid', 'coins', o.coins, 'credited', true,
                           'purchased', r->>'purchased', 'earnings', r->>'earnings');
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_purchase_fail(p_order uuid, p_reason text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o app_9e1318caf6_purchase_orders;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_purchase_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status = 'paid' THEN RETURN json_build_object('status', 'paid'); END IF;
  UPDATE app_9e1318caf6_purchase_orders
     SET status = 'failed', raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('fail_reason', p_reason), updated_at = now()
   WHERE id = o.id RETURNING * INTO o;
  RETURN json_build_object('status', 'failed');
END $$;

-- ---------- existing coin functions rebuilt on spend/credit ----------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_send_gift(p_recipient uuid, p_gift text, p_qty integer, p_room uuid DEFAULT NULL::uuid, p_post uuid DEFAULT NULL::uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := auth.uid(); unit integer; total bigint; w app_9e1318caf6_wallets; r json;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_recipient IS NULL OR p_recipient = me THEN RAISE EXCEPTION 'You can''t send a gift to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_recipient) THEN RAISE EXCEPTION 'recipient not found'; END IF;
  unit := app_9e1318caf6_gift_price(p_gift);
  IF unit IS NULL THEN RAISE EXCEPTION 'invalid gift'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 9999 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
  total := unit::bigint * p_qty::bigint;
  r := app_9e1318caf6_spend(me, total, 'gift_sent', 'Gift sent', p_gift || ' ×' || p_qty);
  PERFORM app_9e1318caf6_credit(p_recipient, floor(total * 0.7), 'gift_received', 'Gift received',
                                p_gift || ' ×' || p_qty, 'earnings');
  INSERT INTO app_9e1318caf6_gifts(sender_id, recipient_id, gift, qty, coins, room_id, post_id)
    VALUES (me, p_recipient, p_gift, p_qty, total, p_room, p_post);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('coins', w.coins, 'spent', total, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_boost_post(p_post uuid, p_hours integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cost bigint; c bigint; until timestamptz; r json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_hours NOT IN (6, 24, 72) THEN RAISE EXCEPTION 'invalid duration'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_posts WHERE id = p_post AND user_id = auth.uid() AND status = 'published') THEN
    RAISE EXCEPTION 'not your published post'; END IF;
  cost := p_hours * 10;
  r := app_9e1318caf6_spend(auth.uid(), cost, 'boost', 'Boost video', p_hours || 'h promotion');
  UPDATE app_9e1318caf6_posts
     SET boosted_until = greatest(coalesce(boosted_until, now()), now()) + make_interval(hours => p_hours)
   WHERE id = p_post RETURNING boosted_until INTO until;
  INSERT INTO app_9e1318caf6_boosts(user_id, post_id, coins, hours) VALUES (auth.uid(), p_post, cost, p_hours);
  RETURN json_build_object('coins', (r->>'coins')::bigint, 'purchased', (r->>'purchased')::bigint,
                           'earnings', (r->>'earnings')::bigint, 'boosted_until', until);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_boost_video(p_post uuid, p_kind text, p_qty integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r numeric; a integer[]; d integer := 0; price integer; w app_9e1318caf6_wallets; res json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT l.rate, l.amounts INTO r, a FROM app_9e1318caf6_boost_ladder(p_kind) l;
  IF r IS NULL THEN RAISE EXCEPTION 'invalid boost type'; END IF;
  IF p_qty IS NULL OR p_qty < a[1] OR p_qty > a[12] * 5 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  IF p_kind IN ('views', 'likes', 'comments') AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_posts WHERE id = p_post) THEN
    RAISE EXCEPTION 'video not found'; END IF;
  IF p_qty >= a[11] THEN d := 15; ELSIF p_qty >= a[9] THEN d := 10; ELSIF p_qty >= a[5] THEN d := 5; END IF;
  price := greatest(1, ceil(p_qty * r * (100 - d) / 100.0 - 1e-9))::integer;
  res := app_9e1318caf6_spend(auth.uid(), price, 'boost', 'Boost ' || p_kind, '+' || p_qty || ' ' || p_kind);
  INSERT INTO app_9e1318caf6_video_boosts(user_id, post_id, kind, quantity, coins, discount)
    VALUES (auth.uid(), CASE WHEN p_kind IN ('views', 'likes', 'comments') THEN p_post END, p_kind, p_qty, price, d);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = auth.uid();
  RETURN json_build_object('coins', w.coins, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance,
                           'price', price, 'discount', d);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_place_race_wager(p_pick integer, p_stake bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w app_9e1318caf6_wallets; winner int; pay bigint; res json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_pick < 0 OR p_pick > 3 THEN RAISE EXCEPTION 'invalid pick'; END IF;
  IF p_stake < 10 OR p_stake > 100000 THEN RAISE EXCEPTION 'invalid stake'; END IF;
  res := app_9e1318caf6_spend(auth.uid(), p_stake, 'game', 'Car Racing', 'Lane ' || (p_pick + 1) || ' · stake');
  winner := floor(random() * 4)::int;
  pay := CASE WHEN winner = p_pick THEN p_stake * 3 ELSE 0 END;
  IF pay > 0 THEN
    -- Stake back as Purchased, profit as Earnings.
    PERFORM app_9e1318caf6_credit(auth.uid(), p_stake, 'game', 'Car Racing stake returned', 'Lane ' || (p_pick + 1), 'purchased');
    PERFORM app_9e1318caf6_credit(auth.uid(), pay - p_stake, 'game', 'Car Racing win', 'Lane ' || (p_pick + 1) || ' · winner ' || (winner + 1), 'earnings');
  END IF;
  INSERT INTO app_9e1318caf6_wagers(user_id, pick, winner, stake, payout)
    VALUES (auth.uid(), p_pick, winner, p_stake, pay);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = auth.uid();
  RETURN json_build_object('winner', winner, 'payout', pay, 'coins', w.coins,
                           'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $$;

-- Balance checks now use Purchased + Earnings.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_invite(p_game text, p_opponent uuid, p_room text, p_stake bigint, p_duration int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); bal bigint; sid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_game NOT IN ('front-war','car-racing','motor-racing','marathon','boxing-match','shootout','number-spin','fast-tap','gift-bomb') THEN RAISE EXCEPTION 'Unknown game'; END IF;
  IF p_opponent IS NULL OR p_opponent = me THEN RAISE EXCEPTION 'Choose another player'; END IF;
  IF coalesce(p_stake, 0) < 500 THEN RAISE EXCEPTION 'Minimum stake is 500 coins'; END IF;
  IF p_stake > 1000000 THEN RAISE EXCEPTION 'Invalid stake'; END IF;
  IF coalesce(p_duration, 0) NOT BETWEEN 60 AND 3600 THEN RAISE EXCEPTION 'Duration must be 1 to 60 minutes'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_live_rooms WHERE id::text = p_room AND host_id = me AND is_live) THEN
    RAISE EXCEPTION 'Only the host of a running live can start a game'; END IF;
  IF NOT app_9e1318caf6_game_is_reachable(p_opponent) THEN RAISE EXCEPTION 'This user is offline right now'; END IF;
  UPDATE app_9e1318caf6_game_sessions SET status = 'expired', updated_at = now() WHERE status = 'pending' AND expires_at < now();
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_game_sessions WHERE status IN ('pending','active')
             AND (host_id IN (me, p_opponent) OR opponent_id IN (me, p_opponent))) THEN
    RAISE EXCEPTION 'You or this player already has a game in progress'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  SELECT purchased_balance + earnings_balance INTO bal FROM app_9e1318caf6_wallets WHERE user_id = me;
  IF bal < p_stake THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  INSERT INTO app_9e1318caf6_game_sessions(game, host_id, opponent_id, host_room, stake, duration_s)
    VALUES (p_game, me, p_opponent, p_room, p_stake, p_duration) RETURNING id INTO sid;
  RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_respond(p_session uuid, p_accept boolean, p_room text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions; bal bigint;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.opponent_id IS DISTINCT FROM me THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF s.status <> 'pending' THEN RETURN to_jsonb(s); END IF;
  IF s.expires_at < now() THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'expired', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    RETURN to_jsonb(s);
  END IF;
  IF NOT p_accept THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'declined', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    RETURN to_jsonb(s);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_live_rooms WHERE id::text = p_room AND host_id = me AND is_live) THEN
    RAISE EXCEPTION 'Go live first to accept this game'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_live_rooms WHERE id::text = s.host_room AND is_live) THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'cancelled', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    RETURN to_jsonb(s);
  END IF;
  IF s.stake > 0 THEN
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (s.host_id) ON CONFLICT DO NOTHING;
    SELECT purchased_balance + earnings_balance INTO bal FROM app_9e1318caf6_wallets WHERE user_id = s.host_id;
    IF bal < s.stake THEN RAISE EXCEPTION 'The host no longer has enough coins for this stake'; END IF;
    PERFORM app_9e1318caf6_spend(s.host_id, s.stake, 'game', 'Game stake', s.game);
    PERFORM app_9e1318caf6_spend(me, s.stake, 'game', 'Game stake', s.game);
  END IF;
  UPDATE app_9e1318caf6_live_seats SET user_id = NULL, muted = false WHERE room_id::text IN (s.host_room, p_room) AND idx > 0;
  UPDATE app_9e1318caf6_game_sessions
     SET status = 'active', opp_room = p_room, started_at = now() + interval '3 seconds',
         ends_at = now() + interval '3 seconds' + make_interval(secs => duration_s), updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;

-- Rebuilt unchanged: it already routes through the ledger, which now applies the balance priority.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_support(p_session uuid, p_side int, p_coins bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions; target uuid; left_coins bigint; cut bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF coalesce(p_coins, 0) < 1 OR p_coins > 100000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' OR now() > s.ends_at THEN RAISE EXCEPTION 'This game is not running'; END IF;
  target := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  IF me IN (s.host_id, s.opponent_id) THEN RAISE EXCEPTION 'Players cannot support during their own game'; END IF;
  cut := floor(p_coins * 0.2);
  left_coins := (app_9e1318caf6_spend(me, p_coins, 'game', 'Game support', s.game)->>'coins')::bigint;
  IF cut > 0 THEN PERFORM app_9e1318caf6_credit(target, cut, 'game_action', 'Supporter reward', s.game, 'earnings'); END IF;
  IF p_side = 0 THEN
    UPDATE app_9e1318caf6_game_sessions SET host_support = host_support + p_coins, host_earn = host_earn + cut, updated_at = now() WHERE id = s.id;
  ELSE
    UPDATE app_9e1318caf6_game_sessions SET opp_support = opp_support + p_coins, opp_earn = opp_earn + cut, updated_at = now() WHERE id = s.id;
  END IF;
  RETURN left_coins;
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_action(p_action uuid, p_session uuid, p_side integer, p_kind text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid(); s app_9e1318caf6_game_sessions; cost bigint; reward bigint := 0;
  is_player boolean; car_owner uuid; ben_side int; ben uuid; title text; w app_9e1318caf6_wallets;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_kind NOT IN ('gas', 'brake') OR p_side NOT IN (0, 1) THEN RAISE EXCEPTION 'Invalid move'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_game_actions WHERE action_id = p_action) THEN
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
    SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
    RETURN json_build_object('ok', true, 'duplicate', true, 'coins', w.coins,
                             'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
  END IF;
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' OR now() > s.ends_at THEN RAISE EXCEPTION 'This game is not running'; END IF;
  IF now() < s.started_at THEN RAISE EXCEPTION 'The race has not started yet'; END IF;
  cost := CASE p_kind WHEN 'gas' THEN 10 ELSE 30 END;
  car_owner := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  is_player := me IN (s.host_id, s.opponent_id);
  IF is_player THEN
    IF p_kind = 'gas' AND me <> car_owner THEN RAISE EXCEPTION 'You can only boost your own car'; END IF;
    IF p_kind = 'brake' AND me = car_owner THEN RAISE EXCEPTION 'You can only brake your opponent''s car'; END IF;
  ELSE
    ben_side := CASE WHEN p_kind = 'gas' THEN p_side ELSE 1 - p_side END;
    ben := CASE WHEN ben_side = 0 THEN s.host_id ELSE s.opponent_id END;
    reward := floor(cost * 0.2);
  END IF;
  title := CASE WHEN is_player
                THEN CASE p_kind WHEN 'gas' THEN 'Gas pedal' ELSE 'Brake pedal' END
                ELSE CASE p_kind WHEN 'gas' THEN 'Gas pedal (support)' ELSE 'Brake pedal (support)' END END;
  PERFORM app_9e1318caf6_spend(me, cost, 'game_action', title, s.game);
  IF reward > 0 THEN PERFORM app_9e1318caf6_credit(ben, reward, 'game_action', 'Supporter reward', s.game, 'earnings'); END IF;
  INSERT INTO app_9e1318caf6_game_actions(action_id, session_id, actor_id, side, kind, coins, reward)
    VALUES (p_action, s.id, me, p_side, p_kind, cost, reward);
  IF NOT is_player THEN
    IF ben_side = 0 THEN
      UPDATE app_9e1318caf6_game_sessions SET host_support = host_support + cost, host_earn = host_earn + reward, updated_at = now() WHERE id = s.id;
    ELSE
      UPDATE app_9e1318caf6_game_sessions SET opp_support = opp_support + cost, opp_earn = opp_earn + reward, updated_at = now() WHERE id = s.id;
    END IF;
  ELSE
    UPDATE app_9e1318caf6_game_sessions SET updated_at = now() WHERE id = s.id;
  END IF;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('ok', true, 'coins', w.coins, 'spent', cost,
                           'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_payout(p_session uuid, p_winner uuid, p_result text)
RETURNS app_9e1318caf6_game_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s app_9e1318caf6_game_sessions; pot bigint;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF s.settled OR s.status <> 'active' THEN RETURN s; END IF;
  pot := s.stake * 2;
  -- Winner: own stake comes back as Purchased, the opponent's stake is real income (Earnings).
  -- Draw: both stakes are refunds (Purchased). This never moves Purchased coins into Earnings.
  IF p_winner IS NOT NULL THEN
    IF s.stake > 0 THEN
      PERFORM app_9e1318caf6_credit(p_winner, s.stake, 'game', 'Game stake returned', s.game, 'purchased');
      PERFORM app_9e1318caf6_credit(p_winner, s.stake, 'game', 'Game won', s.game, 'earnings');
    END IF;
  ELSIF s.stake > 0 THEN
    PERFORM app_9e1318caf6_credit(s.host_id, s.stake, 'game', 'Game refund (draw)', s.game, 'purchased');
    PERFORM app_9e1318caf6_credit(s.opponent_id, s.stake, 'game', 'Game refund (draw)', s.game, 'purchased');
  END IF;
  UPDATE app_9e1318caf6_game_sessions
     SET status = 'finished', settled = true, winner_id = p_winner, result = p_result,
         payout = CASE WHEN p_winner IS NULL THEN s.stake ELSE pot END, finished_at = now(), updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_live_join(p_room uuid, p_pay boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); r app_9e1318caf6_live_rooms; cut bigint; w app_9e1318caf6_wallets;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  SELECT * INTO r FROM app_9e1318caf6_live_rooms WHERE id = p_room;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live not found'; END IF;
  IF r.host_id = me OR r.join_fee <= 0 OR EXISTS (SELECT 1 FROM app_9e1318caf6_live_joins WHERE room_id = p_room AND user_id = me) THEN
    RETURN json_build_object('fee', r.join_fee, 'paid', true);
  END IF;
  IF NOT p_pay THEN RETURN json_build_object('fee', r.join_fee, 'paid', false); END IF;
  IF NOT r.is_live THEN RAISE EXCEPTION 'This live has ended'; END IF;
  cut := floor(r.join_fee * 0.7);
  PERFORM app_9e1318caf6_spend(me, r.join_fee, 'live_join', 'Live joining fee', left(r.title, 60));
  IF cut > 0 THEN PERFORM app_9e1318caf6_credit(r.host_id, cut, 'live_join', 'Joining income', left(r.title, 60), 'earnings'); END IF;
  INSERT INTO app_9e1318caf6_live_joins(room_id, user_id, fee, host_earn) VALUES (p_room, me, r.join_fee, cut);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('fee', r.join_fee, 'paid', true, 'coins', w.coins,
                           'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_grp_join(p_group uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO g FROM app_9e1318caf6_groups WHERE id = p_group;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_group_members WHERE group_id = p_group AND user_id = auth.uid()) THEN RETURN 0; END IF;
  IF g.owner_id <> auth.uid() AND g.fee_join > 0 THEN
    PERFORM app_9e1318caf6_spend(auth.uid(), g.fee_join, 'group', 'Joined group', g.name);
    PERFORM app_9e1318caf6_credit(g.owner_id, g.fee_join, 'group', 'Group joining fee', g.name, 'earnings');
    INSERT INTO app_9e1318caf6_group_earnings(group_id, from_user, kind, coins) VALUES (p_group, auth.uid(), 'join', g.fee_join);
  END IF;
  INSERT INTO app_9e1318caf6_group_members(group_id, user_id) VALUES (p_group, auth.uid());
  RETURN CASE WHEN g.owner_id = auth.uid() THEN 0 ELSE g.fee_join END;
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_grp_send(p_group uuid, p_kind text, p_body text, p_media text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; f int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO g FROM app_9e1318caf6_groups WHERE id = p_group;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF g.comments_enabled = false THEN RAISE EXCEPTION 'Messages are turned off for this group'; END IF;
  IF p_kind NOT IN ('text', 'photo', 'voice') THEN RAISE EXCEPTION 'invalid message kind'; END IF;
  IF p_kind = 'text' AND coalesce(trim(p_body), '') = '' THEN RAISE EXCEPTION 'Message is empty'; END IF;
  IF p_kind <> 'text' AND coalesce(p_media, '') = '' THEN RAISE EXCEPTION 'Media is missing'; END IF;
  IF g.owner_id <> auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_group_members WHERE group_id = p_group AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Join the group first'; END IF;
  f := CASE WHEN g.owner_id = auth.uid() THEN 0 WHEN p_kind = 'text' THEN g.fee_text WHEN p_kind = 'photo' THEN g.fee_photo ELSE g.fee_voice END;
  IF f > 0 THEN
    PERFORM app_9e1318caf6_spend(auth.uid(), f, 'group', 'Group message fee', g.name);
    PERFORM app_9e1318caf6_credit(g.owner_id, f, 'group', 'Group message earning', g.name, 'earnings');
    INSERT INTO app_9e1318caf6_group_earnings(group_id, from_user, kind, coins) VALUES (p_group, auth.uid(), p_kind, f);
  END IF;
  INSERT INTO app_9e1318caf6_group_messages(group_id, user_id, kind, body, media, fee)
  VALUES (p_group, auth.uid(), p_kind, left(coalesce(p_body, ''), 2000), p_media, f);
  RETURN f;
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_mkt_transfer(p_dir text, p_amount bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  INSERT INTO app_9e1318caf6_market_balances(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT balance INTO b FROM app_9e1318caf6_market_balances WHERE user_id = auth.uid() FOR UPDATE;
  IF p_dir = 'in' THEN
    PERFORM app_9e1318caf6_spend(auth.uid(), p_amount, 'market', 'To market balance', 'Main → Market');
    UPDATE app_9e1318caf6_market_balances SET balance = balance + p_amount, updated_at = now() WHERE user_id = auth.uid();
  ELSIF p_dir = 'out' THEN
    IF b - app_9e1318caf6_mkt_locked(auth.uid()) < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
    UPDATE app_9e1318caf6_market_balances SET balance = balance - p_amount, updated_at = now() WHERE user_id = auth.uid();
    PERFORM app_9e1318caf6_credit(auth.uid(), p_amount, 'market', 'From market balance', 'Market → Main', 'purchased');
  ELSE RAISE EXCEPTION 'invalid direction'; END IF;
  RETURN app_9e1318caf6_mkt_balance();
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_mkt_release(p_order uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_market_orders WHERE id = p_order FOR UPDATE;
  PERFORM app_9e1318caf6_mkt_step(p_order, 'completed', p_note);
  UPDATE app_9e1318caf6_market_balances SET balance = balance - o.price, updated_at = now() WHERE user_id = o.buyer_id;
  PERFORM app_9e1318caf6_credit(o.seller_id, o.price, 'market', 'Marketplace sale', p_note, 'earnings');
  UPDATE app_9e1318caf6_market_items SET status = 'sold' WHERE id = o.item_id;
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_vip_subscribe()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e timestamptz; c bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT vip_expires_at, purchased_balance + earnings_balance INTO e, c
    FROM app_9e1318caf6_wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF e > now() THEN RETURN json_build_object('result', 'active', 'expires_at', e); END IF;
  IF c < 12500 THEN RETURN json_build_object('result', 'funds'); END IF;
  PERFORM app_9e1318caf6_spend(auth.uid(), 12500, 'vip', 'VIP membership', '30 days');
  UPDATE app_9e1318caf6_wallets SET vip_expires_at = now() + interval '30 days'
   WHERE user_id = auth.uid() RETURNING vip_expires_at INTO e;
  RETURN json_build_object('result', 'ok', 'expires_at', e);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_vip_status()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE w record; renewed text := 'none'; bal bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = auth.uid();
  IF w.vip_expires_at IS NOT NULL AND w.vip_expires_at <= now() AND w.vip_auto_renew THEN
    bal := w.purchased_balance + w.earnings_balance;
    IF bal >= 12500 THEN
      PERFORM app_9e1318caf6_spend(auth.uid(), 12500, 'vip', 'VIP auto-renewal', '30 days');
      UPDATE app_9e1318caf6_wallets SET vip_expires_at = now() + interval '30 days' WHERE user_id = auth.uid();
      renewed := 'renewed';
    ELSE renewed := 'failed'; END IF;
    SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = auth.uid();
  END IF;
  RETURN json_build_object('coins', w.purchased_balance + w.earnings_balance, 'purchased', w.purchased_balance,
                           'earnings', w.earnings_balance, 'expires_at', w.vip_expires_at,
                           'auto_renew', w.vip_auto_renew, 'renew', renewed);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_rank_top()
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, coins bigint, vip boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT * FROM (SELECT p.id, p.username, p.display_name, p.avatar_url, coalesce(w.coins, 0), coalesce(w.vip_expires_at > now(), false)
    FROM app_9e1318caf6_profiles p LEFT JOIN app_9e1318caf6_wallets w ON w.user_id = p.id ORDER BY coalesce(w.coins, 0) DESC LIMIT 50) t
  UNION
  SELECT p.id, p.username, p.display_name, p.avatar_url, coalesce(w.coins, 0), coalesce(w.vip_expires_at > now(), false)
    FROM app_9e1318caf6_profiles p LEFT JOIN app_9e1318caf6_wallets w ON w.user_id = p.id WHERE p.id = auth.uid()
  ORDER BY 5 DESC
$$;

-- Legacy client-side recharge/withdraw are removed: coins enter only after a verified payment
-- (purchase_settle) and leave only through redeem_create.
DROP FUNCTION IF EXISTS public.app_9e1318caf6_wallet_recharge(text, integer, text);
DROP FUNCTION IF EXISTS public.app_9e1318caf6_wallet_withdraw(bigint, text, text);

-- ---------- grants ----------
REVOKE ALL ON FUNCTION public.app_9e1318caf6_spend(uuid, bigint, text, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_credit(uuid, bigint, text, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_ledger(uuid, bigint, text, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_redeem_set_status(uuid, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_purchase_settle(uuid, text, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_purchase_fail(uuid, text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_redeem_create(text, bigint, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_wallet_convert(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_wallet_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_redeem_limits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_purchase_create(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_get_wallet() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_wallet_history() TO authenticated;

GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_redeem_set_status(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_purchase_settle(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_purchase_fail(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_credit(uuid, bigint, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_spend(uuid, bigint, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
