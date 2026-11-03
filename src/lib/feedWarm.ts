// Warms the feed right after login / app start so the first video is ready when Home opens:
// the list is fetched (or restored from the last session), covers are cached and the first video's
// opening seconds are loaded into the video disk cache. Failures are ignored: the feed loads normally.
import { Image as ExpoImage } from 'expo-image';
import { createVideoPlayer } from 'expo-video';
import { Platform } from 'react-native';
import { fetchForYou, type Post } from './api';
import { playerSource } from './offline';
import { hydrate, persist, PERSIST_LIMIT, put } from './swr';

export const FEED_KEY = 'feed:list';
export type FeedCache = { items: Post[]; more: boolean; activeId: string | null };

let warming: Promise<void> | null = null;

function prefetchCovers(items: Post[]) {
  items.slice(0, 6).forEach((x) => {
    if (x.thumbnail_url) void ExpoImage.prefetch(x.thumbnail_url, 'memory-disk').catch(() => undefined);
    if (x.author?.avatar_url) void ExpoImage.prefetch(x.author.avatar_url, 'memory-disk').catch(() => undefined);
  });
}

/** Loads the first seconds of the first video into the disk cache through a short-lived hidden player. */
function warmFirstVideo(items: Post[]) {
  if (Platform.OS === 'web') return;
  const first = items.find((x) => x.kind === 'video' && x.media_urls[0]);
  if (!first) return;
  try {
    const p = createVideoPlayer(playerSource(first.media_urls[0]));
    p.muted = true;
    try { p.bufferOptions = { preferredForwardBufferDuration: 8, minBufferForPlayback: 1, waitsToMinimizeStalling: true }; } catch { /* unsupported */ }
    setTimeout(() => { try { p.release(); } catch { /* already released */ } }, 9000);
  } catch { /* warm-up is optional */ }
}

export function warmFeed(): Promise<void> {
  warming ??= (async () => {
    try {
      const cached = await hydrate<FeedCache>(FEED_KEY);
      if (cached?.items.length) { prefetchCovers(cached.items); warmFirstVideo(cached.items); return; }
      const items = await fetchForYou(0);
      if (!items.length) return;
      put<FeedCache>(FEED_KEY, { items, more: true, activeId: null });
      void persist<FeedCache>(FEED_KEY, { items: items.slice(0, PERSIST_LIMIT.feed), more: true, activeId: null });
      prefetchCovers(items); warmFirstVideo(items);
    } catch { /* the feed screen loads on its own */ } finally { warming = null; }
  })();
  return warming;
}
