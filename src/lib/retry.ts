import { isNetError } from './errors';
import { waitGood } from './network';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries a network step with backoff (base, 2×base, 4×base). Validation errors are not retried.
 * Network failures wait (up to 60 s) for the connection to come back, then retry automatically.
 */
export async function withRetry<T>(fn: () => Promise<T>, tries = 4, baseMs = 2000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (/1 GB|empty|10 minutes|1080p/.test((e as Error)?.message ?? '')) throw e;
      if (i < tries - 1) { if (isNetError(e)) await waitGood(60000); await sleep(baseMs * 2 ** i); }
    }
  }
  throw last;
}
