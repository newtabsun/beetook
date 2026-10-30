-- 025: Coin-priced live game moves (gas / brake) for players and viewers.
-- Every boost or brake costs coins, charged atomically and idempotently by RPC (unique action id + per-kind cooldown).
-- Participant payments go 100% to the platform; viewer payments count as support (player 20% / platform 80%).
-- Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_game_actions (
  action_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.app_9e1318caf6_game_sessions(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  side int NOT NULL CHECK (side IN (0, 1)),
  kind text NOT NULL CHECK (kind IN ('gas', 'brake')),
  coins bigint NOT NULL,
  reward bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_game_actions_sess_idx ON public.app_9e1318caf6_game_actions (session_id, created_at DESC);

-- Everyone in the live sees the moves; the table is written only by the RPC below.
ALTER TABLE public.app_9e1318caf6_game_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_actions_read ON public.app_9e1318caf6_game_actions;
CREATE POLICY game_actions_read ON public.app_9e1318caf6_game_actions FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.app_9e1318caf6_game_actions FROM anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_game_actions TO anon, authenticated;

-- p_action: client-generated uuid; repeating the same id is a no-op (never charged twice).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_action(p_action uuid, p_session uuid, p_side int, p_kind text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid(); s app_9e1318caf6_game_sessions; cost bigint := 0; reward bigint := 0; c bigint;
  last_at timestamptz; mine boolean; player uuid; title text; wait_for interval;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_kind NOT IN ('gas', 'brake') OR p_side NOT IN (0, 1) THEN RAISE EXCEPTION 'Invalid move'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_game_actions WHERE action_id = p_action) THEN
    INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
    SELECT coins INTO c FROM app_9e1318caf6_wallets WHERE user_id = me;
    RETURN json_build_object('ok', true, 'duplicate', true, 'coins', c);
  END IF;
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' OR now() > s.ends_at THEN RAISE EXCEPTION 'This game is not running'; END IF;
  cost := CASE p_kind WHEN 'gas' THEN 20 ELSE 30 END;
  player := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  mine := me = player;
  IF me IN (s.host_id, s.opponent_id) THEN
    -- A player may only boost their own car or brake the opponent's car.
    IF p_kind = 'gas' AND NOT mine THEN RAISE EXCEPTION 'You can only boost your own car'; END IF;
    IF p_kind = 'brake' AND mine THEN RAISE EXCEPTION 'You can only brake your opponent''s car'; END IF;
  ELSE
    reward := floor(cost * 0.2);
  END IF;
  wait_for := CASE p_kind WHEN 'gas' THEN interval '900 milliseconds' ELSE interval '4 seconds' END;
  SELECT max(created_at) INTO last_at FROM app_9e1318caf6_game_actions
   WHERE session_id = p_session AND actor_id = me AND kind = p_kind;
  IF last_at IS NOT NULL AND last_at > now() - wait_for THEN
    RAISE EXCEPTION 'Too fast — wait a moment before the next move'; END IF;
  INSERT INTO app_9e1318caf6_wallets(user_id) VALUES (me) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_game_sessions WHERE id = s.id) THEN RAISE EXCEPTION 'Game gone'; END IF;
  title := CASE WHEN me IN (s.host_id, s.opponent_id)
                THEN CASE p_kind WHEN 'gas' THEN 'Boost own car' ELSE 'Brake opponent car' END
                ELSE CASE p_kind WHEN 'gas' THEN 'Boost car (support)' ELSE 'Brake car (support)' END END;
  PERFORM app_9e1318caf6_ledger(me, -cost, 'game_action', title, s.game || ' · side ' || (p_side + 1));
  IF reward > 0 THEN PERFORM app_9e1318caf6_ledger(player, reward, 'game_action', 'Supporter reward', s.game); END IF;
  INSERT INTO app_9e1318caf6_game_actions(action_id, session_id, actor_id, side, kind, coins, reward)
    VALUES (p_action, s.id, me, p_side, p_kind, cost, reward);
  IF p_side = 0 THEN UPDATE app_9e1318caf6_game_sessions SET host_earn = host_earn + reward, updated_at = now() WHERE id = s.id;
  ELSE UPDATE app_9e1318caf6_game_sessions SET opp_earn = opp_earn + reward, updated_at = now() WHERE id = s.id; END IF;
  SELECT coins INTO c FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('ok', true, 'coins', c, 'spent', cost, 'reward', reward);
END $$;

REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_action(uuid, uuid, int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_action(uuid, uuid, int, text) TO authenticated;

-- Live-ended game earnings include supporter rewards from coin-priced moves.
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_9e1318caf6_game_actions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_9e1318caf6_game_actions;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
