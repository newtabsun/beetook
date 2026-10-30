-- 044 · Live access: a user may start a live room only if VIP is active OR the profile has >= 1000 followers
-- (a 1000+ follower account does NOT need VIP). Enforced on the table itself, so no client can bypass it.
-- Marketplace and profile edits stay free for everybody (no gate exists or is added).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_can_go_live(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM app_9e1318caf6_wallets w WHERE w.user_id = p_user AND w.vip_expires_at > now())
      OR EXISTS (SELECT 1 FROM app_9e1318caf6_profiles p WHERE p.id = p_user AND coalesce(p.followers_count, 0) >= 1000)
$f$;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_can_go_live(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_can_go_live(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_live_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  -- Server-side jobs and fixtures (no auth session) are not gated; client sessions are checked on the host row.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT app_9e1318caf6_can_go_live(NEW.host_id) THEN
    RAISE EXCEPTION 'Going live needs VIP or at least 1000 followers 👑 — Profile → Menu → VIP';
  END IF;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS live_access_gate ON public.app_9e1318caf6_live_rooms;
CREATE TRIGGER live_access_gate BEFORE INSERT ON public.app_9e1318caf6_live_rooms
  FOR EACH ROW EXECUTE FUNCTION public.app_9e1318caf6_live_gate();
