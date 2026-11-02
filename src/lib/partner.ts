// Partner program (invite by ID → commission on partners' gifts). All rules live on the server (migration 051).
import { supabase } from './supabase';

const P = 'app_9e1318caf6_';

async function rpc<R>(name: string, args?: Record<string, unknown>): Promise<R> {
  const { data, error } = await supabase.rpc(P + name, args);
  if (error) throw new Error(error.message);
  return data as R;
}

export type PartnerPerson = {
  id: string; username: string | null; display_name: string | null; avatar_url: string | null;
  public_id: number | null; level: number; message_html: string;
};
export type PartnerOverview = {
  level: number; pct: number; goal: number; keep_min: number; month_income: number; partner_count: number;
  income: { today: number; week: number; month: number; total: number };
  message_html: string; inviter: PartnerPerson | null;
};
export type PartnerRow = {
  id: string; username: string | null; display_name: string | null; avatar_url: string | null;
  public_id: number | null; level: number; coins: number; joined_at: string;
};
export type PartnerPreview = { inviter: PartnerPerson; is_self: boolean; has_partner: boolean; ready: boolean; post_off: boolean };

export const partnerOverview = () => rpc<PartnerOverview>('partner_overview');
export const partnerList = (q?: string) => rpc<PartnerRow[]>('partner_list', { p_q: q?.trim() || null, p_limit: 100, p_offset: 0 });
export const partnerPreview = (inviter: string, post?: string) => rpc<PartnerPreview>('partner_preview', { p_inviter: inviter, p_post: post ?? null });
export const partnerJoin = (inviter: string, post?: string) => rpc<boolean>('partner_join', { p_inviter: inviter, p_post: post ?? null });
export const partnerSetMessage = (html: string) => rpc<boolean>('partner_set_message', { p_html: html });

/** Level table (display + progress); the server owns the real numbers. */
export const PARTNER_LEVELS = [
  { level: 1, pct: 3, goal: 400_000, color: '#9CA3AF' },
  { level: 2, pct: 5, goal: 1_500_000, color: '#34D399' },
  { level: 3, pct: 8, goal: 5_000_000, color: '#3B82F6' },
  { level: 4, pct: 10, goal: 15_000_000, color: '#A855F7' },
  { level: 5, pct: 12, goal: 25_000_000, color: '#FFC400' },
] as const;
export const levelInfo = (l: number) => PARTNER_LEVELS[Math.max(1, Math.min(5, l || 1)) - 1];
