-- 043 · Boost by anybody: any signed-in user may boost any boostable video.
-- Root cause being fixed: migration 042 added `user_id = auth.uid()` to boost_video (owner-only); 030 only checked
-- that the video exists, and the UI never had an owner check.
-- Roles: PAYER (campaign.user_id) pays coins; OWNER (campaign.owner_id) is the video's author who receives the
-- reach, sees the progress overlay and gets the completion alert. The payer gets a status list and an alert too.
-- Counting: a real viewer action counts once per video+metric, allocated first-come-first-served to the oldest
-- running campaign, so two payers add up (goal A + goal B) and nothing is counted twice.
-- Idempotent. Everything stays server-side.
BEGIN;

-- 1. Owner column ------------------------------------------------------------------------------------------
ALTER TABLE app_9e1318caf6_boost_campaigns ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE app_9e1318caf6_boost_campaigns c
   SET owner_id = coalesce((SELECT p.user_id FROM app_9e1318caf6_posts p WHERE p.id = c.post_id), c.user_id)
 WHERE c.owner_id IS NULL;
ALTER TABLE app_9e1318caf6_boost_campaigns ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS app_9e1318caf6_boost_campaigns_owner_kind
  ON app_9e1318caf6_boost_campaigns(owner_id, kind) WHERE status = 'active';

-- Payer and owner may both read their own rows (Realtime respects this policy).
DROP POLICY IF EXISTS bc_select_own ON app_9e1318caf6_boost_campaigns;
CREATE POLICY bc_select_own ON app_9e1318caf6_boost_campaigns FOR SELECT
  USING (user_id = auth.uid() OR owner_id = auth.uid());

-- 2. One reach, one campaign -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_9e1318caf6_boost_reach_add(p_campaign bigint, p_viewer uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE c app_9e1318caf6_boost_campaigns; n integer; flipped boolean := false; unit text;
BEGIN
  IF p_campaign IS NULL OR p_viewer IS NULL THEN RETURN false; END IF;
  SELECT * INTO c FROM app_9e1318caf6_boost_campaigns WHERE id = p_campaign;
  -- neither the author nor the payer can generate reach for themselves
  IF c.id IS NULL OR c.status <> 'active' OR c.expires_at <= now() OR c.user_id = p_viewer OR c.owner_id = p_viewer THEN
    RETURN false;
  END IF;
  INSERT INTO app_9e1318caf6_boost_reach(campaign_id, user_id) VALUES (p_campaign, p_viewer) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE app_9e1318caf6_boost_campaigns
     SET delivered = LEAST(delivered + 1, goal), updated_at = now()
   WHERE id = p_campaign AND status = 'active'
   RETURNING delivered INTO n;
  IF n IS NULL THEN                                   -- lost a race with the completing transaction: give the slot back
    DELETE FROM app_9e1318caf6_boost_reach WHERE campaign_id = p_campaign AND user_id = p_viewer;
    RETURN false;
  END IF;
  IF n < c.goal THEN RETURN true; END IF;

  UPDATE app_9e1318caf6_boost_campaigns
     SET status = 'completed', completed_at = now(), notified_at = now(), updated_at = now()
   WHERE id = p_campaign AND status = 'active'
   RETURNING true INTO flipped;
  IF NOT coalesce(flipped, false) THEN RETURN true; END IF;   -- only the transaction that flips the status alerts

  unit := CASE c.kind WHEN 'views' THEN 'views' WHEN 'likes' THEN 'likes' WHEN 'comments' THEN 'comments'
                      WHEN 'profileViews' THEN 'profile views' ELSE 'live viewers' END;
  INSERT INTO app_9e1318caf6_notifications(user_id, actor_id, kind, text, ref_type, ref_id)
  VALUES (c.owner_id, CASE WHEN c.user_id <> c.owner_id THEN c.user_id END, 'boost_done',
          CASE WHEN c.user_id = c.owner_id
               THEN 'Your boost reached 100% — ' || to_char(c.goal, 'FM999G999G999') || ' ' || unit || ' reached. Your video is now shown like any other post.'
               ELSE 'boosted your video and it reached 100% — ' || to_char(c.goal, 'FM999G999G999') || ' ' || unit || ' reached. Your video is now shown like any other post.' END,
          CASE WHEN c.post_id IS NULL THEN 'profile' ELSE 'post' END, coalesce(c.post_id::text, c.owner_id::text));
  IF c.user_id <> c.owner_id THEN
    INSERT INTO app_9e1318caf6_notifications(user_id, actor_id, kind, text, ref_type, ref_id)
    VALUES (c.user_id, NULL, 'boost_done',
            'Your boost reached 100% — ' || to_char(c.goal, 'FM999G999G999') || ' ' || unit || ' reached on the video you boosted.',
            CASE WHEN c.post_id IS NULL THEN 'profile' ELSE 'post' END, coalesce(c.post_id::text, c.owner_id::text));
  END IF;
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_boost_reach_add(bigint, uuid) FROM PUBLIC, anon, authenticated;

-- Allocates ONE real action to ONE campaign (oldest first). A per-(metric, target, viewer) advisory lock
-- serialises concurrent taps, so the same person can never be counted by two campaigns.
CREATE OR REPLACE FUNCTION app_9e1318caf6_boost_count(p_kind text, p_post uuid, p_owner uuid, p_viewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r record; once boolean := p_kind IN ('views', 'likes', 'comments');
BEGIN
  IF p_viewer IS NULL THEN RETURN; END IF;
  IF once AND p_post IS NULL THEN RETURN; END IF;
  IF NOT once AND p_owner IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_kind || ':' || coalesce(p_post::text, p_owner::text) || ':' || p_viewer::text, 0));
  IF once THEN        -- a person's view/like/comment on a video is one reach, whichever campaign got it
    IF EXISTS (SELECT 1 FROM app_9e1318caf6_boost_reach x JOIN app_9e1318caf6_boost_campaigns c2 ON c2.id = x.campaign_id
                WHERE c2.post_id = p_post AND c2.kind = p_kind AND x.user_id = p_viewer) THEN RETURN; END IF;
  ELSE                -- profile opens / live joins repeat naturally: one reach per running family
    IF EXISTS (SELECT 1 FROM app_9e1318caf6_boost_reach x JOIN app_9e1318caf6_boost_campaigns c2 ON c2.id = x.campaign_id
                WHERE c2.owner_id = p_owner AND c2.kind = p_kind AND c2.status = 'active' AND x.user_id = p_viewer) THEN RETURN; END IF;
  END IF;
  FOR r IN SELECT c.id FROM app_9e1318caf6_boost_campaigns c
            WHERE c.kind = p_kind AND c.status = 'active' AND c.expires_at > now()
              AND CASE WHEN once THEN c.post_id = p_post ELSE c.owner_id = p_owner END
              AND c.user_id <> p_viewer AND c.owner_id <> p_viewer
            ORDER BY c.started_at, c.id LOOP
    IF app_9e1318caf6_boost_reach_add(r.id, p_viewer) THEN EXIT; END IF;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_boost_count(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_9e1318caf6_boost_count_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF TG_TABLE_NAME = 'app_9e1318caf6_post_views' THEN PERFORM app_9e1318caf6_boost_count('views', NEW.post_id, NULL, NEW.user_id);
  ELSIF TG_TABLE_NAME = 'app_9e1318caf6_likes' THEN PERFORM app_9e1318caf6_boost_count('likes', NEW.post_id, NULL, NEW.user_id);
  ELSIF TG_TABLE_NAME = 'app_9e1318caf6_comments' THEN PERFORM app_9e1318caf6_boost_count('comments', NEW.post_id, NULL, NEW.user_id);
  ELSIF TG_TABLE_NAME = 'app_9e1318caf6_live_viewers' THEN
    PERFORM app_9e1318caf6_boost_count('liveViewers', NULL,
      (SELECT lr.host_id FROM app_9e1318caf6_live_rooms lr WHERE lr.id = NEW.room_id), NEW.user_id);
  END IF;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_boost_count_trg() FROM PUBLIC, anon, authenticated;

-- Profile opens now count directly (the table stays as a once-per-pair log).
DROP TRIGGER IF EXISTS zz_boost_profile_views ON app_9e1318caf6_profile_views;
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_record_profile_view(p_profile uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF auth.uid() IS NULL OR p_profile IS NULL OR p_profile = auth.uid() THEN RETURN; END IF;
  INSERT INTO app_9e1318caf6_profile_views(profile_id, viewer_id) VALUES (p_profile, auth.uid()) ON CONFLICT DO NOTHING;
  PERFORM app_9e1318caf6_boost_count('profileViews', NULL, p_profile, auth.uid());
END $f$;
REVOKE ALL ON FUNCTION app_9e1318caf6_record_profile_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_record_profile_view(uuid) TO authenticated;

-- 3. Purchase: the owner restriction is gone -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_boost_video(p_post uuid, p_kind text, p_qty integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r numeric; a integer[]; d integer := 0; price integer; w app_9e1318caf6_wallets;
        res json; bid bigint; cid bigint; p uuid; own uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT l.rate, l.amounts INTO r, a FROM app_9e1318caf6_boost_ladder(p_kind) l;
  IF r IS NULL THEN RAISE EXCEPTION 'invalid boost type'; END IF;
  IF p_qty IS NULL OR p_qty < a[1] OR p_qty > a[12] * 5 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  p := p_post;
  IF p_kind IN ('views', 'likes', 'comments') AND p IS NULL THEN RAISE EXCEPTION 'video not found'; END IF;
  IF p IS NOT NULL THEN
    -- anybody may boost any published, publicly visible video; the author may always boost their own
    SELECT user_id INTO own FROM app_9e1318caf6_posts
     WHERE id = p AND status = 'published'
       AND (coalesce(privacy, 'everyone') = 'everyone' OR user_id = auth.uid());
    IF own IS NULL THEN RAISE EXCEPTION 'This video can''t be boosted'; END IF;
  ELSE
    own := auth.uid();
  END IF;
  IF p_qty >= a[11] THEN d := 15; ELSIF p_qty >= a[9] THEN d := 10; ELSIF p_qty >= a[5] THEN d := 5; END IF;
  price := greatest(1, ceil(p_qty * r * (100 - d) / 100.0 - 1e-9))::integer;
  -- the PAYER's wallet is charged by the unchanged ledger function (100 % platform revenue, nobody earns)
  res := app_9e1318caf6_spend(auth.uid(), price, 'boost', 'Boost ' || p_kind, '+' || p_qty || ' ' || p_kind);
  INSERT INTO app_9e1318caf6_video_boosts(user_id, post_id, kind, quantity, coins, discount)
    VALUES (auth.uid(), p, p_kind, p_qty, price, d) RETURNING id INTO bid;
  INSERT INTO app_9e1318caf6_boost_campaigns(boost_id, user_id, owner_id, post_id, kind, goal)
    VALUES (bid, auth.uid(), own, p, p_kind, p_qty) RETURNING id INTO cid;
  SELECT * INTO w FROM app_9e1318caf6_wallets WHERE user_id = auth.uid();
  RETURN json_build_object('coins', w.coins, 'purchased', w.purchased_balance, 'earnings', w.earnings_balance,
                           'price', price, 'discount', d, 'campaign_id', cid, 'goal', p_qty, 'for_other', own <> auth.uid());
END $$;
REVOKE ALL ON FUNCTION app_9e1318caf6_boost_video(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_boost_video(uuid, text, integer) TO authenticated;

-- 4. Who sees what -------------------------------------------------------------------------------------------
-- OWNER: progress for every running boost on their videos, whoever paid.
DROP FUNCTION IF EXISTS public.app_9e1318caf6_my_boosts();
CREATE FUNCTION public.app_9e1318caf6_my_boosts()
RETURNS TABLE(campaign_id bigint, post_id uuid, kind text, goal integer, delivered integer, remaining integer,
              pct integer, status text, started_at timestamptz, completed_at timestamptz, paid_by_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT c.id, c.post_id, c.kind, c.goal, c.delivered, greatest(c.goal - c.delivered, 0),
         least(100, floor(c.delivered * 100.0 / greatest(c.goal, 1))::integer), c.status,
         c.started_at, c.completed_at, c.user_id = c.owner_id
    FROM app_9e1318caf6_boost_campaigns c
   WHERE c.owner_id = auth.uid() AND c.post_id IS NOT NULL
   ORDER BY (c.status = 'active') DESC, c.started_at DESC
$f$;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_my_boosts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_my_boosts() TO authenticated;

-- PAYER: status of every boost they paid for (including other people's videos).
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_my_paid_boosts()
RETURNS TABLE(campaign_id bigint, post_id uuid, owner_id uuid, owner_username text, caption text, kind text,
              goal integer, delivered integer, remaining integer, pct integer, status text,
              started_at timestamptz, completed_at timestamptz, for_other boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT c.id, c.post_id, c.owner_id, pr.username, left(coalesce(p.caption, ''), 60), c.kind,
         c.goal, c.delivered, greatest(c.goal - c.delivered, 0),
         least(100, floor(c.delivered * 100.0 / greatest(c.goal, 1))::integer), c.status,
         c.started_at, c.completed_at, c.owner_id <> c.user_id
    FROM app_9e1318caf6_boost_campaigns c
    LEFT JOIN app_9e1318caf6_posts p ON p.id = c.post_id
    LEFT JOIN app_9e1318caf6_profiles pr ON pr.id = c.owner_id
   WHERE c.user_id = auth.uid()
   ORDER BY (c.status = 'active') DESC, c.started_at DESC
   LIMIT 50
$f$;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_my_paid_boosts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_my_paid_boosts() TO authenticated;

-- 5. Feed: pin for everybody who can still add reach -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_feed_for_you(p_offset integer DEFAULT 0, p_limit integer DEFAULT 8)
RETURNS SETOF app_9e1318caf6_posts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with me as (select auth.uid() uid),
  base as (
    select p.*, coalesce(s.score, 0) sc,
      exists (select 1 from app_9e1318caf6_view_events e, me where e.post_id = p.id and e.user_id = me.uid) seen,
      exists (select 1 from app_9e1318caf6_follows f, me where f.follower_id = me.uid and f.following_id = p.user_id) fol
    from app_9e1318caf6_posts p left join app_9e1318caf6_post_scores s on s.post_id = p.id, me
    where p.status in ('published', 'scheduled') and p.publish_at <= now()
      and (coalesce(p.privacy, 'everyone') = 'everyone' or p.user_id = me.uid)
      and coalesce(p.stream_status, 'ready') <> 'error'
  ),
  tagged as (
    select b.*, case
      when b.publish_at > now() - interval '48 hours' and b.sc < 0.05 then 'new'
      when b.fol then 'follow' else 'rank' end bucket
    from base b
  ),
  ordered as (
    select t.*,
      row_number() over (partition by t.bucket order by t.seen, t.sc desc, t.publish_at desc) rb,
      row_number() over (partition by t.user_id order by t.seen, t.sc desc, t.publish_at desc) ra
    from tagged t
  ),
  mixed as (
    select o.*, (o.rb::real / case o.bucket when 'rank' then 0.7 when 'follow' then 0.2 else 0.1 end) pos
    from ordered o where o.ra <= 2 + (p_offset / 8)
  ),
  pin as (
    select c.id cid, c.post_id, c.goal, c.delivered, c.started_at,
      exists (select 1 from app_9e1318caf6_view_events e where e.post_id = c.post_id and e.user_id = me.uid) seen
      from app_9e1318caf6_boost_campaigns c
      join app_9e1318caf6_posts p on p.id = c.post_id, me
     where c.status = 'active' and c.post_id is not null and c.expires_at > now()
       -- neither the author nor the payer needs the pin
       and c.user_id is distinct from me.uid and c.owner_id is distinct from me.uid
       -- someone who already gave this metric on this video cannot add reach: no repeat pinning
       and case when c.kind in ('views', 'likes', 'comments')
             then not exists (select 1 from app_9e1318caf6_boost_reach r join app_9e1318caf6_boost_campaigns c2 on c2.id = r.campaign_id
                               where c2.post_id = c.post_id and c2.kind = c.kind and r.user_id = me.uid)
              and case c.kind
                    when 'views' then not exists (select 1 from app_9e1318caf6_post_views v where v.post_id = c.post_id and v.user_id = me.uid)
                    when 'likes' then not exists (select 1 from app_9e1318caf6_likes l where l.post_id = c.post_id and l.user_id = me.uid)
                    else not exists (select 1 from app_9e1318caf6_comments m where m.post_id = c.post_id and m.user_id = me.uid) end
             else not exists (select 1 from app_9e1318caf6_boost_reach r join app_9e1318caf6_boost_campaigns c2 on c2.id = r.campaign_id
                               where c2.owner_id = c.owner_id and c2.kind = c.kind and c2.status = 'active' and r.user_id = me.uid)
           end
       and p.status in ('published', 'scheduled') and p.publish_at <= now()
       and (coalesce(p.privacy, 'everyone') = 'everyone' or p.user_id = me.uid)
       and coalesce(p.stream_status, 'ready') <> 'error'
  ),
  pin_fair as (
    select x.*, row_number() over (
      order by x.seen, (x.goal - x.delivered)::real / greatest(x.goal, 1) desc, x.started_at, x.cid) fair
      from pin x
  ),
  pin_one as (
    select distinct on (p.user_id) f.post_id, f.fair
      from pin_fair f join app_9e1318caf6_posts p on p.id = f.post_id
     order by p.user_id, f.fair
  ),
  pin_top as (
    select t.post_id, row_number() over (order by t.fair) slot from pin_one t
  ),
  pin_n as (select count(*)::integer n from pin_top where slot <= 2),
  organic as (
    select m.id, row_number() over (order by m.seen, m.pos, m.sc desc) ord
      from mixed m
     where not exists (select 1 from pin_top t where t.post_id = m.id and t.slot <= 2)
  ),
  seat as (select greatest(p_offset - (select n from pin_n), 0) lo)
  select (m.*)::app_9e1318caf6_posts from (
    select t.post_id id, 0 grp, t.slot::bigint ord
      from pin_top t where t.slot <= 2 and p_offset = 0
    union all
    select o.id, 1 grp, o.ord
      from organic o, seat s
     where o.ord > s.lo and o.ord <= s.lo + p_limit
  ) pick join app_9e1318caf6_posts m on m.id = pick.id
  order by pick.grp, pick.ord
$function$;
GRANT EXECUTE ON FUNCTION app_9e1318caf6_feed_for_you(integer, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
