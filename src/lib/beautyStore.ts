// Shared beauty selection (Create, Go Live, recording, editor round-trips). Persisted in AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { BeautyLevels } from '../../modules/gpupixel-camera';

export type BeautyPreset = { id: string; name: string; levels: BeautyLevels | null };

/** First entry "Adjust" uses the user's own slider values; the other 9 are fixed, balanced looks. */
/** "None" = untouched camera (default), "Adjust" = user sliders; the rest are Smoothing + Whitening levels only. */
export const PRESETS: BeautyPreset[] = [
  { id: 'none', name: 'None', levels: { smoothing: 0, whitening: 0 } },
  { id: 'adjust', name: 'Adjust', levels: null },
  { id: 'natural', name: 'Natural', levels: { smoothing: 0.3, whitening: 0.1 } },
  { id: 'soft', name: 'Soft', levels: { smoothing: 0.5, whitening: 0.2 } },
  { id: 'clear', name: 'Clear', levels: { smoothing: 0.7, whitening: 0.25 } },
  { id: 'glow', name: 'Glow', levels: { smoothing: 0.5, whitening: 0.5 } },
  { id: 'fair', name: 'Fair', levels: { smoothing: 0.4, whitening: 0.75 } },
  { id: 'porcelain', name: 'Porcelain', levels: { smoothing: 0.9, whitening: 0.55 } },
  { id: 'silk', name: 'Silk', levels: { smoothing: 1, whitening: 0.3 } },
  { id: 'bright', name: 'Bright', levels: { smoothing: 0.25, whitening: 0.9 } },
  { id: 'studio', name: 'Studio', levels: { smoothing: 0.8, whitening: 0.8 } },
];

export type BeautyState = { preset: string; custom: BeautyLevels };
const KEY = 'bee.beauty.v2';
let state: BeautyState = { preset: 'none', custom: { smoothing: 0.5, whitening: 0.3 } };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

void AsyncStorage.getItem(KEY).then((raw) => {
  if (!raw) return;
  try {
    const v = JSON.parse(raw) as BeautyState;
    if (PRESETS.some((p) => p.id === v.preset) && v.custom) { state = { preset: v.preset, custom: { smoothing: Number(v.custom.smoothing) || 0, whitening: Number(v.custom.whitening) || 0 } }; emit(); }
  } catch { /* keep defaults */ }
}).catch(() => undefined);

function save(next: BeautyState) {
  state = next;
  emit();
  void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
}

export const selectPreset = (id: string) => save({ ...state, preset: id });
/** Commit Adjust values (called on slider release, not while dragging). */
export const commitCustom = (custom: BeautyLevels) => save({ ...state, custom });
export const levelsOf = (s: BeautyState): BeautyLevels => PRESETS.find((p) => p.id === s.preset)?.levels ?? s.custom;
export const isBeautyOn = (l: BeautyLevels) => l.smoothing > 0 || l.whitening > 0;

// Live beauty master switch, separate from the camera look: OFF by default. While OFF the live publishes the raw LiveKit
// camera and no beauty / frame-processor code runs at all. Persisted per device.
const LIVE_KEY = 'bee.beauty.live';
let liveOn = false;
const liveSubs = new Set<() => void>();
void AsyncStorage.getItem(LIVE_KEY).then((v) => { if (v === '1') { liveOn = true; liveSubs.forEach((f) => f()); } }).catch(() => undefined);
export function setLiveBeautyOn(on: boolean) {
  liveOn = on;
  // Switching on with the look set to "None" would do nothing visible: use Natural.
  if (on && !isBeautyOn(levelsOf(state))) save({ ...state, preset: 'natural' });
  liveSubs.forEach((f) => f());
  void AsyncStorage.setItem(LIVE_KEY, on ? '1' : '0').catch(() => undefined);
}
export const toggleBeauty = () => setLiveBeautyOn(!liveOn);
export function useLiveBeautyOn(): boolean {
  return useSyncExternalStore((f) => { liveSubs.add(f); return () => liveSubs.delete(f); }, () => liveOn, () => liveOn);
}
export const NO_BEAUTY: BeautyLevels = { smoothing: 0, whitening: 0 };

export function useBeauty(): BeautyState {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);
}
