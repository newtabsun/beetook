-- Username + guest rules. Run as one statement; everything is rolled back, the report is in the error text
-- ("USERNAME_TEST_REPORT").
DO $$
DECLARE
  ok text := '';
  r text;
  a uuid; b uuid;
  failed boolean;
  anon_rows int;
BEGIN
  -- 1. normalisation: leading @, spaces and case
  ok := ok || format('1_norm %s; ', CASE WHEN
      app_9e1318caf6_normalize_username('@abebe') = 'abebe'
  AND app_9e1318caf6_normalize_username('@@abebe') = 'abebe'
  AND app_9e1318caf6_normalize_username('  Abebe ') = 'abebe' THEN 'PASS' ELSE 'FAIL' END);

  -- 2. validation reasons
  ok := ok || format('2_rules %s; ', CASE WHEN
      app_9e1318caf6_username_error('abebe') IS NULL
  AND app_9e1318caf6_username_error('abe..bu') = 'double_dot'
  AND app_9e1318caf6_username_error('አበበ') = 'non_ascii'
  AND app_9e1318caf6_username_error('abe bu') = 'invalid_chars'
  AND app_9e1318caf6_username_error('ab') = 'too_short'
  AND app_9e1318caf6_username_error(repeat('a', 25)) = 'too_long'
  AND app_9e1318caf6_username_error('.abebe') = 'bad_edges'
  AND app_9e1318caf6_username_error('Admin') = 'reserved' THEN 'PASS' ELSE 'FAIL' END);

  -- 3. generated handle format and uniqueness
  r := app_9e1318caf6_generate_username(10000051);
  ok := ok || format('3_generate %s(%s); ', CASE WHEN r ~ '^user10000051\d*$' THEN 'PASS' ELSE 'FAIL' END, r);

  -- 4. set_username: normalises, rejects taken, rejects Amharic
  SELECT id INTO a FROM app_9e1318caf6_profiles ORDER BY public_id LIMIT 1;
  SELECT id INTO b FROM app_9e1318caf6_profiles WHERE id <> a ORDER BY public_id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := app_9e1318caf6_set_username('@@Zz.Test_1');
  ok := ok || format('4a_set %s; ', CASE WHEN r = 'zz.test_1' THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  failed := false;
  BEGIN PERFORM app_9e1318caf6_set_username('ZZ.test_1'); EXCEPTION WHEN OTHERS THEN failed := SQLERRM = 'USERNAME_TAKEN'; END;
  ok := ok || format('4b_taken %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);
  failed := false;
  BEGIN PERFORM app_9e1318caf6_set_username('አበበ'); EXCEPTION WHEN OTHERS THEN failed := SQLERRM = 'USERNAME_NON_ASCII'; END;
  ok := ok || format('4c_amharic %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);

  -- 5. DB constraint blocks bad handles even without the RPC
  failed := false;
  BEGIN UPDATE app_9e1318caf6_profiles SET username = '@bad' WHERE id = b; EXCEPTION WHEN check_violation THEN failed := true; END;
  ok := ok || format('5_constraint %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);

  -- 6. guest (anon): public reads only, no private data, no writes
  SET LOCAL ROLE anon;
  SELECT count(*) INTO anon_rows FROM app_9e1318caf6_posts;
  ok := ok || format('6a_feed_read %s; ', CASE WHEN anon_rows >= 0 THEN 'PASS' ELSE 'FAIL' END);
  failed := false;
  BEGIN PERFORM 1 FROM app_9e1318caf6_wallets LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ok := ok || format('6b_wallet_denied %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);
  failed := false;
  BEGIN PERFORM 1 FROM app_9e1318caf6_messages LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ok := ok || format('6c_messages_denied %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);
  failed := false;
  BEGIN PERFORM phone FROM app_9e1318caf6_profiles LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ok := ok || format('6d_phone_hidden %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);
  failed := false;
  BEGIN INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (gen_random_uuid(), gen_random_uuid()); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('6e_write_denied %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);
  failed := false;
  BEGIN PERFORM app_9e1318caf6_set_username('guest.try'); EXCEPTION WHEN OTHERS THEN failed := true; END;
  ok := ok || format('6f_rpc_denied %s; ', CASE WHEN failed THEN 'PASS' ELSE 'FAIL' END);
  RESET ROLE;

  RAISE EXCEPTION 'USERNAME_TEST_REPORT %', ok;
END $$;
