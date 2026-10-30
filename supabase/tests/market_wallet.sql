-- Marketplace ↔ wallet checks + custom purchase limits. Everything rolls back (block ends with RAISE EXCEPTION).
DO $$
DECLARE
  a uuid; b uuid; ok text := ''; w app_9e1318caf6_wallets; failed boolean; it uuid; oid uuid; mb bigint; r json; n int;
BEGIN
  SELECT user_id INTO a FROM app_9e1318caf6_wallets ORDER BY user_id LIMIT 1;
  SELECT user_id INTO b FROM app_9e1318caf6_wallets WHERE user_id <> a ORDER BY user_id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- M1. marketplace top-up uses Purchased only: Purchased 100 + Earnings 10000, move 500 → rejected, nothing changes
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 100, earnings_balance = 10000 WHERE user_id = a;
  INSERT INTO app_9e1318caf6_market_balances(user_id) VALUES (a) ON CONFLICT DO NOTHING;
  UPDATE app_9e1318caf6_market_balances SET balance = 0 WHERE user_id = a;
  failed := false;
  BEGIN PERFORM app_9e1318caf6_mkt_transfer('in', 500); EXCEPTION WHEN OTHERS THEN failed := true; END;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  SELECT balance INTO mb FROM app_9e1318caf6_market_balances WHERE user_id = a;
  ok := ok || format('M1_no_earnings_fallback %s; ', CASE WHEN failed AND w.purchased_balance = 100 AND w.earnings_balance = 10000 AND mb = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- M2. enough Purchased → only Purchased is debited
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 5000 WHERE user_id = a;
  PERFORM app_9e1318caf6_mkt_transfer('in', 2000);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  SELECT balance INTO mb FROM app_9e1318caf6_market_balances WHERE user_id = a;
  ok := ok || format('M2_purchased_only p=%s e=%s m=%s %s; ', w.purchased_balance, w.earnings_balance, mb,
    CASE WHEN w.purchased_balance = 3000 AND w.earnings_balance = 10000 AND mb = 2000 THEN 'PASS' ELSE 'FAIL' END);

  -- M3. refund of a paid order: 1000 coins → 950 to Purchased, 50 fee in ledger, escrow cleared; repeat is a no-op
  INSERT INTO app_9e1318caf6_market_items(user_id, title, category, price_etb, status) VALUES (b, 'Test item', 'General', 100, 'reserved') RETURNING id INTO it;
  INSERT INTO app_9e1318caf6_market_orders(item_id, item_title, buyer_id, seller_id, price, status, history)
    VALUES (it, 'Test item', a, b, 1000, 'disputed', '[]'::jsonb) RETURNING id INTO oid;
  PERFORM app_9e1318caf6_mkt_refund(oid, 'Refunded by agreement');
  PERFORM app_9e1318caf6_mkt_refund(oid, 'Refunded by agreement');
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  SELECT balance INTO mb FROM app_9e1318caf6_market_balances WHERE user_id = a;
  SELECT count(*) INTO n FROM app_9e1318caf6_wallet_txns WHERE user_id = a AND title = 'Marketplace refund' AND gross = 1000 AND platform_fee = 50 AND amount = 950 AND created_at >= now();
  ok := ok || format('M3_refund_minus_5pct p=%s e=%s m=%s refund_rows=%s %s; ', w.purchased_balance, w.earnings_balance, mb, n,
    CASE WHEN w.purchased_balance = 3950 AND w.earnings_balance = 10000 AND mb = 1000 AND n = 1
          AND (SELECT refund_fee FROM app_9e1318caf6_market_orders WHERE id = oid) = 50
          AND (SELECT status FROM app_9e1318caf6_market_orders WHERE id = oid) = 'cancelled' THEN 'PASS' ELSE 'FAIL' END);

  -- M5. Market → Purchased: 1000 → 950 to Purchased, 50 platform fee recorded
  PERFORM app_9e1318caf6_mkt_transfer('out', 1000);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  SELECT balance INTO mb FROM app_9e1318caf6_market_balances WHERE user_id = a;
  SELECT count(*) INTO n FROM app_9e1318caf6_platform_revenue WHERE kind = 'market_to_purchased' AND payer_id = a AND gross = 1000 AND platform_fee = 50 AND created_at >= now();
  ok := ok || format('M5_out_5pct p=%s m=%s rev=%s %s; ', w.purchased_balance, mb, n,
    CASE WHEN w.purchased_balance = 4900 AND w.earnings_balance = 10000 AND mb = 0 AND n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- M6. sale release: seller gets 100% of price into Earnings (no 30% cut)
  UPDATE app_9e1318caf6_market_balances SET balance = 500 WHERE user_id = a;
  SELECT earnings_balance INTO mb FROM app_9e1318caf6_wallets WHERE user_id = b;
  INSERT INTO app_9e1318caf6_market_items(user_id, title, category, price_etb, status) VALUES (b, 'Sale item', 'General', 50, 'reserved') RETURNING id INTO it;
  INSERT INTO app_9e1318caf6_market_orders(item_id, item_title, buyer_id, seller_id, price, status, history)
    VALUES (it, 'Sale item', a, b, 500, 'shipped', '[]'::jsonb) RETURNING id INTO oid;
  PERFORM app_9e1318caf6_mkt_release(oid, 'Received');
  ok := ok || format('M6_sale_100pct delta=%s %s; ', (SELECT earnings_balance FROM app_9e1318caf6_wallets WHERE user_id = b) - mb,
    CASE WHEN (SELECT earnings_balance FROM app_9e1318caf6_wallets WHERE user_id = b) - mb = 500
          AND (SELECT balance FROM app_9e1318caf6_market_balances WHERE user_id = a) = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- M4. clients cannot call refund/release or the Purchased-only helper directly
  ok := ok || format('M4_internal_only %s; ', CASE WHEN NOT has_function_privilege('authenticated', 'app_9e1318caf6_mkt_refund(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'app_9e1318caf6_spend_purchased(uuid,bigint,text,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END);

  -- P1. Chapa custom below 50 ETB rejected, 75 ETB ok (750 coins); P2. idempotent; P3. USDT custom; P4. Google Play USD packs
  failed := false;
  BEGIN PERFORM app_9e1318caf6_purchase_create('chapa', 'custom', 't-c1', 40); EXCEPTION WHEN OTHERS THEN failed := true; END;
  r := app_9e1318caf6_purchase_create('chapa', 'custom', 't-c2', 75);
  ok := ok || format('P1_chapa_min coins=%s %s; ', r->>'coins', CASE WHEN failed AND (r->>'coins')::int = 750 THEN 'PASS' ELSE 'FAIL' END);
  r := app_9e1318caf6_purchase_create('chapa', 'custom', 't-c2', 75);
  ok := ok || format('P2_idempotent %s; ', CASE WHEN (r->>'duplicate')::boolean THEN 'PASS' ELSE 'FAIL' END);
  r := app_9e1318caf6_purchase_create('usdt_bep20', 'custom', 't-u1', 2.5);
  ok := ok || format('P3_usdt_custom coins=%s %s; ', r->>'coins', CASE WHEN (r->>'coins')::int = 4000 THEN 'PASS' ELSE 'FAIL' END);
  -- $4.99 × 1,600 = 7,984 coins; cheapest pack $0.99 = 1,584 coins; no 17th pack; max pack inside the Google limit.
  r := app_9e1318caf6_purchase_create('google_play', 'coins_499', 't-g1');
  ok := ok || format('P4_gp_usd coins=%s amount=%s %s; ', r->>'coins', r->>'amount',
    CASE WHEN (r->>'coins')::int = 7984 AND (r->>'amount')::numeric = 4.99 AND r->>'currency' = 'USD' THEN 'PASS' ELSE 'FAIL' END);
  r := app_9e1318caf6_purchase_create('google_play', 'coins_099', 't-g2');
  ok := ok || format('P4b_gp_min coins=%s %s; ', r->>'coins', CASE WHEN (r->>'coins')::int = 1584 THEN 'PASS' ELSE 'FAIL' END);
  ok := ok || format('P4c_gp_pack_count %s; ', CASE WHEN jsonb_array_length(app_9e1318caf6_wallet_settings()->'coin_packs'->'google_play') <= 16 THEN 'PASS' ELSE 'FAIL' END);
  -- Google Play no longer accepts a custom amount, and the old split planner is gone.
  failed := false;
  BEGIN PERFORM app_9e1318caf6_purchase_create('google_play', 'custom', 't-g3', 20); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('P5_gp_no_custom %s; ', CASE WHEN failed AND to_regprocedure('app_9e1318caf6_purchase_gp_plan(numeric)') IS NULL THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'MARKET_TEST_REPORT %', ok;
END $$;
