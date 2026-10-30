/** Theme registry: one Skia-free theme set (../motion) shared by Android, iOS and web. */
import { NATIVE_THEME_CATS, NATIVE_THEMES } from '../motion';

export interface Theme105 { id: number; name: string; cat: string; desc: string }

export const THEMES_105: Theme105[] = NATIVE_THEMES.map(({ id, name, cat, desc }) => ({ id, name, cat, desc }));

const CAT_LABELS: Record<string, string> = { ...NATIVE_THEME_CATS };
export const catLabel = (c: string) => CAT_LABELS[c] ?? c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
export const THEME105_CATS = Array.from(new Set(THEMES_105.map((t) => t.cat)));
export const theme105Key = (id: number) => `x:${id}`;
