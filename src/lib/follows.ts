import { useEffect, useState } from 'react';
import { supabase, T } from './supabase';

/** App-wide cache of who the current user follows (one batched query), shared by Feed, Fullscreen and Profiles. */
let ids = new Set<string>();
let loadedFor: string | null = null;
let pending: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export async function loadFollowing(force = false): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id ?? null;
  if (!me) { ids = new Set(); loadedFor = null; emit(); return; }
  if (!force && loadedFor === me) return;
  if (pending && !force) return pending;
  pending = (async () => {
    const r = await supabase.from(T.follows).select('following_id').eq('follower_id', me).limit(5000);
    if (!r.error) { ids = new Set((r.data ?? []).map((x: { following_id: string }) => x.following_id)); loadedFor = me; emit(); }
  })().finally(() => { pending = null; });
  return pending;
}
export function markFollowing(id: string, on: boolean) {
  const next = new Set(ids);
  if (on) next.add(id); else next.delete(id);
  ids = next; emit();
}
/** Live snapshot of every id the current user follows (same shared cache). */
export function useFollowingIds(): Set<string> {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f); void loadFollowing();
    return () => { subs.delete(f); };
  }, []);
  return ids;
}
export function useIsFollowing(id: string | undefined): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f); void loadFollowing();
    return () => { subs.delete(f); };
  }, []);
  return !!id && ids.has(id);
}
