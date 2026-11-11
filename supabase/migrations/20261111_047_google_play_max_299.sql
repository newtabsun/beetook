-- Google Play packs are capped at $299.99: the $399.99 pack (coins_39999) is removed from the sellable list.
UPDATE app_9e1318caf6_wallet_config
   SET value = jsonb_set(value, '{google_play}',
         (SELECT coalesce(jsonb_agg(e ORDER BY (e->>'priceUsd')::numeric), '[]'::jsonb)
            FROM jsonb_array_elements(value->'google_play') e
           WHERE (e->>'priceUsd')::numeric <= 299.99)),
       updated_at = now()
 WHERE key = 'coin_packs';
