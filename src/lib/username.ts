// Handles (`@abebe`) are machine identifiers: a-z 0-9 _ . only, 3–24 chars, always lowercase and
// stored without the `@`. The human "Name" (display_name) accepts any script, Amharic included.
// Every screen must render a handle through `handleOf` so exactly one `@` is shown.

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;
export const PROFILE_BASE_URL = 'https://beetook.com';

const RESERVED = new Set([
  'admin', 'administrator', 'support', 'beetook', 'api', 'www', 'live', 'market', 'inbox',
  'profile', 'settings', 'help', 'about', 'login', 'signup', 'terms', 'privacy', 'wallet',
  'official', 'root', 'moderator', 'staff', 'system', 'me', 'user', 'users',
]);

/** Mirrors `app_9e1318caf6_normalize_username`: trims, drops every leading `@`, lowercases. */
export function normalizeUsername(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^@+/, '').trim().toLowerCase();
}

export type UsernameProblem =
  | 'empty' | 'non_ascii' | 'invalid_chars' | 'too_short' | 'too_long'
  | 'bad_edges' | 'double_dot' | 'reserved';

export const USERNAME_MESSAGES: Record<UsernameProblem, string> = {
  empty: 'Username አይቀርም።',
  non_ascii: 'Username የሚፈቅደው እንግሊዝኛ ፊደል (a–z)፣ ቁጥር፣ _ እና . ብቻ ነው። አማርኛ ፊደላት አይቻልም — ስምዎን በ "Name" መስክ ላይ በአማርኛ መጻፍ ይችላሉ።',
  invalid_chars: 'Username የሚፈቅደው እንግሊዝኛ ፊደል (a–z)፣ ቁጥር፣ _ እና . ብቻ ነው። ክፍት ቦታ፣ ሌሎች ምልክቶች እና emoji አይፈቀዱም።',
  too_short: `Username ቢያንስ ${HANDLE_MIN} ፊደል መሆን አለበት።`,
  too_long: `Username ከ ${HANDLE_MAX} ፊደል መብለጥ የለበትም።`,
  bad_edges: 'Username በነጥብ (.) ወይም በ underscore (_) መጀመር ወይም መጨረስ አይችልም።',
  double_dot: 'Username ተከታታይ ሁለት ነጥብ (..) መያዝ አይችልም።',
  reserved: 'ይህ username ለራሳችን አገልግሎት ተይዟል። እባክዎ ሌላ ይምረጡ።',
};

/** Reason the handle is unusable, or null when it is valid. */
export function usernameProblem(raw: string | null | undefined): UsernameProblem | null {
  const u = normalizeUsername(raw);
  if (!u) return 'empty';
  if (/[^a-z0-9_.]/.test(u)) return /[^\x20-\x7E]/.test(u) ? 'non_ascii' : 'invalid_chars';
  if (u.length < HANDLE_MIN) return 'too_short';
  if (u.length > HANDLE_MAX) return 'too_long';
  if (/^[._]|[._]$/.test(u)) return 'bad_edges';
  if (u.includes('..')) return 'double_dot';
  if (RESERVED.has(u)) return 'reserved';
  return null;
}

export const isValidUsername = (raw: string | null | undefined) => usernameProblem(raw) === null;

export function usernameError(raw: string | null | undefined): string | null {
  const p = usernameProblem(raw);
  return p ? USERNAME_MESSAGES[p] : null;
}

/** Removes leading `@` signs from (rich) handle HTML so the UI can add exactly one: `<b>@@abe</b>` → `<b>abe</b>`. */
export const stripHandleSigns = (html: string): string => html.replace(/(^|>)(\s*)@+/g, '$1$2');

/** Coloured handle HTML, but only while it still spells the real username; otherwise the plain username. */
export function handleHtml(rawHtml: string | null | undefined, username: string | null | undefined): string {
  const u = clean(username).toLowerCase();
  const plain = (rawHtml ?? '').replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, '').trim().replace(/^@+/, '').toLowerCase();
  return rawHtml && plain === u ? stripHandleSigns(rawHtml) : u;
}

const clean = (raw: string | null | undefined) => (raw ?? '').trim().replace(/^@+/, '');

/** `abebe` → `@abebe`. Never doubles the sign. */
export const handleOf = (raw: string | null | undefined): string => {
  const u = clean(raw);
  return u ? `@${u}` : '';
};

/** Public profile link: `abebe` → `https://beetook.com/abebe` (no `@`, lowercase). */
export function profileUrl(raw: string | null | undefined): string {
  const u = normalizeUsername(raw);
  return u ? `${PROFILE_BASE_URL}/${u}` : PROFILE_BASE_URL;
}

/** Reads a handle out of a shared link (`/abebe` or `/@abebe`), or null when the path is not a profile. */
export function usernameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^(?:https?:\/\/(?:www\.)?beetook\.com\/+|beetook:\/\/\/*)@?([A-Za-z0-9_.]+)\/?(?:[?#].*)?$/i.exec(url.trim());
  if (!match) return null;
  const candidate = match[1].toLowerCase();
  return isValidUsername(candidate) ? candidate : null;
}

/** Server errors (`USERNAME_TAKEN`, `USERNAME_NON_ASCII`, …) → the message shown under the field. */
export function usernameErrorFromServer(message: string | null | undefined): string {
  const m = (message ?? '').toUpperCase();
  if (m.includes('USERNAME_TAKEN') || m.includes('DUPLICATE') || m.includes('UNIQUE')) {
    return 'ይህ username ተይዟል። እባክዎ ሌላ ይምረጡ።';
  }
  const reason = /USERNAME_([A-Z_]+)/.exec(m)?.[1]?.toLowerCase();
  if (reason && reason in USERNAME_MESSAGES) return USERNAME_MESSAGES[reason as UsernameProblem];
  return 'Username ማስቀመጥ አልተቻለም። እባክዎ እንደገና ይሞክሩ።';
}
