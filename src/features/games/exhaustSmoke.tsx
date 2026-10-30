// Exhaust smoke for the race stage: a fixed pool of soft-textured particles per car.
// Each particle is one Animated progress value (0 → 1) driven on the native UI thread; opacity,
// growth, stretch, drag and sideways turbulence are interpolations of that progress, so the JS
// thread only touches a particle when it is (re)born. No runtime blur, shadow or additive glow.
import { useEffect, useMemo } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Asset } from 'expo-asset';
import { isLowEndDevice } from '../../lib/device';

const NATIVE = Platform.OS !== 'web';
const LOW = isLowEndDevice;

const TEX = LOW
  ? [require('../../../assets/games/car-racing/smoke_a_64.png'), require('../../../assets/games/car-racing/smoke_b_64.png')]
  : [require('../../../assets/games/car-racing/smoke_a_128.png'), require('../../../assets/games/car-racing/smoke_b_128.png')];

/** Every tuning number for the plume. Pairs are [coasting, full throttle]. */
export const SMOKE = {
  tier: LOW ? 'low' : 'high',
  pool: LOW ? 10 : 28, // particles per car
  layers: LOW ? [0, 2] : [0, 1, 2], // depth layers in use (0 = near, 2 = far)
  tickMs: LOW ? 33 : 0, // emitter update period (low tier ≈ 30 fps)
  texPx: LOW ? 64 : 128,
  intervalMs: LOW ? [260, 75] : [220, 45],
  lifeMs: [1150, 650],
  lifeClampMs: [600, 1250],
  peakAlpha: [0.1, 0.32],
  stretch: [2.0, 3.6], // scaleY / scaleX
  trail: [0.1, 0.3], // drift distance, fraction of the track height
  rotateDeg: 25,
  burst: LOW ? 2 : 4, // extra particles when the gas pedal is pressed
} as const;

const LAYER = [
  { size: 1, trail: 1, alpha: 1, life: 1 }, // near: big, fast, clear
  { size: 0.82, trail: 0.8, alpha: 0.75, life: 1.08 },
  { size: 0.64, trail: 0.6, alpha: 0.55, life: 1.15 }, // far: small, slow, faint
];

// Alpha rises in the first 15 % of life, then fades slowly; nothing dies while still visible.
const ALPHA = { inputRange: [0, 0.15, 0.45, 0.75, 1], outputRange: [0, 1, 0.62, 0.25, 0] };
// Grows 1.0 → 2.7 wide but only 1.0 → 2.0 long: the plume widens as it ages.
const GROW_X = { inputRange: [0, 0.25, 0.5, 1], outputRange: [1, 1.75, 2.2, 2.7] };
const GROW_Y = { inputRange: [0, 0.25, 0.5, 1], outputRange: [1, 1.4, 1.7, 2.0] };
// Drag: fast release from the exhaust, then slows down: (1 − e^(−3p)) / (1 − e^(−3)).
const DRAG_P = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 1];
const DRAG = { inputRange: DRAG_P, outputRange: DRAG_P.map((p) => (1 - Math.exp(-3 * p)) / (1 - Math.exp(-3))) };
const SWAY_P = Array.from({ length: 9 }, (_, i) => i / 8);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (r: readonly [number, number] | readonly number[], t: number) => r[0] + (r[1] - r[0]) * t;
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface Slot {
  id: number;
  layer: number;
  tex: number;
  prog: Animated.Value;
  x0: Animated.Value; y0: Animated.Value; trail: Animated.Value; sway: Animated.Value;
  k: Animated.Value; ks: Animated.Value; peak: Animated.Value; rot: Animated.Value;
  anim: Animated.CompositeAnimation | null;
  style: object;
}

export interface Emitter { next: number; cursor: number; vs: number; boost: boolean; acc: number; pending: number }

/** One fixed pool per car, created once; slots are reused round-robin (no per-frame allocation). */
export function createSmokePool(): Slot[] {
  return Array.from({ length: SMOKE.pool }, (_, id) => {
    const v = () => new Animated.Value(0);
    const s = { id, layer: SMOKE.layers[id % SMOKE.layers.length], tex: id % TEX.length, prog: v(), x0: v(), y0: v(), trail: v(), sway: v(), k: v(), ks: v(), peak: v(), rot: v(), anim: null } as Omit<Slot, 'style'>;
    // Per-slot turbulence: sin with its own phase/frequency, starting at 0 and growing with age.
    const ph = rand(0, Math.PI * 2); const f = rand(0.8, 1.6);
    const sway = { inputRange: SWAY_P, outputRange: SWAY_P.map((p) => ((Math.sin(2 * Math.PI * f * p + ph) - Math.sin(ph)) / 2) * Math.min(1, p * 2.5)) };
    const style = {
      opacity: Animated.multiply(s.peak, s.prog.interpolate(ALPHA)),
      transform: [
        { translateX: Animated.add(s.x0, Animated.multiply(s.sway, s.prog.interpolate(sway))) },
        { translateY: Animated.add(s.y0, Animated.multiply(s.trail, s.prog.interpolate(DRAG))) },
        { scaleX: Animated.multiply(s.k, s.prog.interpolate(GROW_X)) },
        { scaleY: Animated.multiply(s.ks, s.prog.interpolate(GROW_Y)) },
        { rotate: s.rot.interpolate({ inputRange: [-180, 180], outputRange: ['-180deg', '180deg'] }) },
      ],
    };
    return { ...s, style };
  });
}

export const createEmitter = (): Emitter => ({ next: 0, cursor: 0, vs: 10, boost: false, acc: 0, pending: 0 });

/** Runtime quality governor: the real frame interval decides the plume density, so a phone that
 *  cannot keep up thins its own smoke instead of stuttering. It only ever removes particles. */
export const PERF = { level: LOW ? 0 : 1, slow: 0, fast: 0 };

/** Call once per game-loop tick with the measured frame delta. Slow for ~0.6 s, 3 s to recover. */
export function observeFrame(dtMs: number) {
  if (dtMs <= 0 || dtMs > 200) return;
  const p = PERF;
  if (dtMs > (p.level === 0 ? 60 : 42)) { p.slow += dtMs; p.fast = 0; } else { p.fast += dtMs; p.slow = 0; }
  if (p.level === 1 && p.slow > 600) { p.level = 0; p.slow = 0; }
  else if (p.level === 0 && p.fast > 3000) { p.level = 1; p.fast = 0; }
}

/** Particle base width from the layout: 22 % of a lane, clamped for tiny and huge screens. */
export const smokeSize = (stageWidth: number) => Math.round(Math.min(40, Math.max(20, stageWidth * 0.31 * 0.22)));

/** Drive 0…1 from speed AND acceleration (+ pedal), so a gas press gives a short strong burst. */
export function smokeDrive(em: Emitter, v: number, boost: boolean, dtS: number) {
  em.vs += (v - em.vs) * (1 - Math.exp(-dtS * 2.5));
  const accel = clamp01((v - em.vs) / 3);
  const speed = clamp01((v - 10) / 18);
  if (boost && !em.boost) em.pending = SMOKE.burst; // a burst never gets lost between low-tier ticks
  em.boost = boost;
  return clamp01(0.4 * speed + 0.75 * accel + (boost ? 0.35 : 0));
}

interface Emit { drive: number; x: number; y: number; h: number; size: number }

function spawn(pool: Slot[], em: Emitter, e: Emit) {
  const s = pool[em.cursor];
  em.cursor = (em.cursor + 1) % pool.length;
  const L = LAYER[s.layer]; const d = e.drive;
  const k = rand(0.6, 1.4) * L.size;
  const stretch = lerp(SMOKE.stretch, d) * rand(0.85, 1.15);
  const life = Math.min(SMOKE.lifeClampMs[1], Math.max(SMOKE.lifeClampMs[0], lerp(SMOKE.lifeMs, d) * L.life * rand(0.8, 1.2)));
  s.anim?.stop();
  s.prog.setValue(0);
  s.k.setValue(k);
  s.ks.setValue(k * stretch);
  s.peak.setValue(lerp(SMOKE.peakAlpha, d) * L.alpha * rand(0.85, 1.15));
  s.rot.setValue(rand(-SMOKE.rotateDeg, SMOKE.rotateDeg));
  s.x0.setValue(e.x + rand(-0.18, 0.18) * e.size);
  s.y0.setValue(e.y + 0.3 * e.size * k * stretch); // start just behind the bumper, hidden under the car
  s.trail.setValue(e.h * lerp(SMOKE.trail, d) * L.trail * rand(0.85, 1.15));
  s.sway.setValue(e.size * rand(0.25, 0.6) * (Math.random() < 0.5 ? -1 : 1));
  s.anim = Animated.timing(s.prog, { toValue: 1, duration: life, easing: Easing.linear, useNativeDriver: NATIVE, isInteraction: false });
  s.anim.start();
}

/** Called from the race loop; dt is already capped by the caller, and births per call are capped too.
 *  On the low tier emission ticks at ~30 fps while the particles themselves still animate at full
 *  frame rate, because every particle is one native-driven Animated value. */
export function stepSmoke(pool: Slot[], em: Emitter, dtMs: number, e: Emit) {
  em.acc += dtMs;
  const thin = PERF.level === 0; // device is struggling: fewer, less frequent puffs (look unchanged at a glance)
  if (em.acc < (thin ? Math.max(SMOKE.tickMs, 33) : SMOKE.tickMs)) return;
  em.next -= em.acc;
  em.acc = 0;
  let n = thin ? Math.min(em.pending, 1) : em.pending;
  em.pending = 0;
  if (em.next <= 0) { n += 1; em.next = lerp(SMOKE.intervalMs, e.drive) * rand(0.8, 1.2) * (thin ? 1.5 : 1); }
  for (let i = 0; i < Math.min(n, thin ? 2 : 5); i++) spawn(pool, em, e);
}

/** Renders one car's pool, far layer first so near puffs overlap it. */
export function SmokePlume({ pool, size }: { pool: Slot[]; size: number }) {
  const order = useMemo(() => [...pool].sort((a, b) => b.layer - a.layer), [pool]);
  useEffect(() => { void Asset.loadAsync(TEX).catch(() => undefined); }, []);
  useEffect(() => () => pool.forEach((s) => s.anim?.stop()), [pool]);
  const box = { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 };
  return (
    <>
      {order.map((s) => (
        <Animated.View key={s.id} pointerEvents="none" style={[st.p, box, s.style]}>
          <Image source={TEX[s.tex]} style={StyleSheet.absoluteFill} contentFit="fill" cachePolicy="memory-disk" transition={0} />
        </Animated.View>
      ))}
    </>
  );
}

const st = StyleSheet.create({ p: { position: 'absolute', top: 0, left: '50%', opacity: 0 } });
