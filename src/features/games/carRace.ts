// Car-race physics shared by the live duel and the server (migration 028 mirrors this exactly).
// Both cars start identical at BASE_SPEED. Every paid pedal tap changes a car's speed by a fixed step
// that ramps in over RAMP seconds and then holds, like a real car keeping the speed it gained:
//   v(t) = max(MIN_SPEED, 10 + Σgas 6·(1 − e^(−(t−ti)/2.5)) − Σbrake 4·(1 − e^(−(t−ti)/2.0)))
// Pedals are unlimited (no cooldown, no usage cap) — the only limit is the payer's coin balance.
// Distance is the trapezoid integral of v on a fixed 0.25 s grid (server uses the same grid), and
// because v ≥ MIN_SPEED a car always moves forward: it can never jump backwards or jitter.
export const BASE_SPEED = 10; // m/s — the same gentle start speed for both cars
export const MIN_SPEED = 2; // m/s — heavy braking slows a car to a crawl but never stops it
export const STEP = { gas: 6, brake: 4 } as const; // m/s gained / taken away per pedal tap
export const RAMP = { gas: 2.5, brake: 2.0 } as const; // seconds to reach ~63 % of the step
/** Coins charged per pedal tap. The server charges exactly these (10 = +6 m/s, 30 = −4 m/s). */
export const MOVE_COST = { gas: 10, brake: 30 } as const;
const GRID = 0.25;
export type MoveKind = keyof typeof MOVE_COST;

export interface Move {
  action_id: string; session_id: string; actor_id: string; side: number; kind: MoveKind;
  coins: number; reward: number; created_at: string;
}

interface Step { kind: MoveKind; ti: number; signed: number; tau: number }
/** Per-car integral cache. It survives changes of the move list: a new move only invalidates the grid
 *  checkpoints from its own start time onward, so nothing is ever rebuilt from t = 0 and a burst of
 *  supporter moves cannot stall the frame. `dk[k]` / `vk[k]` = distance / speed at k · GRID seconds. */
interface Cache { startedAt: number; moves: Move[] | null; known: Set<string>; steps: Step[]; dk: number[]; vk: number[] }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function stepOf(m: Move, startedAt: number): Step {
  return { kind: m.kind, ti: Math.max(0, (Date.parse(m.created_at) - startedAt) / 1000), signed: m.kind === 'gas' ? STEP.gas : -STEP.brake, tau: RAMP[m.kind] };
}

function speedAt(steps: Step[], t: number) {
  let v = BASE_SPEED;
  for (const s of steps) if (t >= s.ti) v += s.signed * (1 - Math.exp(-Math.min((t - s.ti) / s.tau, 50)));
  return Math.max(MIN_SPEED, v);
}

const caches = new Map<string, Cache>();

function cacheFor(moves: Move[], side: number, startedAt: number, tag: string): Cache {
  const key = `${side}:${startedAt}:${tag}`;
  let c = caches.get(key);
  if (!c) {
    for (const [k, v] of caches) if (v.startedAt !== startedAt) caches.delete(k); // a new game: drop the old ones
    c = { startedAt, moves: null, known: new Set(), steps: [], dk: [0], vk: [speedAt([], 0)] };
    caches.set(key, c);
  }
  if (c.moves !== moves) {
    c.moves = moves;
    let earliest = Infinity;
    for (const m of moves) {
      if (m.side !== side || c.known.has(m.action_id)) continue;
      c.known.add(m.action_id);
      const s = stepOf(m, startedAt);
      c.steps.push(s);
      if (s.ti < earliest) earliest = s.ti;
    }
    if (earliest < Infinity) {
      // Checkpoint k0 only depends on steps that started at or before k0 · GRID, so it stays valid.
      const k0 = Math.floor(earliest / GRID);
      if (k0 + 1 < c.dk.length) { c.dk.length = k0 + 1; c.vk.length = k0 + 1; }
    }
  }
  return c;
}

/** Distance (m), speed (m/s) and whether a gas/brake ramp is still building, for one car.
 *  `tag` gives each caller its own cache (the frame loop and the 5 Hz UI clock run at different times). */
export function carState(moves: Move[], side: number, startedAt: number | null, durationS: number, nowMs: number, tag = '') {
  if (!startedAt) return { d: 0, v: 0, boost: false, brake: false };
  const t = clamp((nowMs - startedAt) / 1000, 0, durationS);
  const c = cacheFor(moves, side, startedAt, tag);
  const kT = Math.floor(t / GRID);
  while (c.dk.length - 1 < kT) {
    const k = c.dk.length - 1;
    const v1 = speedAt(c.steps, (k + 1) * GRID);
    c.dk.push(c.dk[k] + (GRID * (c.vk[k] + v1)) / 2);
    c.vk.push(v1);
  }
  const v = speedAt(c.steps, t);
  const d = c.dk[kT] + ((t - kT * GRID) * (c.vk[kT] + v)) / 2;
  let boost = false; let brake = false;
  for (const s of c.steps) {
    const dt = t - s.ti;
    if (dt >= 0 && dt <= s.tau * 2) { if (s.kind === 'gas') boost = true; else brake = true; }
  }
  return { d, v, boost, brake };
}

/** Distance of a car that never touches a pedal — the track-length reference. */
export const baselineDistance = (durationS: number) => BASE_SPEED * durationS;

/** Engine note for one car: revs rise with speed, a ramp still building adds a little pitch and load.
 *  `bias` keeps the two engines a little apart so they never sound like the same car. */
export function engineTone(speed: number, boosting: boolean, braking: boolean, bias: number) {
  const load = clamp(speed / 34, 0, 1);
  return {
    rate: clamp(bias * (0.74 + load * 0.5) + (boosting ? 0.05 : 0) - (braking ? 0.04 : 0), 0.62, 1.7),
    volume: clamp(0.05 + load * 0.5 + (boosting ? 0.08 : 0) - (braking ? 0.05 : 0), 0.03, 0.6),
  };
}

/** Idempotency key for a paid move, so a retry can never be charged twice. */
export function moveId(): string {
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${Date.now().toString(16).padStart(12, '0').slice(-12)}-${r()}-4${r().slice(1)}-a${r().slice(1)}-${r()}${r().slice(0, 4)}`;
}
