-- 032: transaction history with a precise per-row type (tx_kind), the other party's name and a
-- server-side filter (p_kind) so every type shows its own complete list.
-- * One row per real ledger movement; legacy rows without a ledger entry are still shown once.
-- * Repeated in-game actions (GAS/BRAKE taps) are grouped per minute + action ("Gas pedal ×12").
-- * The "Redeem refunded" row is folded into its request row (shown as Refunded) so a redeem appears once.
DROP FUNCTION IF EXISTS app_9e1318caf6_wallet_history();
DROP FUNCTION IF EXISTS app_9e1318caf6_wallet_history(text);
CREATE OR REPLACE FUNCTION app_9e1318caf6_wallet_history(p_kind text DEFAULT NULL)
RETURNS TABLE(id text, kind text, category text, title text, sub text, amount bigint, status text,
              created_at timestamptz, purchased_delta bigint, earnings_delta bigint, balance text,
              tx_kind text, party text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH me AS (SELECT auth.uid() AS uid),
  ledger AS (
    SELECT 't'||t.id AS id, t.kind, t.category, t.title, t.sub, t.amount, t.status, t.created_at,
           t.purchased_delta, t.earnings_delta,
           CASE
             WHEN t.category = 'gift_sent' THEN
               (SELECT g.recipient_id FROM app_9e1318caf6_gifts g WHERE g.sender_id = t.user_id AND g.created_at = t.created_at LIMIT 1)
             WHEN t.category = 'gift_received' THEN
               (SELECT g.sender_id FROM app_9e1318caf6_gifts g WHERE g.recipient_id = t.user_id AND g.created_at = t.created_at LIMIT 1)
             WHEN t.category = 'live_join' AND t.title = 'Live joining fee' THEN
               (SELECT r.host_id FROM app_9e1318caf6_live_joins j JOIN app_9e1318caf6_live_rooms r ON r.id = j.room_id
                 WHERE j.user_id = t.user_id AND j.created_at = t.created_at LIMIT 1)
             WHEN t.category = 'live_join' THEN
               (SELECT j.user_id FROM app_9e1318caf6_live_joins j JOIN app_9e1318caf6_live_rooms r ON r.id = j.room_id
                 WHERE r.host_id = t.user_id AND j.created_at = t.created_at LIMIT 1)
             WHEN t.category = 'group' AND t.title = 'Joined group' THEN
               (SELECT g.owner_id FROM app_9e1318caf6_group_earnings e JOIN app_9e1318caf6_groups g ON g.id = e.group_id
                 WHERE e.from_user = t.user_id AND e.kind = 'join' AND e.created_at = t.created_at LIMIT 1)
             WHEN t.category = 'group' AND t.title = 'Group joining fee' THEN
               (SELECT e.from_user FROM app_9e1318caf6_group_earnings e JOIN app_9e1318caf6_groups g ON g.id = e.group_id
                 WHERE g.owner_id = t.user_id AND e.kind = 'join' AND e.created_at = t.created_at LIMIT 1)
           END AS party_id
      FROM app_9e1318caf6_wallet_txns t, me
     WHERE t.user_id = me.uid AND t.category <> 'game_action'
       AND NOT (t.category = 'redeem' AND t.title = 'Redeem refunded')
  ),
  actions AS (
    SELECT 'ga'||min(t.id), t.kind, t.category,
           CASE WHEN count(*) > 1 THEN t.title||' ×'||count(*) ELSE t.title END,
           t.sub, sum(t.amount)::bigint, 'completed', max(t.created_at),
           sum(t.purchased_delta)::bigint, sum(t.earnings_delta)::bigint, NULL::uuid
      FROM app_9e1318caf6_wallet_txns t, me
     WHERE t.user_id = me.uid AND t.category = 'game_action'
     GROUP BY t.kind, t.category, t.title, t.sub, date_trunc('minute', t.created_at)
  ),
  legacy AS (
    SELECT 'gs'||g.id, 'out', 'gift_sent', 'Gift sent', g.gift||' ×'||g.qty, g.coins, 'completed', g.created_at,
           -g.coins, 0::bigint, g.recipient_id
      FROM app_9e1318caf6_gifts g, me
     WHERE g.sender_id = me.uid AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = g.sender_id AND t.category = 'gift_sent' AND t.created_at = g.created_at)
    UNION ALL
    SELECT 'gr'||g.id, 'in', 'gift_received', 'Gift received', g.gift||' ×'||g.qty, floor(g.coins * 0.7)::bigint,
           'completed', g.created_at, 0::bigint, floor(g.coins * 0.7)::bigint, g.sender_id
      FROM app_9e1318caf6_gifts g, me
     WHERE g.recipient_id = me.uid AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = g.recipient_id AND t.category = 'gift_received' AND t.created_at = g.created_at)
    UNION ALL
    SELECT 'b'||b.id, 'out', 'boost', 'Boost video', b.hours||'h promotion', b.coins, 'completed', b.created_at,
           -b.coins, 0::bigint, NULL::uuid
      FROM app_9e1318caf6_boosts b, me
     WHERE b.user_id = me.uid AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = b.user_id AND t.category = 'boost' AND t.created_at = b.created_at)
    UNION ALL
    SELECT 'w'||w.id, CASE WHEN w.payout > 0 THEN 'in' ELSE 'out' END, 'game', 'Car Racing',
           'Lane '||(w.pick+1)||' · winner '||(w.winner+1), abs(w.payout - w.stake), 'completed', w.created_at,
           CASE WHEN w.payout > 0 THEN 0 ELSE -(w.stake) END::bigint,
           CASE WHEN w.payout > 0 THEN w.payout - w.stake ELSE 0 END::bigint, NULL::uuid
      FROM app_9e1318caf6_wagers w, me
     WHERE w.user_id = me.uid AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t
             WHERE t.user_id = w.user_id AND t.category = 'game' AND t.created_at = w.created_at)
  ),
  rows AS (SELECT * FROM ledger UNION ALL SELECT * FROM actions UNION ALL SELECT * FROM legacy),
  typed AS (
    SELECT r.*,
           CASE r.category
             WHEN 'game_action' THEN 'game'
             WHEN 'live_join' THEN CASE WHEN r.title = 'Live joining fee' THEN 'live_join_paid' ELSE 'live_join_income' END
             WHEN 'group' THEN CASE r.title WHEN 'Joined group' THEN 'group_join_paid'
                                            WHEN 'Group joining fee' THEN 'group_join_income'
                                            WHEN 'Group message fee' THEN 'group_msg_paid'
                                            ELSE 'group_msg_income' END
             WHEN 'recharge' THEN 'purchase'
             WHEN 'withdraw' THEN 'redeem'
             ELSE r.category
           END AS tx_kind,
           (SELECT left(coalesce(nullif(trim(p.display_name), ''), p.username), 40)
              FROM app_9e1318caf6_profiles p WHERE p.id = r.party_id) AS party
      FROM rows r
  )
  SELECT t.id, t.kind, t.category, t.title, t.sub, t.amount, t.status, t.created_at,
         t.purchased_delta, t.earnings_delta,
         CASE WHEN t.purchased_delta <> 0 AND t.earnings_delta <> 0 THEN 'mixed'
              WHEN t.earnings_delta <> 0 THEN 'earnings' ELSE 'purchased' END,
         t.tx_kind, t.party
    FROM typed t
   WHERE p_kind IS NULL OR p_kind = 'all' OR t.tx_kind = p_kind
      OR (p_kind = 'balance_purchased' AND t.purchased_delta <> 0)
      OR (p_kind = 'balance_earnings' AND t.earnings_delta <> 0)
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT 300
$f$;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_wallet_history(text) TO authenticated;
