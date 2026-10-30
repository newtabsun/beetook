-- 038 · Marketplace: working auto-reply (once per product + buyer), safer listings/orders,
-- 24 h auto-resolution (pg_cron + client fallback) and an order audit log.
-- Idempotent. No rows are deleted; open orders get a fresh 24 h window instead of being resolved at once.
BEGIN;

-- 1. Auto-reply ---------------------------------------------------------------------------------------------
-- Root cause of "auto-reply never sends": the toggle/text were only stored on market_items; nothing ever read them.
CREATE TABLE IF NOT EXISTS app_9e1318caf6_market_auto_replies (
  item_id uuid NOT NULL REFERENCES app_9e1318caf6_market_items(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, buyer_id)            -- the DB itself guarantees "once per product per buyer"
);
ALTER TABLE app_9e1318caf6_market_auto_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_9e1318caf6_market_auto_replies FROM anon, authenticated;

CREATE OR REPLACE FUNCTION app_9e1318caf6_market_auto_reply(p_item uuid, p_buyer uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l record; nm text; n int;
BEGIN
  SELECT user_id, auto_reply_on, auto_reply INTO l FROM app_9e1318caf6_market_items WHERE id = p_item;
  IF NOT FOUND OR l.user_id = p_buyer OR NOT coalesce(l.auto_reply_on, false) OR btrim(coalesce(l.auto_reply, '')) = '' THEN
    RETURN false;                            -- missing item, seller to self, toggle OFF or empty text
  END IF;
  INSERT INTO app_9e1318caf6_market_auto_replies(item_id, buyer_id) VALUES (p_item, p_buyer) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN false; END IF;        -- already sent for this product + buyer
  SELECT coalesce(nullif(btrim(regexp_replace(display_name, '<[^>]*>', '', 'g')), ''), nullif(username, ''), 'friend')
    INTO nm FROM app_9e1318caf6_profiles WHERE id = p_buyer;
  nm := coalesce(nm, 'friend');
  INSERT INTO app_9e1318caf6_messages(sender_id, recipient_id, body)
    VALUES (l.user_id, p_buyer, left(replace(replace(l.auto_reply, '{name}', nm), '{Name}', nm), 1000));
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_market_auto_reply(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Called by the app when a buyer shows interest (Inbox button on a product).
CREATE OR REPLACE FUNCTION app_9e1318caf6_market_inquiry(p_item uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  RETURN json_build_object('auto_replied', app_9e1318caf6_market_auto_reply(p_item, auth.uid()));
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_market_inquiry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_market_inquiry(uuid) TO authenticated;

-- 2. Order columns, deadline trigger, audit log ----------------------------------------------------------------
ALTER TABLE app_9e1318caf6_market_orders ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE app_9e1318caf6_market_orders ADD COLUMN IF NOT EXISTS auto_at timestamptz;   -- deadline of the current stage
UPDATE app_9e1318caf6_market_orders SET auto_at = now() + interval '24 hours'
 WHERE auto_at IS NULL AND status IN ('requested', 'accepted', 'shipped', 'disputed', 'admin_review');
CREATE INDEX IF NOT EXISTS app_9e1318caf6_mord_auto_idx ON app_9e1318caf6_market_orders(auto_at)
  WHERE status IN ('requested', 'accepted', 'shipped', 'disputed', 'admin_review');

CREATE TABLE IF NOT EXISTS app_9e1318caf6_market_order_events (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES app_9e1318caf6_market_orders(id) ON DELETE CASCADE,
  actor_id uuid,                             -- NULL = system timer
  from_status text, to_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_mevt_idx ON app_9e1318caf6_market_order_events(order_id, id);
ALTER TABLE app_9e1318caf6_market_order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_mevt_read ON app_9e1318caf6_market_order_events;
CREATE POLICY p_mevt_read ON app_9e1318caf6_market_order_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM app_9e1318caf6_market_orders o WHERE o.id = order_id AND auth.uid() IN (o.buyer_id, o.seller_id))
  OR EXISTS (SELECT 1 FROM app_9e1318caf6_profiles p WHERE p.id = auth.uid() AND p.is_admin));
REVOKE INSERT, UPDATE, DELETE ON app_9e1318caf6_market_order_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION app_9e1318caf6_mord_before() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.auto_at := now() + interval '24 hours';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.auto_at := CASE
      WHEN NEW.status IN ('requested', 'accepted', 'shipped', 'disputed') THEN now() + interval '24 hours'
      WHEN NEW.status = 'admin_review' THEN least(coalesce(OLD.auto_at, now() + interval '1 hour'), now() + interval '24 hours')
      ELSE NULL END;
    IF NEW.status = 'accepted' THEN NEW.accepted_at := now(); END IF;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS mord_before ON app_9e1318caf6_market_orders;
CREATE TRIGGER mord_before BEFORE INSERT OR UPDATE OF status ON app_9e1318caf6_market_orders
  FOR EACH ROW EXECUTE FUNCTION app_9e1318caf6_mord_before();

CREATE OR REPLACE FUNCTION app_9e1318caf6_mord_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app_9e1318caf6_market_order_events(order_id, actor_id, from_status, to_status)
      VALUES (NEW.id, auth.uid(), NULL, NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO app_9e1318caf6_market_order_events(order_id, actor_id, from_status, to_status)
      VALUES (NEW.id, auth.uid(), OLD.status, NEW.status);
  END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS mord_audit ON app_9e1318caf6_market_orders;
CREATE TRIGGER mord_audit AFTER INSERT OR UPDATE OF status ON app_9e1318caf6_market_orders
  FOR EACH ROW EXECUTE FUNCTION app_9e1318caf6_mord_audit();

-- One live order per buyer + product (race-proof; the RPC check alone can be beaten by two simultaneous taps).
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS app_9e1318caf6_mord_one_active
    ON app_9e1318caf6_market_orders(item_id, buyer_id)
    WHERE status IN ('requested', 'accepted', 'shipped', 'disputed', 'admin_review');
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Existing duplicate open orders found; unique index skipped (RPC check still applies).';
END $$;

-- 3. Listing guards (spam limit, price sanity, status/owner changes are server-only) ---------------------------------
CREATE OR REPLACE FUNCTION app_9e1318caf6_mitem_guard() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE client boolean := current_user IN ('anon', 'authenticated');
BEGIN
  -- Price is checked only for new rows or a changed price, so legacy rows never block server-side status updates.
  IF TG_OP = 'INSERT' THEN
    IF NEW.price_etb IS NULL OR NEW.price_etb < 1 OR NEW.price_etb > 1000000 THEN RAISE EXCEPTION 'Price must be between 1 and 1,000,000 ETB'; END IF;
    IF btrim(coalesce(NEW.title, '')) = '' THEN RAISE EXCEPTION 'Product name is required'; END IF;
    IF client THEN
      NEW.status := 'active';
      IF (SELECT count(*) FROM app_9e1318caf6_market_items WHERE user_id = NEW.user_id AND status IN ('active', 'reserved')) >= 20 THEN
        RAISE EXCEPTION 'Listing limit reached (20 active products)';
      END IF;
    END IF;
  ELSE
    IF NEW.price_etb IS DISTINCT FROM OLD.price_etb THEN
      IF NEW.price_etb IS NULL OR NEW.price_etb < 1 OR NEW.price_etb > 1000000 THEN RAISE EXCEPTION 'Price must be between 1 and 1,000,000 ETB'; END IF;
      IF client AND EXISTS (
           SELECT 1 FROM app_9e1318caf6_market_orders WHERE item_id = OLD.id AND status IN ('requested', 'accepted', 'shipped', 'disputed', 'admin_review')) THEN
        RAISE EXCEPTION 'Price cannot change while an order is open';
      END IF;
    END IF;
    IF client THEN
      NEW.status := OLD.status; NEW.user_id := OLD.user_id;
    END IF;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS mitem_guard ON app_9e1318caf6_market_items;
CREATE TRIGGER mitem_guard BEFORE INSERT OR UPDATE ON app_9e1318caf6_market_items
  FOR EACH ROW EXECUTE FUNCTION app_9e1318caf6_mitem_guard();

-- 4. Purchase request: server price, item lock, open-request cap, auto-reply ----------------------------------------
CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_request(p_item uuid, p_msg text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l record; b bigint; price bigint; oid uuid; me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO l FROM app_9e1318caf6_market_items WHERE id = p_item FOR UPDATE;   -- serialises buyers of one product
  IF NOT FOUND OR coalesce(l.status, 'active') <> 'active' THEN RAISE EXCEPTION 'This item is no longer available'; END IF;
  IF l.user_id = me THEN RAISE EXCEPTION 'You cannot buy your own item'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_market_orders WHERE item_id = p_item AND buyer_id = me
             AND status IN ('requested', 'accepted', 'shipped', 'disputed', 'admin_review')) THEN
    RAISE EXCEPTION 'You already requested this';
  END IF;
  IF (SELECT count(*) FROM app_9e1318caf6_market_orders WHERE buyer_id = me AND status = 'requested') >= 5 THEN
    RAISE EXCEPTION 'You have 5 pending requests — wait for sellers to answer';
  END IF;
  price := l.price_etb::bigint * 10;                      -- price always comes from the listing, never from the client
  INSERT INTO app_9e1318caf6_market_balances(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  SELECT balance INTO b FROM app_9e1318caf6_market_balances WHERE user_id = me FOR UPDATE;
  IF b - app_9e1318caf6_mkt_locked(me) < price THEN RAISE EXCEPTION 'INSUFFICIENT'; END IF;
  INSERT INTO app_9e1318caf6_market_orders(item_id, item_title, item_photo, buyer_id, seller_id, price, message, history)
  VALUES (p_item, l.title, l.photos[1], me, l.user_id, price, nullif(left(trim(coalesce(p_msg, '')), 300), ''),
    jsonb_build_array(jsonb_build_object('status', 'requested', 'at', (extract(epoch FROM now()) * 1000)::bigint)))
  RETURNING id INTO oid;
  PERFORM app_9e1318caf6_market_auto_reply(p_item, me);
  RETURN oid;
END $f$;

-- 5. State machine (same actions as before + item must still be available on accept) -------------------------------
CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_act(p_order uuid, p_action text, p_arg text DEFAULT NULL, p_photo text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record; me uuid := auth.uid(); party text; d jsonb; it text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO o FROM app_9e1318caf6_market_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  party := CASE WHEN me = o.buyer_id THEN 'buyer' WHEN me = o.seller_id THEN 'seller' ELSE NULL END;

  IF p_action = 'cancel' AND party = 'buyer' AND o.status = 'requested' THEN
    PERFORM app_9e1318caf6_mkt_step(p_order, 'cancelled', 'Buyer cancelled');
  ELSIF p_action = 'decline' AND party = 'seller' AND o.status = 'requested' THEN
    PERFORM app_9e1318caf6_mkt_step(p_order, 'cancelled', 'Seller declined');
  ELSIF p_action = 'accept' AND party = 'seller' AND o.status = 'requested' THEN
    SELECT status INTO it FROM app_9e1318caf6_market_items WHERE id = o.item_id FOR UPDATE;
    IF it IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'This item is no longer available'; END IF;
    UPDATE app_9e1318caf6_market_items SET status = 'reserved' WHERE id = o.item_id;
    PERFORM app_9e1318caf6_mkt_step(p_order, 'accepted', 'Seller accepted');
    UPDATE app_9e1318caf6_market_orders SET notice = 'Item sold — your held funds were released'
      WHERE item_id = o.item_id AND id <> p_order AND status = 'requested';
    PERFORM app_9e1318caf6_mkt_step(x.id, 'cancelled', 'Item sold / reserved for another buyer')
      FROM app_9e1318caf6_market_orders x WHERE x.item_id = o.item_id AND x.id <> p_order AND x.status = 'requested';
  ELSIF p_action = 'ship' AND party = 'seller' AND o.status = 'accepted' THEN
    UPDATE app_9e1318caf6_market_orders SET shipped_at = now() WHERE id = p_order;
    PERFORM app_9e1318caf6_mkt_step(p_order, 'shipped', 'Seller shipped');
  ELSIF p_action = 'confirm' AND party = 'buyer' AND o.status = 'shipped' THEN
    PERFORM app_9e1318caf6_mkt_release(p_order, 'Buyer confirmed receipt');
  ELSIF p_action = 'dispute' AND party = 'buyer' AND o.status = 'shipped' THEN
    IF coalesce(trim(p_arg), '') = '' THEN RAISE EXCEPTION 'Enter a reason'; END IF;
    UPDATE app_9e1318caf6_market_orders SET dispute = jsonb_build_object('reason', left(trim(p_arg), 500), 'photo', p_photo) WHERE id = p_order;
    PERFORM app_9e1318caf6_mkt_step(p_order, 'disputed', left(trim(p_arg), 500));
  ELSIF p_action = 'propose' AND party IS NOT NULL AND o.status = 'disputed' AND p_arg IN ('refund', 'release') THEN
    d := coalesce(o.dispute, '{}'::jsonb) || jsonb_build_object(party, p_arg);
    UPDATE app_9e1318caf6_market_orders SET dispute = d WHERE id = p_order;
    IF d ? 'buyer' AND d ? 'seller' THEN
      IF d->>'buyer' = d->>'seller' THEN
        IF d->>'buyer' = 'refund' THEN PERFORM app_9e1318caf6_mkt_refund(p_order, 'Refunded by agreement');
        ELSE PERFORM app_9e1318caf6_mkt_release(p_order, 'Released to seller by agreement'); END IF;
      ELSE
        PERFORM app_9e1318caf6_mkt_step(p_order, 'admin_review', 'No agreement — admin or the 24 h rule decides');
      END IF;
    END IF;
  ELSIF p_action = 'admin' AND o.status = 'admin_review' AND p_arg IN ('refund', 'release')
        AND EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = me AND is_admin) THEN
    IF p_arg = 'refund' THEN PERFORM app_9e1318caf6_mkt_refund(p_order, 'Admin decided refund');
    ELSE PERFORM app_9e1318caf6_mkt_release(p_order, 'Admin released to seller'); END IF;
  ELSIF p_action = 'rate' AND party = 'buyer' AND o.status = 'completed' AND o.rating IS NULL THEN
    UPDATE app_9e1318caf6_market_orders SET rating = greatest(1, least(5, p_arg::int)) WHERE id = p_order;
  ELSIF p_action = 'dismiss' AND party = 'buyer' THEN
    UPDATE app_9e1318caf6_market_orders SET notice = NULL WHERE id = p_order;
  ELSE
    RAISE EXCEPTION 'This action is not allowed now';
  END IF;
END $f$;

-- 6. 24 h auto-resolution. Each order is handled in its own sub-transaction so one failure never blocks the rest. ----
CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_timers() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r record; n int := 0; d jsonb;
BEGIN
  FOR r IN SELECT id, status FROM app_9e1318caf6_market_orders
            WHERE auto_at <= now() AND status IN ('requested', 'accepted', 'shipped', 'disputed', 'admin_review')
            ORDER BY auto_at LIMIT 200 LOOP
    BEGIN
      PERFORM 1 FROM app_9e1318caf6_market_orders WHERE id = r.id AND status = r.status AND auto_at <= now() FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
      IF r.status = 'requested' THEN
        PERFORM app_9e1318caf6_mkt_step(r.id, 'cancelled', 'Auto: seller did not respond within 24 h');
        UPDATE app_9e1318caf6_market_orders SET notice = 'The seller did not respond in 24 h — your held funds were released' WHERE id = r.id;
      ELSIF r.status = 'accepted' THEN
        PERFORM app_9e1318caf6_mkt_step(r.id, 'cancelled', 'Auto: seller did not ship within 24 h');
        UPDATE app_9e1318caf6_market_orders SET notice = 'The seller did not ship in 24 h — your held funds were released' WHERE id = r.id;
        UPDATE app_9e1318caf6_market_items SET status = 'active' WHERE id = (SELECT item_id FROM app_9e1318caf6_market_orders WHERE id = r.id) AND status = 'reserved';
      ELSIF r.status = 'shipped' THEN
        PERFORM app_9e1318caf6_mkt_release(r.id, 'Auto-confirmed: no complaint within 24 h');
      ELSE
        SELECT coalesce(dispute, '{}'::jsonb) INTO d FROM app_9e1318caf6_market_orders WHERE id = r.id;
        IF d->>'seller' = 'release' AND coalesce(d->>'buyer', '') <> 'refund' THEN
          PERFORM app_9e1318caf6_mkt_release(r.id, 'Auto: seller proposed release, buyer did not object within 24 h');
        ELSE
          PERFORM app_9e1318caf6_mkt_refund(r.id, 'Auto: refunded — no agreement within 24 h');
        END IF;
      END IF;
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'mkt_timers: order % skipped: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $f$;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_mkt_timers() TO authenticated;   -- idempotent; clients double as a fallback trigger

-- pg_cron: every 5 minutes (skipped with a notice if the extension cannot be enabled).
DO $$ BEGIN
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron unavailable: %', SQLERRM; END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'beetook_market_timers';
    PERFORM cron.schedule('beetook_market_timers', '*/5 * * * *', 'SELECT public.app_9e1318caf6_mkt_timers()');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
