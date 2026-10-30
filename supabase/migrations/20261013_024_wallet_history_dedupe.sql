-- 024: wallet_history listed each sent gift twice: the ledger row ('Gift sent') AND the gifts-table row ('Send gift').
-- Fix: gifts/boosts table rows are shown only when no ledger row exists for the same event (legacy rows before the ledger).
-- View-only fix: balances were charged once. Idempotent.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_wallet_history()
RETURNS TABLE(id text, kind text, category text, title text, sub text, amount bigint, status text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 't'||t.id, t.kind, t.category, t.title, t.sub, t.amount, t.status, t.created_at FROM app_9e1318caf6_wallet_txns t WHERE t.user_id = auth.uid()
  UNION ALL SELECT 'gs'||g.id, 'out', 'gift_sent', 'Send gift', g.gift||' x'||g.qty, g.coins, 'completed', g.created_at FROM app_9e1318caf6_gifts g
    WHERE g.sender_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t WHERE t.user_id = g.sender_id AND t.category = 'gift_sent' AND t.created_at = g.created_at)
  UNION ALL SELECT 'gr'||g.id, 'in', 'gift_received', 'Gift received', g.gift||' x'||g.qty, floor(g.coins * 0.7)::bigint, 'completed', g.created_at FROM app_9e1318caf6_gifts g WHERE g.recipient_id = auth.uid()
  UNION ALL SELECT 'b'||b.id, 'out', 'boost', 'Boost video', b.hours||'h promotion', b.coins, 'completed', b.created_at FROM app_9e1318caf6_boosts b
    WHERE b.user_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM app_9e1318caf6_wallet_txns t WHERE t.user_id = b.user_id AND t.category = 'boost' AND t.created_at = b.created_at)
  UNION ALL SELECT 'w'||w.id, CASE WHEN w.payout > 0 THEN 'in' ELSE 'out' END, 'game', 'Car Racing', 'Lane '||(w.pick+1)||' · winner '||(w.winner+1), abs(w.payout - w.stake), 'completed', w.created_at FROM app_9e1318caf6_wagers w WHERE w.user_id = auth.uid()
  ORDER BY 8 DESC LIMIT 200
$$;
NOTIFY pgrst, 'reload schema';
