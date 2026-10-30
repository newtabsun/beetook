-- 048 · Self-service profile updates (Edit profile → Save changes).
--
-- Bug: 005 granted only SELECT on profiles. The client's `updateProfile` upsert
-- (display_name, bio, avatar_url, links/_profile rich text) failed with
-- "new row violates row-level security policy" AFTER the username RPC had already
-- succeeded, so only the handle changed and the UI showed
-- "Username ማስቀመጥ አልተቻለም. እባክዎ እንደገና ይሞክሩ." Colored name/username/bio
-- (links._profile) never reached other viewers on web or Android.
--
-- Fix: let authenticated users insert/update their OWN row. The username column
-- stays RPC-only (format validation + uniqueness); public counters stay locked by
-- the 004 guard trigger, which is (re)attached here because it was defined but
-- never wired to the table. Idempotent (safe to run more than once).

BEGIN;

GRANT INSERT ON public.app_9e1318caf6_profiles TO authenticated;
-- `id` is in the upsert's ON CONFLICT DO UPDATE SET list, so it needs the column grant too;
-- username is deliberately NOT granted (RPC-only) and counts stay locked by the trigger below.
GRANT UPDATE (id, display_name, bio, avatar_url, links) ON public.app_9e1318caf6_profiles TO authenticated;

DROP POLICY IF EXISTS profiles_self_insert ON public.app_9e1318caf6_profiles;
CREATE POLICY profiles_self_insert ON public.app_9e1318caf6_profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_self_update ON public.app_9e1318caf6_profiles;
CREATE POLICY profiles_self_update ON public.app_9e1318caf6_profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 004 defined app_9e1318caf6_lock_profile_counts but no trigger referenced it;
-- without it app clients could overwrite followers/likes/views counters.
DROP TRIGGER IF EXISTS profiles_lock_counts ON public.app_9e1318caf6_profiles;
CREATE TRIGGER profiles_lock_counts
  BEFORE INSERT OR UPDATE ON public.app_9e1318caf6_profiles
  FOR EACH ROW EXECUTE FUNCTION public.app_9e1318caf6_lock_profile_counts();

COMMIT;
NOTIFY pgrst, 'reload schema';

-- Quick checks after running:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'app_9e1318caf6_profiles';
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.app_9e1318caf6_profiles'::regclass AND NOT tgisinternal;
