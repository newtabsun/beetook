-- 039 · Rank is ordered by the Earnings balance (wallets.earnings_balance), not by total coins.
-- Before: rank_top() ordered by wallets.coins (= purchased + earnings) and returned that total for everybody.
-- Now:    ordered by earnings_balance DESC, then public_id, then id (stable on ties).
--         Only users with earnings > 0 are ranked; users with 0/NULL earnings get rank NULL.
--         The amount is returned ONLY for the caller's own row; everybody else's amount is NULL.
--         The caller's own row is always included (even outside the top 50 or with 0 earnings).
-- Idempotent; the return type changes, so the old function is dropped first. Guests (anon) keep read access
-- but never receive any amount.
BEGIN;

DROP FUNCTION IF EXISTS public.app_9e1318caf6_rank_top();

CREATE FUNCTION public.app_9e1318caf6_rank_top()
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, earnings bigint, vip boolean, rank bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH base AS (
    SELECT p.id, p.username, p.display_name, p.avatar_url, p.public_id,
           coalesce(w.earnings_balance, 0) AS earn,
           coalesce(w.vip_expires_at > now(), false) AS is_vip
      FROM app_9e1318caf6_profiles p
      LEFT JOIN app_9e1318caf6_wallets w ON w.user_id = p.id
  ), ranked AS (
    SELECT b.*,
           CASE WHEN b.earn > 0 THEN row_number() OVER (ORDER BY b.earn DESC, b.public_id, b.id) END AS rn
      FROM base b
  )
  SELECT r.id, r.username, r.display_name, r.avatar_url,
         CASE WHEN r.id = auth.uid() THEN r.earn END,
         r.is_vip, r.rn
    FROM ranked r
   WHERE (r.rn IS NOT NULL AND r.rn <= 50) OR r.id = auth.uid()
   ORDER BY r.rn NULLS LAST, r.id
$f$;

REVOKE ALL ON FUNCTION public.app_9e1318caf6_rank_top() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_rank_top() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
