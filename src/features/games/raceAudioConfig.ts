// Shared race-audio config for the native (expo-audio) and web (Web Audio API) engines.
// Layers are cut from the user's recording only (scripts/build_race_audio.py).
export interface CarTone { v: number; boost: boolean; brake: boolean }

/** Every tunable number for the race sound lives here. */
export const RACE_AUDIO = {
  smoothMs: 220, // easing time constant for volume and pitch
  vMin: 2, // m/s that maps to "idling" (the slowest a car can ever be)
  vMax: 34, // m/s that maps to "flat out"
  boostLoad: 0.3, // extra load while a gas ramp is building
  brakeLoad: 0.2, // load removed while a brake ramp is building
  cruiseRate: [0.88, 1.02] as [number, number], // cruise-layer playbackRate across the speed range
  highRate: [0.98, 1.12] as [number, number], // high-layer playbackRate across the speed range
  master: 1, // engine level at volume step 100 % (native players are capped at 1.0)
  primary: 1, // a player's own car
  secondary: 0.5, // a player's rival
  viewer: 0.8, // viewers hear both cars equally
  secondaryOffset: 1.7, // s — loop start offset for car 2 (anti phase-lock)
  revPrimary: 1, // rev burst level for the main car
  revSecondary: 0.35, // rev burst level for the other car
  webBoost: 1.9, // web only: make-up gain before the limiter (Web Audio can go above 1.0)
} as const;

export const LAYERS = {
  cruise: require('../../../assets/music/engine_cruise_loop.mp3'),
  high: require('../../../assets/music/engine_high_loop.mp3'),
  rev: require('../../../assets/music/engine_rev_oneshot.mp3'),
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const loadOf = (c: CarTone) => clamp01((c.v - RACE_AUDIO.vMin) / (RACE_AUDIO.vMax - RACE_AUDIO.vMin)
  + (c.boost ? RACE_AUDIO.boostLoad : 0) - (c.brake ? RACE_AUDIO.brakeLoad : 0));
export const mixOf = (side: 0 | 1, primary: 0 | 1 | null) =>
  primary === null ? RACE_AUDIO.viewer : side === primary ? RACE_AUDIO.primary : RACE_AUDIO.secondary;
export const revOf = (side: 0 | 1, primary: 0 | 1 | null) =>
  primary === null || side === primary ? RACE_AUDIO.revPrimary : RACE_AUDIO.revSecondary;

/** Per-car mix: equal-power crossfade cruise → high, plus playback rates. */
export function voice(load: number, gain: number) {
  return {
    vc: gain * Math.cos((load * Math.PI) / 2),
    vh: gain * Math.sin((load * Math.PI) / 2),
    rc: lerp(RACE_AUDIO.cruiseRate[0], RACE_AUDIO.cruiseRate[1], load),
    rh: lerp(RACE_AUDIO.highRate[0], RACE_AUDIO.highRate[1], load),
  };
}
