-- 027: Pedal prices and race-speed rules. Idempotent.
-- Gas pedal   = 10 coins → +6 m/s on the car the payer backs (players: their own car).
-- Brake pedal = 30 coins → −4 m/s on the rival of that car (players: the opponent's car).
-- Each step ramps in over 2.5 s (gas) / 2.0 s (brake) and then holds, like a real car keeping a gear,
-- so distance is the integral of speed and can never decrease:
--   d(T) = 10·T + Σ signedAmp · ((T − ti) − τ·(1 − e^(−(T−ti)/τ))),  clamped at 0.
-- Both cars start identical at 10 m/s. Summed boost is capped at +24 m/s and summed slow-down at
-- −8 m/s per car (below the 10 m/s start speed, so a car can never be pushed backwards). A move that
-- would exceed a cap is refused before a single coin is charged.
-- Idempotency (unique action id) and the per-actor, per-kind cooldown are unchanged; the cooldowns
-- are re-tuned for the new pedal prices.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_distance(p_session uuid, p_side int, p_at timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT started_at, greatest(0, least(extract(epoch FROM (least(p_at, ends_at) - started_at)), duration_s))::numeric AS t
      FROM app_9e1318caf6_game_sessions WHERE id = p_session
  ), a AS (
    SELECT x.kind,
           greatest(0, extract(epoch FROM (x.created_at - s.started_at)))::numeric AS ti,
           least(
             CASE x.kind WHEN 'gas' THEN 6 ELSE 4 END,
             greatest(0, CASE x.kind WHEN 'gas' THEN 24 ELSE 8 END
               - coalesce(sum(CASE x.kind WHEN 'gas' THEN 6 ELSE 4 END)
                          OVER (PARTITION BY x.kind ORDER BY x.created_at, x.action_id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))
           )::numeric AS amp,
           s.t
      FROM app_9e1318caf6_game_actions x CROSS JOIN s
     WHERE x.session_id = p_session AND x.side = p_side
  )
  SELECT greatest(0, (SELECT 10 * t FROM s) + coalesce((
    SELECT sum(
      CASE a.kind WHEN 'gas' THEN a.amp ELSE -a.amp END
      * ((a.t - a.ti) - (CASE a.kind WHEN 'gas' THEN 2.5 ELSE 2.0 END)
                      * (1 - exp(-(a.t - a.ti) / (CASE a.kind WHEN 'gas' THEN 2.5 ELSE 2.0 END)))))
      FROM a WHERE a.ti <= a.t), 0));
$$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_action(p_action uuid, p_session uuid, p_side int, p_kind text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid(); s app_9e1318caf6_game_sessions; cost bigint; step_mps bigint; cap_mps bigint;
  spent bigint; reward bigint := 0; c bigint; last_at timestamptz; is_player boolean;
  car_owner uuid; ben_side int; ben uuid; title text; wait_for interval;
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
  cost := CASE p_kind WHEN 'gas' THEN 10 ELSE 30 END;
  step_mps := CASE p_kind WHEN 'gas' THEN 6 ELSE 4 END;
  cap_mps := CASE p_kind WHEN 'gas' THEN 24 ELSE 8 END;
  car_owner := CASE WHEN p_side = 0 THEN s.host_id ELSE s.opponent_id END;
  is_player := me IN (s.host_id, s.opponent_id);
  IF is_player THEN
    -- A player may only boost their own car and brake the rival's car.
    IF p_kind = 'gas' AND me <> car_owner THEN RAISE EXCEPTION 'You can only boost your own car'; END IF;
    IF p_kind = 'brake' AND me = car_owner THEN RAISE EXCEPTION 'You can only brake your opponent''s car'; END IF;
  ELSE
    -- Viewers pay to back one car: gas backs that car, brake backs the other one.
    ben_side := CASE WHEN p_kind = 'gas' THEN p_side ELSE 1 - p_side END;
    ben := CASE WHEN ben_side = 0 THEN s.host_id ELSE s.opponent_id END;
    reward := floor(cost * 0.2);
  END IF;
  -- The speed cap is checked before charging, so a capped pedal never costs a coin.
  SELECT coalesce(sum(step_mps), 0) INTO spent FROM app_9e1318caf6_game_actions
   WHERE session_id = p_session AND side = p_side AND kind = p_kind;
  IF spent + step_mps > cap_mps THEN RAISE EXCEPTION 'This car has already reached its speed limit'; END IF;
  wait_for := CASE p_kind WHEN 'gas' THEN interval '1500 milliseconds' ELSE interval '5 seconds' END;
  SELECT max(created_at) INTO last_at FROM app_9e1318caf6_game_actions
   WHERE session_id = p_session AND actor_id = me AND kind = p_kind;
  IF last_at IS NOT NULL AND last_at > now() - wait_for THEN
    RAISE EXCEPTION 'Too fast — wait a moment before the next pedal'; END IF;
  title := CASE WHEN is_player
                THEN CASE p_kind WHEN 'gas' THEN 'Gas pedal' ELSE 'Brake pedal' END
                ELSE CASE p_kind WHEN 'gas' THEN 'Gas pedal (support)' ELSE 'Brake pedal (support)' END END;
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

REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_distance(uuid, int, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_game_action(uuid, uuid, int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_game_action(uuid, uuid, int, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
