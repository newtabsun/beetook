-- Google Play Console product IDs now end with "_01" (coins_099_01 … coins_29999_01).
UPDATE app_9e1318caf6_wallet_config
   SET value = jsonb_set(value, '{google_play}',
         (SELECT jsonb_agg(jsonb_set(e, '{productId}', to_jsonb((e->>'productId') || '_01')) ORDER BY (e->>'priceUsd')::numeric)
            FROM jsonb_array_elements(value->'google_play') e
           WHERE (e->>'productId') !~ '_01$')),
       updated_at = now()
 WHERE key = 'coin_packs'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(value->'google_play') x WHERE (x->>'productId') ~ '_01$');
