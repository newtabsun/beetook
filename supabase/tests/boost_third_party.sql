-- 043 checks: any signed-in user can boost any visible video. The payer pays, the author gets the reach, progress and
-- alert; two payers on one video add up without double counting. Everything rolls back (ends with RAISE EXCEPTION).
CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u::text, true),
         set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;

DO $$
DECLARE
  o uuid; pa uuid; pb uuid; vs uuid[]; post uuid; priv uuid; draft uuid; c1 bigint; c2 bigint; c3 bigint;
  ok text := ''; r json; w0 bigint; w1 bigint; ow0 bigint; ow1 bigint; n int; n2 int; n3 int; b0 int; st1 text; st2 text;
  d1 int; d2 int; first_id uuid; rows_n int; dup_n int; i int; rejected boolean; fo boolean; un text; pbf boolean;
BEGIN
  SELECT w.user_id INTO o FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO pa FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id <> o ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO pb FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id NOT IN (o, pa) ORDER BY w.user_id LIMIT 1;
  SELECT array_agg(x.user_id) INTO vs FROM (
    SELECT w.user_id FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id
     WHERE w.user_id NOT IN (o, pa, pb) ORDER BY w.user_id LIMIT 12) x;

  UPDATE app_9e1318caf6_boost_campaigns SET status = 'expired', updated_at = now() WHERE status = 'active';
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 100000, earnings_balance = 0 WHERE user_id IN (pa, pb);
  INSERT INTO app_9e1318caf6_posts(user_id, kind, status, publish_at, privacy, caption, media_urls)
    VALUES (o, 'video', 'published', now() - interval '2 minutes', 'everyone', 'third-party-test', ARRAY['https://x/t.mp4']) RETURNING id INTO post;
  INSERT INTO app_9e1318caf6_posts(user_id, kind, status, publish_at, privacy, caption, media_urls)
    VALUES (o, 'video', 'published', now() - interval '2 minutes', 'only_me', 'private', ARRAY['https://x/p.mp4']) RETURNING id INTO priv;
  INSERT INTO app_9e1318caf6_posts(user_id, kind, status, publish_at, privacy, caption, media_urls)
    VALUES (o, 'video', 'draft', now() - interval '2 minutes', 'everyone', 'draft', ARRAY['https://x/d.mp4']) RETURNING id INTO draft;

  -- P1/P2. a third party boosts the author's video: payer pays exactly once, author's wallet untouched ----------
  PERFORM pg_temp.as_user(pa);
  SELECT purchased_balance + earnings_balance INTO w0 FROM app_9e1318caf6_wallets WHERE user_id = pa;
  SELECT purchased_balance + earnings_balance INTO ow0 FROM app_9e1318caf6_wallets WHERE user_id = o;
  SELECT count(*) INTO b0 FROM app_9e1318caf6_wallet_txns WHERE user_id = pa AND category = 'boost';
  r := app_9e1318caf6_boost_video(post, 'likes', 4);
  c1 := (r->>'campaign_id')::bigint; fo := (r->>'for_other')::boolean;
  SELECT purchased_balance + earnings_balance INTO w1 FROM app_9e1318caf6_wallets WHERE user_id = pa;
  SELECT purchased_balance + earnings_balance INTO ow1 FROM app_9e1318caf6_wallets WHERE user_id = o;
  SELECT count(*) INTO n FROM app_9e1318caf6_wallet_txns WHERE user_id = pa AND category = 'boost';
  SELECT count(*) INTO n2 FROM app_9e1318caf6_video_boosts WHERE user_id = pa AND post_id = post;
  ok := ok || format('P1_third_party_allowed charged=%s author_delta=%s for_other=%s %s; ', w0 - w1, ow1 - ow0, fo,
    CASE WHEN w0 - w1 = 50 AND ow1 = ow0 AND fo AND c1 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);
  ok := ok || format('P2_charged_once ledger_rows=%s boost_rows=%s %s; ', n - b0, n2,
    CASE WHEN n - b0 = 1 AND n2 = 1 THEN 'PASS' ELSE 'FAIL' END);
  SELECT c.user_id = pa AND c.owner_id = o INTO fo FROM app_9e1318caf6_boost_campaigns c WHERE c.id = c1;
  ok := ok || format('P2b_roles payer=pa owner=author %s; ', CASE WHEN fo THEN 'PASS' ELSE 'FAIL' END);

  -- P3. neither the payer nor the author can create reach for themselves ------------------------------------
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, pa), (post, o);
  SELECT delivered INTO n FROM app_9e1318caf6_boost_campaigns WHERE id = c1;
  ok := ok || format('P3_self_not_counted delivered=%s %s; ', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- P4. every other signed-in user sees it first -------------------------------------------------------------
  PERFORM pg_temp.as_user(vs[1]);
  SELECT f.id INTO first_id FROM app_9e1318caf6_feed_for_you(0, 8) f LIMIT 1;
  ok := ok || format('P4_pinned_for_viewer %s; ', CASE WHEN first_id = post THEN 'PASS' ELSE 'FAIL' END);

  -- P5. author sees progress (not paid by them); payer sees status (for another user's video) ---------------
  PERFORM pg_temp.as_user(o);
  SELECT b.paid_by_me, b.pct INTO pbf, n FROM app_9e1318caf6_my_boosts() b WHERE b.campaign_id = c1;
  PERFORM pg_temp.as_user(pa);
  SELECT b.for_other, b.owner_username INTO fo, un FROM app_9e1318caf6_my_paid_boosts() b WHERE b.campaign_id = c1;
  ok := ok || format('P5_roles_visible author_paid_by_me=%s payer_for_other=%s %s; ', pbf, fo,
    CASE WHEN pbf = false AND fo = true THEN 'PASS' ELSE 'FAIL' END);

  -- P6. a second payer on the same video: goals add up, nobody is counted twice ----------------------------
  PERFORM pg_temp.as_user(pb);
  r := app_9e1318caf6_boost_video(post, 'likes', 4);
  c2 := (r->>'campaign_id')::bigint;
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, vs[1]);
  DELETE FROM app_9e1318caf6_likes WHERE post_id = post AND user_id = vs[1];
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, vs[1]);           -- repeat: still one
  SELECT delivered INTO d1 FROM app_9e1318caf6_boost_campaigns WHERE id = c1;
  SELECT delivered INTO d2 FROM app_9e1318caf6_boost_campaigns WHERE id = c2;
  ok := ok || format('P6_oldest_first c1=%s c2=%s %s; ', d1, d2, CASE WHEN d1 = 1 AND d2 = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- P7. first goal completes: exactly one alert to the author (actor = payer) and one to the payer ----------
  FOR i IN 2..4 LOOP INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, vs[i]); END LOOP;
  SELECT status, delivered INTO st1, d1 FROM app_9e1318caf6_boost_campaigns WHERE id = c1;
  SELECT delivered INTO d2 FROM app_9e1318caf6_boost_campaigns WHERE id = c2;
  SELECT count(*) INTO n FROM app_9e1318caf6_notifications WHERE user_id = o AND kind = 'boost_done' AND ref_id = post::text AND actor_id = pa;
  SELECT count(*) INTO n2 FROM app_9e1318caf6_notifications WHERE user_id = pa AND kind = 'boost_done' AND ref_id = post::text;
  SELECT count(*) INTO n3 FROM app_9e1318caf6_notifications WHERE user_id = o AND kind = 'boost_done' AND ref_id = post::text AND actor_id = pb;
  ok := ok || format('P7_first_complete status=%s c1=%s c2=%s author_alerts=%s payer_alerts=%s other_payer_alerts=%s %s; ', st1, d1, d2, n, n2, n3,
    CASE WHEN st1 = 'completed' AND d1 = 4 AND d2 = 0 AND n = 1 AND n2 = 1 AND n3 = 0 THEN 'PASS' ELSE 'FAIL' END);
  ok := ok || format('P7b_no_second_alert re-add=%s %s; ', app_9e1318caf6_boost_reach_add(c1, vs[9]),
    CASE WHEN (SELECT count(*) FROM app_9e1318caf6_notifications WHERE user_id = o AND kind = 'boost_done' AND ref_id = post::text AND actor_id = pa) = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- P8. still pinned for a fresh viewer while the second boost runs ------------------------------------------
  PERFORM pg_temp.as_user(vs[6]);
  SELECT f.id INTO first_id FROM app_9e1318caf6_feed_for_you(0, 8) f LIMIT 1;
  ok := ok || format('P8_second_still_pinned %s; ', CASE WHEN first_id = post THEN 'PASS' ELSE 'FAIL' END);

  -- P9. second goal completes with the next four distinct viewers; totals equal distinct people ---------------
  FOR i IN 5..8 LOOP INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, vs[i]); END LOOP;
  SELECT status, delivered INTO st2, d2 FROM app_9e1318caf6_boost_campaigns WHERE id = c2;
  SELECT count(*) INTO n FROM app_9e1318caf6_boost_reach WHERE campaign_id IN (c1, c2);
  SELECT count(*) INTO n2 FROM app_9e1318caf6_notifications WHERE user_id = o AND kind = 'boost_done' AND ref_id = post::text AND actor_id = pb;
  ok := ok || format('P9_second_complete status=%s c2=%s reach_rows=%s alerts=%s %s; ', st2, d2, n, n2,
    CASE WHEN st2 = 'completed' AND d2 = 4 AND n = 8 AND n2 = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- P10. all done: unpinned, feed page full and duplicate-free, extra likes change nothing -------------------
  INSERT INTO app_9e1318caf6_likes(post_id, user_id) VALUES (post, vs[10]);
  SELECT count(*) INTO n FROM app_9e1318caf6_boost_campaigns WHERE post_id = post AND status = 'active';
  SELECT sum(delivered) INTO n2 FROM app_9e1318caf6_boost_campaigns WHERE post_id = post;
  PERFORM pg_temp.as_user(vs[11]);
  SELECT count(*), count(*) - count(DISTINCT f.id) INTO rows_n, dup_n FROM app_9e1318caf6_feed_for_you(0, 8) f;
  ok := ok || format('P10_equal_reach_after active=%s total_delivered=%s page=%s dups=%s %s; ', n, n2, rows_n, dup_n,
    CASE WHEN n = 0 AND n2 = 8 AND rows_n > 0 AND dup_n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- P11. a profile-views boost bought on someone else's video counts that author's profile opens ------------
  PERFORM pg_temp.as_user(pa);
  r := app_9e1318caf6_boost_video(post, 'profileViews', 20);
  c3 := (r->>'campaign_id')::bigint;
  PERFORM pg_temp.as_user(vs[12]);
  PERFORM app_9e1318caf6_record_profile_view(o);
  PERFORM app_9e1318caf6_record_profile_view(o);
  SELECT delivered INTO n FROM app_9e1318caf6_boost_campaigns WHERE id = c3;
  ok := ok || format('P11_profile_views_for_author delivered=%s %s; ', n, CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- P12. what still cannot be boosted: private video of someone else, draft, and an empty wallet -------------
  PERFORM pg_temp.as_user(pa);
  BEGIN PERFORM app_9e1318caf6_boost_video(priv, 'views', 500); rejected := false; EXCEPTION WHEN OTHERS THEN rejected := true; END;
  ok := ok || format('P12a_private_rejected %s; ', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END);
  BEGIN PERFORM app_9e1318caf6_boost_video(draft, 'views', 500); rejected := false; EXCEPTION WHEN OTHERS THEN rejected := true; END;
  ok := ok || format('P12b_draft_rejected %s; ', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END);
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 0, earnings_balance = 0 WHERE user_id = pa;
  SELECT count(*) INTO n FROM app_9e1318caf6_boost_campaigns WHERE user_id = pa;
  BEGIN PERFORM app_9e1318caf6_boost_video(post, 'views', 500); rejected := false; EXCEPTION WHEN OTHERS THEN rejected := true; END;
  SELECT count(*) INTO n2 FROM app_9e1318caf6_boost_campaigns WHERE user_id = pa;
  ok := ok || format('P12c_no_coins_rejected campaigns_before=%s after=%s %s; ', n, n2, CASE WHEN rejected AND n = n2 THEN 'PASS' ELSE 'FAIL' END);

  -- P13. privileges -----------------------------------------------------------------------------------------
  ok := ok || format('P13_privileges anon_boost=%s auth_boost=%s anon_paid=%s auth_paid=%s auth_write_campaigns=%s %s; ',
    has_function_privilege('anon', 'public.app_9e1318caf6_boost_video(uuid, text, integer)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.app_9e1318caf6_boost_video(uuid, text, integer)', 'EXECUTE'),
    has_function_privilege('anon', 'public.app_9e1318caf6_my_paid_boosts()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.app_9e1318caf6_my_paid_boosts()', 'EXECUTE'),
    has_table_privilege('authenticated', 'public.app_9e1318caf6_boost_campaigns', 'INSERT'),
    CASE WHEN NOT has_function_privilege('anon', 'public.app_9e1318caf6_boost_video(uuid, text, integer)', 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.app_9e1318caf6_boost_video(uuid, text, integer)', 'EXECUTE')
           AND NOT has_function_privilege('anon', 'public.app_9e1318caf6_my_paid_boosts()', 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.app_9e1318caf6_my_paid_boosts()', 'EXECUTE')
           AND NOT has_table_privilege('authenticated', 'public.app_9e1318caf6_boost_campaigns', 'INSERT')
         THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'BOOST_THIRD_PARTY_REPORT %', ok;
END $$;
