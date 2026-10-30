// Looping soundtrack for photo slideshows / editor-added video sound (editor, previews, feed).
// Web: HTMLAudioElement routed through a Web Audio GainNode so volume can go 0–200%
// (Storage serves `access-control-allow-origin: *`, so crossOrigin='anonymous' keeps the graph audible).
// Native: expo-audio player (volume is capped at 100% there).
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export const MAX_GAIN = 2;
const clampGain = (v: number) => Math.max(0, Math.min(MAX_GAIN, Number.isFinite(v) ? v : 1));

type Graph = { ctx: AudioContext; gain: GainNode };
const graphs = new WeakMap<HTMLMediaElement, Graph>();
let sharedCtx: AudioContext | null = null;

/** Web: routes a media element through a GainNode (created once per element) and applies `level` (0–2). */
export function applyGain(el: HTMLMediaElement, level: number): void {
  const v = clampGain(level);
  let g = graphs.get(el);
  if (!g && v > 1) {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      try {
        sharedCtx = sharedCtx ?? new AC();
        const gain = sharedCtx.createGain();
        sharedCtx.createMediaElementSource(el).connect(gain).connect(sharedCtx.destination);
        g = { ctx: sharedCtx, gain };
        graphs.set(el, g);
      } catch { /* element already captured or tainted: fall back to element volume */ }
    }
  }
  if (g) {
    el.volume = 1;
    g.gain.gain.value = v;
    if (g.ctx.state !== 'running') void g.ctx.resume().catch(() => undefined);
  } else el.volume = Math.min(1, v);
}

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  // Mobile Safari/Chrome only start an AudioContext inside a user gesture.
  document.addEventListener('pointerdown', () => { if (sharedCtx && sharedCtx.state !== 'running') void sharedCtx.resume().catch(() => undefined); }, true);
}

/** Live player state for the editor's diagnostics line. */
export type AudioDebug = { state: string; t: number; dur: number; error?: string; gain?: number };
let current: HTMLAudioElement | null = null;
/** Manual retry for the editor's Retry button (reloads and plays the current soundtrack). */
export function retryAudio(): void {
  const a = current; if (!a) return;
  setDebug({ state: 'loading', error: undefined });
  if (a.error) a.load();
  void a.play().catch((e: Error) => setDebug({ state: 'blocked', error: e.name }));
}
let debug: AudioDebug = { state: 'idle', t: 0, dur: 0 };
const setDebug = (p: Partial<AudioDebug>) => { debug = { ...debug, ...p }; };
export function useAudioDebug(on: boolean): AudioDebug {
  const [d, setD] = useState(debug);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setD({ ...debug }), 400);
    return () => clearInterval(t);
  }, [on]);
  return d;
}

export type SoundCtl = { seek: (t: number) => void; time: () => number };
/** seek(t) moves the soundtrack to t (wrapped); time() = current position (-1 = unknown). `volume` is 0–2. */
export function useSlideshowAudio(url: string | null, playing: boolean, muted: boolean, volume = 1, loop = true): SoundCtl {
  const web = Platform.OS === 'web';
  const player = useAudioPlayer(web ? null : url);
  const status = useAudioPlayerStatus(player);
  const loaded = web || !!status?.isLoaded;
  useEffect(() => {
    if (web || !url) return;
    // Without this, iOS silent switch mutes playback and Android may route to a ducked stream.
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, [web, url]);
  useEffect(() => {
    if (web || !url) return;
    setDebug({ state: status?.isLoaded ? (status.playing ? 'playing' : 'loaded') : 'loading', t: status?.currentTime ?? 0, dur: status?.duration ?? 0 });
  }, [web, url, status]);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!web || !url) return;
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.loop = loop; a.preload = 'auto';
    a.setAttribute('data-slide-audio', '');
    a.style.display = 'none';
    const on = (ev: string, fn: () => void) => a.addEventListener(ev, fn);
    on('loadedmetadata', () => setDebug({ state: 'loaded', dur: a.duration }));
    on('playing', () => setDebug({ state: 'playing', error: undefined }));
    on('pause', () => setDebug({ state: 'paused' }));
    on('timeupdate', () => setDebug({ t: a.currentTime }));
    on('error', () => setDebug({ state: 'error', error: `code ${a.error?.code ?? '?'} ${a.error?.message ?? ''}`.trim() }));
    setDebug({ state: 'loading', t: 0, dur: 0, error: undefined });
    a.src = url;
    document.body.appendChild(a);
    el.current = a; current = a;
    return () => { a.pause(); a.removeAttribute('src'); a.load(); a.remove(); el.current = null; if (current === a) current = null; };
  }, [web, url, loop]);
  useEffect(() => {
    if (web) {
      const a = el.current;
      if (!a) return;
      a.muted = muted;
      applyGain(a, volume);
      setDebug({ gain: clampGain(volume) });
      if (!playing) { a.pause(); return; }
      let alive = true; let tries = 0;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const start = () => {
        if (!alive) return;
        a.play().then(() => setDebug({ state: 'playing', error: undefined })).catch((e: Error) => {
          if (!alive) return;
          // AbortError = play() interrupted by loading/pause (large files, slow network): not an autoplay block.
          if (e.name === 'AbortError' && tries++ < 5) {
            setDebug({ state: 'retrying', error: e.name });
            if (a.readyState >= 3) timers.push(setTimeout(start, 500));
            else a.addEventListener('canplay', start, { once: true });
            return;
          }
          setDebug({ state: e.name === 'NotAllowedError' ? 'blocked' : 'error', error: e.name });
          document.addEventListener('pointerdown', start, { once: true });
        });
      };
      if (a.readyState >= 3) start(); else { setDebug({ state: 'loading' }); a.addEventListener('canplay', start, { once: true }); }
      return () => { alive = false; timers.forEach(clearTimeout); a.removeEventListener('canplay', start); document.removeEventListener('pointerdown', start); };
    }
    try {
      player.loop = loop; player.volume = Math.min(1, clampGain(volume)); player.muted = muted;
      if (playing && url && loaded) player.play(); else player.pause();
    } catch { /* released */ }
  }, [web, url, playing, muted, volume, player, loaded, loop]);
  useEffect(() => () => { try { player.pause(); } catch { /* released */ } }, [player]);
  const seek = (t: number) => {
    if (web) { const a = el.current; if (a) { const d = a.duration; a.currentTime = d && isFinite(d) ? t % d : t; } return; }
    try { const d = player.duration; void player.seekTo(d ? t % d : t); } catch { /* released */ }
  };
  const time = () => {
    if (web) { const a = el.current; return a && a.readyState >= 1 ? a.currentTime : -1; }
    try { return player.isLoaded ? player.currentTime : -1; } catch { return -1; }
  };
  return { seek, time };
}
