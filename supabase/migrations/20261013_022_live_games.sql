-- 022: Live game sessions (Bee Took).
-- Flow: host invites (pending, 30 s) -> opponent accepts (both stakes escrowed atomically, guest seats cleared)
--       -> realtime play (scores pushed, server-capped) -> server settlement (exactly once) -> finished.
-- Idempotent: safe to run repeatedly in the Supabase SQL Editor. Depends on 002 (wallets, ledger) and 015 (presence).
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_game_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game text NOT NULL,
  host_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  opponent_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  host_room text NOT NULL,
  opp_room text,
  stake bigint NOT NULL DEFAULT 0 CHECK (stake >= 0 AND stake <= 1000000),
  duration_s int NOT NULL DEFAULT 60 CHECK (duration_s BETWEEN 30 AND 600),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','declined','expired','cancelled','active','finished')),
  host_score numeric NOT NULL DEFAULT 0,
  opp_score numeric NOT NULL DEFAULT 0,
  host_support bigint NOT NULL DEFAULT 0,
  opp_support bigint NOT NULL DEFAULT 0,
  winner_id uuid,
  result text CHECK (result IS NULL OR result IN ('win','draw','forfeit')),
  payout bigint NOT NULL DEFAULT 0,
  settled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 seconds',
  started_at timestamptz,
  ends_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (host_id <> opponent_id)
);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_game_sessions_opp_idx ON public.app_9e1318caf6_game_sessions (opponent_id, status);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_game_sessions_hroom_idx ON public.app_9e1318caf6_game_sessions (host_room, created_at DESC);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_game_sessions_oroom_idx ON public.app_9e1318caf6_game_sessions (opp_room, created_at DESC);

-- Everyone in a live can watch the game; all writes go through the SECURITY DEFINER functions below.
ALTER TABLE public.app_9e1318caf6_game_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_read ON public.app_9e1318caf6_game_sessions;
CREATE POLICY game_read ON public.app_9e1318caf6_game_sessions FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.app_9e1318caf6_game_sessions FROM anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_game_sessions TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_is_reachable(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_user AND last_seen_at > now() - interval '2 minutes')
      OR EXISTS (SELECT 1 FROM app_9e1318caf6_live_rooms WHERE host_id = p_user AND is_live);
$$;

-- Host sends an invite. Stake is only checked here; it is escrowed on accept.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_invite(p_game text, p_opponent uuid, p_room text, p_stake bigint, p_duration int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); bal bigint; sid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_game NOT IN ('front-war','car-racing','motor-racing','marathon','boxing-match','shootout','number-spin','fast-tap','gift-bomb') THEN RAISE EXCEPTION 'Unknown game'; END IF;
  IF p_opponent IS NULL OR p_opponent = me THEN RAISE EXCEPTION 'Choose another player'; END IF;
  IF coalesce(p_stake, -1) < 0 OR p_stake > 1000000 THEN RAISE EXCEPTION 'Invalid stake'; END IF;
  IF coalesce(p_duration, 0) NOT BETWEEN 30 AND 600 THEN RAISE EXCEPTION 'Invalid duration'; END IF;
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

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_cancel(p_session uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE app_9e1318caf6_game_sessions SET status = 'cancelled', updated_at = now()
   WHERE id = p_session AND host_id = auth.uid() AND status = 'pending';
$$;

-- Opponent answers. Accept = escrow both stakes + clear guest seats in both rooms, in one transaction.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_respond(p_session uuid, p_accept boolean, p_room text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions; bal bigint;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.opponent_id IS DISTINCT FROM me THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF s.status <> 'pending' THEN RETURN to_jsonb(s); END IF;
  IF s.expires_at < now() THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'expired', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    RETURN to_jsonb(s);
  END IF;
  IF NOT p_accept THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'declined', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    RETURN to_jsonb(s);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_live_rooms WHERE id::text = p_room AND host_id = me AND is_live) THEN
    RAISE EXCEPTION 'Go live first to accept this game'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_live_rooms WHERE id::text = s.host_room AND is_live) THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'cancelled', updated_at = now() WHERE id = s.id RETURNING * INTO s;
    RETURN to_jsonb(s);
  END IF;
  IF s.stake > 0 THEN
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (s.host_id) ON CONFLICT DO NOTHING;
    SELECT coins INTO bal FROM app_9e1318caf6_wallets WHERE user_id = s.host_id;
    IF bal < s.stake THEN RAISE EXCEPTION 'The host no longer has enough coins for this stake'; END IF;
    PERFORM app_9e1318caf6_ledger(s.host_id, -s.stake, 'game', 'Game stake', s.game);
    PERFORM app_9e1318caf6_ledger(me, -s.stake, 'game', 'Game stake', s.game);
  END IF;
  UPDATE app_9e1318caf6_live_seats SET user_id = NULL, muted = false WHERE room_id::text IN (s.host_room, p_room) AND idx > 0;
  UPDATE app_9e1318caf6_game_sessions
     SET status = 'active', opp_room = p_room, started_at = now() + interval '3 seconds',
         ends_at = now() + interval '3 seconds' + make_interval(secs => duration_s), updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;

-- Players push their own monotonic score; capped by elapsed time (70 units/s) to block impossible values.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_push(p_session uuid, p_score numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions; cap numeric; v numeric;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session;
  IF NOT FOUND OR s.status <> 'active' OR now() < s.started_at OR now() > s.ends_at + interval '2 seconds' THEN RETURN; END IF;
  cap := greatest(0, extract(epoch FROM (least(now(), s.ends_at) - s.started_at))) * 70;
  v := least(greatest(coalesce(p_score, 0), 0), cap);
  IF me = s.host_id THEN
    UPDATE app_9e1318caf6_game_sessions SET host_score = greatest(host_score, v), updated_at = now() WHERE id = s.id AND status = 'active';
  ELSIF me = s.opponent_id THEN
    UPDATE app_9e1318caf6_game_sessions SET opp_score = greatest(opp_score, v), updated_at = now() WHERE id = s.id AND status = 'active';
  END IF;
END $$;

-- Viewers back a side: coins go straight to that player (like a gift) and show on the VS card.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_support(p_session uuid, p_side int, p_coins bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions; target uuid; left_coins bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF coalesce(p_coins, 0) < 1 OR p_coins > 100000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' OR now() > s.ends_at THEN RAISE EXCEPTION 'This game is not running'; END IF;
  target := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  IF target = me THEN RAISE EXCEPTION 'You cannot support yourself'; END IF;
  left_coins := app_9e1318caf6_ledger(me, -p_coins, 'game', 'Game support', s.game);
  PERFORM app_9e1318caf6_ledger(target, p_coins, 'game', 'Game support received', s.game);
  IF p_side = 0 THEN UPDATE app_9e1318caf6_game_sessions SET host_support = host_support + p_coins, updated_at = now() WHERE id = s.id;
  ELSE UPDATE app_9e1318caf6_game_sessions SET opp_support = opp_support + p_coins, updated_at = now() WHERE id = s.id; END IF;
  RETURN left_coins;
END $$;

-- Internal payout: exactly once (guarded by settled flag under row lock).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_payout(p_session uuid, p_winner uuid, p_result text)
RETURNS app_9e1318caf6_game_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s app_9e1318caf6_game_sessions; pot bigint;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF s.settled OR s.status <> 'active' THEN RETURN s; END IF;
  pot := s.stake * 2;
  IF p_winner IS NOT NULL THEN
    IF pot > 0 THEN PERFORM app_9e1318caf6_ledger(p_winner, pot, 'game', 'Game won', s.game); END IF;
  ELSIF s.stake > 0 THEN
    PERFORM app_9e1318caf6_ledger(s.host_id, s.stake, 'game', 'Game refund (draw)', s.game);
    PERFORM app_9e1318caf6_ledger(s.opponent_id, s.stake, 'game', 'Game refund (draw)', s.game);
  END IF;
  UPDATE app_9e1318caf6_game_sessions
     SET status = 'finished', settled = true, winner_id = p_winner, result = p_result,
         payout = CASE WHEN p_winner IS NULL THEN s.stake ELSE pot END, finished_at = now(), updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_payout(uuid, uuid, text) FROM public, anon, authenticated;

-- Anyone may call; it only acts once the server clock passes ends_at. Idempotent.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_settle(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s app_9e1318caf6_game_sessions;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF s.status = 'pending' AND s.expires_at < now() THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'expired', updated_at = now() WHERE id = s.id RETURNING * INTO s;
  ELSIF s.status = 'active' AND NOT s.settled AND now() >= s.ends_at THEN
    s := app_9e1318caf6_game_payout(s.id,
      CASE WHEN s.host_score > s.opp_score THEN s.host_id WHEN s.opp_score > s.host_score THEN s.opponent_id END,
      CASE WHEN s.host_score = s.opp_score THEN 'draw' ELSE 'win' END);
  END IF;
  RETURN to_jsonb(s);
END $$;

-- A player leaving: pending -> cancelled/declined; active -> the other player wins the whole pot.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_forfeit(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); s app_9e1318caf6_game_sessions;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR me NOT IN (s.host_id, s.opponent_id) THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF s.status = 'pending' THEN
    UPDATE app_9e1318caf6_game_sessions SET status = CASE WHEN me = s.host_id THEN 'cancelled' ELSE 'declined' END, updated_at = now()
     WHERE id = s.id RETURNING * INTO s;
  ELSIF s.status = 'active' AND NOT s.settled THEN
    s := app_9e1318caf6_game_payout(s.id, CASE WHEN me = s.host_id THEN s.opponent_id ELSE s.host_id END, 'forfeit');
  END IF;
  RETURN to_jsonb(s);
END $$;

REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_is_reachable(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_invite(text, uuid, text, bigint, int) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_cancel(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_respond(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_push(uuid, numeric) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_support(uuid, int, bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_settle(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_forfeit(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_is_reachable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_invite(text, uuid, text, bigint, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_respond(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_push(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_support(uuid, int, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_settle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_forfeit(uuid) TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_9e1318caf6_game_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_9e1318caf6_game_sessions;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
