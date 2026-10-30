-- 041 · One gift catalog in the database (single source of truth for id, name, price, tier).
-- Before: prices lived in a hardcoded VALUES list inside gift_price() and in a client copy (src/lib/gifts.ts).
-- Now:    gift_catalog table (read-only for clients) + gift_price() reads it. send_gift() is unchanged: it still
--         takes only (recipient, gift id, qty, room, post); the price always comes from the catalog, never from the client.
-- The 14 legacy gifts keep their ids and prices; 21 new gifts raise the top price to 300,000 coins. Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_gift_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  emoji text NOT NULL,
  coins integer NOT NULL CHECK (coins BETWEEN 1 AND 300000),
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 5),
  sort_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_9e1318caf6_gift_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gift_catalog_read ON public.app_9e1318caf6_gift_catalog;
CREATE POLICY gift_catalog_read ON public.app_9e1318caf6_gift_catalog FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.app_9e1318caf6_gift_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_gift_catalog TO anon, authenticated;

-- tier: 1 Basic ≤50 · 2 Popular ≤500 · 3 Premium ≤5,000 · 4 Elite ≤30,000 · 5 Legendary >30,000
INSERT INTO public.app_9e1318caf6_gift_catalog (id, name, emoji, coins, tier, sort_order) VALUES
  ('clover','Lucky Clover','🍀',5,1,5),('rose','Rose','🌹',10,1,10),('heart','Heart','💖',15,1,15),
  ('icecream','Ice Cream','🍦',20,1,20),('coffee','Coffee','☕',25,1,25),('beer','Beer','🍺',30,1,30),
  ('starlight','Starlight','⭐',40,1,40),('perfume','Perfume','🌸',50,1,50),
  ('cake','Cake','🎂',60,2,60),('moonbeam','Moonbeam','🌙',70,2,70),('teddy','Teddy Bear','🧸',80,2,80),
  ('bee','Golden Bee','🐝',99,2,99),('sunburst','Sunburst','☀️',120,2,120),('fireworks','Fireworks','🎆',150,2,150),
  ('diamond','Diamond','💎',200,2,200),('ember','Ember Flame','🔥',250,2,250),('rocket','Rocket','🚀',300,2,300),
  ('wings','Angel Wings','🪽',400,2,400),('crown','Crown','👑',500,2,500),
  ('aurora','Aurora Gem','💠',700,3,700),('castle','Castle','🏰',1000,3,1000),('trophy','Golden Trophy','🏆',1500,3,1500),
  ('nebula','Nebula','🌌',2500,3,2500),('ship','Royal Ship','🚢',4000,3,4000),
  ('shield','Knight Shield','🛡️',6000,4,6000),('phoenix','Phoenix','🦅',10000,4,10000),('sapphire','Blue Sapphire','💙',15000,4,15000),
  ('throne','Royal Hall','🏛️',20000,4,20000),('comet','Comet','☄️',30000,4,30000),
  ('palace','Grand Palace','🏯',50000,5,50000),('dragon','Dragon Spirit','🐉',80000,5,80000),('emperor','Emperor','🤴',120000,5,120000),
  ('universe','Universe','🪐',180000,5,180000),('eternity','Eternal Ring','💍',240000,5,240000),('majesty','Majesty','🌟',300000,5,300000)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, tier = EXCLUDED.tier, sort_order = EXCLUDED.sort_order;
-- (coins is never overwritten on re-run: prices of existing ids stay as they are)

-- Same signature as before; now reads the catalog (inactive or unknown gifts → NULL → send_gift raises 'invalid gift').
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_gift_price(p_gift text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT c.coins FROM app_9e1318caf6_gift_catalog c WHERE c.id = p_gift AND c.active
$f$;

NOTIFY pgrst, 'reload schema';
COMMIT;
