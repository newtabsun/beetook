// Profile ☰ menu data — all server-owned (Supabase app_9e1318caf6_*). See backend/migrations/002_profile_menu.sql.
import { supabase } from './supabase';

const P = 'app_9e1318caf6_';

async function rpc<R>(name: string, args?: Record<string, unknown>): Promise<R> {
  const { data, error } = await supabase.rpc(P + name, args);
  if (error) throw new Error(error.message);
  return data as R;
}
async function me(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
}

// Wallet balances, history, purchases and redeem live in ./wallet and ./payments.

export type Vip = { coins: number; expires_at: string | null; auto_renew: boolean; renew: 'none' | 'renewed' | 'failed' };
export const vipStatus = () => rpc<Vip>('vip_status');
export const vipSubscribe = () => rpc<{ result: 'ok' | 'active' | 'funds'; expires_at?: string }>('vip_subscribe');
export const vipSetAuto = (on: boolean) => rpc<boolean>('vip_set_auto', { p_on: on });
export const vipActive = (v: Vip | null) => !!v?.expires_at && new Date(v.expires_at).getTime() > Date.now();
export const vipDays = (v: Vip | null) => (vipActive(v) ? Math.ceil((new Date(v!.expires_at!).getTime() - Date.now()) / 86_400_000) : 0);

/** Ranked by Earnings balance. `earnings` (Earnings balance only) is returned for every row and is visible to everybody, guests included; `rank` is null when the user has no earnings yet. */
export type RankRow = { id: string; username: string; display_name: string | null; avatar_url: string | null; earnings: number | null; vip: boolean; rank: number | null };
export const rankTop = () => rpc<RankRow[]>('rank_top');

export type Social = { id: string; label: string; url: string };
export async function loadSocials(): Promise<Social[]> {
  const { data, error } = await supabase.from(`${P}app_config`).select('value').eq('key', 'socials').maybeSingle();
  if (error) throw new Error(error.message);
  return ((data?.value as Social[]) ?? []);
}
export const saveSocials = (links: Social[]) => rpc<void>('save_socials', { p_links: links });

export type Blocked = { id: string; username: string; display_name: string | null };
export const myBlocks = () => rpc<Blocked[]>('my_blocks');
export async function unblock(id: string) {
  const { error } = await supabase.from(`${P}blocks`).delete().eq('blocker_id', await me()).eq('blocked_id', id);
  if (error) throw new Error(error.message);
}
export const deleteAccount = () => rpc<void>('delete_account');

export type Settings = {
  privateAccount: boolean; pushNotifications: boolean; liveAlerts: boolean; commentFilter: 'everyone' | 'friends' | 'off';
  dataSaver: boolean; showActivity: boolean; twoStep: boolean; showInSearch: boolean; method: string;
};
export const DEFAULT_SETTINGS: Settings = {
  privateAccount: false, pushNotifications: true, liveAlerts: true, commentFilter: 'everyone',
  dataSaver: false, showActivity: true, twoStep: false, showInSearch: true, method: 'telebirr',
};
export async function loadSettings(): Promise<Settings> {
  const { data, error } = await supabase.from(`${P}user_settings`).select('settings').eq('user_id', await me()).maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_SETTINGS, ...((data?.settings as Partial<Settings>) ?? {}) };
}
export async function saveSettings(s: Settings) {
  const { error } = await supabase.from(`${P}user_settings`).upsert({ user_id: await me(), settings: s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  // The private-account switch is enforced by the database (follow guard + post visibility), not only stored.
  await rpc<boolean>('set_private_account', { p_on: s.privateAccount });
}

export type SupportMsg = { id: number; from_support: boolean; body: string; created_at: string };
export async function fetchSupport(): Promise<SupportMsg[]> {
  const { data, error } = await supabase.from(`${P}support_messages`).select('id,from_support,body,created_at').order('created_at').limit(200);
  if (error) throw new Error(error.message);
  return data as SupportMsg[];
}
export async function sendSupport(body: string) {
  const { error } = await supabase.from(`${P}support_messages`).insert({ user_id: await me(), body: body.trim().slice(0, 1000) });
  if (error) throw new Error(error.message);
}
