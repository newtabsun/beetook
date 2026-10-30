-- 039/040 checks: Rank by earnings_balance, amount visible to everybody. Everything rolls back (block ends with RAISE EXCEPTION).
DO $$
DECLARE
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; lo uuid; hi uuid; ok text := ''; n int; v bigint; v2 bigint; rk bigint; rk_lo bigint; rk_hi bigint; prev bigint;
  r record; sorted boolean := true; res text;
BEGIN
  SELECT user_id INTO u1 FROM app_9e1318caf6_wallets ORDER BY user_id LIMIT 1;
  SELECT user_id INTO u2 FROM app_9e1318caf6_wallets WHERE user_id <> u1 ORDER BY user_id LIMIT 1;
  SELECT user_id INTO u3 FROM app_9e1318caf6_wallets WHERE user_id NOT IN (u1, u2) ORDER BY user_id LIMIT 1;
  SELECT user_id INTO u4 FROM app_9e1318caf6_wallets WHERE user_id NOT IN (u1, u2, u3) ORDER BY user_id LIMIT 1;

  -- u1 clearly first; u2 and u3 tie; u4 has 0 earnings but a big Purchased balance (must NOT matter)
  UPDATE app_9e1318caf6_wallets SET earnings_balance = 9000000000000 WHERE user_id = u1;
  UPDATE app_9e1318caf6_wallets SET earnings_balance = 8000000000000 WHERE user_id IN (u2, u3);
  UPDATE app_9e1318caf6_wallets SET earnings_balance = 0, purchased_balance = 99000000000000 WHERE user_id = u4;
  SELECT CASE WHEN p2.public_id < p3.public_id THEN u2 ELSE u3 END, CASE WHEN p2.public_id < p3.public_id THEN u3 ELSE u2 END
    INTO lo, hi FROM app_9e1318caf6_profiles p2, app_9e1318caf6_profiles p3 WHERE p2.id = u2 AND p3.id = u3;

  -- R1. caller u1: ranked 1st, sees own amount AND other users' amounts (exact values)
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SELECT t.rank, t.earnings INTO rk, v FROM app_9e1318caf6_rank_top() t WHERE t.id = u1;
  SELECT t.earnings INTO v2 FROM app_9e1318caf6_rank_top() t WHERE t.id = u2;
  SELECT count(*) INTO n FROM app_9e1318caf6_rank_top() t WHERE t.earnings IS NOT NULL AND t.id <> u1;
  ok := ok || format('R1_first_and_all_amounts rank=%s own=%s u2=%s others_with_amount=%s %s; ', rk, v, v2, n,
    CASE WHEN rk = 1 AND v = 9000000000000 AND v2 = 8000000000000 AND n >= 2 THEN 'PASS' ELSE 'FAIL' END);

  -- R2. tie: smaller public_id first
  SELECT t.rank INTO rk_lo FROM app_9e1318caf6_rank_top() t WHERE t.id = lo;
  SELECT t.rank INTO rk_hi FROM app_9e1318caf6_rank_top() t WHERE t.id = hi;
  ok := ok || format('R2_tie_by_public_id lo=%s hi=%s %s; ', rk_lo, rk_hi, CASE WHEN rk_lo = 2 AND rk_hi = 3 THEN 'PASS' ELSE 'FAIL' END);

  -- R3. Purchased balance is ignored: u4 (0 earnings, huge Purchased) is not ranked and not listed for others
  SELECT count(*) INTO n FROM app_9e1318caf6_rank_top() t WHERE t.id = u4;
  ok := ok || format('R3_purchased_ignored listed=%s %s; ', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- R4. caller u4 (0 earnings): own row present, rank NULL, own amount 0 (Earnings, not Purchased); others' amounts visible
  PERFORM set_config('request.jwt.claim.sub', u4::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  SELECT t.rank, t.earnings INTO rk, v FROM app_9e1318caf6_rank_top() t WHERE t.id = u4;
  SELECT t.earnings INTO v2 FROM app_9e1318caf6_rank_top() t WHERE t.id = u1;
  ok := ok || format('R4_zero_earner rank=%s own=%s u1_amount=%s %s; ', coalesce(rk::text, 'NULL'), v, v2,
    CASE WHEN rk IS NULL AND v = 0 AND v2 = 9000000000000 AND EXISTS (SELECT 1 FROM app_9e1318caf6_rank_top() t WHERE t.id = u4) THEN 'PASS' ELSE 'FAIL' END);

  -- R5. guest (no user): ranking AND earnings amounts visible
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SELECT count(*) INTO n FROM app_9e1318caf6_rank_top() t WHERE t.earnings IS NOT NULL;
  SELECT t.rank, t.earnings INTO rk, v FROM app_9e1318caf6_rank_top() t WHERE t.id = u1;
  ok := ok || format('R5_guest_sees_amounts amounts=%s u1_rank=%s u1_amount=%s %s; ', n, rk, v,
    CASE WHEN n >= 3 AND rk = 1 AND v = 9000000000000 THEN 'PASS' ELSE 'FAIL' END);

  -- R6. rows come ordered by rank (NULL last), at most 50 ranked rows + the caller
  prev := 0;
  FOR r IN SELECT t.rank FROM app_9e1318caf6_rank_top() t LOOP
    IF r.rank IS NOT NULL THEN IF r.rank <= prev THEN sorted := false; END IF; prev := r.rank; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM app_9e1318caf6_rank_top() t;
  ok := ok || format('R6_order_and_limit rows=%s %s; ', n, CASE WHEN sorted AND n <= 51 THEN 'PASS' ELSE 'FAIL' END);

  -- R7. grants: guests and signed-in users can call it, PUBLIC cannot be relied on
  ok := ok || format('R7_grants %s; ', CASE WHEN has_function_privilege('anon', 'public.app_9e1318caf6_rank_top()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.app_9e1318caf6_rank_top()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END);

  -- R8. no other wallet data leaks: the function returns exactly the 7 expected columns (no purchased/coins/transactions)
  res := pg_get_function_result('public.app_9e1318caf6_rank_top()'::regprocedure);
  ok := ok || format('R8_columns_only_expected [%s] %s; ', res,
    CASE WHEN res = 'TABLE(id uuid, username text, display_name text, avatar_url text, earnings bigint, vip boolean, rank bigint)'
      AND res !~* '(purchased|coins|transaction)' THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RANK_TEST_REPORT %', ok;
END $$;
