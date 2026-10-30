// Boost packages — identical to app/frontend/src/lib/boost.ts. Price is re-computed server-side (009).
import { supabase } from './supabase';

export type BoostKind = 'views' | 'likes' | 'comments' | 'profileViews' | 'liveViewers';

export interface BoostType { kind: BoostKind; tab: string; unit: string; rate: number; amounts: number[]; example: [number, number] }

export const BOOST_TYPES: BoostType[] = [
  { kind: 'views', tab: 'Video views', unit: 'views', rate: 0.5, example: [500, 250],
    amounts: [500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6] },
  { kind: 'likes', tab: 'Likes', unit: 'likes', rate: 12.5, example: [4, 50],
    amounts: [4, 10, 20, 40, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4] },
  { kind: 'comments', tab: 'Comments', unit: 'comments', rate: 25, example: [2, 50],
    amounts: [2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4] },
  { kind: 'profileViews', tab: 'Profile views', unit: 'profile views', rate: 5, example: [20, 100],
    amounts: [20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5] },
  { kind: 'liveViewers', tab: 'Live viewers', unit: 'live viewers', rate: 10, example: [1, 10],
    amounts: [10, 25, 50, 100, 250, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4] },
];

export function discountFor(type: BoostType, amount: number): number {
  const a = type.amounts;
  if (amount >= a[10]) return 15;
  if (amount >= a[8]) return 10;
  if (amount >= a[4]) return 5;
  return 0;
}
export const priceFor = (t: BoostType, n: number) => Math.max(1, Math.ceil(n * t.rate * (1 - discountFor(t, n) / 100) - 1e-9));
export const basePriceFor = (t: BoostType, n: number) => Math.ceil(n * t.rate - 1e-9);
export const customLimits = (t: BoostType) => ({ min: t.amounts[0], max: t.amounts[t.amounts.length - 1] * 5 });

export async function boostVideo(postId: string, kind: BoostKind, qty: number): Promise<{ coins: number; price: number; campaign_id?: number; goal?: number; for_other?: boolean }> {
  const { data, error } = await supabase.rpc('app_9e1318caf6_boost_video', { p_post: postId, p_kind: kind, p_qty: qty });
  if (error) throw new Error(error.message);
  return data as { coins: number; price: number; campaign_id?: number; goal?: number; for_other?: boolean };
}

/** A running purchase: `delivered` counts distinct viewers, so it never rises twice for the same person. */
export interface BoostProgress {
  campaign_id: number; post_id: string; kind: BoostKind;
  goal: number; delivered: number; remaining: number; pct: number;
  status: 'active' | 'completed' | 'expired';
  started_at?: string;
}

/** A boost the current user paid for — possibly on someone else's video (owner_id is the video's author). */
export interface PaidBoost extends BoostProgress {
  owner_id: string; owner_username: string | null; caption: string | null; for_other: boolean;
}

/** Campaigns where the caller owns the boosted video: what the profile grid overlay draws. */
export async function fetchMyBoosts(): Promise<BoostProgress[]> {
  const { data, error } = await supabase.rpc('app_9e1318caf6_my_boosts');
  if (error) return []; // older backend: no overlay rather than a broken profile
  return (data ?? []) as BoostProgress[];
}

/** Campaigns where the caller paid the coins (own videos and other people's videos). */
export async function fetchMyPaidBoosts(): Promise<PaidBoost[]> {
  const r = await supabase.rpc('app_9e1318caf6_my_paid_boosts');
  return r.error ? [] : ((r.data ?? []) as PaidBoost[]);
}

/**
 * Progress per post, summing campaigns of the same kind. Two people boosting one video add up: the deliveries
 * are allocated oldest-campaign-first, so the totals never overlap. When a post carries several metrics the
 * one with the most outstanding work is shown, always labelled with its unit.
 */
export function activeBoosts(campaigns: BoostProgress[]): Record<string, BoostProgress> {
  const merged = new Map<string, BoostProgress>();
  for (const c of campaigns) {
    if (c.status !== 'active' || !c.post_id) continue;
    const key = `${c.post_id}|${c.kind}`;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, { ...c }); continue; }
    const goal = prev.goal + c.goal;
    const delivered = prev.delivered + c.delivered;
    const earlier = (prev.started_at ?? '') < (c.started_at ?? '') ? prev : c;
    merged.set(key, {
      ...prev, campaign_id: earlier.campaign_id, goal, delivered,
      remaining: Math.max(goal - delivered, 0),
      pct: Math.min(100, Math.floor((delivered * 100) / Math.max(goal, 1))),
      started_at: earlier.started_at,
    });
  }
  const out: Record<string, BoostProgress> = {};
  for (const c of merged.values()) {
    const cur = out[c.post_id];
    if (!cur || c.remaining > cur.remaining) out[c.post_id] = c;
  }
  return out;
}

/** Opening someone's profile is the metric behind "profile views" boosts (server dedupes per viewer). */
export async function recordProfileView(userId: string): Promise<void> {
  if (!userId) return;
  try { await supabase.rpc('app_9e1318caf6_record_profile_view', { p_profile: userId }); } catch { /* best effort */ }
}
