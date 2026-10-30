// Android-first motion & color engine (pure RN views, no Skia):
// - TRANSITIONS: how ONE photo/video enters and exits (in/out pair).
// - NATIVE_THEMES: a full multi-photo edit (transition pair + beat-synced hold motion + look); 1 theme = 1 edited video.
// - FILTERS: color grades = RN `filter` (Android 12+ via RenderEffect) + tint/vignette layer (works on every device and over cameras).
import type { ViewStyle } from 'react-native';

export interface Fx { transform?: object[]; opacity?: number; filter?: string; overlay?: ViewStyle }
type Fn = (p: number, W: number, H: number) => Fx;
export interface Transition { id: string; name: string; in: Fn; out: Fn }

const eo = (p: number) => 1 - Math.pow(1 - p, 3);
const ei = (p: number) => p * p * p;
const bounce = (p: number) => {
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
};
const tint = (c: string, a: number): ViewStyle => ({ backgroundColor: c, opacity: Math.max(0, Math.min(1, a)) });

export const TRANSITIONS: Transition[] = [
  { id: 'zoomPunch', name: 'Zoom Punch', in: (p) => ({ transform: [{ scale: 1.6 - 0.6 * eo(p) }] }), out: (p) => ({ transform: [{ scale: 1 + 0.9 * ei(p) }], opacity: 1 - ei(p) }) },
  { id: 'pullBack', name: 'Pull Back', in: (p) => ({ transform: [{ scale: 0.55 + 0.45 * eo(p) }], opacity: eo(p) }), out: (p) => ({ transform: [{ scale: 1 - 0.45 * ei(p) }], opacity: 1 - p }) },
  { id: 'whip', name: 'Whip Pan', in: (p, W) => ({ transform: [{ translateX: W * (1 - eo(p)) }], overlay: tint('#fff', 0.25 * (1 - p)) }), out: (p, W) => ({ transform: [{ translateX: -W * ei(p) }], overlay: tint('#fff', 0.25 * p) }) },
  { id: 'swipe', name: 'Swipe Up', in: (p, _W, H) => ({ transform: [{ translateY: H * (1 - eo(p)) }] }), out: (p, _W, H) => ({ transform: [{ translateY: -H * ei(p) }] }) },
  { id: 'drop', name: 'Drop Bounce', in: (p, _W, H) => ({ transform: [{ translateY: -H * (1 - bounce(p)) }] }), out: (p, _W, H) => ({ transform: [{ translateY: H * ei(p) }] }) },
  { id: 'flash', name: 'Flash Cut', in: (p) => ({ overlay: tint('#fff', 1 - eo(p)) }), out: (p) => ({ overlay: tint('#fff', ei(p)) }) },
  { id: 'dip', name: 'Dip to Black', in: (p) => ({ overlay: tint('#000', 1 - p) }), out: (p) => ({ overlay: tint('#000', p) }) },
  { id: 'leak', name: 'Light Leak', in: (p) => ({ overlay: tint('#FF9A3C', 0.85 * (1 - p)) }), out: (p) => ({ overlay: tint('#FF5E3A', 0.85 * p) }) },
  { id: 'spin', name: 'Spin', in: (p) => ({ transform: [{ rotate: `${-200 * (1 - eo(p))}deg` }, { scale: 0.3 + 0.7 * eo(p) }] }), out: (p) => ({ transform: [{ rotate: `${200 * ei(p)}deg` }, { scale: 1 - 0.7 * ei(p) }] }) },
  { id: 'flip', name: '3D Flip', in: (p) => ({ transform: [{ perspective: 900 }, { rotateY: `${90 * (1 - eo(p))}deg` }] }), out: (p) => ({ transform: [{ perspective: 900 }, { rotateY: `${-90 * ei(p)}deg` }] }) },
  { id: 'stretch', name: 'Rubber Stretch', in: (p) => ({ transform: [{ scaleX: 2.2 - 1.2 * bounce(p) }, { scaleY: 0.3 + 0.7 * bounce(p) }] }), out: (p) => ({ transform: [{ scaleX: 1 - 0.8 * ei(p) }, { scaleY: 1 + 1.2 * ei(p) }] }) },
  { id: 'tilt', name: 'Tilt Swing', in: (p, W) => ({ transform: [{ translateX: -W * 0.6 * (1 - eo(p)) }, { rotate: `${-28 * (1 - eo(p))}deg` }] }), out: (p, W) => ({ transform: [{ translateX: W * 0.6 * ei(p) }, { rotate: `${28 * ei(p)}deg` }] }) },
  { id: 'shake', name: 'Shake', in: (p) => ({ transform: [{ translateX: Math.sin(p * 55) * 26 * (1 - p) }, { translateY: Math.cos(p * 47) * 16 * (1 - p) }] }), out: (p) => ({ transform: [{ translateX: Math.sin(p * 55) * 26 * p }, { translateY: Math.cos(p * 47) * 16 * p }] }) },
  { id: 'glitch', name: 'Glitch', in: (p) => ({ transform: [{ translateX: (Math.floor(p * 12) % 2 ? 1 : -1) * 22 * (1 - p) }, { skewX: `${(Math.floor(p * 9) % 2 ? 8 : -8) * (1 - p)}deg` }], overlay: tint('#FF0080', 0.35 * (1 - p) * (Math.floor(p * 10) % 2)) }), out: (p) => ({ transform: [{ translateX: (Math.floor(p * 12) % 2 ? 1 : -1) * 22 * p }], overlay: tint('#00F0FF', 0.35 * p * (Math.floor(p * 10) % 2)) }) },
  { id: 'stutter', name: 'Stutter Steps', in: (p) => ({ transform: [{ scale: 1 + 0.36 * (1 - Math.floor(p * 4) / 3) * (p < 1 ? 1 : 0) }] }), out: (p) => ({ opacity: Math.floor(p * 6) % 2 ? 0.25 : 1 }) },
  { id: 'blur', name: 'Blur Focus', in: (p) => ({ filter: `blur(${(14 * (1 - p)).toFixed(1)}px)`, opacity: 0.4 + 0.6 * p }), out: (p) => ({ filter: `blur(${(14 * p).toFixed(1)}px)`, opacity: 1 - 0.6 * p }) },
];

export const LEGACY_FX: Record<string, string> = {
  zoomIn: 'zoomPunch', zoomOut: 'pullBack', fade: 'dip', mosh: 'glitch', rgb: 'glitch', seamless: 'pullBack', match: 'zoomPunch',
  light: 'leak', wipe: 'swipe', incam: 'tilt', blurIn: 'blur', bounce: 'drop',
};
export const transitionOf = (id?: string) => TRANSITIONS.find((t) => t.id === (LEGACY_FX[id ?? ''] ?? id));

/** Merges two Fx (transforms concatenated, opacity multiplied). */
export function mergeFx(a: Fx, b: Fx): Fx {
  return {
    transform: [...(a.transform ?? []), ...(b.transform ?? [])],
    opacity: (a.opacity ?? 1) * (b.opacity ?? 1),
    filter: [a.filter, b.filter].filter(Boolean).join(' ') || undefined,
    overlay: b.overlay ?? a.overlay,
  };
}

/** Timed in/out on a video: first half = current shot exits, second half = next shot enters. */
export function transitionFrame(id: string, p: number, W = 400, H = 710): Fx {
  const t = transitionOf(id);
  if (!t) return {};
  return p < 0.5 ? t.out(p * 2, W, H) : t.in((p - 0.5) * 2, W, H);
}

// ---------- Themes ----------
type Hold = (q: number, beat: number, W: number, H: number) => Fx;
export interface NativeTheme { id: number; name: string; cat: string; desc: string; tin: string; tout: string; hold?: Hold; bars?: boolean }
const pulse = (q: number, amt: number) => ({ transform: [{ scale: 1 + amt * Math.exp(-q * 9) }] });
const DISCO = ['#FF2D55', '#00E5FF', '#B6FF3B', '#FFB020', '#B388FF'];

export const NATIVE_THEMES: NativeTheme[] = [
  { id: 2001, cat: 'beat', name: 'Punch Pop', desc: 'Hard zoom punch on every beat', tin: 'zoomPunch', tout: 'stutter', hold: (q) => pulse(q, 0.08) },
  { id: 2002, cat: 'beat', name: 'Flash Drop', desc: 'White flash then the photo drops in', tin: 'drop', tout: 'flash' },
  { id: 2003, cat: 'beat', name: 'Bass Shake', desc: 'Camera shake on the kick', tin: 'shake', tout: 'shake', hold: (q) => ({ transform: [{ translateX: Math.sin(q * 70) * 6 * Math.exp(-q * 6) }, { scale: 1.05 }] }) },
  { id: 2004, cat: 'beat', name: 'Heartbeat', desc: 'Lub-dub double pulse', tin: 'pullBack', tout: 'dip', hold: (q) => ({ transform: [{ scale: 1 + 0.07 * Math.exp(-((q * 4) % 1) * 8) * (q < 0.5 ? 1 : 0) }] }) },
  { id: 2005, cat: 'beat', name: 'Mirror Beat', desc: 'Mirror flips on each half beat', tin: 'zoomPunch', tout: 'whip', hold: (q) => ({ transform: [{ scaleX: Math.floor(q * 2) % 2 ? -1 : 1 }] }) },
  { id: 2006, cat: 'smooth', name: 'Swipe Stack', desc: 'Vertical feed-style swipes', tin: 'swipe', tout: 'swipe', hold: (q) => ({ transform: [{ scale: 1.02 + 0.04 * q }] }) },
  { id: 2007, cat: 'smooth', name: 'Dream Blur', desc: 'Soft focus pulls with slow zoom', tin: 'blur', tout: 'blur', hold: (q) => ({ transform: [{ scale: 1.04 + 0.08 * q }] }) },
  { id: 2008, cat: 'smooth', name: 'Whip Run', desc: 'Fast whip pans left to right', tin: 'whip', tout: 'whip', hold: (q, _b, W) => ({ transform: [{ scale: 1.1 }, { translateX: W * 0.04 * (0.5 - q) }] }) },
  { id: 2009, cat: 'cinematic', name: 'Ken Burns', desc: 'Documentary pan & zoom, alternating', tin: 'dip', tout: 'pullBack', hold: (q, b, W) => ({ transform: [{ scale: 1.08 + 0.12 * q }, { translateX: (b % 2 ? 1 : -1) * W * 0.05 * q }] }) },
  { id: 2010, cat: 'cinematic', name: 'Movie Bars', desc: 'Widescreen bars with slow push-in', tin: 'dip', tout: 'dip', bars: true, hold: (q) => ({ transform: [{ scale: 1.05 + 0.07 * q }] }) },
  { id: 2011, cat: 'cinematic', name: 'Flip Card', desc: '3D card flips between photos', tin: 'flip', tout: 'flip' },
  { id: 2012, cat: 'cinematic', name: 'Golden Leak', desc: 'Warm film light leaks', tin: 'leak', tout: 'leak', hold: (q) => ({ transform: [{ scale: 1.03 + 0.05 * q }], overlay: tint('#FFB45A', 0.12) }) },
  { id: 2013, cat: 'glitch', name: 'Glitch Hop', desc: 'Digital jitter and color tears', tin: 'glitch', tout: 'glitch', hold: (q) => (q < 0.12 ? { transform: [{ translateX: (Math.floor(q * 80) % 2 ? 8 : -8) }] } : {}) },
  { id: 2014, cat: 'glitch', name: 'Stutter Cut', desc: 'Stepped zoom stutters', tin: 'stutter', tout: 'stutter', hold: (q) => ({ transform: [{ scale: 1 + 0.04 * Math.floor(q * 4) }] }) },
  { id: 2015, cat: 'glitch', name: 'Strobe', desc: 'Club strobe blackouts', tin: 'flash', tout: 'stutter', hold: (q) => (q > 0.7 && Math.floor(q * 30) % 3 === 0 ? { overlay: tint('#000', 0.85) } : {}) },
  { id: 2016, cat: 'party', name: 'Spin Party', desc: 'Spinning entries and exits', tin: 'spin', tout: 'spin', hold: (q) => pulse(q, 0.05) },
  { id: 2017, cat: 'party', name: 'Rubber Band', desc: 'Elastic squash & stretch', tin: 'stretch', tout: 'stretch', hold: (q) => ({ transform: [{ scaleY: 1 + 0.05 * Math.sin(q * Math.PI * 4) }] }) },
  { id: 2018, cat: 'party', name: 'Pendulum', desc: 'Swinging photos', tin: 'tilt', tout: 'tilt', hold: (q) => ({ transform: [{ scale: 1.12 }, { rotate: `${6 * Math.sin(q * Math.PI * 2)}deg` }] }) },
  { id: 2019, cat: 'party', name: 'Disco Tint', desc: 'Color wash changes every beat', tin: 'zoomPunch', tout: 'flash', hold: (q, b) => ({ ...pulse(q, 0.06), overlay: tint(DISCO[b % DISCO.length], 0.22) }) },
  { id: 2020, cat: 'party', name: 'Drop Zone', desc: 'Photos bounce down, exit sideways', tin: 'drop', tout: 'tilt', hold: (q) => pulse(q, 0.04) },
  // Trending: fast-music themes with 2–4 sub-beat hits per photo.
  { id: 2021, cat: 'trend', name: 'Double Tap', desc: 'Two punchy zoom hits per photo', tin: 'zoomPunch', tout: 'whip', hold: (q) => ({ transform: [{ scale: 1.03 + 0.07 * Math.exp(-((q * 2) % 1) * 10) }] }) },
  { id: 2022, cat: 'trend', name: 'Hyper Swipe', desc: 'Rapid swipes with a kick pulse', tin: 'swipe', tout: 'whip', hold: (q) => pulse(q, 0.09) },
  { id: 2023, cat: 'trend', name: 'Neon Pulse', desc: 'Neon color flashes on every hit', tin: 'flash', tout: 'zoomPunch', hold: (q, b) => ({ ...pulse((q * 2) % 1, 0.06), overlay: tint(DISCO[(b * 2 + Math.floor(q * 2)) % DISCO.length], 0.18 * Math.exp(-((q * 2) % 1) * 5)) }) },
  { id: 2024, cat: 'trend', name: 'Snap Angle', desc: 'Tilts snap left/right on the beat', tin: 'tilt', tout: 'stutter', hold: (q) => ({ transform: [{ scale: 1.1 }, { rotate: `${(Math.floor(q * 4) % 2 ? 3 : -3)}deg` }] }) },
  { id: 2025, cat: 'trend', name: 'Velocity', desc: 'Speed-ramp zoom then a hard cut', tin: 'whip', tout: 'flash', hold: (q) => ({ transform: [{ scale: 1 + 0.18 * (q < 0.3 ? eo(q / 0.3) : 1 - 0.4 * ei((q - 0.3) / 0.7)) }] }) },
  { id: 2026, cat: 'trend', name: 'Mirror Kaleido', desc: 'Quarter-beat mirror flips', tin: 'flip', tout: 'glitch', hold: (q) => ({ transform: [{ scaleX: Math.floor(q * 4) % 2 ? -1.05 : 1.05 }, { scaleY: 1.05 }] }) },
  { id: 2027, cat: 'trend', name: 'Bounce Beat', desc: 'Photo bounces with the bass', tin: 'drop', tout: 'swipe', hold: (q, _b, _W, H) => ({ transform: [{ scale: 1.06 }, { translateY: -H * 0.025 * Math.abs(Math.sin(q * Math.PI * 3)) }] }) },
  { id: 2028, cat: 'trend', name: 'Cinema Hit', desc: 'Widescreen bars with beat push-ins', tin: 'dip', tout: 'zoomPunch', bars: true, hold: (q) => ({ transform: [{ scale: 1.04 + 0.06 * Math.exp(-((q * 2) % 1) * 8) }] }) },
  { id: 2029, cat: 'trend', name: 'Prism Shift', desc: 'RGB shifts and side jitter', tin: 'glitch', tout: 'whip', hold: (q, b) => ({ transform: [{ scale: 1.06 }, { translateX: (Math.floor(q * 8) % 2 ? 4 : -4) * Math.exp(-q * 3) }], overlay: tint(b % 2 ? '#00F0FF' : '#FF0080', 0.1 * Math.exp(-q * 4)) }) },
  { id: 2030, cat: 'trend', name: 'Bass Drop', desc: 'Big hit + shake on each drop', tin: 'zoomPunch', tout: 'shake', hold: (q) => ({ transform: [{ scale: 1 + 0.12 * Math.exp(-q * 7) }, { translateX: Math.sin(q * 80) * 7 * Math.exp(-q * 9) }] }) },
];
export const NATIVE_THEME_CATS: Record<string, string> = { trend: 'Trending', beat: 'Beat', smooth: 'Smooth', cinematic: 'Cinematic', glitch: 'Glitch', party: 'Party' };
export const nativeThemeFor = (id: number) => NATIVE_THEMES.find((t) => t.id === id) ?? NATIVE_THEMES[Math.abs(id) % NATIVE_THEMES.length];

/** Frame of a slideshow at time t: which photo is visible and its combined motion. */
export function slideFrame(t: number, per: number, n: number, W: number, H: number, theme: NativeTheme, trans?: string) {
  const slide = Math.max(0, Math.floor(t / per));
  const idx = n ? slide % n : 0;
  const u = t - slide * per;
  const half = Math.min(0.45, per * 0.35) / 2;
  const tin = transitionOf(trans ?? theme.tin);
  const tout = transitionOf(trans ?? theme.tout);
  let fx: Fx = trans ? {} : (theme.hold?.(u / per, slide, W, H) ?? {});
  if (u < half && tin) fx = mergeFx(fx, tin.in(u / half, W, H));
  else if (u > per - half && tout) fx = mergeFx(fx, tout.out((u - (per - half)) / half, W, H));
  return { idx, fx, bars: !trans && !!theme.bars };
}

// ---------- Filters ----------
// Every grade is numeric (brightness b, contrast c, saturation s, hue h, warmth, soft glow, tint) so the SAME look is
// (1) previewed live over the camera / Live / editor (RN filter + tint/glow layers) and
// (2) baked into the posted video on Android by Media3 (Brightness/Contrast/HslAdjustment/RgbAdjustment) — see colorSpecOf.
export interface FilterDef { id: string; name: string; css: string; b: number; c: number; s: number; h: number; warm: number; glow: number; tint?: string; tintA?: number; vignette?: number;
  /** Shader-side skin params (native camera + Media3 bake): warm rosy skin, skin shadow lift, non-skin clarity. */
  skinWarm: number; skinLift: number; clarity: number }
type FIn = Partial<FilterDef> & { id: string; name: string };
const mk = (f: FIn): FilterDef => {
  const d = { b: 1, c: 1, s: 1, h: 0, warm: 0, glow: 0, skinWarm: 0, skinLift: 0, clarity: 0, ...f };
  return { ...d, css: f.id === 'none' ? '' : `brightness(${d.b}) contrast(${d.c}) saturate(${d.s})` };
};
/** Real looks (no overlays): global grade + skin-only warmth/lift + clarity, all in the GPU shader. */
export const FILTERS: FilterDef[] = [
  mk({ id: 'none', name: 'Original' }),
  mk({ id: 'clear', name: 'Clear HD', b: 1.04, c: 1.1, s: 1.08, glow: 0.12, tint: '#FFF2EA', tintA: 0.08, clarity: 0.55, skinLift: 0.06 }),
  mk({ id: 'glow', name: 'Glass Skin', b: 1.1, c: 0.96, s: 1.04, glow: 0.38, tint: '#FFE3D6', tintA: 0.16, skinLift: 0.18, skinWarm: 0.2, clarity: 0.1 }),
  mk({ id: 'rosy', name: 'Peach Blush', b: 1.06, c: 1.0, s: 1.1, glow: 0.22, tint: '#FF9FB0', tintA: 0.16, skinWarm: 0.45, skinLift: 0.1, clarity: 0.15 }),
  mk({ id: 'honey', name: 'Golden Hour', b: 1.05, c: 1.06, s: 1.15, warm: 0.6, glow: 0.2, tint: '#FFB347', tintA: 0.18, vignette: 0.35, skinWarm: 0.3, skinLift: 0.06, clarity: 0.2 }),
  mk({ id: 'velvet', name: 'Velvet Night', b: 1.04, c: 1.12, s: 1.12, glow: 0.15, tint: '#7A3CFF', tintA: 0.16, vignette: 0.5, skinLift: 0.12, skinWarm: 0.2, clarity: 0.2 }),
  mk({ id: 'studio', name: 'Studio Soft', b: 1.12, c: 0.92, s: 0.98, glow: 0.32, tint: '#FFFFFF', tintA: 0.1, skinLift: 0.2, skinWarm: 0.1, clarity: 0.1 }),
  mk({ id: 'vivid', name: 'Vivid Pop', b: 1.04, c: 1.14, s: 1.4, glow: 0.08, tint: '#FF5E7E', tintA: 0.06, clarity: 0.35, skinWarm: 0.15 }),
  mk({ id: 'bright', name: 'Sunny Day', b: 1.14, c: 1.06, s: 1.16, glow: 0.2, tint: '#FFE680', tintA: 0.1, skinLift: 0.1, skinWarm: 0.1, clarity: 0.3 }),
  mk({ id: 'cinema', name: 'Teal Cinema', b: 1.0, c: 1.16, s: 1.06, tint: '#1FA5B8', tintA: 0.16, vignette: 0.45, skinWarm: 0.35, clarity: 0.3 }),
  mk({ id: 'lux', name: 'Luxe Mono', b: 1.06, c: 1.22, s: 0.15, glow: 0.12, tint: '#F2E6D8', tintA: 0.08, vignette: 0.4, clarity: 0.4 }),
];
export const DEFAULT_FILTER = 'clear';
/** Retired looks map to the closest kept one (skin-ish → glow/rosy/honey, rest → Clear HD). */
const LEGACY: Record<string, string> = { beauty: 'glow', porcelain: 'studio', peach: 'rosy', cocoa: 'honey', bronze: 'honey', luxe: 'honey', dreamy: 'studio', warm: 'honey', sunset: 'honey' };
export const filterOf = (id?: string) => (!id || id === 'none' ? undefined : FILTERS.find((f) => f.id === id) ?? FILTERS.find((f) => f.id === (LEGACY[id] ?? 'clear')));
/** Shader skin params [skinWarm, skinLift, clarity] or null. */
export const skinOf = (id?: string): number[] | null => { const f = filterOf(id); return f && (f.skinWarm || f.skinLift || f.clarity) ? [f.skinWarm, f.skinLift, f.clarity] : null; };

export interface ColorSpec { brightness: number; contrast: number; saturation: number; hue: number; r: number; g: number; b: number }
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Native bake parameters for a filter + manual adjust; null when the result is neutral. */
export function colorSpecOf(filterId?: string, adj: { brightness?: number; contrast?: number; saturation?: number } = {}): ColorSpec | null {
  const f = filterOf(filterId);
  const b = (f?.b ?? 1) * (adj.brightness ?? 1) + (f?.glow ?? 0) * 0.35;
  const c = (f?.c ?? 1) * (adj.contrast ?? 1);
  const s = (f?.s ?? 1) * (adj.saturation ?? 1);
  const w = f?.warm ?? 0;
  let r = 1 + 0.08 * w, g = 1 + 0.02 * w, bl = 1 - 0.08 * w;
  if (f?.tint && f.tintA) {
    const a = f.tintA; const hex = parseInt(f.tint.slice(1), 16);
    const ch = (v: number) => 1 - a + a * (v / 255) * 1.4;
    r *= ch((hex >> 16) & 255); g *= ch((hex >> 8) & 255); bl *= ch(hex & 255);
  }
  const spec = { brightness: clampN(b - 1, -1, 1), contrast: clampN(c - 1, -1, 1), saturation: clampN((s - 1) * 100, -100, 100), hue: f?.h ?? 0, r, g, b: bl };
  const neutral = Math.abs(spec.brightness) < 0.005 && Math.abs(spec.contrast) < 0.005 && Math.abs(spec.saturation) < 0.5 && !spec.hue
    && Math.abs(r - 1) < 0.005 && Math.abs(g - 1) < 0.005 && Math.abs(bl - 1) < 0.005;
  return neutral ? null : spec;
}
