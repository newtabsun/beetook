-- 047: audit trail of payment-provider events (Chapa webhooks / callbacks). Written only by edge functions (service role).
BEGIN;

CREATE TABLE IF NOT EXISTS app_9e1318caf6_purchase_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  order_id uuid REFERENCES app_9e1318caf6_purchase_orders(id) ON DELETE CASCADE,
  event text NOT NULL,
  status text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_purchase_events_order_idx ON app_9e1318caf6_purchase_events(order_id, created_at DESC);
ALTER TABLE app_9e1318caf6_purchase_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_9e1318caf6_purchase_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_9e1318caf6_purchase_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE app_9e1318caf6_purchase_events_id_seq TO service_role;

-- Chapa: stop old unpaid orders from piling up (the edge function also closes them when it re-checks).
UPDATE app_9e1318caf6_purchase_orders SET status = 'failed', updated_at = now()
 WHERE provider = 'chapa' AND status = 'pending' AND created_at < now() - interval '3 days';

NOTIFY pgrst, 'reload schema';
COMMIT;
