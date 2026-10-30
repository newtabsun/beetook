-- Revenue-share checks for every coin flow between users. Everything rolls back (ends with RAISE EXCEPTION).
DO $$
DECLARE
  a uuid; b uuid; c uuid; ok text := ''; g uuid; room uuid; sess uuid; s2 uuid;
  pa0 bigint; ea0 bigint; eb0 bigint; pb0 bigint; ec0 bigint; pc0 bigint; eb1 bigint; pb1 bigint; pc1 bigint; ec1 bigint;
  fee bigint; tot0 bigint; tot1 bigint; rev0 bigint; rev1 bigint; n int;
BEGIN
  SELECT w.user_id INTO a FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO b FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id <> a ORDER BY w.user_id LIMIT 1;
  SELECT w.user_id INTO c FROM app_9e1318caf6_wallets w JOIN app_9e1318caf6_profiles p ON p.id = w.user_id WHERE w.user_id NOT IN (a, b) ORDER BY w.user_id LIMIT 1;
  UPDATE app_9e1318caf6_wallets SET purchased_balance = 100000, earnings_balance = 0, vip_expires_at = NULL WHERE user_id IN (a, b, c);
  SELECT sum(purchased_balance + earnings_balance) INTO tot0 FROM app_9e1318caf6_wallets WHERE user_id IN (a, b, c);
  SELECT coalesce(sum(platform_fee), 0) INTO rev0 FROM app_9e1318caf6_platform_revenue;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);

  -- 1. group joining fee 33 (rounding): owner gets floor(33*0.7)=23, platform 10
  INSERT INTO app_9e1318caf6_groups(owner_id, name, fee_join, fee_text, fee_photo, fee_voice) VALUES (b, 'rs-test', 33, 7, 3, 5) RETURNING id INTO g;
  PERFORM app_9e1318caf6_grp_join(g);
  PERFORM app_9e1318caf6_grp_join(g);
  SELECT earnings_balance INTO eb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT platform_fee INTO fee FROM app_9e1318caf6_platform_revenue WHERE ref = 'group:' || g;
  ok := ok || format('1_group_join owner=%s fee=%s %s; ', eb1, fee, CASE WHEN eb1 = 23 AND fee = 10 THEN 'PASS' ELSE 'FAIL' END);

  -- 2. paid group messages: text 7 -> 4 / 3, photo 3 -> 2 / 1, voice 5 -> 3 / 2
  PERFORM app_9e1318caf6_grp_send(g, 'text', 'hi', NULL);
  PERFORM app_9e1318caf6_grp_send(g, 'photo', '', 'x.jpg');
  PERFORM app_9e1318caf6_grp_send(g, 'voice', '', 'x.m4a');
  SELECT earnings_balance INTO eb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT sum(platform_fee) INTO fee FROM app_9e1318caf6_platform_revenue WHERE ref = 'group_msg:' || g;
  ok := ok || format('2_group_msg owner_delta=%s fee=%s %s; ', eb1 - 23, fee, CASE WHEN eb1 - 23 = 9 AND fee = 6 THEN 'PASS' ELSE 'FAIL' END);

  -- 3. live gift + 4. feed gift (rose = 10 coins x 3 = 30 -> 21 / 9 each)
  INSERT INTO app_9e1318caf6_live_rooms(host_id, title, join_fee) VALUES (b, 'rs-live', 15) RETURNING id INTO room;
  SELECT earnings_balance INTO eb0 FROM app_9e1318caf6_wallets WHERE user_id = b;
  PERFORM app_9e1318caf6_send_gift(b, 'rose', 3, room, NULL);
  SELECT earnings_balance INTO eb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  ok := ok || format('3_live_gift recv=%s %s; ', eb1 - eb0, CASE WHEN eb1 - eb0 = floor(app_9e1318caf6_gift_price('rose') * 3 * 0.7) THEN 'PASS' ELSE 'FAIL' END);
  eb0 := eb1;
  PERFORM app_9e1318caf6_send_gift(b, 'rose', 1, NULL, NULL);
  SELECT earnings_balance INTO eb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  ok := ok || format('4_feed_gift recv=%s %s; ', eb1 - eb0, CASE WHEN eb1 - eb0 = floor(app_9e1318caf6_gift_price('rose') * 0.7) THEN 'PASS' ELSE 'FAIL' END);

  -- 5. live joining fee 15 (rounding): host floor(10.5)=10, platform 5, charged once
  eb0 := eb1;
  PERFORM app_9e1318caf6_live_join(room, true);
  PERFORM app_9e1318caf6_live_join(room, true);
  SELECT earnings_balance INTO eb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT count(*) INTO n FROM app_9e1318caf6_platform_revenue WHERE ref = 'live:' || room;
  ok := ok || format('5_live_join host=%s rows=%s %s; ', eb1 - eb0, n, CASE WHEN eb1 - eb0 = 10 AND n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- 6. game support (viewer a): GAS 10 -> 2, BRAKE 30 -> 6 (to the supported player), direct support 13 -> 2
  INSERT INTO app_9e1318caf6_game_sessions(game, host_id, opponent_id, host_room, stake, duration_s, status, started_at, ends_at)
    VALUES ('car-racing', b, c, room::text, 0, 600, 'active', now() - interval '1 minute', now() + interval '1 hour') RETURNING id INTO sess;
  SELECT earnings_balance INTO eb0 FROM app_9e1318caf6_wallets WHERE user_id = b;
  PERFORM app_9e1318caf6_game_action(gen_random_uuid(), sess, 0, 'gas');      -- supports b
  PERFORM app_9e1318caf6_game_action(gen_random_uuid(), sess, 1, 'brake');    -- brakes c's car -> supports b
  PERFORM app_9e1318caf6_game_support(sess, 0, 13);
  SELECT earnings_balance INTO eb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT sum(platform_fee), sum(gross) INTO fee, n FROM app_9e1318caf6_platform_revenue WHERE kind = 'game_support' AND payer_id = a;
  ok := ok || format('6_game_support player=%s platform=%s gross=%s %s; ', eb1 - eb0, fee, n,
    CASE WHEN eb1 - eb0 = 10 AND fee = 43 AND n = 53 THEN 'PASS' ELSE 'FAIL' END);

  -- 7. wager: both staked 500 -> winner gets the whole pot 1000 as ONE Earnings row (+1000), platform 0; second payout ignored
  UPDATE app_9e1318caf6_game_sessions SET stake = 500 WHERE id = sess;
  PERFORM app_9e1318caf6_spend(b, 500, 'game', 'Game stake', 'car-racing');
  PERFORM app_9e1318caf6_spend(c, 500, 'game', 'Game stake', 'car-racing');
  SELECT purchased_balance, earnings_balance INTO pb0, eb0 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT purchased_balance, earnings_balance INTO pc0, ec0 FROM app_9e1318caf6_wallets WHERE user_id = c;
  PERFORM app_9e1318caf6_game_payout(sess, b, 'win');
  PERFORM app_9e1318caf6_game_payout(sess, b, 'win');
  SELECT purchased_balance, earnings_balance INTO pb1, eb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT purchased_balance, earnings_balance INTO pc1, ec1 FROM app_9e1318caf6_wallets WHERE user_id = c;
  SELECT platform_fee INTO fee FROM app_9e1318caf6_platform_revenue WHERE ref = 'game:' || sess;
  ok := ok || format('7_wager winner_total=%s loser_delta=%s platform=%s %s; ', (pb1 - pb0) + (eb1 - eb0), (pc1 - pc0) + (ec1 - ec0), fee,
    CASE WHEN pb1 = pb0 AND eb1 - eb0 = 1000 AND pc1 = pc0 AND ec1 = ec0 AND fee = 0
          AND (SELECT count(*) FROM app_9e1318caf6_wallet_txns WHERE user_id = b AND category = 'game' AND title = 'Game won' AND amount = 1000 AND earnings_delta = 1000) = 1
          AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns WHERE user_id = b AND title = 'Game stake returned')
         THEN 'PASS' ELSE 'FAIL' END);

  -- 8. wager draw -> each stake back to Purchased
  INSERT INTO app_9e1318caf6_game_sessions(game, host_id, opponent_id, host_room, stake, duration_s, status, started_at, ends_at)
    VALUES ('car-racing', b, c, room::text, 500, 600, 'active', now() - interval '1 minute', now() + interval '1 hour') RETURNING id INTO s2;
  PERFORM app_9e1318caf6_spend(b, 500, 'game', 'Game stake', 'car-racing');
  PERFORM app_9e1318caf6_spend(c, 500, 'game', 'Game stake', 'car-racing');
  SELECT purchased_balance INTO pb0 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT purchased_balance INTO pc0 FROM app_9e1318caf6_wallets WHERE user_id = c;
  PERFORM app_9e1318caf6_game_payout(s2, NULL, 'draw');
  PERFORM app_9e1318caf6_game_payout(s2, NULL, 'draw');
  SELECT purchased_balance INTO pb1 FROM app_9e1318caf6_wallets WHERE user_id = b;
  SELECT purchased_balance INTO pc1 FROM app_9e1318caf6_wallets WHERE user_id = c;
  ok := ok || format('8_draw_refund b=%s c=%s %s; ', pb1 - pb0, pc1 - pc0, CASE WHEN pb1 - pb0 = 500 AND pc1 - pc0 = 500 THEN 'PASS' ELSE 'FAIL' END);

  -- 9. boost + VIP: 100% platform, nobody earns
  SELECT sum(earnings_balance) INTO ec0 FROM app_9e1318caf6_wallets WHERE user_id IN (b, c);
  PERFORM app_9e1318caf6_vip_subscribe();
  PERFORM app_9e1318caf6_boost_video(NULL, 'profileViews', (SELECT amounts[1] FROM app_9e1318caf6_boost_ladder('profileViews')));
  SELECT sum(earnings_balance) INTO ec1 FROM app_9e1318caf6_wallets WHERE user_id IN (b, c);
  SELECT count(*) FILTER (WHERE platform_fee = gross AND recipient_share = 0), count(*) INTO n, fee
    FROM app_9e1318caf6_platform_revenue WHERE payer_id = a AND kind IN ('vip', 'boost');
  ok := ok || format('9_boost_vip rows=%s full_platform=%s others_earn=%s %s; ', fee, n, ec1 - ec0,
    CASE WHEN fee = 2 AND n = 2 AND ec1 = ec0 THEN 'PASS' ELSE 'FAIL' END);

  -- 10. conservation: coins lost by users = platform fees collected (no coin created or lost)
  SELECT sum(purchased_balance + earnings_balance) INTO tot1 FROM app_9e1318caf6_wallets WHERE user_id IN (a, b, c);
  SELECT coalesce(sum(platform_fee), 0) INTO rev1 FROM app_9e1318caf6_platform_revenue;
  ok := ok || format('10_conservation users_lost=%s platform_got=%s %s; ', tot0 - tot1, rev1 - rev0, CASE WHEN tot0 - tot1 = rev1 - rev0 THEN 'PASS' ELSE 'FAIL' END);

  -- 11. ledger rows carry gross / platform / recipient and add up
  SELECT count(*) INTO n FROM app_9e1318caf6_wallet_txns WHERE user_id = b AND gross IS NOT NULL AND gross <> platform_fee + recipient_share;
  SELECT count(*) INTO fee FROM app_9e1318caf6_wallet_txns WHERE user_id = b AND gross IS NOT NULL AND created_at >= now();
  ok := ok || format('11_ledger_split rows=%s bad=%s %s; ', fee, n, CASE WHEN n = 0 AND fee > 0 THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'REVENUE_TEST_REPORT %', ok;
END $$;
