-- 037 · Inbox: cheap unread counters, one-call "mark all read", stable newest-first paging, optional alert targets.
-- Idempotent and non-destructive: no rows are deleted or rewritten. RLS ownership is untouched (every function
-- runs as the caller, SECURITY INVOKER, and filters by auth.uid()).
BEGIN;

-- 1. Optional target of an alert (what to open when it is tapped). Older rows keep NULL and fall back to the actor's profile.
ALTER TABLE IF EXISTS public.app_9e1318caf6_notifications
  ADD COLUMN IF NOT EXISTS ref_type text,
  ADD COLUMN IF NOT EXISTS ref_id text;

-- 2. Indexes that match the three hot queries:
--    list/paging (user, created_at DESC, id DESC), unread alerts (partial), unread messages (partial).
CREATE INDEX IF NOT EXISTS app_9e1318caf6_notif_feed_idx
  ON public.app_9e1318caf6_notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_notif_unread_idx
  ON public.app_9e1318caf6_notifications (user_id, created_at DESC) WHERE read = false;
CREATE INDEX IF NOT EXISTS app_9e1318caf6_msg_unread_idx
  ON public.app_9e1318caf6_messages (recipient_id, created_at DESC) WHERE read = false;

-- 3. Unread counters, capped at 100 so the scan never walks a huge backlog (the app shows "99+").
--    Alerts of kind 'message' (written by the messages trigger) are NOT counted: the same message is already counted
--    in 'messages', so the tab-bar total would otherwise count every message twice.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_unread_counts()
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT json_build_object(
    'alerts',   (SELECT count(*) FROM (SELECT 1 FROM app_9e1318caf6_notifications WHERE user_id = auth.uid() AND read = false AND kind <> 'message' LIMIT 100) a),
    'messages', (SELECT count(*) FROM (SELECT 1 FROM app_9e1318caf6_messages WHERE recipient_id = auth.uid() AND read = false LIMIT 100) m)
  );
$$;

-- 4. Mark everything read in ONE call (two set-based UPDATEs). Only unread rows owned by the caller are touched,
--    so repeating it changes nothing (idempotent) and other users' rows are never affected.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_mark_all_read()
RETURNS json LANGUAGE plpgsql SET search_path = public AS $$
DECLARE a int; m int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  UPDATE app_9e1318caf6_notifications SET read = true WHERE user_id = auth.uid() AND read = false;
  GET DIAGNOSTICS a = ROW_COUNT;
  UPDATE app_9e1318caf6_messages SET read = true WHERE recipient_id = auth.uid() AND read = false;
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN json_build_object('alerts', a, 'messages', m);
END $$;

-- Guests (anon) never get these; signed-in users only.
REVOKE ALL ON FUNCTION public.app_9e1318caf6_unread_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_mark_all_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_unread_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_mark_all_read() TO authenticated;

-- 5. Realtime: make sure both tables publish INSERT/UPDATE (needed for the single per-user channel).
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['app_9e1318caf6_notifications', 'app_9e1318caf6_messages'] LOOP
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t)
         AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- Retention (suggestion only, NOT applied automatically): read alerts older than 90 days can be pruned by a scheduled job:
--   DELETE FROM app_9e1318caf6_notifications WHERE read = true AND created_at < now() - interval '90 days';

COMMIT;
