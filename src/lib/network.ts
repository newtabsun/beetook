// Connectivity + Data Saver state shared by players, uploads and banners (expo-network is optional: Wi-Fi/cellular only).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

/** `cellular` = connected through mobile data (false on Wi-Fi, web or when unknown). */
export interface NetState { online: boolean; slow: boolean; cellular: boolean }

const PROBES = ['https://www.gstatic.com/generate_204', 'https://klxynisbmxqmyszkdrxj.supabase.co/auth/v1/health', 'https://cloudflare.com/cdn-cgi/trace'];
let fails = 0;
const SLOW_MS = 2500;
let state: NetState = { online: true, slow: false, cellular: false };
const subs = new Set<(n: NetState) => void>();

type NetModule = {
  getNetworkStateAsync(): Promise<{ type?: string }>;
  addNetworkStateListener(l: (e: { type?: string }) => void): { remove(): void };
};
let netModule: NetModule | null = null;
try {
  // Optional native module: without it the connection type stays "unknown" (treated as not cellular).
  netModule = require('expo-network') as NetModule;
} catch {
  netModule = null;
}

const inBackground = () => (Platform.OS === 'web'
  ? typeof document !== 'undefined' && document.visibilityState === 'hidden'
  : AppState.currentState === 'background');

function update(next: Partial<NetState>) {
  const n = { ...state, ...next };
  if (n.online === state.online && n.slow === state.slow && n.cellular === state.cellular) return;
  state = n;
  subs.forEach((f) => f(state));
}

/** Measures reachability and latency; updates the shared state.
 *  Several independent endpoints are tried at once (any HTTP answer = online) and "offline" is only reported
 *  after two failed rounds in a row, so one blocked or slow host never shows a false "No internet". */
export async function probe(): Promise<boolean> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 8000);
  try {
    await Promise.any(PROBES.map((u) => fetch(`${u}${u.includes('?') ? '&' : '?'}t=${t0}`, { cache: 'no-store', signal: ctl.signal, ...(Platform.OS === 'web' ? { mode: 'no-cors' as RequestMode } : {}) })));
    fails = 0;
    update({ online: true, slow: Date.now() - t0 > SLOW_MS });
    return true;
  } catch {
    fails += 1;
    if (fails >= 2) update({ online: false });
    else setTimeout(() => void probe(), 1500);
    return false;
  } finally { clearTimeout(to); }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('online', () => void probe());
    window.addEventListener('offline', () => { fails = 2; update({ online: false }); });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) update({ online: false });
  }
  if (netModule && Platform.OS !== 'web') {
    const apply = (type?: string) => update({ cellular: type === 'CELLULAR' });
    void netModule.getNetworkStateAsync().then((s) => apply(s.type)).catch(() => undefined);
    try { netModule.addNetworkStateListener((e) => apply(e.type)); } catch { /* listener unsupported */ }
  }
  // Web: Chrome on Android reports mobile data through the Network Information API; other browsers stay "not cellular".
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const c = (navigator as unknown as { connection?: { type?: string; addEventListener?: (t: string, f: () => void) => void } }).connection;
    if (c) {
      const apply = () => update({ cellular: c.type === 'cellular' });
      apply();
      try { c.addEventListener?.('change', apply); } catch { /* unsupported */ }
    }
  }
  // Probe often while the connection is bad so recovery/10 s thresholds are measured accurately.
  // In the background no probe is sent (battery/data); it resumes on the next tick after returning.
  const loop = async () => {
    const bg = inBackground();
    if (!bg) await probe();
    setTimeout(() => void loop(), bg || (state.online && !state.slow) ? 15000 : 2000);
  };
  void loop();
}

/** Subscribes to connectivity changes (non-React). Returns an unsubscribe function. */
export function subscribeNetwork(fn: (n: NetState) => void): () => void {
  start();
  subs.add(fn);
  return () => { subs.delete(fn); };
}

let lastIssueProbe = 0;
/** A request failed with a network error: re-check connectivity now (throttled). */
export function reportNetIssue() {
  start();
  const now = Date.now();
  if (now - lastIssueProbe < 2000) return;
  lastIssueProbe = now;
  void probe();
}

/** Resolves true once online and not slow, or false after `ms`. */
export function waitGood(ms: number): Promise<boolean> {
  if (state.online && !state.slow) return Promise.resolve(true);
  return new Promise((resolve) => {
    const un = subscribeNetwork((n) => { if (n.online && !n.slow) { clearTimeout(t); un(); resolve(true); } });
    const t = setTimeout(() => { un(); resolve(false); }, ms);
  });
}

export function getNetwork(): NetState { start(); return state; }

export function useNetwork(): NetState {
  const [n, setN] = useState(getNetwork());
  useEffect(() => { subs.add(setN); setN(state); return () => { subs.delete(setN); }; }, []);
  return n;
}

/** Calls `cb` once the connection is online and not slow (checked every 5 s). Returns a cancel function. */
export function whenGood(cb: () => void): () => void {
  let dead = false;
  const tick = async () => {
    if (dead) return;
    await probe();
    if (dead) return;
    if (state.online && !state.slow) cb(); else setTimeout(() => void tick(), 5000);
  };
  const t = setTimeout(() => void tick(), 4000);
  return () => { dead = true; clearTimeout(t); };
}

/** Cloudflare Stream HLS → same manifest capped to a low bitrate. Null when no low variant exists. */
export function lowQuality(uri: string): string | null {
  return /videodelivery\.net\/[^/]+\/manifest\/video\.m3u8/.test(uri) ? `${uri.split('?')[0]}?clientBandwidthHint=0.4` : null;
}

const SAVER_KEY = 'beetook_data_saver_v1';
let saver = false;
const saverSubs = new Set<(on: boolean) => void>();
void AsyncStorage.getItem(SAVER_KEY).then((v) => { if (v === '1') { saver = true; saverSubs.forEach((f) => f(true)); } }).catch(() => undefined);

// One-time "Data Saver is on" notice. Persisted separately (never cleared on logout); reset only off→on.
const NOTICE_KEY = 'beetook_data_saver_notice_seen_v1';
let noticeSeen = false;
const noticeSubs = new Set<(seen: boolean) => void>();
void AsyncStorage.getItem(NOTICE_KEY).then((v) => { if (v === '1') { noticeSeen = true; noticeSubs.forEach((f) => f(true)); } }).catch(() => undefined);

function setNoticeSeen(seen: boolean) {
  noticeSeen = seen;
  noticeSubs.forEach((f) => f(seen));
  void AsyncStorage.setItem(NOTICE_KEY, seen ? '1' : '0').catch(() => undefined);
}

export function markDataSaverNoticeSeen() { if (!noticeSeen) setNoticeSeen(true); }

export function useDataSaverNoticeSeen(): boolean {
  const [s, setS] = useState(noticeSeen);
  useEffect(() => { noticeSubs.add(setS); setS(noticeSeen); return () => { noticeSubs.delete(setS); }; }, []);
  return s;
}

export function setDataSaver(on: boolean) {
  if (on && !saver) setNoticeSeen(false);
  saver = on;
  saverSubs.forEach((f) => f(on));
  void AsyncStorage.setItem(SAVER_KEY, on ? '1' : '0').catch(() => undefined);
}

export function useDataSaver(): boolean {
  const [on, setOn] = useState(saver);
  useEffect(() => { saverSubs.add(setOn); setOn(saver); return () => { saverSubs.delete(setOn); }; }, []);
  return on;
}

// "Data Saver on mobile data": off by default; when on, Data Saver applies automatically on cellular only.
const AUTO_KEY = 'beetook_auto_saver_cellular_v1';
let autoCellular = false;
const autoSubs = new Set<(on: boolean) => void>();
void AsyncStorage.getItem(AUTO_KEY).then((v) => { if (v === '1') { autoCellular = true; autoSubs.forEach((f) => f(true)); } }).catch(() => undefined);

export function setAutoSaverOnCellular(on: boolean) {
  autoCellular = on;
  autoSubs.forEach((f) => f(on));
  void AsyncStorage.setItem(AUTO_KEY, on ? '1' : '0').catch(() => undefined);
}

export function useAutoSaverOnCellular(): boolean {
  const [on, setOn] = useState(autoCellular);
  useEffect(() => { autoSubs.add(setOn); setOn(autoCellular); return () => { autoSubs.delete(setOn); }; }, []);
  return on;
}

/** Data Saver as the players see it: the manual switch, or the automatic mobile-data option while on cellular. */
export function useEffectiveDataSaver(): boolean {
  const manual = useDataSaver();
  const auto = useAutoSaverOnCellular();
  const net = useNetwork();
  return manual || (auto && net.cellular);
}
