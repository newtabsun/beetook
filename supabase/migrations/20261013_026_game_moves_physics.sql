-- 026: Car-race physics on the server + correct support beneficiary. Idempotent.
-- Distance is computed from paid moves only (same formula as the client):
--   d(T) = 14*T + Σgas 16*3*(1-e^(-(T-ti)/3)) - Σbrake 12*2.5*(1-e^(-(T-ti)/2.5)),  clamped at 0.
-- Settlement uses this server distance, so client-pushed scores cannot decide the winner.
-- Viewer moves are support for the car that benefits (gas → that car, brake → the other car):
-- that player receives 20% and the VS-card support counter grows. Player moves earn nobody anything.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_distance(p_session uuid, p_side int, p_at timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT started_at, greatest(0, least(extract(epoch FROM (least(p_at, ends_at) - started_at)), duration_s))::numeric AS t
      FROM app_9e1318caf6_game_sessions WHERE id = p_session
  ), a AS (
    SELECT x.kind, greatest(0, extract(epoch FROM (x.created_at - s.started_at)))::numeric AS ti, s.t
      FROM app_9e1318caf6_game_actions x, s
     WHERE x.session_id = p_session AND x.side = p_side
  )
  SELECT greatest(0, (SELECT 14 * t FROM s) + coalesce((
    SELECT sum(CASE kind WHEN 'gas' THEN 48 * (1 - exp(-(t - ti) / 3.0)) ELSE -30 * (1 - exp(-(t - ti) / 2.5)) END)
      FROM a WHERE ti <= t), 0));
$$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_action(p_action uuid, p_session uuid, p_side int, p_kind text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid(); s app_9e1318caf6_game_sessions; cost bigint; reward bigint := 0; c bigint;
  last_at timestamptz; is_player boolean; car_owner uuid; ben_side int; ben uuid; title text; wait_for interval;
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
  IF now() < s.started_at THEN RAISE EXCEPTION 'The race has not started yet'; END IF;
  cost := CASE p_kind WHEN 'gas' THEN 20 ELSE 30 END;
  car_owner := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  is_player := me IN (s.host_id, s.opponent_id);
  IF is_player THEN
    IF p_kind = 'gas' AND me <> car_owner THEN RAISE EXCEPTION 'You can only boost your own car'; END IF;
    IF p_kind = 'brake' AND me = car_owner THEN RAISE EXCEPTION 'You can only brake your opponent''s car'; END IF;
  ELSE
    ben_side := CASE WHEN p_kind = 'gas' THEN p_side ELSE 1 - p_side END;
    ben := CASE WHEN ben_side = 0 THEN s.host_id ELSE s.opponent_id END;
    reward := floor(cost * 0.2);
  END IF;
  wait_for := CASE p_kind WHEN 'gas' THEN interval '900 milliseconds' ELSE interval '4 seconds' END;
  SELECT max(created_at) INTO last_at FROM app_9e1318caf6_game_actions
   WHERE session_id = p_session AND actor_id = me AND kind = p_kind;
  IF last_at IS NOT NULL AND last_at > now() - wait_for THEN
    RAISE EXCEPTION 'Too fast — wait a moment before the next move'; END IF;
  title := CASE WHEN is_player
                THEN CASE p_kind WHEN 'gas' THEN 'Boost own car' ELSE 'Brake opponent car' END
                ELSE CASE p_kind WHEN 'gas' THEN 'Boost car (support)' ELSE 'Brake car (support)' END END;
  PERFORM app_9e1318caf6_ledger(me, -cost, 'game_action', title, s.game);
  IF reward > 0 THEN PERFORM app_9e1318caf6_ledger(ben, reward, 'game_action', 'Supporter reward', s.game); END IF;
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
  SELECT coins INTO c FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('ok', true, 'coins', c, 'spent', cost);
END $$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_settle(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s app_9e1318caf6_game_sessions; hd numeric; od numeric;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF s.status = 'pending' AND s.expires_at < now() THEN
    UPDATE app_9e1318caf6_game_sessions SET status = 'expired', updated_at = now() WHERE id = s.id RETURNING * INTO s;
  ELSIF s.status = 'active' AND NOT s.settled AND now() >= s.ends_at THEN
    hd := round(app_9e1318caf6_game_distance(s.id, 0, s.ends_at), 1);
    od := round(app_9e1318caf6_game_distance(s.id, 1, s.ends_at), 1);
    UPDATE app_9e1318caf6_game_sessions SET host_score = hd, opp_score = od WHERE id = s.id;
    s := app_9e1318caf6_game_payout(s.id,
      CASE WHEN hd > od THEN s.host_id WHEN od > hd THEN s.opponent_id END,
      CASE WHEN hd = od THEN 'draw' ELSE 'win' END);
  END IF;
  RETURN to_jsonb(s);
END $$;

-- Scores are server-computed now; client score pushes are ignored.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_push(p_session uuid, p_score numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT NULL::void $$;

REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_distance(uuid, int, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_action(uuid, uuid, int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_action(uuid, uuid, int, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
