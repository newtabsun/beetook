// Foreground state shared by every timer and poller: background work pauses, and resumes with one refresh.
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { subscribeNetwork } from './network';

const webHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
let active = Platform.OS === 'web' ? !webHidden() : AppState.currentState !== 'background';
const subs = new Set<(a: boolean) => void>();

function set(next: boolean) {
  if (next === active) return;
  active = next;
  subs.forEach((f) => f(next));
}

if (Platform.OS === 'web') {
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => set(!webHidden()));
} else {
  // iOS "inactive" is a short transition (control center, calls): only "background" pauses work.
  AppState.addEventListener('change', (s) => set(s !== 'background'));
}

export const isAppActive = () => active;

/** Subscribes to foreground/background changes. Returns an unsubscribe function. */
export function onAppActiveChange(fn: (active: boolean) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

export function useAppActive(): boolean {
  const [a, setA] = useState(active);
  useEffect(() => { setA(active); return onAppActiveChange(setA); }, []);
  return a;
}

/** Runs `fn` every `ms` only while the app is in the foreground. It also runs once when the app returns
 * to the foreground and once when the connection comes back, so data is fresh without polling in the background. */
export function useActiveInterval(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => ref.current(), ms); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    if (active) start();
    const offApp = onAppActiveChange((a) => { if (a) { ref.current(); start(); } else stop(); });
    let wasOnline = true;
    const offNet = subscribeNetwork((n) => { if (n.online && !wasOnline && active) ref.current(); wasOnline = n.online; });
    return () => { stop(); offApp(); offNet(); };
  }, [ms, enabled]);
}
