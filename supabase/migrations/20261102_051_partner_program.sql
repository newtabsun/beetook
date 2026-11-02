-- 051: Partner program. A user joins ONE inviter (forever, by the inviter's ID). The inviter earns a commission
-- on the partner's GIFTS only, computed on the recipient's 70% share (the 30% platform cut is never counted twice).
-- Levels L1..L5 -> 3/5/8/10/12 %. Level goes up when this month's partner income reaches the level goal and goes
-- down at month end when the month's income is below 20% of the current level's goal. Months follow Africa/Addis_Ababa.
-- Commission is credited straight to the inviter's Earnings balance (the income stats below are only a report).
BEGIN;

CREATE TABLE IF NOT EXISTS app_9e1318caf6_partner_links (
  user_id uuid PRIMARY KEY,
  inviter_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id <> inviter_id)
);
CREATE INDEX IF NOT EXISTS partner_links_inviter_idx ON app_9e1318caf6_partner_links(inviter_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS app_9e1318caf6_partner_state (
  user_id uuid PRIMARY KEY,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  level_month text NOT NULL,
  message_html text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_9e1318caf6_partner_commissions (
  id bigserial PRIMARY KEY,
  inviter_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  gift_id bigint UNIQUE,
  gift_coins bigint NOT NULL,
  base bigint NOT NULL,
  pct numeric NOT NULL,
  coins bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_comm_inviter_idx ON app_9e1318caf6_partner_commissions(inviter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_comm_pair_idx ON app_9e1318caf6_partner_commissions(inviter_id, partner_id);

ALTER TABLE app_9e1318caf6_partner_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_9e1318caf6_partner_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_9e1318caf6_partner_commissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_9e1318caf6_partner_links, app_9e1318caf6_partner_state, app_9e1318caf6_partner_commissions FROM anon, authenticated;

-- ---------- level table ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_pct(p_level integer) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$f$ SELECT (ARRAY[3,5,8,10,12])[greatest(1, least(5, coalesce(p_level, 1)))]::numeric $f$;
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_goal(p_level integer) RETURNS bigint LANGUAGE sql IMMUTABLE AS
$f$ SELECT (ARRAY[400000, 1500000, 5000000, 15000000, 25000000])[greatest(1, least(5, coalesce(p_level, 1)))]::bigint $f$;
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_cur_month() RETURNS text LANGUAGE sql STABLE AS
$f$ SELECT to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'YYYY-MM') $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_month_income(p_user uuid, p_month text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT coalesce(sum(coins), 0)::bigint FROM app_9e1318caf6_partner_commissions
   WHERE inviter_id = p_user
     AND created_at >= (to_date(p_month || '-01', 'YYYY-MM-DD')::timestamp AT TIME ZONE 'Africa/Addis_Ababa')
     AND created_at <  ((to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp AT TIME ZONE 'Africa/Addis_Ababa');
$f$;

-- Read-only: the level a user really has now, after applying every finished month (demotion rule).
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_calc(p_user uuid) RETURNS TABLE(o_level integer, o_month text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE st app_9e1318caf6_partner_state; cur text := app_9e1318caf6_partner_cur_month(); lv integer; m text;
BEGIN
  SELECT * INTO st FROM app_9e1318caf6_partner_state WHERE user_id = p_user;
  IF NOT FOUND THEN o_level := 1; o_month := cur; RETURN NEXT; RETURN; END IF;
  lv := st.level; m := st.level_month;
  WHILE m < cur LOOP
    IF lv = 1 THEN m := cur; EXIT; END IF;
    IF app_9e1318caf6_partner_month_income(p_user, m) < app_9e1318caf6_partner_goal(lv) * 0.2 THEN lv := lv - 1; END IF;
    m := to_char(to_date(m || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
  END LOOP;
  o_level := lv; o_month := cur; RETURN NEXT;
END $f$;

-- Persists the month roll-over and returns the current level.
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_roll(p_user uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE lv integer; mon text;
BEGIN
  INSERT INTO app_9e1318caf6_partner_state(user_id, level, level_month) VALUES (p_user, 1, app_9e1318caf6_partner_cur_month()) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM app_9e1318caf6_partner_state WHERE user_id = p_user FOR UPDATE;
  SELECT o_level, o_month INTO lv, mon FROM app_9e1318caf6_partner_calc(p_user);
  UPDATE app_9e1318caf6_partner_state SET level = lv, level_month = mon, updated_at = now() WHERE user_id = p_user;
  RETURN lv;
END $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_person(p_user uuid) RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT json_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
    'public_id', p.public_id, 'level', (SELECT o_level FROM app_9e1318caf6_partner_calc(p.id)),
    'message_html', coalesce((SELECT s.message_html FROM app_9e1318caf6_partner_state s WHERE s.user_id = p.id), ''))
  FROM app_9e1318caf6_profiles p WHERE p.id = p_user;
$f$;

-- Called by send_gift: pays the sender's inviter (if any) and levels the inviter up when the goal is reached.
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_commission(p_sender uuid, p_gift bigint, p_coins bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE inv uuid; lv integer; base bigint; pct numeric; c bigint; inc bigint; nm text;
BEGIN
  SELECT inviter_id INTO inv FROM app_9e1318caf6_partner_links WHERE user_id = p_sender;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = inv) THEN RETURN 0; END IF;
  lv := app_9e1318caf6_partner_roll(inv);
  base := app_9e1318caf6_share_recipient(p_coins, 'gift');
  pct := app_9e1318caf6_partner_pct(lv);
  c := floor(base * pct / 100)::bigint;
  IF c <= 0 THEN RETURN 0; END IF;
  SELECT left(coalesce(nullif(trim(display_name), ''), username, ''), 40) INTO nm FROM app_9e1318caf6_profiles WHERE id = p_sender;
  PERFORM app_9e1318caf6_credit(inv, c, 'partner_commission', 'Partner commission', coalesce(nm, ''), 'earnings');
  INSERT INTO app_9e1318caf6_partner_commissions(inviter_id, partner_id, gift_id, gift_coins, base, pct, coins)
    VALUES (inv, p_sender, p_gift, p_coins, base, pct, c);
  inc := app_9e1318caf6_partner_month_income(inv, app_9e1318caf6_partner_cur_month());
  WHILE lv < 5 AND inc >= app_9e1318caf6_partner_goal(lv) LOOP lv := lv + 1; END LOOP;
  UPDATE app_9e1318caf6_partner_state SET level = lv, updated_at = now() WHERE user_id = inv;
  RETURN c;
END $f$;

-- ---------- client RPCs ----------
CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_overview() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); lv integer; l timestamp := now() AT TIME ZONE 'Africa/Addis_Ababa';
  t0 timestamptz; w0 timestamptz; m0 timestamptz; inc record; msg text; inv uuid; cnt bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  lv := app_9e1318caf6_partner_roll(me);
  t0 := date_trunc('day', l) AT TIME ZONE 'Africa/Addis_Ababa';
  w0 := date_trunc('week', l) AT TIME ZONE 'Africa/Addis_Ababa';
  m0 := date_trunc('month', l) AT TIME ZONE 'Africa/Addis_Ababa';
  SELECT coalesce(sum(coins) FILTER (WHERE created_at >= t0), 0)::bigint AS today,
         coalesce(sum(coins) FILTER (WHERE created_at >= w0), 0)::bigint AS week,
         coalesce(sum(coins) FILTER (WHERE created_at >= m0), 0)::bigint AS month,
         coalesce(sum(coins), 0)::bigint AS total
    INTO inc FROM app_9e1318caf6_partner_commissions WHERE inviter_id = me;
  SELECT message_html INTO msg FROM app_9e1318caf6_partner_state WHERE user_id = me;
  SELECT inviter_id INTO inv FROM app_9e1318caf6_partner_links WHERE user_id = me;
  SELECT count(*) INTO cnt FROM app_9e1318caf6_partner_links WHERE inviter_id = me;
  RETURN json_build_object('level', lv, 'pct', app_9e1318caf6_partner_pct(lv), 'goal', app_9e1318caf6_partner_goal(lv),
    'keep_min', floor(app_9e1318caf6_partner_goal(lv) * 0.2)::bigint, 'month_income', inc.month, 'partner_count', cnt,
    'income', json_build_object('today', inc.today, 'week', inc.week, 'month', inc.month, 'total', inc.total),
    'message_html', coalesce(msg, ''),
    'inviter', CASE WHEN inv IS NULL THEN NULL ELSE app_9e1318caf6_partner_person(inv) END);
END $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_list(p_q text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, public_id bigint, level integer, coins bigint, joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); q text := lower(regexp_replace(coalesce(trim(p_q), ''), '^@+', ''));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.public_id, k.o_level, coalesce(c.coins, 0)::bigint, l.joined_at
    FROM app_9e1318caf6_partner_links l
    JOIN app_9e1318caf6_profiles p ON p.id = l.user_id
    LEFT JOIN (SELECT partner_id, sum(pc.coins) AS coins FROM app_9e1318caf6_partner_commissions pc WHERE pc.inviter_id = me GROUP BY partner_id) c ON c.partner_id = l.user_id
    LEFT JOIN LATERAL app_9e1318caf6_partner_calc(p.id) k ON true
   WHERE l.inviter_id = me
     AND (q = '' OR p.public_id::text = q OR position(q IN lower(coalesce(p.username, ''))) > 0 OR position(q IN lower(coalesce(p.display_name, ''))) > 0)
   ORDER BY coalesce(c.coins, 0) DESC, l.joined_at DESC
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 100) OFFSET greatest(coalesce(p_offset, 0), 0);
END $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_preview(p_inviter uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_inviter) THEN RAISE EXCEPTION 'User not found'; END IF;
  RETURN json_build_object('inviter', app_9e1318caf6_partner_person(p_inviter), 'is_self', p_inviter = me,
    'has_partner', EXISTS (SELECT 1 FROM app_9e1318caf6_partner_links WHERE user_id = me));
END $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_join(p_inviter uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_inviter IS NULL OR p_inviter = me THEN RAISE EXCEPTION 'You can''t join your own partners'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_9e1318caf6_profiles WHERE id = p_inviter) THEN RAISE EXCEPTION 'User not found'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_partner_links WHERE user_id = me) THEN
    RAISE EXCEPTION 'You have already joined a partner. You can join only once, forever.'; END IF;
  IF EXISTS (SELECT 1 FROM app_9e1318caf6_partner_links WHERE user_id = p_inviter AND inviter_id = me) THEN
    RAISE EXCEPTION 'This user is already your partner, so you can''t join theirs.'; END IF;
  BEGIN
    INSERT INTO app_9e1318caf6_partner_links(user_id, inviter_id) VALUES (me, p_inviter);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You have already joined a partner. You can join only once, forever.';
  END;
  RETURN true;
END $f$;

CREATE OR REPLACE FUNCTION app_9e1318caf6_partner_set_message(p_html text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE me uuid := auth.uid(); h text := coalesce(p_html, '');
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF length(h) > 3000 THEN RAISE EXCEPTION 'Message is too long'; END IF;
  INSERT INTO app_9e1318caf6_partner_state(user_id, level, level_month, message_html) VALUES (me, 1, app_9e1318caf6_partner_cur_month(), h)
    ON CONFLICT (user_id) DO UPDATE SET message_html = EXCLUDED.message_html, updated_at = now();
  RETURN true;
END $f$;

-- ---------- gifts: unchanged except the partner commission hook ----------
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
  PERFORM app_9e1318caf6_partner_commission(me, gid, total);
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = me;
  RETURN json_build_object('coins', w.coins, 'spent', total, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance);
END $f$;

REVOKE ALL ON FUNCTION app_9e1318caf6_partner_month_income(uuid, text), app_9e1318caf6_partner_calc(uuid), app_9e1318caf6_partner_roll(uuid),
  app_9e1318caf6_partner_person(uuid), app_9e1318caf6_partner_commission(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_9e1318caf6_partner_overview(), app_9e1318caf6_partner_list(text, integer, integer), app_9e1318caf6_partner_preview(uuid),
  app_9e1318caf6_partner_join(uuid), app_9e1318caf6_partner_set_message(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_partner_overview(), app_9e1318caf6_partner_list(text, integer, integer), app_9e1318caf6_partner_preview(uuid),
  app_9e1318caf6_partner_join(uuid), app_9e1318caf6_partner_set_message(text) TO authenticated;

COMMIT;
