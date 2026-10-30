// One app-wide network notice: shown only after 10 s of continuous bad network, once per outage,
// dismissible, "Back online" for 2 s on recovery. Hysteresis keeps flapping networks from toggling it.
import { subscribeNetwork, type NetState } from './network';

export const NET_CFG = { SHOW_MS: 10000, CLEAR_MS: 3000, BACK_MS: 2000 };

export type Notice = { kind: 'offline' | 'weak' | 'back' } | null;
type Phase = 'idle' | 'pending' | 'shown' | 'dismissed' | 'back';

let phase: Phase = 'idle';
let kind: 'offline' | 'weak' = 'offline';
let showT: ReturnType<typeof setTimeout> | null = null;
let clearT: ReturnType<typeof setTimeout> | null = null;
let backT: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<(n: Notice) => void>();
const backSubs = new Set<() => void>();

export function getNotice(): Notice {
  if (phase === 'shown') return { kind };
  if (phase === 'back') return { kind: 'back' };
  return null;
}
const emit = () => { const n = getNotice(); subs.forEach((f) => f(n)); };
const stop = (t: ReturnType<typeof setTimeout> | null) => { if (t) clearTimeout(t); return null; };

/** Feeds a connectivity sample into the state machine (exported for simulation). */
export function onNet(n: NetState) {
  const bad = !n.online || n.slow;
  if (bad) {
    kind = n.online ? 'weak' : 'offline';
    clearT = stop(clearT);
    if (phase === 'idle' || phase === 'back') {
      backT = stop(backT);
      const wasBack = phase === 'back';
      phase = 'pending';
      showT = setTimeout(() => { showT = null; if (phase === 'pending') { phase = 'shown'; emit(); } }, NET_CFG.SHOW_MS);
      if (wasBack) emit();
    } else if (phase === 'shown') emit();
    return;
  }
  if (phase === 'pending') { showT = stop(showT); phase = 'idle'; return; }
  if ((phase === 'shown' || phase === 'dismissed') && !clearT) {
    clearT = setTimeout(() => {
      clearT = null;
      const wasShown = phase === 'shown';
      backSubs.forEach((f) => f());
      if (wasShown) {
        phase = 'back'; emit();
        backT = setTimeout(() => { backT = null; if (phase === 'back') { phase = 'idle'; emit(); } }, NET_CFG.BACK_MS);
      } else phase = 'idle';
    }, NET_CFG.CLEAR_MS);
  }
}

/** User tapped/swiped the banner: hidden for the rest of this outage. */
export function dismissNotice() {
  if (phase === 'shown') { phase = 'dismissed'; emit(); }
  else if (phase === 'back') { backT = stop(backT); phase = 'idle'; emit(); }
}

/** Called once each outage ends (used to re-run failed work). */
export function onBackOnline(fn: () => void): () => void { backSubs.add(fn); return () => { backSubs.delete(fn); }; }

let started = false;
export function subscribeNotice(fn: (n: Notice) => void): () => void {
  if (!started) { started = true; subscribeNetwork(onNet); }
  subs.add(fn);
  return () => { subs.delete(fn); };
}
