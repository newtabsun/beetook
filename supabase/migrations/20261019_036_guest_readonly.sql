-- 036 · Guests (anon role) may only read public data: close every anonymous write/RPC entry point.
-- Kept for anon: login_email (phone login before sign-in), feed_for_you, vip_ids, online_ids,
-- boost_ladder, gift_price, rank_top (read-only helpers used by public screens).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'app\_9e1318caf6\_%' AND p.prokind = 'f'
       AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('anon', p.oid, 'execute')
       AND p.proname NOT IN ('app_9e1318caf6_login_email', 'app_9e1318caf6_feed_for_you', 'app_9e1318caf6_vip_ids',
                             'app_9e1318caf6_online_ids', 'app_9e1318caf6_boost_ladder', 'app_9e1318caf6_gift_price',
                             'app_9e1318caf6_rank_top')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.args);
  END LOOP;
END $$;
