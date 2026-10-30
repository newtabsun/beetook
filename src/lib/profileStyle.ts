// Web-parity profile extras (rich name/username/bio, scrolling bio, 3 action buttons).
// Stored in `profiles.links` (jsonb, owner-only RLS already applied) under the `_profile` key,
// so every viewer that can read a profile also gets its formatting.
import type { Profile } from './api';
import { handleHtml } from './username';

export interface ActionButton { id: string; type: 'phone' | 'link'; title: string; value: string }
export interface ProfileStyle { nameHtml: string; usernameHtml: string; bioHtml: string; bioMarquee: boolean; actionButtons: ActionButton[] }

const KEY = '_profile';
export const defaultButtons = (): ActionButton[] => [
  { id: 'b1', type: 'phone', title: 'Phone', value: '' },
  { id: 'b2', type: 'link', title: 'Link', value: '' },
  { id: 'b3', type: 'link', title: 'Link', value: '' },
];

export function readStyle(p: Profile): ProfileStyle {
  let raw: Partial<ProfileStyle> = {};
  try { raw = JSON.parse(p.links?.[KEY] ?? '{}') as Partial<ProfileStyle>; } catch { raw = {}; }
  const base = defaultButtons();
  return {
    nameHtml: raw.nameHtml || p.display_name || p.username || '',
    usernameHtml: handleHtml(raw.usernameHtml, p.username),
    bioHtml: raw.bioHtml ?? p.bio ?? '',
    bioMarquee: !!raw.bioMarquee,
    actionButtons: Array.isArray(raw.actionButtons) && raw.actionButtons.length === 3
      ? raw.actionButtons.map((b, i) => ({ ...base[i], ...b, type: base[i].type }))
      : base,
  };
}

export function writeStyle(links: Record<string, string>, st: ProfileStyle): Record<string, string> {
  return { ...links, [KEY]: JSON.stringify(st) };
}

export const telHref = (v: string) => `tel:${v.replace(/[^\d+]/g, '')}`;
export const linkHref = (v: string) => (/^[a-z]+:/i.test(v) ? v : `https://${v}`);
