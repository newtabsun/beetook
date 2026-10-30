// Small "stale-while-revalidate" cache: a screen shows its last data instantly when the user returns to
// it, and only asks the server again when the data is older than its TTL, was invalidated by a change the
// app made itself, or Realtime reported a change. A trimmed copy can be persisted to AsyncStorage
// (localStorage on web) so a cold start paints immediately. Cleared when the signed-in account changes.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/** How long cached screen data counts as fresh before a quiet background revalidate. */
export const STALE_MS = { feed: 60_000, live: 15_000 } as const;
/** How many items of each list are persisted for the next cold start. */
export const PERSIST_LIMIT = { feed: 20, live: 40 } as const;

type Entry = { data: unknown; at: number; stale: boolean };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const PREFIX = 'swr:v1:';

export function peek<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

/** Stores `data`. With `fresh = false` the entry keeps its previous age (e.g. saving scroll position). */
export function put<T>(key: string, data: T, fresh = true) {
  const prev = store.get(key);
  store.set(key, fresh || !prev ? { data, at: Date.now(), stale: false } : { ...prev, data });
}

/** Marks an existing entry as just revalidated without replacing its data. */
export function touch(key: string) {
  const e = store.get(key);
  if (e) { e.at = Date.now(); e.stale = false; }
}

/** True when there is no cached value, it was invalidated, or it is older than `maxAgeMs`. */
export function needsRefresh(key: string, maxAgeMs: number): boolean {
  const e = store.get(key);
  return !e || e.stale || Date.now() - e.at > maxAgeMs;
}

/** True when the entry was explicitly invalidated (the app itself changed the underlying data). */
export function isInvalidated(key: string): boolean {
  return !!store.get(key)?.stale;
}

/** Marks every key starting with `prefix` as stale (it is still shown, then refreshed quietly). */
export function invalidate(prefix: string) {
  store.forEach((e, k) => { if (k.startsWith(prefix)) e.stale = true; });
}

/** Shares one in-flight request between concurrent callers using the same key. */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function storageKey(key: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  return id ? `${PREFIX}${id}:${key}` : null;
}

/** Saves `data` for the next cold start (per account). Failures are ignored: the cache is optional. */
export async function persist<T>(key: string, data: T) {
  try {
    const k = await storageKey(key);
    if (k) await AsyncStorage.setItem(k, JSON.stringify({ data, at: Date.now() }));
  } catch { /* storage full or unavailable */ }
}

/** Loads a persisted value into memory (keeping its original age) unless memory already has one. */
export async function hydrate<T>(key: string): Promise<T | undefined> {
  if (store.has(key)) return peek<T>(key);
  try {
    const k = await storageKey(key);
    const raw = k ? await AsyncStorage.getItem(k) : null;
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { data: T; at: number };
    if (!store.has(key)) store.set(key, { data: saved.data, at: saved.at, stale: false });
    return peek<T>(key);
  } catch { return undefined; }
}

async function clearPersisted() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
  } catch { /* nothing to clear */ }
}

let owner: string | null | undefined;
supabase.auth.onAuthStateChange((_event, session) => {
  const id = session?.user.id ?? null;
  if (owner !== undefined && id !== owner) { store.clear(); inflight.clear(); }
  if (id === null) void clearPersisted();
  owner = id;
});
