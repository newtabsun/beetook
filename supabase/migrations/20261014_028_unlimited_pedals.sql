-- 028: Unlimited pedals. Idempotent.
-- Gas 10 coins → +6 m/s, brake 30 coins → −4 m/s, for any signed-in user, with no cooldown and no
-- usage cap. The only limit is the payer's balance (enforced by the ledger). Each tap still carries a
-- unique action id, so a retried request is never charged twice.
-- Speed: v(t) = max(2, 10 + Σgas 6·(1 − e^(−(t−ti)/2.5)) − Σbrake 4·(1 − e^(−(t−ti)/2.0))).
-- Distance: trapezoid integral of v on a 0.25 s grid ending exactly at t (same as the client).
BEGIN;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_distance(p_session uuid, p_side int, p_at timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT started_at, greatest(0, least(extract(epoch FROM (least(p_at, ends_at) - started_at)), duration_s))::float8 AS t
      FROM app_9e1318caf6_game_sessions WHERE id = p_session
  ), a AS (
    SELECT x.kind, greatest(0, extract(epoch FROM (x.created_at - s.started_at)))::float8 AS ti
      FROM app_9e1318caf6_game_actions x CROSS JOIN s
     WHERE x.session_id = p_session AND x.side = p_side
  ), g AS (
    SELECT k, least(k * 0.25, s.t) AS tt FROM s, generate_series(0, ceil(s.t / 0.25)::int) AS k
  ), v AS (
    SELECT g.k, g.tt, greatest(2, 10 + coalesce(sum(
      CASE a.kind WHEN 'gas' THEN 6 * (1 - exp(-least((g.tt - a.ti) / 2.5, 50)))
                  ELSE -4 * (1 - exp(-least((g.tt - a.ti) / 2.0, 50))) END), 0)) AS vv
      FROM g LEFT JOIN a ON a.ti <= g.tt
     GROUP BY g.k, g.tt
  ), seg AS (
    SELECT (tt - lag(tt) OVER w) * (vv + lag(vv) OVER w) / 2 AS area FROM v WINDOW w AS (ORDER BY k)
  )
  SELECT coalesce(sum(area), 0)::numeric FROM seg;
$$;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_action(p_action uuid, p_session uuid, p_side int, p_kind text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid(); s app_9e1318caf6_game_sessions; cost bigint; reward bigint := 0; c bigint;
  is_player boolean; car_owner uuid; ben_side int; ben uuid; title text;
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
