// Single place that turns any thrown value into a short, user-facing English message.
import { getNetwork, reportNetIssue } from './network';
import { LIVE_DENIED_MESSAGE } from './liveRule';

/** True when an error came from connectivity (offline / weak), not from the app or server logic. */
export function isNetError(e: unknown): boolean {
  const t = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return OFFLINE_RE.test(t) || WEAK_RE.test(t);
}

export const MSG_OFFLINE = 'No internet connection';
export const MSG_WEAK = 'Your internet connection is weak';
export const MSG_GENERIC = 'Something went wrong. Please try again';

const OFFLINE_RE = /failed to fetch|network request failed|fetch failed|unknownhost|unable to resolve host|enotfound|econnrefused|enetunreach|no address associated|network ?error|internet connection appears to be offline|load failed/i;
const WEAK_RE = /timed? ?out|timeout|aborterror|aborted|sockettimeout|econnreset|connection reset|slow/i;
const TECH_RE = /error:|typeerror|referenceerror|syntaxerror|exception|java\.|supabase|https?:\/\/|\.co\b|\bhost\b|stack|undefined|null|json|relation|schema|column|function|violates|constraint|duplicate key|pgrst|jwt|status code|\bcode\b|\bat \w|[{}<>]|render:|mediastore|migration|database/i;

function raw(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Classifies any error. Original text is logged for developers only. */
export function friendlyError(e: unknown): string {
  const text = raw(e);
  const msg = e instanceof Error ? e.message : text;
  if (text && ![MSG_OFFLINE, MSG_WEAK, MSG_GENERIC].includes(msg)) console.warn('[error]', text);
  if (!getNetwork().online) return MSG_OFFLINE;
  if (/going live needs vip/i.test(text)) return LIVE_DENIED_MESSAGE;
  const blk = /(LIVE|POST)_BLOCKED:\s*([^"\\\n]*)/.exec(text);
  if (blk) return `${blk[1] === 'LIVE' ? 'Going live' : 'Posting'} is blocked by Bee Took.${blk[2].trim() ? ` Reason: ${blk[2].trim()}` : ''}`;
  if (OFFLINE_RE.test(text)) { reportNetIssue(); return MSG_OFFLINE; }
  if (WEAK_RE.test(text)) { reportNetIssue(); return MSG_WEAK; }
  if ([MSG_OFFLINE, MSG_WEAK, MSG_GENERIC].includes(msg)) return msg;
  // Short, plain, user-meaningful validation messages (e.g. "Video is larger than 1 GB.") are kept.
  if (msg && msg.length <= 90 && !TECH_RE.test(msg)) return msg;
  return MSG_GENERIC;
}

/** For free-text messages that may or may not be technical (toasts). */
export function safeMessage(m?: string): string | undefined {
  if (!m) return m;
  return OFFLINE_RE.test(m) || WEAK_RE.test(m) || TECH_RE.test(m) || m.length > 140 ? friendlyError(m) : m;
}
