-- 054 · Server-side privacy + duet guard + scheduled-post publishing. Idempotent.
--  * Private account: nobody can follow it; only existing followers see its videos.
--  * Video privacy: Everyone / Friends(Followers) / Only me enforced by RLS (not only by the app).
--  * Duet: a duet of a video whose owner turned Duet/Share off is rejected by the database.
--  * Scheduled posts: promoted to normal posts automatically when publish_at is reached.
BEGIN;

ALTER TABLE public.app_9e1318caf6_profiles ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
UPDATE public.app_9e1318caf6_profiles SET is_private = true
 WHERE id IN (SELECT user_id FROM public.app_9e1318caf6_user_settings WHERE settings->>'privateAccount' = 'true');

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_is_follower(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select auth.uid() is not null and exists (
    select 1 from app_9e1318caf6_follows f where f.follower_id = auth.uid() and f.following_id = p_owner)
$$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_can_view_post(p_owner uuid, p_privacy text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case
    when p_owner = auth.uid() then true
    when coalesce(p_privacy, 'everyone') = 'only_me' then false
    when coalesce(p_privacy, 'everyone') = 'friends' then app_9e1318caf6_is_follower(p_owner)
    else not coalesce((select pr.is_private from app_9e1318caf6_profiles pr where pr.id = p_owner), false)
         or app_9e1318caf6_is_follower(p_owner)
  end
$$;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_is_follower(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_can_view_post(uuid, text) TO anon, authenticated;

DROP POLICY IF EXISTS "posts_feed_read" ON public.app_9e1318caf6_posts;
CREATE POLICY "posts_feed_read" ON public.app_9e1318caf6_posts FOR SELECT TO anon, authenticated
  USING (
    user_id = auth.uid()
    OR (status IN ('published', 'scheduled') AND publish_at <= now()
        AND public.app_9e1318caf6_can_view_post(user_id, privacy))
  );

-- Private account switch (profiles has no direct UPDATE grant on this column).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_set_private_account(p_on boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please log in first'; END IF;
  UPDATE app_9e1318caf6_profiles SET is_private = coalesce(p_on, false) WHERE id = auth.uid();
  RETURN coalesce(p_on, false);
END $$;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_set_private_account(boolean) TO authenticated;

-- Nobody can follow a private account.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_follow_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.follower_id <> NEW.following_id
     AND coalesce((SELECT is_private FROM app_9e1318caf6_profiles WHERE id = NEW.following_id), false) THEN
    RAISE EXCEPTION 'This account is private';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS follow_guard ON public.app_9e1318caf6_follows;
CREATE TRIGGER follow_guard BEFORE INSERT ON public.app_9e1318caf6_follows
  FOR EACH ROW EXECUTE FUNCTION public.app_9e1318caf6_follow_guard();

-- Duet is refused when the original owner turned Duet/Share off (or the original is not visible to the user).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_duet_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record;
BEGIN
  IF NEW.duet_of IS NULL THEN RETURN NEW; END IF;
  SELECT user_id, allow_duet, privacy INTO o FROM app_9e1318caf6_posts WHERE id = NEW.duet_of;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF o.user_id <> NEW.user_id AND (NOT coalesce(o.allow_duet, true)
      OR NOT app_9e1318caf6_can_view_post(o.user_id, o.privacy)) THEN
    RAISE EXCEPTION 'The creator turned off Duet for this video';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS duet_guard ON public.app_9e1318caf6_posts;
CREATE TRIGGER duet_guard BEFORE INSERT OR UPDATE OF duet_of ON public.app_9e1318caf6_posts
  FOR EACH ROW EXECUTE FUNCTION public.app_9e1318caf6_duet_guard();

-- For You feed (security definer, bypasses RLS): apply the same visibility rule.
DO $do$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'app_9e1318caf6_feed_for_you' LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '(coalesce(p.privacy, ''everyone'') = ''everyone'' or p.user_id = me.uid)',
                    'app_9e1318caf6_can_view_post(p.user_id, p.privacy)');
    EXECUTE d;
  END LOOP;
END $do$;

-- Scheduled posts become normal posts when their time comes (cron every minute + callable fallback).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_publish_due_posts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  UPDATE app_9e1318caf6_posts SET status = 'published' WHERE status = 'scheduled' AND publish_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_publish_due_posts() TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'beetook_publish_due';
SELECT cron.schedule('beetook_publish_due', '* * * * *', 'select public.app_9e1318caf6_publish_due_posts()');

COMMIT;
NOTIFY pgrst, 'reload schema';
