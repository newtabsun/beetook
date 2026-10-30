// Remembers progressive (MP4) videos that already played on this device; the player keeps them in its disk
// cache, so they can be watched again without a connection ("Watch downloaded videos").
// Also owns the 1 GB media cache budget, its usage meter and the "Clear cache" action.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';
import { Directory, Paths, type File } from 'expo-file-system';
import { clearVideoCacheAsync, getCurrentVideoCacheSize, setVideoCacheSizeAsync } from 'expo-video';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

const KEY = 'beetook_played_v1';
const MAX = 200;
let played: string[] = [];
void AsyncStorage.getItem(KEY).then((v) => { if (v) played = JSON.parse(v) as string[]; }).catch(() => undefined);

export const isCacheable = (uri: string) => /^https?:/.test(uri) && !/\.m3u8/.test(uri);

export function markPlayed(uri: string) {
  if (!isCacheable(uri) || played.includes(uri)) return;
  played = [uri, ...played].slice(0, MAX);
  void AsyncStorage.setItem(KEY, JSON.stringify(played)).catch(() => undefined);
}
export const isPlayed = (uri?: string) => !!uri && played.includes(uri);
export const hasPlayed = () => played.length > 0;

let only = false;
const subs = new Set<(v: boolean) => void>();
export function setDownloadedOnly(v: boolean) { only = v; subs.forEach((f) => f(v)); }
export function useDownloadedOnly(): boolean {
  const [v, setV] = useState(only);
  useEffect(() => { subs.add(setV); setV(only); return () => { subs.delete(setV); }; }, []);
  return v;
}

/** Total disk budget for cached media, shown in Settings as "used / 1 GB". */
export const CACHE_LIMIT_BYTES = 1024 * 1024 * 1024;
/** expo-image (Glide on Android) caps its own disk cache at 250 MB; videos get the rest of the 1 GB. */
const IMAGE_CACHE_BYTES = 250 * 1024 * 1024;
/** Disk space the video player may use for cached MP4s (oldest entries are evicted first). */
export const VIDEO_CACHE_BYTES = CACHE_LIMIT_BYTES - IMAGE_CACHE_BYTES;
const native = Platform.OS !== 'web';
const IMAGE_CACHE_DIR = 'image_manager_disk_cache';

function folderBytes(dir: Directory): number {
  let n = 0;
  for (const x of dir.list()) n += x instanceof Directory ? folderBytes(x) : (x as File).size ?? 0;
  return n;
}

/** Bytes currently used by cached videos + images (web: the app's browser storage). */
export async function mediaCacheBytes(): Promise<number> {
  if (!native) {
    try { return (await navigator.storage?.estimate?.())?.usage ?? 0; } catch { return 0; }
  }
  let n = 0;
  try { n += getCurrentVideoCacheSize(); } catch { /* unknown */ }
  try { const d = new Directory(Paths.cache, IMAGE_CACHE_DIR); if (d.exists) n += folderBytes(d); } catch { /* no image cache yet */ }
  return n;
}

/** Applies the cache limit. Must run before the first video player is created (app start). */
export function initMediaCache() {
  if (!native) return;
  void setVideoCacheSizeAsync(VIDEO_CACHE_BYTES).catch(() => undefined);
}


/** Clears cached videos and images; previously watched videos then need a connection again. */
export async function clearMediaCache(): Promise<void> {
  played = [];
  setDownloadedOnly(false);
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
  if (native) await clearVideoCacheAsync().catch(() => undefined);
  await Promise.all([ExpoImage.clearDiskCache(), ExpoImage.clearMemoryCache()]).catch(() => undefined);
  if (!native && typeof caches !== 'undefined') {
    try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch { /* unsupported */ }
  }
}
