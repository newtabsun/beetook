-- 034: marketplace — no 30% on sales; the only fee is 5% (wallet_config.market.return_fee_pct) whenever
-- market coins go back to the Purchased balance (Market → Purchased transfer and order refunds).
BEGIN;

UPDATE app_9e1318caf6_wallet_config SET value = jsonb_set(value, '{market_sale}', '0'), updated_at = now() WHERE key = 'revenue_share';

CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_transfer(p_dir text, p_amount bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE b bigint; pct numeric; fee bigint; net bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  INSERT INTO app_9e1318caf6_market_balances(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
  SELECT balance INTO b FROM app_9e1318caf6_market_balances WHERE user_id = auth.uid() FOR UPDATE;
  IF p_dir = 'in' THEN
    PERFORM app_9e1318caf6_spend_purchased(auth.uid(), p_amount, 'market', 'To market balance', 'Purchased → Market');
    UPDATE app_9e1318caf6_market_balances SET balance = balance + p_amount, updated_at = now() WHERE user_id = auth.uid();
  ELSIF p_dir = 'out' THEN
    IF b - app_9e1318caf6_mkt_locked(auth.uid()) < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
    pct := coalesce((app_9e1318caf6_wallet_settings()->'market'->>'return_fee_pct')::numeric, 5);
    fee := ceil(p_amount * pct / 100)::bigint;
    net := p_amount - fee;
    UPDATE app_9e1318caf6_market_balances SET balance = balance - p_amount, updated_at = now() WHERE user_id = auth.uid();
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
    PERFORM 1 FROM app_9e1318caf6_wallets WHERE user_id = auth.uid() FOR UPDATE;
    IF net > 0 THEN
      UPDATE app_9e1318caf6_wallets SET purchased_balance = purchased_balance + net, updated_at = now() WHERE user_id = auth.uid();
    END IF;
    INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta,
                                           gross, platform_fee, recipient_share)
      VALUES (auth.uid(), 'in', 'market', 'From market balance', format('Market → Purchased · %s%% fee %s', pct, fee),
              net, 'completed', net, 0, p_amount, fee, net);
    INSERT INTO app_9e1318caf6_platform_revenue(kind, gross, platform_fee, recipient_share, payer_id, recipient_id, ref)
      VALUES ('market_to_purchased', p_amount, fee, net, auth.uid(), auth.uid(), 'market_out');
  ELSE RAISE EXCEPTION 'invalid direction'; END IF;
  RETURN app_9e1318caf6_mkt_balance();
END $f$;

-- Refund: same 5% rule, now also recorded with gross / fee / net and in platform_revenue.
CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_refund(p_order uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record; pct numeric; fee bigint; net bigint;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_market_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.refunded_at IS NOT NULL THEN RETURN; END IF;
  IF o.status NOT IN ('disputed', 'admin_review') THEN RAISE EXCEPTION 'This order cannot be refunded now'; END IF;
  pct := coalesce((app_9e1318caf6_wallet_settings()->'market'->>'return_fee_pct')::numeric, 5);
  fee := floor(o.price * pct / 100); net := o.price - fee;
  UPDATE app_9e1318caf6_market_balances SET balance = balance - o.price, updated_at = now() WHERE user_id = o.buyer_id;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (o.buyer_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM app_9e1318caf6_wallets WHERE user_id = o.buyer_id FOR UPDATE;
  IF net > 0 THEN
    UPDATE app_9e1318caf6_wallets SET purchased_balance = purchased_balance + net, updated_at = now() WHERE user_id = o.buyer_id;
  END IF;
  INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta,
                                         gross, platform_fee, recipient_share)
    VALUES (o.buyer_id, 'in', 'market', 'Marketplace refund', format('%s · %s%% fee %s', left(o.item_title, 60), pct, fee),
            net, 'completed', net, 0, o.price, fee, net);
  INSERT INTO app_9e1318caf6_platform_revenue(kind, gross, platform_fee, recipient_share, payer_id, recipient_id, ref)
    VALUES ('market_refund', o.price, fee, net, o.buyer_id, o.buyer_id, 'refund:' || p_order);
  UPDATE app_9e1318caf6_market_orders SET refund_fee = fee, refunded_at = now() WHERE id = p_order;
  PERFORM app_9e1318caf6_mkt_step(p_order, 'cancelled', format('%s · %s coins back to Purchased (%s%% fee)', p_note, net, pct));
  UPDATE app_9e1318caf6_market_items SET status = 'active' WHERE id = o.item_id;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_mkt_refund(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
