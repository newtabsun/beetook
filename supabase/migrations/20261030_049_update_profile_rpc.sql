-- 049 · Profile save through one server function (Edit profile → Save changes).
--
-- The client used to upsert straight into the profiles table, which depends on RLS policies,
-- column grants and ON CONFLICT rules. Any gap there made "Save changes" fail after the
-- username had already been changed. This SECURITY DEFINER function updates ONLY the caller's own
-- row and ONLY these columns: display_name, bio, avatar_url, phone, links (rich/colored text).
-- Username stays on app_9e1318caf6_set_username; counters/public_id can never be changed here.
-- Idempotent (safe to run more than once).

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_update_profile(p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'invalid profile data'; END IF;

  UPDATE public.app_9e1318caf6_profiles SET
    display_name = CASE WHEN p_patch ? 'display_name' THEN left(nullif(btrim(p_patch->>'display_name'), ''), 4000) ELSE display_name END,
    bio          = CASE WHEN p_patch ? 'bio'          THEN left(coalesce(p_patch->>'bio', ''), 300) ELSE bio END,
    avatar_url   = CASE WHEN p_patch ? 'avatar_url'   THEN nullif(p_patch->>'avatar_url', '') ELSE avatar_url END,
    phone        = CASE WHEN p_patch ? 'phone'        THEN nullif(btrim(p_patch->>'phone'), '') ELSE phone END,
    links        = CASE WHEN p_patch ? 'links'        THEN coalesce(p_patch->'links', '{}'::jsonb) ELSE links END
  WHERE id = me;

  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.app_9e1318caf6_update_profile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_update_profile(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
