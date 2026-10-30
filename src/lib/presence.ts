// Online presence + live status, shared by every avatar.
// Online = in the global Realtime Presence channel (app open & foreground, any screen)
// OR server heartbeat last_seen_at within 2 min (RPC, covers brief socket drops).
// No touch/activity requirement: idle users (e.g. long Live sessions) stay online.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, T } from './supabase';
import type { LiveRoom } from './api';
import { isAppActive } from './appActive';

const RPC_TOUCH = 'app_9e1318caf6_touch_presence';
const RPC_ONLINE = 'app_9e1318caf6_online_ids';
const HEARTBEAT_MS = 45_000;
const RECHECK_MS = 60_000;
/** Live list is pushed by Realtime; this slow poll only repairs a missed event. */
const LIVE_RECHECK_MS = 60_000;
/** Several live-table changes in a row (viewer peaks, settings) → one refresh. */
const LIVE_DEBOUNCE_MS = 3_000;
/** Only what avatars and openLive() need (no stickers/settings payload). */
const LIVE_COLS = 'id,host_id,title,category,cover_url,created_at,mode,layout,bg';

const present = new Set<string>();
const recent = new Set<string>();
const watched = new Set<string>();
const live = new Map<string, LiveRoom>();
const subs = new Set<() => void>();
let self: string | null = null;
const emit = () => subs.forEach((f) => f());

/** Instant "live ended" between apps (Realtime broadcast): the ring disappears at once, even where the DB row is hidden. */
let bus: RealtimeChannel | null = null;
const endedCbs = new Set<(roomId: string, hostId: string) => void>();
/** Drops a host's LIVE ring at once (live ended / found ended). */
export function markLiveEnded(hostId: string, roomId?: string) {
  const r = live.get(hostId);
  if (r && (!roomId || r.id === roomId)) { live.delete(hostId); emit(); }
}
export function onLiveEnded(cb: (roomId: string, hostId: string) => void): () => void { endedCbs.add(cb); return () => { endedCbs.delete(cb); }; }
/** Host: tell every open app that this live ended (rings + viewers), then the DB / LiveKit close follows. */
export function announceLiveEnded(roomId: string, hostId: string) {
  markLiveEnded(hostId, roomId);
  void bus?.send({ type: 'broadcast', event: 'ended', payload: { roomId, hostId } }).catch(() => undefined);
}

let liveHandler: ((room: LiveRoom) => void) | null = null;
export function setLiveNavigator(h: (room: LiveRoom) => void): () => void {
  liveHandler = h;
  return () => { if (liveHandler === h) liveHandler = null; };
}
export function openLive(room: LiveRoom): void { liveHandler?.(room); }

async function refreshRecent() {
  const ids = [...watched];
  if (!ids.length) return;
  const { data, error } = await supabase.rpc(RPC_ONLINE, { p_ids: ids });
  if (error) return; // migration 015 not applied → Presence alone decides
  recent.clear();
  ((data as string[] | null) ?? []).forEach((id) => recent.add(id));
  emit();
}

async function refreshLive() {
  const query = (cols: string) => supabase.from(T.live).select(cols).eq('is_live', true).limit(500);
  let res = await query(LIVE_COLS);
  if (res.error) res = await query('*'); // older schema without one of the columns
  if (res.error) return;
  live.clear();
  ((res.data as unknown as LiveRoom[] | null) ?? []).forEach((r) => { if (!live.has(r.host_id)) live.set(r.host_id, r); });
  emit();
}

let liveTimer: ReturnType<typeof setTimeout> | null = null;
function refreshLiveSoon() {
  if (liveTimer || !isAppActive()) return;
  liveTimer = setTimeout(() => { liveTimer = null; void refreshLive(); }, LIVE_DEBOUNCE_MS);
}

let watchTimer: ReturnType<typeof setTimeout> | null = null;
function watch(id: string) {
  if (watched.has(id)) return;
  watched.add(id);
  if (!watchTimer) watchTimer = setTimeout(() => { watchTimer = null; void refreshRecent(); }, 50);
}

/** Starts presence for the logged-in user; returns cleanup (call on logout/unmount). */
export function startPresence(userId: string): () => void {
  self = userId;
  const touch = (online: boolean) => void supabase.rpc(RPC_TOUCH, { p_online: online }).then(() => undefined, () => undefined);
  const ch: RealtimeChannel = supabase.channel('app-online-users', { config: { presence: { key: userId } } });
  let tracked = false;
  ch.on('presence', { event: 'sync' }, () => {
    present.clear();
    Object.keys(ch.presenceState()).forEach((k) => present.add(k));
    emit();
  });
  const goOnline = () => { if (!tracked) { tracked = true; void ch.track({ at: Date.now() }); } touch(true); };
  const goOffline = () => { if (tracked) { tracked = false; void ch.untrack(); } touch(false); };
  ch.subscribe((status) => { if (status === 'SUBSCRIBED' && AppState.currentState !== 'background') goOnline(); });

  const liveCh = supabase.channel(`live-status-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: T.live }, (payload) => {
      const n = (payload as { new?: { id?: string; host_id?: string; is_live?: boolean } }).new;
      if (n?.host_id && n.is_live === false) markLiveEnded(n.host_id, n.id); // ended: ring off now, no debounce
      refreshLiveSoon();
    })
    .subscribe();
  bus = supabase.channel('live-status-bus')
    .on('broadcast', { event: 'ended' }, ({ payload }) => {
      const p = payload as { roomId?: string; hostId?: string };
      if (!p.roomId || !p.hostId) return;
      markLiveEnded(p.hostId, p.roomId);
      endedCbs.forEach((f) => f(p.roomId!, p.hostId!));
    })
    .subscribe();
  void refreshLive();

  const beat = setInterval(() => { if (tracked && isAppActive()) touch(true); }, HEARTBEAT_MS);
  const recheck = setInterval(() => { if (isAppActive()) void refreshRecent(); }, RECHECK_MS);
  const liveCheck = setInterval(() => { if (isAppActive()) void refreshLive(); }, LIVE_RECHECK_MS);
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') { goOnline(); void refreshRecent(); void refreshLive(); } else if (s === 'background') goOffline();
  });
  return () => {
    clearInterval(beat); clearInterval(recheck); clearInterval(liveCheck); app.remove();
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
    goOffline();
    void supabase.removeChannel(ch); void supabase.removeChannel(liveCh);
    if (bus) { void supabase.removeChannel(bus); bus = null; }
    if (self === userId) self = null;
    present.clear(); recent.clear(); live.clear(); emit();
  };
}

/** Realtime status of a user: live room (takes precedence) and online flag. */
export function useUserStatus(id?: string | null): { online: boolean; room: LiveRoom | null } {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    if (id) watch(id);
    return () => { subs.delete(f); };
  }, [id]);
  if (!id) return { online: false, room: null };
  // Own online dot is hidden from oneself (others still see it); own LIVE ring stays.
  return { online: id !== self && (present.has(id) || recent.has(id)), room: live.get(id) ?? null };
}
