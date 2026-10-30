-- 045: a wager win is ONE full-pot entry on the Earnings balance.
-- Before: the winner of a 1000 + 1000 game got two ledger rows ("Game stake returned" +1000 to Purchased and
--         "Game won" +1000 to Earnings), so the history showed "+1000" while the screen said "You won 2000".
-- Now:    payout credits the whole pot (stake * 2, own stake included) as a single "Game won" row of +2000 on Earnings.
--         Draw refunds are unchanged (each stake returns to Purchased). Settlement stays exactly-once (settled flag).
-- Legacy: existing pairs of rows written by earlier versions are merged into one row so the old history reads +pot too.
--         Wallet balances are NOT touched (no coins are moved between Purchased and Earnings for past games).
BEGIN;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_game_payout(p_session uuid, p_winner uuid, p_result text)
RETURNS app_9e1318caf6_game_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s app_9e1318caf6_game_sessions; prize bigint := 0; loser uuid;
BEGIN
  SELECT * INTO s FROM app_9e1318caf6_game_sessions WHERE id = p_session FOR UPDATE;
  IF s.settled OR s.status <> 'active' THEN RETURN s; END IF;
  IF p_winner IS NOT NULL THEN
    IF s.stake > 0 THEN
      loser := CASE WHEN p_winner = s.host_id THEN s.opponent_id ELSE s.host_id END;
      -- Whole pot to Earnings in one ledger row (wager platform share is 0 %, see wallet_config.revenue_share).
      prize := app_9e1318caf6_credit_split(p_winner, s.stake * 2, 'wager', 'game', 'Game won', s.game, loser, 'game:' || s.id);
    END IF;
  ELSIF s.stake > 0 THEN
    PERFORM app_9e1318caf6_credit(s.host_id, s.stake, 'game', 'Game refund (draw)', s.game, 'purchased');
    PERFORM app_9e1318caf6_credit(s.opponent_id, s.stake, 'game', 'Game refund (draw)', s.game, 'purchased');
  END IF;
  UPDATE app_9e1318caf6_game_sessions
     SET status = 'finished', settled = true, winner_id = p_winner, result = p_result,
         payout = CASE WHEN p_winner IS NULL THEN s.stake ELSE prize END, finished_at = now(), updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN s;
END $f$;

-- Merge legacy "Game stake returned" + "Game won" pairs (same user, same payout instant) into one "Game won" row.
WITH pairs AS (
  SELECT w.id AS won_id, r.id AS ret_id, r.amount AS ret_amount, r.purchased_delta AS ret_p
    FROM app_9e1318caf6_wallet_txns w
    JOIN app_9e1318caf6_wallet_txns r
      ON r.user_id = w.user_id AND r.created_at = w.created_at AND r.sub = w.sub
     AND r.category = 'game' AND r.title = 'Game stake returned' AND r.kind = 'in'
   WHERE w.category = 'game' AND w.title = 'Game won' AND w.kind = 'in'
), upd AS (
  UPDATE app_9e1318caf6_wallet_txns t
     SET amount = t.amount + p.ret_amount,
         purchased_delta = t.purchased_delta + p.ret_p,
         gross = CASE WHEN t.gross IS NULL THEN NULL ELSE t.gross + p.ret_amount END,
         recipient_share = CASE WHEN t.recipient_share IS NULL THEN NULL ELSE t.recipient_share + p.ret_amount END
    FROM pairs p
   WHERE t.id = p.won_id
  RETURNING p.ret_id
)
DELETE FROM app_9e1318caf6_wallet_txns WHERE id IN (SELECT ret_id FROM upd);

COMMIT;
