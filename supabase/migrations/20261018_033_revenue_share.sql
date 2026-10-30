-- 033: one server-side source for platform shares + ledger records of gross / platform / recipient.
-- Config: wallet_config.revenue_share (percent kept by the platform per flow).
-- Rounding: recipient = floor(gross * (100 - pct) / 100), platform = gross - recipient (no coin lost or created).
BEGIN;

DELETE FROM app_9e1318caf6_wallet_config WHERE key = 'revenue_share';
INSERT INTO app_9e1318caf6_wallet_config(key, value) VALUES ('revenue_share',
 '{"default":30,"gift":30,"live_join":30,"group_join":30,"group_message":30,"market_sale":30,"game_support":80,"wager":0,"boost":100,"vip":100}'::jsonb);

ALTER TABLE app_9e1318caf6_wallet_txns ADD COLUMN IF NOT EXISTS gross bigint;
ALTER TABLE app_9e1318caf6_wallet_txns ADD COLUMN IF NOT EXISTS platform_fee bigint;
ALTER TABLE app_9e1318caf6_wallet_txns ADD COLUMN IF NOT EXISTS recipient_share bigint;

CREATE TABLE IF NOT EXISTS app_9e1318caf6_platform_revenue (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  gross bigint NOT NULL,
  platform_fee bigint NOT NULL,
  recipient_share bigint NOT NULL,
  payer_id uuid,
  recipient_id uuid,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (gross = platform_fee + recipient_share AND platform_fee >= 0 AND recipient_share >= 0)
);
ALTER TABLE app_9e1318caf6_platform_revenue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_9e1318caf6_platform_revenue FROM anon, authenticated;

CREATE OR REPLACE FUNCTION app_9e1318caf6_platform_pct(p_kind text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT greatest(0, least(100, coalesce(
    (SELECT coalesce((value->>p_kind)::numeric, (value->>'default')::numeric) FROM app_9e1318caf6_wallet_config WHERE key = 'revenue_share'),
    30)));
$f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_share_recipient(p_gross bigint, p_kind text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT floor(coalesce(p_gross, 0) * (100 - app_9e1318caf6_platform_pct(p_kind)) / 100)::bigint;
$f$;

-- Credits the recipient's share (Earnings) of an already-collected gross amount and records the split.
CREATE OR REPLACE FUNCTION app_9e1318caf6_credit_split(p_user uuid, p_gross bigint, p_kind text, p_cat text, p_title text,
                                                      p_sub text, p_payer uuid, p_ref text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE net bigint; fee bigint;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'recipient missing'; END IF;
  IF p_gross IS NULL OR p_gross < 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  net := app_9e1318caf6_share_recipient(p_gross, p_kind);
  fee := p_gross - net;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (p_user) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM app_9e1318caf6_wallets WHERE user_id = p_user FOR UPDATE;
  IF net > 0 THEN
    UPDATE app_9e1318caf6_wallets SET earnings_balance = earnings_balance + net, updated_at = now() WHERE user_id = p_user;
    INSERT INTO app_9e1318caf6_wallet_txns(user_id, kind, category, title, sub, amount, status, purchased_delta, earnings_delta,
                                           gross, platform_fee, recipient_share)
      VALUES (p_user, 'in', p_cat, p_title, coalesce(p_sub, ''), net, 'completed', 0, net, p_gross, fee, net);
  END IF;
  INSERT INTO app_9e1318caf6_platform_revenue(kind, gross, platform_fee, recipient_share, payer_id, recipient_id, ref)
    VALUES (p_kind, p_gross, fee, net, p_payer, p_user, p_ref);
  RETURN net;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_credit_split(uuid, bigint, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_9e1318caf6_platform_pct(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_9e1318caf6_share_recipient(bigint, text) FROM PUBLIC, anon, authenticated;

-- Boost / VIP: no recipient, 100% platform. Recorded on the payer's ledger row.
CREATE OR REPLACE FUNCTION app_9e1318caf6_txn_platform_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.kind = 'out' AND NEW.category IN ('boost', 'vip') THEN
    NEW.gross := NEW.amount; NEW.platform_fee := NEW.amount; NEW.recipient_share := 0;
    INSERT INTO app_9e1318caf6_platform_revenue(kind, gross, platform_fee, recipient_share, payer_id, ref)
      VALUES (NEW.category, NEW.amount, NEW.amount, 0, NEW.user_id, NEW.title);
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS txn_platform_only ON app_9e1318caf6_wallet_txns;
CREATE TRIGGER txn_platform_only BEFORE INSERT ON app_9e1318caf6_wallet_txns
  FOR EACH ROW EXECUTE FUNCTION app_9e1318caf6_txn_platform_only();

-- ---------- gifts (live + feed): 30 / 70 ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_send_gift(p_recipient uuid, p_gift text, p_qty integer, p_room uuid DEFAULT NULL, p_post uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); unit integer; total bigint; w app_9e1318caf6_wallets; gid bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_recipient IS NULL OR p_recipient = me THEN RAISE EXCEPTION 'You can''t send a gift to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_recipient) THEN RAISE EXCEPTION 'recipient not found'; END IF;
  unit := app_9e1318caf6_gift_price(p_gift);
  IF unit IS NULL THEN RAISE EXCEPTION 'invalid gift'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 9999 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
  total := unit::bigint * p_qty::bigint;
  PERFORM app_9e1318caf6_spend(me, total, 'gift_sent', 'Gift sent', p_gift || ' ×' || p_qty);
  INSERT INTO app_9e1318caf6_gifts(sender_id, recipient_id, gift, qty, coins, room_id, post_id)
    VALUES (me, p_recipient, p_gift, p_qty, total, p_room, p_post) RETURNING id INTO gid;
  PERFORM app_9e1318caf6_credit_split(p_recipient, total, 'gift', 'gift_received', 'Gift received', p_gift || ' ×' || p_qty, me, 'gift:' || gid);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('coins', w.coins, 'spent', total, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $f$;

-- ---------- live joining fee: 30 / 70 ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_live_join(p_room uuid, p_pay boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); r app_9e1318caf6_live_rooms; cut bigint; w app_9e1318caf6_wallets;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  SELECT * INTO r FROM app_9e1318caf6_live_rooms WHERE id = p_room;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live not found'; END IF;
  IF r.host_id = me OR r.join_fee <= 0 OR EXISTS (SELECT 1 FROM app_9e1318caf6_live_joins WHERE room_id = p_room AND user_id = me) THEN
    RETURN json_build_object('fee', r.join_fee, 'paid', true);
  END IF;
  IF NOT p_pay THEN RETURN json_build_object('fee', r.join_fee, 'paid', false); END IF;
  IF NOT r.is_live THEN RAISE EXCEPTION 'This live has ended'; END IF;
  PERFORM app_9e1318caf6_spend(me, r.join_fee, 'live_join', 'Live joining fee', left(r.title, 60));
  cut := app_9e1318caf6_credit_split(r.host_id, r.join_fee, 'live_join', 'live_join', 'Joining income', left(r.title, 60), me, 'live:' || p_room);
  INSERT INTO app_9e1318caf6_live_joins(room_id, user_id, fee, host_earn) VALUES (p_room, me, r.join_fee, cut);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('fee', r.join_fee, 'paid', true, 'coins', w.coins, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $f$;

-- ---------- group joining fee: 30 / 70 (was 0 / 100) ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_grp_join(p_group uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE g record; net bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO g FROM app_9e1318caf6_groups WHERE id = p_group;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  PERFORM 1 FROM app_9e1318caf6_wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_group_members WHERE group_id = p_group AND user_id = auth.uid()) THEN RETURN 0; END IF;
  IF g.owner_id <> auth.uid() AND g.fee_join > 0 THEN
    PERFORM app_9e1318caf6_spend(auth.uid(), g.fee_join, 'group', 'Joined group', g.name);
    net := app_9e1318caf6_credit_split(g.owner_id, g.fee_join, 'group_join', 'group', 'Group joining fee', g.name, auth.uid(), 'group:' || p_group);
    INSERT INTO app_9e1318caf6_group_earnings(group_id, from_user, kind, coins) VALUES (p_group, auth.uid(), 'join', net);
  END IF;
  INSERT INTO app_9e1318caf6_group_members(group_id, user_id) VALUES (p_group, auth.uid());
  RETURN CASE WHEN g.owner_id = auth.uid() THEN 0 ELSE g.fee_join END;
END $f$;

-- ---------- paid group messages (text / photo / voice): 30 / 70 (was 0 / 100) ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_grp_send(p_group uuid, p_kind text, p_body text, p_media text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE g record; f int; net bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO g FROM app_9e1318caf6_groups WHERE id = p_group;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF g.comments_enabled = false THEN RAISE EXCEPTION 'Messages are turned off for this group'; END IF;
  IF p_kind NOT IN ('text', 'photo', 'voice') THEN RAISE EXCEPTION 'invalid message kind'; END IF;
  IF p_kind = 'text' AND coalesce(trim(p_body), '') = '' THEN RAISE EXCEPTION 'Message is empty'; END IF;
  IF p_kind <> 'text' AND coalesce(p_media, '') = '' THEN RAISE EXCEPTION 'Media is missing'; END IF;
  IF g.owner_id <> auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_group_members WHERE group_id = p_group AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Join the group first'; END IF;
  f := CASE WHEN g.owner_id = auth.uid() THEN 0 WHEN p_kind = 'text' THEN g.fee_text WHEN p_kind = 'photo' THEN g.fee_photo ELSE g.fee_voice END;
  IF f > 0 THEN
    PERFORM app_9e1318caf6_spend(auth.uid(), f, 'group', 'Group message fee', g.name);
    net := app_9e1318caf6_credit_split(g.owner_id, f, 'group_message', 'group', 'Group message earning', g.name, auth.uid(), 'group_msg:' || p_group);
    INSERT INTO app_9e1318caf6_group_earnings(group_id, from_user, kind, coins) VALUES (p_group, auth.uid(), p_kind, net);
  END IF;
  INSERT INTO app_9e1318caf6_group_messages(group_id, user_id, kind, body, media, fee)
  VALUES (p_group, auth.uid(), p_kind, left(coalesce(p_body, ''), 2000), p_media, f);
  RETURN f;
END $f$;

-- ---------- game support (viewer GAS/BRAKE, prices 10/30 unchanged): 80 / 20 ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_game_action(p_action uuid, p_session uuid, p_side integer, p_kind text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  me uuid := auth.uid(); s app_9e1318caf6_game_sessions; cost bigint; reward bigint := 0;
  is_player boolean; car_owner uuid; ben_side int; ben uuid; title text; w app_9e1318caf6_wallets;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_kind NOT IN ('gas', 'brake') OR p_side NOT IN (0, 1) THEN RAISE EXCEPTION 'Invalid move'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_game_actions WHERE action_id = p_action) THEN
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
    SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
    RETURN json_build_object('ok', true, 'duplicate', true, 'coins', w.coins, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
  END IF;
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' OR now() > s.ends_at THEN RAISE EXCEPTION 'This game is not running'; END IF;
  IF now() < s.started_at THEN RAISE EXCEPTION 'The race has not started yet'; END IF;
  cost := CASE p_kind WHEN 'gas' THEN 10 ELSE 30 END;
  car_owner := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  is_player := me IN (s.host_id, s.opponent_id);
  IF is_player THEN
    IF p_kind = 'gas' AND me <> car_owner THEN RAISE EXCEPTION 'You can only boost your own car'; END IF;
    IF p_kind = 'brake' AND me = car_owner THEN RAISE EXCEPTION 'You can only brake your opponent''s car'; END IF;
  ELSE
    ben_side := CASE WHEN p_kind = 'gas' THEN p_side ELSE 1 - p_side END;
    ben := CASE WHEN ben_side = 0 THEN s.host_id ELSE s.opponent_id END;
  END IF;
  title := CASE WHEN is_player THEN CASE p_kind WHEN 'gas' THEN 'Gas pedal' ELSE 'Brake pedal' END
                ELSE CASE p_kind WHEN 'gas' THEN 'Gas pedal (support)' ELSE 'Brake pedal (support)' END END;
  PERFORM app_9e1318caf6_spend(me, cost, 'game_action', title, s.game);
  IF NOT is_player THEN
    reward := app_9e1318caf6_credit_split(ben, cost, 'game_support', 'game_action', 'Supporter reward', s.game, me, 'action:' || p_action);
  END IF;
  INSERT INTO app_9e1318caf6_game_actions(action_id, session_id, actor_id, side, kind, coins, reward)
    VALUES (p_action, s.id, me, p_side, p_kind, cost, reward);
  IF NOT is_player THEN
    IF ben_side = 0 THEN
      UPDATE app_9e1318caf6_game_sessions SET host_support = host_support + cost, host_earn = host_earn + reward, updated_at = now() WHERE id = s.id;
    ELSE
      UPDATE app_9e1318caf6_game_sessions SET opp_support = opp_support + cost, opp_earn = opp_earn + reward, updated_at = now() WHERE id = s.id;
    END IF;
  ELSE
    UPDATE app_9e1318caf6_game_sessions SET updated_at = now() WHERE id = s.id;
  END IF;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('ok', true, 'coins', w.coins, 'spent', cost, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_game_support(p_session uuid, p_side integer, p_coins bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions; target uuid; left_coins bigint; cut bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF coalesce(p_coins, 0) < 1 OR p_coins > 100000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' OR now() > s.ends_at THEN RAISE EXCEPTION 'This game is not running'; END IF;
  target := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  IF me IN (s.host_id, s.opponent_id) THEN RAISE EXCEPTION 'Players cannot support during their own game'; END IF;
  left_coins := (app_9e1318caf6_spend(me, p_coins, 'game', 'Game support', s.game)->>'coins')::bigint;
  cut := app_9e1318caf6_credit_split(target, p_coins, 'game_support', 'game_action', 'Supporter reward', s.game, me, 'support:' || p_session);
  IF p_side = 0 THEN
    UPDATE app_9e1318caf6_game_sessions SET host_support = host_support + p_coins, host_earn = host_earn + cut, updated_at = now() WHERE id = s.id;
  ELSE
    UPDATE app_9e1318caf6_game_sessions SET opp_support = opp_support + p_coins, opp_earn = opp_earn + cut, updated_at = now() WHERE id = s.id;
  END IF;
  RETURN left_coins;
END $f$;

-- ---------- player-vs-player wager: 100% of the pot to the winner (wager pct = 0), draw refunds ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_game_payout(p_session uuid, p_winner uuid, p_result text)
RETURNS app_9e1318caf6_game_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s app_9e1318caf6_game_sessions; prize bigint := 0; loser uuid;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF s.settled OR s.status <> 'active' THEN RETURN s; END IF;
  IF p_winner IS NOT NULL THEN
    IF s.stake > 0 THEN
      loser := CASE WHEN p_winner = s.host_id THEN s.opponent_id ELSE s.host_id END;
      PERFORM app_9e1318caf6_credit(p_winner, s.stake, 'game', 'Game stake returned', s.game, 'purchased');
      prize := app_9e1318caf6_credit_split(p_winner, s.stake, 'wager', 'game', 'Game won', s.game, loser, 'game:' || s.id);
    END IF;
  ELSIF s.stake > 0 THEN
    PERFORM app_9e1318caf6_credit(s.host_id, s.stake, 'game', 'Game refund (draw)', s.game, 'purchased');
    PERFORM app_9e1318caf6_credit(s.opponent_id, s.stake, 'game', 'Game refund (draw)', s.game, 'purchased');
  END IF;
  UPDATE app_9e1318caf6_game_sessions
     SET status = 'finished', settled = true, winner_id = p_winner, result = p_result,
         payout = CASE WHEN p_winner IS NULL THEN s.stake ELSE s.stake + prize END, finished_at = now(), updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN s;
END $f$;

-- ---------- marketplace sale: 30 / 70 to the seller (refund rule 5% unchanged) ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_mkt_release(p_order uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM app_9e1318caf6_market_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status = 'completed' THEN RETURN; END IF;
  IF o.status NOT IN ('shipped', 'disputed', 'admin_review') THEN RAISE EXCEPTION 'This order cannot be released now'; END IF;
  PERFORM app_9e1318caf6_mkt_step(p_order, 'completed', p_note);
  UPDATE app_9e1318caf6_market_balances SET balance = balance - o.price, updated_at = now() WHERE user_id = o.buyer_id;
  PERFORM app_9e1318caf6_credit_split(o.seller_id, o.price, 'market_sale', 'market', 'Marketplace sale', p_note, o.buyer_id, 'market:' || p_order);
  UPDATE app_9e1318caf6_market_items SET status = 'sold' WHERE id = o.item_id;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_mkt_release(uuid, text) FROM PUBLIC, anon, authenticated;

-- History: legacy gift rows use the same config instead of a hardcoded 0.7.
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('app_9e1318caf6_wallet_history(text)'::regprocedure);
  d := replace(d, 'floor(g.coins * 0.7)::bigint', 'app_9e1318caf6_share_recipient(g.coins, ''gift'')');
  EXECUTE d;
END $$;

COMMIT;
