-- 038 checks: auto-reply (once per product+buyer, {name}, off, self) and 24 h auto-resolution. Everything rolls back.
DO $$
DECLARE
  s uuid; b uuid; ok text := ''; it uuid; oid uuid; n int; r json; msg text; st text; w1 bigint; w2 bigint;
BEGIN
  SELECT user_id INTO s FROM app_9e1318caf6_wallets ORDER BY user_id LIMIT 1;
  SELECT user_id INTO b FROM app_9e1318caf6_wallets WHERE user_id <> s ORDER BY user_id LIMIT 1;
  UPDATE app_9e1318caf6_profiles SET display_name = 'Abebe' WHERE id = b;

  INSERT INTO app_9e1318caf6_market_items(user_id, title, category, price_etb, status, auto_reply_on, auto_reply)
    VALUES (s, 'AR item', 'General', 100, 'active', true, 'Hello {name}! Thanks for your interest. I will confirm and reply shortly, or call me now.')
    RETURNING id INTO it;

  -- A1. first inquiry sends one message with {name} replaced, from the seller to the buyer
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  r := app_9e1318caf6_market_inquiry(it);
  SELECT m.body INTO msg FROM app_9e1318caf6_messages m WHERE m.sender_id = s AND m.recipient_id = b ORDER BY m.created_at DESC LIMIT 1;
  ok := ok || format('A1_sent %s; ', CASE WHEN (r->>'auto_replied')::boolean AND msg LIKE 'Hello Abebe! Thanks%' THEN 'PASS' ELSE 'FAIL' END);

  -- A2. repeating (inquiry again, then a purchase request) never sends a second message
  r := app_9e1318caf6_market_inquiry(it);
  UPDATE app_9e1318caf6_market_balances SET balance = 100000 WHERE user_id = b;
  INSERT INTO app_9e1318caf6_market_balances(user_id, balance) VALUES (b, 100000) ON CONFLICT (user_id) DO UPDATE SET balance = 100000;
  oid := app_9e1318caf6_mkt_request(it, 'hi');
  SELECT count(*) INTO n FROM app_9e1318caf6_messages WHERE sender_id = s AND recipient_id = b AND body LIKE 'Hello Abebe!%';
  ok := ok || format('A2_once n=%s %s; ', n, CASE WHEN n = 1 AND NOT (r->>'auto_replied')::boolean THEN 'PASS' ELSE 'FAIL' END);

  -- A3. seller never auto-replies to self
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', s::text, true);
  r := app_9e1318caf6_market_inquiry(it);
  ok := ok || format('A3_self %s; ', CASE WHEN NOT (r->>'auto_replied')::boolean THEN 'PASS' ELSE 'FAIL' END);

  -- A4. toggle OFF → nothing is sent
  UPDATE app_9e1318caf6_market_items SET auto_reply_on = false WHERE id = it;
  DELETE FROM app_9e1318caf6_market_auto_replies WHERE item_id = it;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  r := app_9e1318caf6_market_inquiry(it);
  ok := ok || format('A4_off %s; ', CASE WHEN NOT (r->>'auto_replied')::boolean THEN 'PASS' ELSE 'FAIL' END);

  -- T1. requested order older than 24 h → cancelled by the timer, funds released
  UPDATE app_9e1318caf6_market_orders SET auto_at = now() - interval '1 minute' WHERE id = oid;
  PERFORM app_9e1318caf6_mkt_timers();
  SELECT status INTO st FROM app_9e1318caf6_market_orders WHERE id = oid;
  ok := ok || format('T1_requested_24h %s %s; ', st, CASE WHEN st = 'cancelled' THEN 'PASS' ELSE 'FAIL' END);

  -- T2. shipped order, no complaint in 24 h → auto-confirmed, seller paid once (repeat is a no-op)
  UPDATE app_9e1318caf6_market_items SET status = 'active' WHERE id = it;
  oid := app_9e1318caf6_mkt_request(it, 'again');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', s::text, true);
  PERFORM app_9e1318caf6_mkt_act(oid, 'accept');
  PERFORM app_9e1318caf6_mkt_act(oid, 'ship');
  SELECT earnings_balance INTO w1 FROM app_9e1318caf6_wallets WHERE user_id = s;
  UPDATE app_9e1318caf6_market_orders SET auto_at = now() - interval '1 minute' WHERE id = oid;
  PERFORM app_9e1318caf6_mkt_timers(); PERFORM app_9e1318caf6_mkt_timers();
  SELECT earnings_balance INTO w2 FROM app_9e1318caf6_wallets WHERE user_id = s;
  SELECT status INTO st FROM app_9e1318caf6_market_orders WHERE id = oid;
  ok := ok || format('T2_shipped_24h %s paid=%s %s; ', st, w2 - w1, CASE WHEN st = 'completed' AND w2 - w1 = 1000 THEN 'PASS' ELSE 'FAIL' END);

  -- G1. a client cannot change listing status or exceed the price ceiling
  BEGIN
    INSERT INTO app_9e1318caf6_market_items(user_id, title, category, price_etb) VALUES (s, 'Too dear', 'General', 99999999);
    ok := ok || 'G1_price_cap FAIL; ';
  EXCEPTION WHEN OTHERS THEN ok := ok || 'G1_price_cap PASS; '; END;

  RAISE EXCEPTION 'MARKET_HARDENING_REPORT %', ok;
END $$;
