// MediaCoordinator: only one media owner may play with sound at a time, app-wide.
// Owners form a stack: the newest wanting owner plays; when it stops wanting/unmounts, the previous one resumes.
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type Listener = (on: boolean) => void;
const listeners = new Map<number, Listener>();
let stack: number[] = [];
let seq = 0;

function notify() {
  const top = stack[stack.length - 1];
  listeners.forEach((f, id) => f(id === top));
  if (__DEV__ && Platform.OS === 'web') setTimeout(auditMedia, 700);
}
function claim(id: number) { stack = [...stack.filter((x) => x !== id), id]; notify(); }
function release(id: number) { if (!stack.includes(id)) return; stack = stack.filter((x) => x !== id); notify(); }

/** Silences every owner (e.g. before a full navigation). Owners that still want sound reclaim on next change. */
export function stopAllMedia() { stack = []; notify(); }

/** Registers a player; returns true only while this player is the single audible owner. */
export function useAudible(want: boolean, nonce = 0): boolean {
  const id = useRef(0);
  if (!id.current) id.current = ++seq;
  const [on, setOn] = useState(false);
  useEffect(() => {
    const me = id.current;
    listeners.set(me, setOn);
    return () => { listeners.delete(me); release(me); };
  }, []);
  useEffect(() => { if (want) claim(id.current); else { setOn(false); release(id.current); } }, [want, nonce]);
  return want && on;
}

export type MediaAuditItem = { tag: string; slide: boolean; paused: boolean; muted: boolean; volume: number; currentTime: number; loop: boolean; src: string };
/** Dev check (web): every <video>/<audio> element's state; warns when more than one is audible. */
export function auditMedia(): { audible: number; items: MediaAuditItem[] } {
  if (typeof document === 'undefined') return { audible: 0, items: [] };
  const items = Array.from(document.querySelectorAll('video,audio')).map((m) => {
    const el = m as HTMLMediaElement;
    return { tag: el.tagName.toLowerCase(), slide: el.hasAttribute('data-slide-audio'), paused: el.paused, muted: el.muted, volume: el.volume, currentTime: el.currentTime, loop: el.loop, src: el.currentSrc.slice(-60) };
  });
  const audible = items.filter((i) => !i.paused && !i.muted && i.volume > 0).length;
  if (audible > 1) console.warn(`[media] ${audible} audible media elements playing at once`);
  return { audible, items };
}
if (Platform.OS === 'web' && typeof window !== 'undefined') (window as unknown as { __mediaAudit: typeof auditMedia }).__mediaAudit = auditMedia;
