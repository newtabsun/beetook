// Go Live access: VIP, or at least LIVE_FREE_FOLLOWERS followers (VIP not needed then).
// The server enforces the same rule (migration 044); this check only gives a friendly message before the request.
import { supabase, T } from './supabase';
import { liveAllowed } from './liveRule';

export interface LiveAccess { allowed: boolean; vip: boolean; followers: number }

export async function liveAccess(): Promise<LiveAccess> {
  const { data } = await supabase.auth.getSession();
  const me = data.session?.user.id;
  if (!me) return { allowed: false, vip: false, followers: 0 };
  const [vip, prof] = await Promise.all([
    supabase.rpc('app_9e1318caf6_vip_ids', { p_ids: [me] }),
    supabase.from(T.profiles).select('followers_count').eq('id', me).maybeSingle(),
  ]);
  const isVip = ((vip.data as string[] | null) ?? []).includes(me);
  const followers = Number((prof.data as { followers_count?: number } | null)?.followers_count ?? 0);
  return { allowed: liveAllowed(isVip, followers), vip: isVip, followers };
}

export async function canGoLive(): Promise<boolean> {
  return (await liveAccess()).allowed;
}
