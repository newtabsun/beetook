-- 041 checks: gift catalog + send_gift. Everything rolls back (block ends with RAISE EXCEPTION).
DO $$
DECLARE
  u1 uuid; u2 uuid; ok text := ''; n int; mx int; mn int; p0 bigint; e0 bigint; p1 bigint; e1 bigint; g0 int; t0 int; r json; bad boolean; failed boolean;
  legacy text[] := ARRAY['rose:10','icecream:20','beer:30','perfume:50','bee:99','heart:15','coffee:25','cake:60','teddy:80','fireworks:150','diamond:200','rocket:300','crown:500','castle:1000'];
  x text;
BEGIN
  SELECT user_id INTO u1 FROM app_9e1318caf6_wallets ORDER BY user_id LIMIT 1;
  SELECT user_id INTO u2 FROM app_9e1318caf6_wallets WHERE user_id <> u1 ORDER BY user_id LIMIT 1;

  -- G1. legacy ids/prices unchanged, 35 gifts, top price exactly 300000, no zero/negative price
  bad := false;
  FOREACH x IN ARRAY legacy LOOP
    IF app_9e1318caf6_gift_price(split_part(x, ':', 1)) IS DISTINCT FROM split_part(x, ':', 2)::int THEN bad := true; END IF;
  END LOOP;
  SELECT count(*), max(coins), min(coins) INTO n, mx, mn FROM app_9e1318caf6_gift_catalog;
  ok := ok || format('G1_legacy_and_range count=%s max=%s min=%s %s; ', n, mx, mn, CASE WHEN NOT bad AND n = 35 AND mx = 300000 AND mn >= 1 THEN 'PASS' ELSE 'FAIL' END);

  -- G2. tiers match the price bands; unknown / inactive gifts have no price
  SELECT count(*) INTO n FROM app_9e1318caf6_gift_catalog
   WHERE tier <> CASE WHEN coins <= 50 THEN 1 WHEN coins <= 500 THEN 2 WHEN coins <= 5000 THEN 3 WHEN coins <= 30000 THEN 4 ELSE 5 END;
  UPDATE app_9e1318caf6_gift_catalog SET active = false WHERE id = 'majesty';
  ok := ok || format('G2_tiers_and_inactive wrong_tier=%s unknown=%s inactive=%s %s; ', n, coalesce(app_9e1318caf6_gift_price('nope')::text, 'NULL'),
    coalesce(app_9e1318caf6_gift_price('majesty')::text, 'NULL'),
    CASE WHEN n = 0 AND app_9e1318caf6_gift_price('nope') IS NULL AND app_9e1318caf6_gift_price('majesty') IS NULL THEN 'PASS' ELSE 'FAIL' END);
  UPDATE app_9e1318caf6_gift_catalog SET active = true WHERE id = 'majesty';

  UPDATE app_9e1318caf6_wallets SET purchased_balance = 1000000, earnings_balance = 0 WHERE user_id = u1;
  SELECT earnings_balance INTO e0 FROM app_9e1318caf6_wallets WHERE user_id = u2;
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);

  -- G3. top gift: exact charge, recipient share, one gifts row with the catalog price
  SELECT count(*) INTO g0 FROM app_9e1318caf6_gifts WHERE sender_id = u1;
  r := app_9e1318caf6_send_gift(u2, 'majesty', 1);
  SELECT purchased_balance, earnings_balance INTO p1, e1 FROM app_9e1318caf6_wallets WHERE user_id = u1;
  SELECT earnings_balance INTO e1 FROM app_9e1318caf6_wallets WHERE user_id = u2;
  SELECT count(*) INTO n FROM app_9e1318caf6_gifts WHERE sender_id = u1 AND gift = 'majesty' AND coins = 300000;
  ok := ok || format('G3_top_gift spent=%s recv=%s rows=%s %s; ', r->>'spent', e1 - e0, n,
    CASE WHEN (r->>'spent')::bigint = 300000 AND e1 - e0 = app_9e1318caf6_share_recipient(300000, 'gift') AND n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- G4. insufficient balance: raises, no balance change, no gifts row, no txn
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 199, earnings_balance = 0 WHERE user_id = u1;
  SELECT count(*) INTO g0 FROM app_9e1318caf6_gifts WHERE sender_id = u1;
  SELECT count(*) INTO t0 FROM app_9e1318caf6_wallet_txns WHERE user_id = u1;
  failed := false;
  BEGIN PERFORM app_9e1318caf6_send_gift(u2, 'diamond', 1); EXCEPTION WHEN OTHERS THEN failed := true; END;
  SELECT purchased_balance INTO p1 FROM app_9e1318caf6_wallets WHERE user_id = u1;
  SELECT count(*) INTO n FROM app_9e1318caf6_gifts WHERE sender_id = u1;
  ok := ok || format('G4_insufficient failed=%s bal=%s rows_added=%s txn_added=%s %s; ', failed, p1, n - g0,
    (SELECT count(*) FROM app_9e1318caf6_wallet_txns WHERE user_id = u1) - t0,
    CASE WHEN failed AND p1 = 199 AND n = g0 AND (SELECT count(*) FROM app_9e1318caf6_wallet_txns WHERE user_id = u1) = t0 THEN 'PASS' ELSE 'FAIL' END);

  -- G5. invalid inputs are rejected: unknown gift, qty 0, qty 10000, self gift
  bad := false;
  BEGIN PERFORM app_9e1318caf6_send_gift(u2, 'fake', 1); bad := true; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM app_9e1318caf6_send_gift(u2, 'rose', 0); bad := true; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM app_9e1318caf6_send_gift(u2, 'rose', 10000); bad := true; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM app_9e1318caf6_send_gift(u1, 'rose', 1); bad := true; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT purchased_balance INTO p1 FROM app_9e1318caf6_wallets WHERE user_id = u1;
  ok := ok || format('G5_invalid_rejected bal=%s %s; ', p1, CASE WHEN NOT bad AND p1 = 199 THEN 'PASS' ELSE 'FAIL' END);

  -- G6. two sends charge exactly twice (each call is its own atomic charge) and create two rows
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 10000, earnings_balance = 0 WHERE user_id = u1;
  SELECT count(*) INTO g0 FROM app_9e1318caf6_gifts WHERE sender_id = u1;
  PERFORM app_9e1318caf6_send_gift(u2, 'ember', 2);
  PERFORM app_9e1318caf6_send_gift(u2, 'ember', 2);
  SELECT purchased_balance INTO p1 FROM app_9e1318caf6_wallets WHERE user_id = u1;
  SELECT count(*) INTO n FROM app_9e1318caf6_gifts WHERE sender_id = u1;
  ok := ok || format('G6_charge_exact bal=%s rows_added=%s %s; ', p1, n - g0, CASE WHEN p1 = 10000 - 4 * 250 AND n - g0 = 2 THEN 'PASS' ELSE 'FAIL' END);

  -- G7. clients cannot write the catalog; guests and users can read it; RLS is on
  ok := ok || format('G7_catalog_access %s; ', CASE WHEN NOT has_table_privilege('authenticated', 'public.app_9e1318caf6_gift_catalog', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.app_9e1318caf6_gift_catalog', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.app_9e1318caf6_gift_catalog', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.app_9e1318caf6_gift_catalog', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.app_9e1318caf6_gift_catalog', 'UPDATE')
    AND has_table_privilege('anon', 'public.app_9e1318caf6_gift_catalog', 'SELECT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_9e1318caf6_gift_catalog'::regclass) THEN 'PASS' ELSE 'FAIL' END);

  -- G8. send_gift takes no price/coins argument, so the client cannot influence the price
  ok := ok || format('G8_no_price_arg [%s] %s; ', pg_get_function_arguments('public.app_9e1318caf6_send_gift(uuid,text,integer,uuid,uuid)'::regprocedure),
    CASE WHEN pg_get_function_arguments('public.app_9e1318caf6_send_gift(uuid,text,integer,uuid,uuid)'::regprocedure) !~* '(price|coins|amount)' THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'GIFT_TEST_REPORT %', ok;
END $$;
