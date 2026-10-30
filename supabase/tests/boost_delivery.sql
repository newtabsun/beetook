-- 042 checks: a boosted video is pinned for everybody until its goal is met, each viewer is counted once,
-- 100 % is announced exactly once, and the pin disappears afterwards. Everything rolls back.
DO $$
DECLARE
  owner uuid; v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid; v6 uuid;
  post uuid; cid bigint; cid2 bigint; ok text := ''; n int; n2 int; del int; rem int; pct int; st text;
  coins0 bigint; coins1 bigint; first_id uuid; rows_n int; dup_n int; notif_n int; flipped boolean;
BEGIN
  -- fixtures ---------------------------------------------------------------------------------------------
  SELECT w.user_id INTO owner FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO v1 FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id <> owner ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO v2 FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id NOT IN (owner, v1) ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO v3 FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id NOT IN (owner, v1, v2) ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO v4 FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id NOT IN (owner, v1, v2, v3) ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO v5 FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id NOT IN (owner, v1, v2, v3, v4) ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO v6 FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id NOT IN (owner, v1, v2, v3, v4, v5) ORDER BY w.user_id LIMIT 1;

  -- campaign tests need a clean pin board (nothing from real purchases may interfere with the ordering)
  UPDATE app_9e1318caf6_boost_campaigns SET status = 'expired', updated_at = now() WHERE status = 'active';
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 100000 WHERE user_id = owner;

  INSERT INTO app_9e1318caf6_posts(user_id, kind, status, publish_at, privacy, caption, media_urls)
    VALUES (owner, 'video', 'published', now() - interval '2 minutes', 'everyone', 'boost-test', ARRAY['https://x/t.mp4'])
    RETURNING id INTO post;

  -- T1. buying a boost opens a campaign with exactly the paid quantity as goal ----------------------------
  PERFORM set_config('request.jwt.claim.sub', owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  SELECT purchased_balance INTO coins0 FROM app_9e1318caf6_wallets WHERE user_id = owner;
  PERFORM app_9e1318caf6_boost_video(post, 'likes', 4);
  SELECT purchased_balance, w.coins INTO coins1, coins0 FROM app_9e1318caf6_wallets w WHERE w.user_id = owner;
  SELECT c.id, c.goal, c.status INTO cid, n, st FROM app_9e1318caf6_boost_campaigns c
   WHERE c.post_id = post ORDER BY c.id DESC LIMIT 1;
  ok := ok || format('T1_purchase_opens_campaign goal=%s status=%s campaign=%s %s; ', n, st, cid IS NOT NULL,
    CASE WHEN n = 4 AND st = 'active' AND cid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- T2. pinned first for a viewer who has not been reached yet -------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v1::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v1, 'role', 'authenticated')::text, true);
  SELECT f.id INTO first_id FROM app_9e1318caf6_feed_for_you(0, 8) f LIMIT 1;
  ok := ok || format('T2_pinned_first first=%s %s; ', first_id = post, CASE WHEN first_id = post THEN 'PASS' ELSE 'FAIL' END);

  -- T3. the same viewer never counts twice (like, unlike, like again) -----------------------------------
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, v1);
  SELECT delivered INTO n FROM app_9e1318caf6_boost_campaigns WHERE id = cid;
  DELETE FROM app_9e1318caf6_likes WHERE post_id = post AND user_id = v1;
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, v1);
  SELECT delivered INTO n2 FROM app_9e1318caf6_boost_campaigns WHERE id = cid;
  ok := ok || format('T3_counted_once first=%s repeat=%s %s; ', n, n2, CASE WHEN n = 1 AND n2 = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- T4. two comments from one viewer still count once (they are rows, not a primary key) -----------------
  INSERT INTO app_9e1318caf6_comments(post_id, user_id, body) VALUES (post, v2, 'one'), (post, v2, 'two');
  SELECT delivered INTO n2 FROM app_9e1318caf6_boost_campaigns WHERE id = cid;
  ok := ok || format('T4_two_rows_one_viewer delivered=%s %s; ', n2, CASE WHEN n2 = 2 THEN 'PASS' ELSE 'FAIL' END);

  -- T5. the owner's own action never counts --------------------------------------------------------------
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, owner);
  SELECT delivered INTO n FROM app_9e1318caf6_boost_campaigns WHERE id = cid;
  ok := ok || format('T5_owner_not_counted delivered=%s %s; ', n, CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END);

  -- T6. owner sees progress: delivered / remaining / pct ------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  SELECT b.delivered, b.remaining, b.pct INTO del, rem, pct FROM app_9e1318caf6_my_boosts() b WHERE b.campaign_id = cid;
  ok := ok || format('T6_progress delivered=%s remaining=%s pct=%s %s; ', del, rem, pct,
    CASE WHEN del = 2 AND rem = 2 AND pct = 50 THEN 'PASS' ELSE 'FAIL' END);

  -- T7. reaching the goal completes it, alerts exactly once, and cannot double-fire ----------------------
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, v3), (post, v4);
  SELECT status, delivered INTO st, n FROM app_9e1318caf6_boost_campaigns WHERE id = cid;
  SELECT count(*) INTO notif_n FROM app_9e1318caf6_notifications WHERE user_id = owner AND kind = 'boost_done' AND ref_id = post::text;
  SELECT app_9e1318caf6_boost_reach_add(cid, v5) INTO flipped;
  SELECT count(*) INTO n2 FROM app_9e1318caf6_notifications WHERE user_id = owner AND kind = 'boost_done' AND ref_id = post::text;
  ok := ok || format('T7_complete status=%s delivered=%s alerts=%s re-add=%s alerts_after=%s %s; ', st, n, notif_n, flipped, n2,
    CASE WHEN st = 'completed' AND n = 4 AND notif_n = 1 AND flipped = false AND n2 = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- T8. after completion the video is no longer pinned: no active campaign, fresh viewer has no reach row,
  --     and the feed page is still full and duplicate-free (the video keeps normal reach).
  SELECT count(*) INTO n FROM app_9e1318caf6_boost_campaigns WHERE id = cid AND status = 'active';
  SELECT count(*) INTO n2 FROM app_9e1318caf6_boost_reach WHERE campaign_id = cid AND user_id = v5;
  PERFORM set_config('request.jwt.claim.sub', v5::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v5, 'role', 'authenticated')::text, true);
  SELECT count(*), count(*) - count(DISTINCT f.id) INTO rows_n, dup_n FROM app_9e1318caf6_feed_for_you(0, 8) f;
  ok := ok || format('T8_unpinned active=%s reach=%s page=%s dups=%s %s; ', n, n2, rows_n, dup_n,
    CASE WHEN n = 0 AND n2 = 0 AND dup_n = 0 AND rows_n > 0 THEN 'PASS' ELSE 'FAIL' END);

  -- T9. profile views are recorded server-side and feed a profileViews campaign -------------------------
  PERFORM set_config('request.jwt.claim.sub', owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  PERFORM app_9e1318caf6_boost_video(NULL, 'profileViews', 20);
  SELECT c.id INTO cid2 FROM app_9e1318caf6_boost_campaigns c WHERE c.user_id = owner AND c.kind = 'profileViews' ORDER BY c.id DESC LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v6::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v6, 'role', 'authenticated')::text, true);
  PERFORM app_9e1318caf6_record_profile_view(owner);
  PERFORM app_9e1318caf6_record_profile_view(owner);        -- second open in the same session must not count twice
  SELECT delivered INTO n FROM app_9e1318caf6_boost_campaigns WHERE id = cid2;
  SELECT count(*) INTO n2 FROM app_9e1318caf6_profile_views WHERE profile_id = owner AND viewer_id = v6;
  ok := ok || format('T9_profile_view_campaign delivered=%s rows=%s %s; ', n, n2,
    CASE WHEN n = 1 AND n2 = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- T10. a stale campaign stops pinning (expiry safety net) ---------------------------------------------
  UPDATE app_9e1318caf6_boost_campaigns SET expires_at = now() - interval '1 minute' WHERE id = cid2;
  PERFORM app_9e1318caf6_boost_timers();
  SELECT status INTO st FROM app_9e1318caf6_boost_campaigns WHERE id = cid2;
  ok := ok || format('T10_expiry status=%s %s; ', st, CASE WHEN st = 'expired' THEN 'PASS' ELSE 'FAIL' END);

  -- T11. only the owner's own video can be boosted ------------------------------------------------------
  -- T11. 043: anybody may boost somebody else's visible video (the old owner-only rule is gone) ------------
  BEGIN
    UPDATE app_9e1318caf6_wallets SET purchased_balance = 100000 WHERE user_id = v1;
    PERFORM set_config('request.jwt.claim.sub', v1::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v1, 'role', 'authenticated')::text, true);
    PERFORM app_9e1318caf6_boost_video(post, 'views', 500);
    n := 1;
  EXCEPTION WHEN OTHERS THEN n := 0;
  END;
  ok := ok || format('T11_third_party_allowed %s; ', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- T12. privileges: guests cannot touch the boost internals, clients cannot write campaign state --------
  ok := ok || format('T12_privileges anon_my_boosts=%s auth_my_boosts=%s anon_reach_add=%s auth_insert_campaign=%s %s; ',
    has_function_privilege('anon', 'public.app_9e1318caf6_my_boosts()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.app_9e1318caf6_my_boosts()', 'EXECUTE'),
    has_function_privilege('anon', 'public.app_9e1318caf6_boost_reach_add(bigint, uuid)', 'EXECUTE'),
    has_table_privilege('authenticated', 'public.app_9e1318caf6_boost_campaigns', 'INSERT'),
    CASE WHEN NOT has_function_privilege('anon', 'public.app_9e1318caf6_my_boosts()', 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.app_9e1318caf6_my_boosts()', 'EXECUTE')
           AND NOT has_function_privilege('anon', 'public.app_9e1318caf6_boost_reach_add(bigint, uuid)', 'EXECUTE')
           AND NOT has_table_privilege('authenticated', 'public.app_9e1318caf6_boost_campaigns', 'INSERT')
         THEN 'PASS' ELSE 'FAIL' END);

  -- T13. feed still works for a guest (anonymous callers keep their feed) -------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SELECT count(*) INTO n FROM app_9e1318caf6_feed_for_you(0, 8) f;
  ok := ok || format('T13_guest_feed rows=%s %s; ', n, CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'BOOST_DELIVERY_REPORT %', ok;
END $$;
