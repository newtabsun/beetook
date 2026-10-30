// Development-only tracing for the live room: synchronous entry/exit marks that go into the native freeze report.
// In production builds both helpers are no-ops (no wrapper, no native call).
import { jsMark } from '../../modules/gpupixel-camera';

/** Wraps an event handler: "> name" on entry, "< name" on exit (dev builds only). */
export function traced<A extends unknown[], R>(name: string, fn: (...a: A) => R): (...a: A) => R {
  if (!__DEV__) return fn;
  return (...a: A) => { jsMark(`> ${name}`); try { return fn(...a); } finally { jsMark(`< ${name}`); } };
}
/** Marks an effect run (dev builds only). */
export const fxMark = (name: string) => { if (__DEV__) jsMark(`fx ${name}`); };
