-- 052: (1) only users who joined a partner themselves (or admins = roots) can be joined; (2) per-post Partner on/off.
BEGIN;

ALTER TABLE app_9e1318caf6_posts ADD COLUMN IF NOT EXISTS partner_enabled boolean NOT NULL DEFAULT true;

DROP FUNCTION IF EXISTS app_9e1318caf6_partner_preview(uuid);
DROP FUNCTION IF EXISTS app_9e1318caf6_partner_join(uuid);

-- Admins are the roots of the partner tree; everybody else must have joined a partner before others can join them.
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_ready(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM app_9e1318caf6_partner_links WHERE user_id = p_user)
      OR coalesce((SELECT is_admin FROM app_9e1318caf6_profiles WHERE id = p_user), false);
$f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_preview(p_inviter uuid, p_post uuid DEFAULT NULL) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); off boolean := false;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_inviter) THEN RAISE EXCEPTION 'User not found'; END IF;
  IF p_post IS NOT NULL THEN
    SELECT NOT partner_enabled INTO off FROM app_9e1318caf6_posts WHERE id = p_post AND user_id = p_inviter;
  END IF;
  RETURN json_build_object('inviter', app_9e1318caf6_partner_person(p_inviter), 'is_self', p_inviter = me,
    'has_partner', EXISTS (SELECT 1 FROM app_9e1318caf6_partner_links WHERE user_id = me),
    'ready', app_9e1318caf6_partner_ready(p_inviter), 'post_off', coalesce(off, false));
END $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_join(p_inviter uuid, p_post uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_inviter IS NULL OR p_inviter = me THEN RAISE EXCEPTION 'You can''t join your own partners'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_inviter) THEN RAISE EXCEPTION 'User not found'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_partner_links WHERE user_id = me) THEN
    RAISE EXCEPTION 'You have already joined a partner. You can join only once, forever.'; END IF;
  IF NOT app_9e1318caf6_partner_ready(p_inviter) THEN
    RAISE EXCEPTION 'This user has not joined a partner yet, so you can''t join them.'; END IF;
  IF p_post IS NOT NULL AND EXISTS (SELECT 1 FROM app_9e1318caf6_posts WHERE id = p_post AND user_id = p_inviter AND NOT partner_enabled) THEN
    RAISE EXCEPTION 'The owner turned Partner off for this video.'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_partner_links WHERE user_id = p_inviter AND inviter_id = me) THEN
    RAISE EXCEPTION 'This user is already your partner, so you can''t join theirs.'; END IF;
  BEGIN
    INSERT INTO app_9e1318caf6_partner_links(user_id, inviter_id) VALUES (me, p_inviter);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You have already joined a partner. You can join only once, forever.';
  END;
  RETURN true;
END $f$;

REVOKE ALL ON FUNCTION app_9e1318caf6_partner_ready(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_9e1318caf6_partner_preview(uuid, uuid), app_9e1318caf6_partner_join(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_partner_preview(uuid, uuid), app_9e1318caf6_partner_join(uuid, uuid) TO authenticated;

COMMIT;
