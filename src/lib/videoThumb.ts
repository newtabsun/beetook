// First-frame thumbnails for videos without a cover (web: <video> → canvas, native: expo-video-thumbnails).
import { Platform } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';

const cache = new Map<string, Promise<string | null>>();

function webFrame(uri: string, at = 0.5): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.playsInline = true;
    const done = (r: string | null) => { v.removeAttribute('src'); v.load(); resolve(r); };
    const timer = setTimeout(() => done(null), 15000);
    v.onloadedmetadata = () => { v.currentTime = Math.min(at, Math.max(0, (v.duration || 1) - 0.05)); };
    v.onseeked = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement('canvas');
        const scale = Math.min(1, 540 / (v.videoWidth || 540));
        c.width = Math.round((v.videoWidth || 540) * scale); c.height = Math.round((v.videoHeight || 960) * scale);
        c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.8));
      } catch { done(null); }
    };
    v.onerror = () => { clearTimeout(timer); done(null); };
    v.src = uri;
  });
}

/** Returns a local/data image URI of the video's first second, or null. Cached per URI. */
export function videoThumb(uri: string): Promise<string | null> {
  let p = cache.get(uri);
  if (!p) {
    p = Platform.OS === 'web'
      ? webFrame(uri)
      : VideoThumbnails.getThumbnailAsync(uri, { time: 500, quality: 0.7 }).then((r) => r.uri).catch(() => null);
    cache.set(uri, p);
  }
  return p;
}
