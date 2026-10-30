-- 044 checks: Go Live needs VIP or >= 1000 followers; 1000 followers works without VIP.
-- Everything rolls back (ends with RAISE EXCEPTION).
CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u::text, true),
         set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;

DO $$
DECLARE
  low uuid; ok text := ''; blocked boolean; made int; f0 int;
BEGIN
  -- Pick a user with no VIP and few followers (created if needed).
  SELECT p.id INTO low FROM app_9e1318caf6_profiles p
    LEFT JOIN app_9e1318caf6_wallets w ON w.user_id = p.id
   WHERE coalesce(w.vip_expires_at, 'epoch'::timestamptz) <= now()
     AND coalesce(p.followers_count, 0) < 1000
   ORDER BY p.id LIMIT 1;
  IF low IS NULL THEN
    INSERT INTO app_9e1318caf6_profiles(id, username, display_name) VALUES (gen_random_uuid(), 'livegate_test', 'Live gate test')
      RETURNING id INTO low;
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (low) ON CONFLICT DO NOTHING;
  END IF;

  PERFORM pg_temp.as_user(low);
  UPDATE app_9e1318caf6_wallets SET vip_expires_at = NULL WHERE user_id = low;
  UPDATE app_9e1318caf6_profiles SET followers_count = 0 WHERE id = low;

  -- 1. no VIP, 0 followers -> rejected
  blocked := false;
  BEGIN
    INSERT INTO app_9e1318caf6_live_rooms(host_id, title) VALUES (low, 'gate-1');
  EXCEPTION WHEN others THEN blocked := true;
  END;
  ok := ok || format('1_no_vip_no_followers blocked=%s %s; ', blocked, CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END);

  -- 2. 999 followers -> still rejected
  UPDATE app_9e1318caf6_profiles SET followers_count = 999 WHERE id = low;
  blocked := false;
  BEGIN
    INSERT INTO app_9e1318caf6_live_rooms(host_id, title) VALUES (low, 'gate-2');
  EXCEPTION WHEN others THEN blocked := true;
  END;
  ok := ok || format('2_999_followers blocked=%s %s; ', blocked, CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END);

  -- 3. exactly 1000 followers, no VIP -> allowed
  UPDATE app_9e1318caf6_profiles SET followers_count = 1000 WHERE id = low;
  made := 0;
  BEGIN
    INSERT INTO app_9e1318caf6_live_rooms(host_id, title) VALUES (low, 'gate-3');
    GET DIAGNOSTICS made = ROW_COUNT;
  EXCEPTION WHEN others THEN made := 0;
  END;
  ok := ok || format('3_1000_followers_no_vip inserted=%s %s; ', made, CASE WHEN made = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- 4. no followers but active VIP -> allowed
  UPDATE app_9e1318caf6_profiles SET followers_count = 0 WHERE id = low;
  UPDATE app_9e1318caf6_wallets SET vip_expires_at = now() + interval '30 days' WHERE user_id = low;
  made := 0;
  BEGIN
    INSERT INTO app_9e1318caf6_live_rooms(host_id, title) VALUES (low, 'gate-4');
    GET DIAGNOSTICS made = ROW_COUNT;
  EXCEPTION WHEN others THEN made := 0;
  END;
  ok := ok || format('4_vip_no_followers inserted=%s %s; ', made, CASE WHEN made = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- 5. expired VIP + few followers -> rejected
  UPDATE app_9e1318caf6_wallets SET vip_expires_at = now() - interval '1 day' WHERE user_id = low;
  blocked := false;
  BEGIN
    INSERT INTO app_9e1318caf6_live_rooms(host_id, title) VALUES (low, 'gate-5');
  EXCEPTION WHEN others THEN blocked := true;
  END;
  ok := ok || format('5_expired_vip blocked=%s %s; ', blocked, CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'ROLLBACK 044: %', ok;
END $$;
