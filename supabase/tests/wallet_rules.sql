-- Wallet rule checks. Run as one statement: every change is rolled back because the block ends with
-- RAISE EXCEPTION carrying the report (look for "WALLET_TEST_REPORT" in the error message).
DO $$
DECLARE
  a uuid; r json; ok text := ''; w app_9e1318caf6_wallets; req uuid; o json; o2 json; failed boolean;
BEGIN
  SELECT user_id INTO a FROM app_9e1318caf6_wallets ORDER BY user_id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  DELETE FROM app_9e1318caf6_redeem_requests WHERE user_id = a;

  -- 1. priority split: Purchased 30 + Earnings 100, spend 50 → 30 from Purchased, 20 from Earnings
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 30, earnings_balance = 100 WHERE user_id = a;
  r := app_9e1318caf6_spend(a, 50, 'test', 'Test spend', '');
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  ok := ok || format('1_split from_p=%s from_e=%s left_p=%s left_e=%s %s; ', r->>'from_purchased', r->>'from_earnings',
         w.purchased_balance, w.earnings_balance,
         CASE WHEN (r->>'from_purchased')::int = 30 AND (r->>'from_earnings')::int = 20 AND w.purchased_balance = 0 AND w.earnings_balance = 80 THEN 'PASS' ELSE 'FAIL' END);

  -- 2. not enough in total → error and nothing deducted
  failed := false;
  BEGIN PERFORM app_9e1318caf6_spend(a, 1000, 'test', 'Too much', ''); EXCEPTION WHEN OTHERS THEN failed := true; END;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  ok := ok || format('2_insufficient %s; ', CASE WHEN failed AND w.purchased_balance = 0 AND w.earnings_balance = 80 THEN 'PASS' ELSE 'FAIL' END);

  -- 3. convert Earnings → Purchased works; no Purchased → Earnings path exists
  r := app_9e1318caf6_wallet_convert(50);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  failed := false;
  BEGIN PERFORM app_9e1318caf6_wallet_convert(1000); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('3_convert p=%s e=%s overdraw_blocked=%s reverse_fn=%s %s; ', w.purchased_balance, w.earnings_balance, failed,
         (SELECT count(*) FROM pg_proc WHERE proname ~ 'app_9e1318caf6_.*(to_earnings|purchased_to)'),
         CASE WHEN w.purchased_balance = 50 AND w.earnings_balance = 30 AND failed
               AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname ~ 'app_9e1318caf6_.*(to_earnings|purchased_to)') THEN 'PASS' ELSE 'FAIL' END);

  -- 4. redeem rules: min, BEP20 format, only from Earnings, fee 10%, daily cap, idempotency
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 500000, earnings_balance = 100000 WHERE user_id = a;
  failed := false;
  BEGIN PERFORM app_9e1318caf6_redeem_create('telebirr', 20000, '{"name":"A","phone":"0911223344"}', 'k-min'); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('4a_min %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);
  failed := false;
  BEGIN PERFORM app_9e1318caf6_redeem_create('usdt_bep20', 30000, '{"address":"0x123"}', 'k-addr'); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('4b_bep20_format %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);

  r := app_9e1318caf6_redeem_create('telebirr', 30000, '{"name":"A","phone":"0911223344"}', 'k-1');
  req := (r->>'id')::uuid;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  ok := ok || format('4c_fee fee=%s net_coins=%s net_etb=%s e=%s p=%s %s; ', r->>'fee', r->>'net_coins', r->>'net_amount',
         w.earnings_balance, w.purchased_balance,
         CASE WHEN (r->>'fee')::int = 3000 AND (r->>'net_coins')::int = 27000 AND (r->>'net_amount')::numeric = 2700
               AND w.earnings_balance = 70000 AND w.purchased_balance = 500000 THEN 'PASS' ELSE 'FAIL' END);

  r := app_9e1318caf6_redeem_create('telebirr', 30000, '{"name":"A","phone":"0911223344"}', 'k-1');
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  ok := ok || format('4d_idempotent dup=%s e=%s %s; ', r->>'duplicate', w.earnings_balance,
         CASE WHEN (r->>'duplicate')::boolean AND w.earnings_balance = 70000 THEN 'PASS' ELSE 'FAIL' END);

  failed := false;
  BEGIN PERFORM app_9e1318caf6_redeem_create('cbe', 25000, '{"full_name":"A B","account_number":"1000123456789"}', 'k-2'); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('4e_daily_cap %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);

  -- Purchased balance can never be redeemed
  UPDATE app_9e1318caf6_wallets SET earnings_balance = 10000 WHERE user_id = a;
  DELETE FROM app_9e1318caf6_redeem_requests WHERE user_id = a AND id <> req;
  failed := false;
  BEGIN PERFORM app_9e1318caf6_redeem_create('boa', 25000, '{"full_name":"A B","account_number":"1000123456789"}', 'k-3'); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('4f_no_redeem_from_purchased %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);

  -- 5. reject → coins back to Earnings
  UPDATE app_9e1318caf6_wallets SET earnings_balance = 70000 WHERE user_id = a;
  r := app_9e1318caf6_redeem_set_status(req, 'rejected', 'test reject');
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  failed := false;
  BEGIN PERFORM app_9e1318caf6_redeem_set_status(req, 'paid'); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('5_reject_refund e=%s final_locked=%s %s; ', w.earnings_balance, failed,
         CASE WHEN w.earnings_balance = 100000 AND failed THEN 'PASS' ELSE 'FAIL' END);

  -- 6. purchases: credited once to Purchased; same external payment cannot be reused
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 0, earnings_balance = 0 WHERE user_id = a;
  o := app_9e1318caf6_purchase_create('chapa', 'chapa_100', 'p-1');
  r := app_9e1318caf6_purchase_settle((o->>'id')::uuid, 'tx-test-1', '{}');
  r := app_9e1318caf6_purchase_settle((o->>'id')::uuid, 'tx-test-1', '{}');
  o2 := app_9e1318caf6_purchase_create('chapa', 'chapa_100', 'p-2');
  failed := false;
  BEGIN PERFORM app_9e1318caf6_purchase_settle((o2->>'id')::uuid, 'tx-test-1', '{}'); EXCEPTION WHEN OTHERS THEN failed := true; END;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
  ok := ok || format('6_purchase_once p=%s e=%s reuse_blocked=%s %s; ', w.purchased_balance, w.earnings_balance, failed,
         CASE WHEN w.purchased_balance = 1000 AND w.earnings_balance = 0 AND failed THEN 'PASS' ELSE 'FAIL' END);

  -- 7. gift: sender pays Purchased first, recipient gets 70% in Earnings
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 5, earnings_balance = 100 WHERE user_id = a;
  DECLARE b uuid; wb_before bigint; wb app_9e1318caf6_wallets;
  BEGIN
    SELECT w2.user_id INTO b FROM app_9e1318caf6_wallets w2 JOIN app_9e1318caf6_profiles p ON p.id = w2.user_id WHERE w2.user_id <> a LIMIT 1;
    SELECT earnings_balance INTO wb_before FROM app_9e1318caf6_wallets WHERE user_id = b;
    r := app_9e1318caf6_send_gift(b, 'rose', 1);
    SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = a;
    SELECT * INTO wb FROM app_9e1318caf6_wallets WHERE user_id = b;
    ok := ok || format('7_gift sender_p=%s sender_e=%s recv_e_delta=%s %s; ', w.purchased_balance, w.earnings_balance,
           wb.earnings_balance - wb_before,
           CASE WHEN w.purchased_balance = 0 AND w.earnings_balance = 95 AND wb.earnings_balance - wb_before = 7 THEN 'PASS' ELSE 'FAIL' END);
  END;

  RAISE EXCEPTION 'WALLET_TEST_REPORT %', ok;
END $$;
