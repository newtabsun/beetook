/** Gift catalog: the single source of truth is the `gift_catalog` table. Names, emoji, tiers and prices are only
 *  displayed here; the send_gift RPC re-reads the price from the same table, so the client never decides what a gift costs. */
import { useCallback, useEffect, useState } from 'react';
import { supabase, T } from './supabase';

export type GiftTier = 1 | 2 | 3 | 4 | 5;
export interface GiftItem { id: string; emoji: string; name: string; coins: number; price: number; tier: GiftTier; sort_order: number }

/** Presentation per tier (colors used by emblems, picker headers and the full-screen animation). */
export const TIERS: Record<GiftTier, { label: string; c1: string; c2: string; dark: string }> = {
  1: { label: 'Basic', c1: '#7DD3FC', c2: '#0EA5E9', dark: '#0B2A3D' },
  2: { label: 'Popular', c1: '#FDE68A', c2: '#F59E0B', dark: '#3A2606' },
  3: { label: 'Premium', c1: '#F9A8D4', c2: '#DB2777', dark: '#3B0A27' },
  4: { label: 'Elite', c1: '#FCA5A5', c2: '#DC2626', dark: '#3B0B0B' },
  5: { label: 'Legendary', c1: '#FDE047', c2: '#A855F7', dark: '#24083D' },
};

const TTL_MS = 5 * 60_000;
let cache: GiftItem[] | null = null;
let loadedAt = 0;
let inflight: Promise<GiftItem[]> | null = null;

export function loadGiftCatalog(force = false): Promise<GiftItem[]> {
  if (cache && !force && Date.now() - loadedAt < TTL_MS) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase.from(T.giftCatalog).select('id,name,emoji,coins,tier,sort_order').eq('active', true).order('sort_order');
    if (error) throw new Error(error.message);
    cache = (data ?? []).map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, coins: Number(g.coins), price: Number(g.coins), tier: Number(g.tier) as GiftTier, sort_order: Number(g.sort_order) }));
    loadedAt = Date.now();
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}

export const giftById = (id: string): GiftItem | undefined => cache?.find((g) => g.id === id);

export function useGiftCatalog() {
  const [gifts, setGifts] = useState<GiftItem[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  useEffect(() => {
    let alive = true;
    loadGiftCatalog().then((g) => { if (alive) setGifts(g); }).catch(() => undefined).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const reload = useCallback(() => {
    setLoading(true);
    loadGiftCatalog(true).then(setGifts).catch(() => undefined).finally(() => setLoading(false));
  }, []);
  return { gifts, loading, reload };
}

/** Wallet history stores the sub-title as "<gift id> ×<qty>"; show "🌹 Rose ×3" when the id is in the catalog. */
export function giftSubLabel(sub: string): string {
  const m = /^([a-z0-9_]+) [×x](\d+)$/.exec(sub);
  const g = m ? giftById(m[1]) : undefined;
  return g && m ? `${g.emoji} ${g.name} ×${m[2]}` : sub;
}

/** Truncated compact count: 999→999, 1999→1.9k, 1_000_000→1M. */
export function formatGiftCount(n: number): string {
  const t = (v: number) => (Math.floor(v * 10) / 10).toString();
  if (n >= 1_000_000) return `${t(n / 1_000_000)}M`;
  if (n >= 1_000) return `${t(n / 1_000)}k`;
  return String(n);
}
export const formatCoins = (n: number) => n.toLocaleString('en-US');
