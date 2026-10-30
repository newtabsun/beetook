-- 040 · Rank shows each user's Earnings balance to everybody (explicit product decision; lifts the own-row-only rule of 039).
-- Only wallets.earnings_balance is exposed, through the `earnings` column. Purchased balance, total coins and transactions
-- are never returned. Ordering (earn DESC, public_id, id), the earn > 0 ranking rule, the top-50 limit and the caller's
-- own row are unchanged. Grants are unchanged: anon (guests) and authenticated can execute, PUBLIC cannot.
-- The return type is identical to 039, so CREATE OR REPLACE is enough; the migration is idempotent.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_rank_top()
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
         r.earn,
         r.is_vip, r.rn
    FROM ranked r
   WHERE (r.rn IS NOT NULL AND r.rn <= 50) OR r.id = auth.uid()
   ORDER BY r.rn NULLS LAST, r.id
$f$;

REVOKE ALL ON FUNCTION public.app_9e1318caf6_rank_top() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_rank_top() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
