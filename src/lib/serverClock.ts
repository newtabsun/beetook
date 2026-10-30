// Server-aligned clock for live games. Every move/session timestamp is written by the database, but the
// race used to be evaluated with the phone's own clock: a phone that is 3 s fast saw each move "3 s old"
// at once (its speed ramp already 70 % done), so cars jumped, and two viewers saw two different races.
// The offset is estimated from realtime events: a row arrives a little after its server timestamp, so the
// largest (server − local) sample is the best estimate (it only ever errs by the network latency).
let offset: number | null = null;

/** Feed a database timestamp. `live` = the row just arrived over realtime (polled rows may be old). */
export function observeServerTime(iso: unknown, live = false, receivedMs = Date.now()) {
  if (typeof iso !== 'string') return;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return;
  const sample = t - receivedMs;
  if (offset === null) { if (live) offset = sample; return; }
  if (sample > offset) offset = sample;
}

/** Current time on the server's clock (falls back to the local clock until the first realtime event). */
export const serverNow = () => Date.now() + (offset ?? 0);

/** Test helper. */
export const resetServerClock = () => { offset = null; };
