// Inbox unread counters (alerts + messages).
// Cost model: ONE cheap RPC (counts capped at 100) on start, on return to foreground and after local reads;
// ONE Realtime channel per user (INSERT/UPDATE only, filtered by user) that adjusts the counters locally;
// reads are batched (one UPDATE per 600 ms burst). No polling, no per-event refetch of lists.
import { useSyncExternalStore } from 'react';
import { fetchUnreadCounts, markNotificationsRead, type Notification } from './api';
import { onAppActiveChange } from './appActive';
import { friendlyError } from './errors';
import { notify } from './notify';
import { invalidate } from './swr';
import { supabase, T } from './supabase';

export const UNREAD_CAP = 100;
export type UnreadCounts = { alerts: number; messages: number };

let counts: UnreadCounts = { alerts: 0, messages: 0 };
let owner: string | null = null;
const subs = new Set<() => void>();
const clamp = (n: number) => Math.max(0, Math.min(UNREAD_CAP, Math.round(n) || 0));

function commit(next: UnreadCounts) {
  if (next.alerts === counts.alerts && next.messages === counts.messages) return;
  counts = next;
  subs.forEach((f) => f());
}
export const getUnread = () => counts;
export const setUnread = (next: UnreadCounts) => commit({ alerts: clamp(next.alerts), messages: clamp(next.messages) });
export function useUnread(): UnreadCounts {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getUnread, getUnread);
}

let inflight: Promise<void> | null = null;
/** Re-reads the counters from the server (shared while one request is running). */
export function refreshUnread(): Promise<void> {
  if (!owner) return Promise.resolve();
  if (!inflight) {
    inflight = fetchUnreadCounts().then(setUnread).catch(() => undefined).finally(() => { inflight = null; });
  }
  return inflight;
}
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
export function refreshUnreadSoon(ms = 800) {
  if (resyncTimer) clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => { resyncTimer = null; void refreshUnread(); }, ms);
}
/** Optimistic change; when the shown number was capped the real one is unknown, so it is re-read once. */
export function adjustUnread(kind: keyof UnreadCounts, delta: number) {
  const was = counts[kind];
  commit({ ...counts, [kind]: clamp(was + delta) });
  if (delta < 0 && was >= UNREAD_CAP) refreshUnreadSoon(1500);
}

/** Our own writes also come back as UPDATE events; ignore those for a few seconds instead of refetching. */
let quietUntil = 0;
export const markLocalWrite = () => { quietUntil = Date.now() + 4000; };

// ---- batched "mark one read" ----
const pending = new Map<string, () => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
async function flushReads() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!pending.size) return;
  const batch = new Map(pending);
  pending.clear();
  markLocalWrite();
  try { await markNotificationsRead([...batch.keys()]); }
  catch (e) { batch.forEach((undo) => undo()); notify('Could not mark as read', friendlyError(e)); void refreshUnread(); }
}
/** Queues one alert as read; `undo` restores the UI if the database write fails. */
export function queueNotificationRead(id: string, undo: () => void) {
  pending.set(id, undo);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushReads(), 600);
}

// ---- new-alert listeners (the open Alerts list prepends the row) ----
const noteListeners = new Set<(row: Notification) => void>();
export function onNotificationInserted(fn: (row: Notification) => void): () => void {
  noteListeners.add(fn);
  return () => { noteListeners.delete(fn); };
}

/** Starts counters + the single per-user channel. Returns the cleanup (call on logout / unmount). */
export function startUnread(userId: string): () => void {
  owner = userId;
  void refreshUnread();
  const spec = (event: 'INSERT' | 'UPDATE', table: string, col: string) => [
    'postgres_changes' as never, { event, schema: 'public', table, filter: `${col}=eq.${userId}` } as never,
  ] as const;
  const onUpdate = () => { if (Date.now() > quietUntil) refreshUnreadSoon(1500); };
  const ch = supabase.channel(`unread-${userId}`)
    .on(...spec('INSERT', T.notifications, 'user_id'), (p: { new: Notification }) => {
      // 'message' alerts mirror a message that is already counted in `messages`, so they do not add to the alerts badge.
      if (!p.new.read && p.new.kind !== 'message') adjustUnread('alerts', 1);
      invalidate('inbox:activity');
      noteListeners.forEach((f) => f(p.new));
    })
    .on(...spec('UPDATE', T.notifications, 'user_id'), onUpdate)
    .on(...spec('INSERT', T.messages, 'recipient_id'), (p: { new: { read?: boolean } }) => {
      if (!p.new.read) adjustUnread('messages', 1);
      invalidate('inbox:messages');
    })
    .on(...spec('UPDATE', T.messages, 'recipient_id'), onUpdate)
    .subscribe();
  const offActive = onAppActiveChange((active) => { if (active) void refreshUnread(); else void flushReads(); });
  return () => {
    owner = null;
    if (resyncTimer) { clearTimeout(resyncTimer); resyncTimer = null; }
    void flushReads();
    offActive();
    void supabase.removeChannel(ch);
    commit({ alerts: 0, messages: 0 });
  };
}
