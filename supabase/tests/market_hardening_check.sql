-- Read-only check after running migration 038: every row should say ok = true.
SELECT 'table market_auto_replies' AS item, to_regclass('public.app_9e1318caf6_market_auto_replies') IS NOT NULL AS ok
UNION ALL SELECT 'table market_order_events', to_regclass('public.app_9e1318caf6_market_order_events') IS NOT NULL
UNION ALL SELECT 'column market_orders.auto_at', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_9e1318caf6_market_orders' AND column_name = 'auto_at')
UNION ALL SELECT 'function market_inquiry', to_regprocedure('public.app_9e1318caf6_market_inquiry(uuid)') IS NOT NULL
UNION ALL SELECT 'function market_auto_reply', to_regprocedure('public.app_9e1318caf6_market_auto_reply(uuid,uuid)') IS NOT NULL
UNION ALL SELECT 'function mkt_timers', to_regprocedure('public.app_9e1318caf6_mkt_timers()') IS NOT NULL
UNION ALL SELECT 'trigger mord_before', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mord_before' AND NOT tgisinternal)
UNION ALL SELECT 'trigger mord_audit', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mord_audit' AND NOT tgisinternal)
UNION ALL SELECT 'trigger mitem_guard', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mitem_guard' AND NOT tgisinternal)
UNION ALL SELECT 'index one active order per buyer+item (false = old duplicate open orders existed; code check still applies)', to_regclass('public.app_9e1318caf6_mord_one_active') IS NOT NULL;

-- OPTIONAL (run separately). Works only when the pg_cron extension is enabled; otherwise this query errors,
-- which is fine: the app still runs the 24 h rules whenever the Market screen loads.
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'beetook_market_timers';
