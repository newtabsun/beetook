// What the player SEES of a car. The race maths (carRace.ts) is exact, but a move that reaches a phone late
// is applied retroactively, so the exact speed/distance can step suddenly (a batch of supporter gas
// arriving 1 s late = +40 m/s at once). The picture follows the exact values through this limiter, so
// cars glide instead of being thrown. In normal play (a few pedal taps) the limits are never reached and
// the picture equals the exact state.
export const VIEW = {
  acc: 14, // m/s² — largest speed change shown (one tap ramps in at ~2.4 m/s², so ~6 taps at once pass unchanged)
  pull: 1.5, // s — time constant for pulling the shown distance back to the exact distance
  pullMax: 25, // m/s — fastest allowed correction of the shown distance
} as const;

/** Road pixels per metre travelled (the dashed divider moves exactly this far per metre). */
export const ROAD_PX_PER_M = 9;
/** Largest vertical offset of a car from the centre line, as a fraction of the road height. */
export const MAX_OFF = 0.3;

export interface CarView { d: number; v: number }

/** Advance one car's shown state by dt seconds toward the exact state. */
export function stepView(view: CarView, exactD: number, exactV: number, dt: number) {
  const lim = VIEW.acc * dt;
  view.v += Math.max(-lim, Math.min(lim, exactV - view.v));
  view.d += view.v * dt;
  const cap = VIEW.pullMax * dt;
  const pull = (exactD - view.d) * (1 - Math.exp(-dt / VIEW.pull));
  view.d += Math.max(-cap, Math.min(cap, pull));
}

/** Position of car A on the road (fraction of the height, 0.5 = centre); car B mirrors it. */
export const leadOffset = (distA: number, distB: number, scale: number) => MAX_OFF * Math.tanh((distA - distB) / scale);
