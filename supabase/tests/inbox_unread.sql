-- Inbox checks: unread counts, ordering, mark-all-read (one call, idempotent, never touches another user), guest denied.
-- Everything rolls back (ends with RAISE EXCEPTION); read the PASS/FAIL list in the error message.
-- Note: inserting a message fires a trigger that also writes a 'message' alert, so messages are inserted FIRST
-- and the alerts are then reset to a known state.
DO $$
DECLARE
  a uuid; b uuid; ok text := ''; c json; r json;
  n3 text; first_id text; b_unread int; b_msgs int;
BEGIN
  SELECT id INTO a FROM app_9e1318caf6_profiles ORDER BY id LIMIT 1;
  SELECT id INTO b FROM app_9e1318caf6_profiles WHERE id <> a ORDER BY id LIMIT 1;
  UPDATE app_9e1318caf6_messages SET read = true WHERE recipient_id IN (a, b);
  INSERT INTO app_9e1318caf6_messages(sender_id, recipient_id, body) VALUES (b, a, 'm1'), (b, a, 'm2'), (a, b, 'm3');
  DELETE FROM app_9e1318caf6_notifications WHERE user_id IN (a, b);

  -- a: 3 real alerts (old, mid, new) + 1 'message' alert (must NOT be counted); b: 2 alerts
  INSERT INTO app_9e1318caf6_notifications(user_id, actor_id, kind, text, created_at) VALUES (a, b, 'follow', 'old', now() - interval '2 hours');
  INSERT INTO app_9e1318caf6_notifications(user_id, actor_id, kind, text, created_at) VALUES (a, b, 'like', 'mid', now() - interval '1 hour');
  INSERT INTO app_9e1318caf6_notifications(user_id, actor_id, kind, text, created_at) VALUES (a, b, 'comment', 'new', now()) RETURNING id::text INTO n3;
  INSERT INTO app_9e1318caf6_notifications(user_id, actor_id, kind, text) VALUES (a, b, 'message', 'sent you a message');
  INSERT INTO app_9e1318caf6_notifications(user_id, actor_id, kind, text) VALUES (b, a, 'follow', 'x'), (b, a, 'like', 'y');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;

  c := app_9e1318caf6_unread_counts();
  ok := ok || format('1_counts alerts=%s messages=%s %s; ', c->>'alerts', c->>'messages',
    CASE WHEN (c->>'alerts')::int = 3 AND (c->>'messages')::int = 2 THEN 'PASS' ELSE 'FAIL' END);

  SELECT id::text INTO first_id FROM app_9e1318caf6_notifications WHERE user_id = a AND kind <> 'message' ORDER BY created_at DESC, id DESC LIMIT 1;
  ok := ok || format('2_newest_first %s; ', CASE WHEN first_id = n3 THEN 'PASS' ELSE 'FAIL' END);

  r := app_9e1318caf6_mark_all_read();
  c := app_9e1318caf6_unread_counts();
  ok := ok || format('3_mark_all changed=%s/%s now=%s/%s %s; ', r->>'alerts', r->>'messages', c->>'alerts', c->>'messages',
    CASE WHEN (r->>'alerts')::int = 4 AND (r->>'messages')::int = 2 AND (c->>'alerts')::int = 0 AND (c->>'messages')::int = 0 THEN 'PASS' ELSE 'FAIL' END);

  r := app_9e1318caf6_mark_all_read();
  ok := ok || format('4_idempotent %s; ', CASE WHEN (r->>'alerts')::int = 0 AND (r->>'messages')::int = 0 THEN 'PASS' ELSE 'FAIL' END);

  RESET ROLE;
  SELECT count(*) INTO b_unread FROM app_9e1318caf6_notifications WHERE user_id = b AND read = false;
  SELECT count(*) INTO b_msgs FROM app_9e1318caf6_messages WHERE recipient_id = b AND read = false;
  ok := ok || format('5_other_user alerts=%s msgs=%s %s; ', b_unread, b_msgs, CASE WHEN b_unread = 2 AND b_msgs = 1 THEN 'PASS' ELSE 'FAIL' END);

  SET LOCAL ROLE anon;
  BEGIN PERFORM app_9e1318caf6_unread_counts(); ok := ok || '6_anon_denied FAIL; ';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok || '6_anon_denied PASS; '; END;
  RESET ROLE;

  RAISE EXCEPTION 'INBOX_RESULT: %', ok;
END $$;
