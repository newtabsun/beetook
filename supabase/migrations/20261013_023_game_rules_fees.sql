-- 023: Game rules (min stake 500, 1–60 min), support split (player 20% / platform 80%),
-- gift split (recipient 70% / platform 30%, outside games), live joining fee (host 70% / platform 30%),
-- per-room earnings for the "Live ended" summary. Idempotent.
BEGIN;

-- ---------- game rules ----------
ALTER TABLE public.app_9e1318caf6_game_sessions ADD COLUMN IF NOT EXISTS host_earn bigint NOT NULL DEFAULT 0;
ALTER TABLE public.app_9e1318caf6_game_sessions ADD COLUMN IF NOT EXISTS opp_earn bigint NOT NULL DEFAULT 0;
ALTER TABLE public.app_9e1318caf6_game_sessions DROP CONSTRAINT IF EXISTS app_9e1318caf6_game_sessions_duration_s_check;
ALTER TABLE public.app_9e1318caf6_game_sessions ADD CONSTRAINT app_9e1318caf6_game_sessions_duration_s_check CHECK (duration_s BETWEEN 30 AND 3600);

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_invite(p_game text, p_opponent uuid, p_room text, p_stake bigint, p_duration int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); bal bigint; sid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_game NOT IN ('front-war','car-racing','motor-racing','marathon','boxing-match','shootout','number-spin','fast-tap','gift-bomb') THEN RAISE EXCEPTION 'Unknown game'; END IF;
  IF p_opponent IS NULL OR p_opponent = me THEN RAISE EXCEPTION 'Choose another player'; END IF;
  IF coalesce(p_stake, 0) < 500 THEN RAISE EXCEPTION 'Minimum stake is 500 coins'; END IF;
  IF p_stake > 1000000 THEN RAISE EXCEPTION 'Invalid stake'; END IF;
  IF coalesce(p_duration, 0) NOT BETWEEN 60 AND 3600 THEN RAISE EXCEPTION 'Duration must be 1 to 60 minutes'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_live_rooms WHERE id::text = p_room AND host_id = me AND is_live) THEN
    RAISE EXCEPTION 'Only the host of a running live can start a game'; END IF;
  IF NOT app_9e1318caf6_game_is_reachable(p_opponent) THEN RAISE EXCEPTION 'This user is offline right now'; END IF;
  UPDATE app_9e1318caf6_game_sessions SET status = 'expired', updated_at = now() WHERE status = 'pending' AND expires_at < now();
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_game_sessions WHERE status IN ('pending','active')
             AND (host_id IN (me, p_opponent) OR opponent_id IN (me, p_opponent))) THEN
    RAISE EXCEPTION 'You or this player already has a game in progress'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  SELECT coins INTO bal FROM app_9e1318caf6_wallets WHERE user_id = me;
  IF bal < p_stake THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  INSERT INTO app_9e1318caf6_game_sessions(game, host_id, opponent_id, host_room, stake, duration_s)
    VALUES (p_game, me, p_opponent, p_room, p_stake, p_duration) RETURNING id INTO sid;
  RETURN sid;
END $$;

-- Support: supporter pays the full amount; the backed player receives 20%, the rest stays with the platform.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_support(p_session uuid, p_side int, p_coins bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions; target uuid; left_coins bigint; cut bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF coalesce(p_coins, 0) < 1 OR p_coins > 100000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' OR now() > s.ends_at THEN RAISE EXCEPTION 'This game is not running'; END IF;
  target := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  IF me IN (s.host_id, s.opponent_id) THEN RAISE EXCEPTION 'Players cannot support during their own game'; END IF;
  cut := floor(p_coins * 0.2);
  left_coins := app_9e1318caf6_ledger(me, -p_coins, 'game', 'Game support', s.game);
  IF cut > 0 THEN PERFORM app_9e1318caf6_ledger(target, cut, 'game', 'Supporter reward', s.game); END IF;
  IF p_side = 0 THEN UPDATE app_9e1318caf6_game_sessions SET host_support = host_support + p_coins, host_earn = host_earn + cut, updated_at = now() WHERE id = s.id;
  ELSE UPDATE app_9e1318caf6_game_sessions SET opp_support = opp_support + p_coins, opp_earn = opp_earn + cut, updated_at = now() WHERE id = s.id; END IF;
  RETURN left_coins;
END $$;

-- ---------- gifts: recipient now credited 70% ----------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_send_gift(p_recipient uuid, p_gift text, p_qty integer, p_room uuid DEFAULT NULL::uuid, p_post uuid DEFAULT NULL::uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := auth.uid(); unit integer; total bigint; c bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_recipient IS NULL OR p_recipient = me THEN RAISE EXCEPTION 'You can''t send a gift to yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_recipient) THEN RAISE EXCEPTION 'recipient not found'; END IF;
  unit := app_9e1318caf6_gift_price(p_gift);
  IF unit IS NULL THEN RAISE EXCEPTION 'invalid gift'; END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 9999 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
  total := unit::bigint * p_qty::bigint;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  SELECT coins INTO c FROM app_9e1318caf6_wallets WHERE user_id = me FOR UPDATE;
  IF c < total THEN RAISE EXCEPTION 'Not enough coins — please recharge'; END IF;
  PERFORM app_9e1318caf6_ledger(me, -total, 'gift_sent', 'Gift sent', p_gift || ' ×' || p_qty);
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (p_recipient) ON CONFLICT DO NOTHING;
  UPDATE app_9e1318caf6_wallets SET coins = coins + floor(total * 0.7), updated_at = now() WHERE user_id = p_recipient;
  INSERT INTO app_9e1318caf6_gifts(sender_id, recipient_id, gift, qty, coins, room_id, post_id)
    VALUES (me, p_recipient, p_gift, p_qty, total, p_room, p_post);
  SELECT coins INTO c FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('coins', c, 'spent', total);
END $$;

-- History: gift received shows the amount actually credited (70%).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_wallet_history()
RETURNS TABLE(id text, kind text, category text, title text, sub text, amount bigint, status text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 't'||t.id, t.kind, t.category, t.title, t.sub, t.amount, t.status, t.created_at FROM app_9e1318caf6_wallet_txns t WHERE t.user_id = auth.uid()
  UNION ALL SELECT 'gs'||g.id, 'out', 'gift_sent', 'Send gift', g.gift||' x'||g.qty, g.coins, 'completed', g.created_at FROM app_9e1318caf6_gifts g WHERE g.sender_id = auth.uid()
  UNION ALL SELECT 'gr'||g.id, 'in', 'gift_received', 'Gift received', g.gift||' x'||g.qty, floor(g.coins * 0.7)::bigint, 'completed', g.created_at FROM app_9e1318caf6_gifts g WHERE g.recipient_id = auth.uid()
  UNION ALL SELECT 'b'||b.id, 'out', 'boost', 'Boost video', b.hours||'h promotion', b.coins, 'completed', b.created_at FROM app_9e1318caf6_boosts b WHERE b.user_id = auth.uid()
  UNION ALL SELECT 'w'||w.id, CASE WHEN w.payout > 0 THEN 'in' ELSE 'out' END, 'game', 'Car Racing', 'Lane '||(w.pick+1)||' · winner '||(w.winner+1), abs(w.payout - w.stake), 'completed', w.created_at FROM app_9e1318caf6_wagers w WHERE w.user_id = auth.uid()
  ORDER BY 8 DESC LIMIT 200
$$;

-- ---------- live joining fee ----------
ALTER TABLE public.app_9e1318caf6_live_rooms ADD COLUMN IF NOT EXISTS join_fee integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_9e1318caf6_live_rooms_join_fee_chk') THEN
    ALTER TABLE public.app_9e1318caf6_live_rooms ADD CONSTRAINT app_9e1318caf6_live_rooms_join_fee_chk CHECK (join_fee BETWEEN 0 AND 1000000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_live_joins (
  room_id uuid NOT NULL REFERENCES public.app_9e1318caf6_live_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  fee bigint NOT NULL,
  host_earn bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.app_9e1318caf6_live_joins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_or_host_read ON public.app_9e1318caf6_live_joins;
CREATE POLICY own_or_host_read ON public.app_9e1318caf6_live_joins FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.app_9e1318caf6_live_rooms r WHERE r.id = room_id AND r.host_id = auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.app_9e1318caf6_live_joins FROM anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_live_joins TO authenticated;

-- p_pay=false: just report {fee, paid}. p_pay=true: charge once per room (idempotent), host gets 70%.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_live_join(p_room uuid, p_pay boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); r app_9e1318caf6_live_rooms; cut bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  SELECT * INTO r FROM app_9e1318caf6_live_rooms WHERE id = p_room;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live not found'; END IF;
  IF r.host_id = me OR r.join_fee <= 0 OR EXISTS (SELECT 1 FROM app_9e1318caf6_live_joins WHERE room_id = p_room AND user_id = me) THEN
    RETURN json_build_object('fee', r.join_fee, 'paid', true);
  END IF;
  IF NOT p_pay THEN RETURN json_build_object('fee', r.join_fee, 'paid', false); END IF;
  IF NOT r.is_live THEN RAISE EXCEPTION 'This live has ended'; END IF;
  cut := floor(r.join_fee * 0.7);
  PERFORM app_9e1318caf6_ledger(me, -r.join_fee, 'live_join', 'Live joining fee', left(r.title, 60));
  IF cut > 0 THEN PERFORM app_9e1318caf6_ledger(r.host_id, cut, 'live_join', 'Joining income', left(r.title, 60)); END IF;
  INSERT INTO app_9e1318caf6_live_joins(room_id, user_id, fee, host_earn) VALUES (p_room, me, r.join_fee, cut);
  RETURN json_build_object('fee', r.join_fee, 'paid', true);
END $$;

-- Summary for "Live ended": game = stakes won + supporter rewards; joining = joining fees received.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_live_earnings(p_room uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'game', coalesce((SELECT sum(CASE WHEN g.winner_id = auth.uid() AND g.result <> 'draw' THEN g.payout ELSE 0 END
                              + CASE WHEN g.host_id = auth.uid() THEN g.host_earn WHEN g.opponent_id = auth.uid() THEN g.opp_earn ELSE 0 END)
                       FROM app_9e1318caf6_game_sessions g
                      WHERE (g.host_room = p_room::text OR g.opp_room = p_room::text) AND g.status IN ('active','finished')), 0),
    'joining', coalesce((SELECT sum(j.host_earn) FROM app_9e1318caf6_live_joins j JOIN app_9e1318caf6_live_rooms r ON r.id = j.room_id
                          WHERE j.room_id = p_room AND r.host_id = auth.uid()), 0));
$$;

REVOKE ALL ON FUNCTION public.app_9e1318caf6_live_join(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_live_earnings(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_live_join(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_live_earnings(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
