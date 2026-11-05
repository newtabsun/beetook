// Admin panel API. Every call is enforced server-side (is_admin guard in each RPC / RLS policy).
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

/** Opens an admin-set link; adds https:// when the scheme is missing (Android refuses bare domains). */
export function openLink(raw?: string | null) {
  const t = (raw ?? '').trim();
  if (!t) return;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
  void Linking.openURL(url).catch(() => undefined);
}
import { supabase } from './supabase';
import { uploadStickerImage, markPostDeleted } from './api';

const P = 'app_9e1318caf6_';
const rpc = async <T = any>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(P + fn, args as any);
  if (error) throw new Error(error.message);
  return data as T;
};
const tbl = (n: string) => supabase.from(P + n);
const ok = <T,>(r: { data: T; error: any }): T => { if (r.error) throw new Error(r.error.message); return r.data; };

export const isAdmin = async (): Promise<boolean> => { try { return !!(await rpc('is_admin')); } catch { return false; } };

export const searchUsers = (q: string) => rpc<any[]>('adm_search', { p_q: q });
export const getUser = (id: string) => rpc<any>('adm_user', { p_id: id });
export const listRedeems = (status: string) => rpc<any[]>('adm_redeems', { p_status: status });
export const setRedeem = (id: string, okFlag: boolean, note: string) => rpc('adm_redeem_set', { p_id: id, p_ok: okFlag, p_note: note });
export const listBlocks = () => rpc<any[]>('adm_blocks');
export const blockAccess = (kind: 'live' | 'post' | 'auth', user: string | null, reason: string, days: number | null) => rpc('adm_block', { p_kind: kind, p_user: user, p_reason: reason, p_days: days ?? 0 });
export const unblockAccess = (kind: 'live' | 'post' | 'auth', user: string | null) => rpc('adm_unblock', { p_kind: kind, p_user: user });
export const adjustCoins = (user: string, amount: number, note: string) => rpc('adm_coins', { p_user: user, p_amount: amount, p_note: note });
export const notify = (user: string | null, title: string, body: string) => rpc<number>('adm_notify', { p_user: user, p_title: title, p_body: body });
export const regCounts = () => rpc<Record<string, number>>('adm_reg');
export const warnUser = (user: string, text: string) => rpc('adm_warn', { p_user: user, p_text: text });
export const deletePost = async (id: string) => { await rpc('adm_delete_post', { p_id: id }); markPostDeleted(id); };

/** Picks an image (GIF kept intact) and uploads it; returns the public URL or null if cancelled. */
export async function pickAndUploadImage(): Promise<string | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  return uploadStickerImage(a.uri, a.mimeType, a.fileName);
}

export const listBanners = async () => ok(await tbl('banners').select('*').order('created_at', { ascending: false })) as any[];
export const addBanner = async (image_url: string, link: string) => ok(await tbl('banners').insert({ image_url, link: link || null }));
export const updateBanner = async (id: string, patch: Record<string, unknown>) => ok(await tbl('banners').update(patch).eq('id', id));
export const deleteBanner = async (id: string) => ok(await tbl('banners').delete().eq('id', id));
export const activeBanner = async (): Promise<{ id: string; image_url: string; link: string | null } | null> => {
  const { data } = await tbl('banners').select('id,image_url,link').eq('active', true).order('created_at', { ascending: false }).limit(1);
  return (data?.[0] as any) ?? null;
};

export const listNotices = async () => ok(await tbl('notices').select('*').order('created_at', { ascending: false }).limit(50)) as any[];
export const addNotice = async (user: string | null, image_url: string, link: string) => ok(await tbl('notices').insert({ user_id: user, image_url, link: link || null }));
export const deleteNotice = async (id: string) => ok(await tbl('notices').delete().eq('id', id));
export const myNotice = () => rpc<{ id: string; image_url: string; link: string | null } | null>('my_notice');
export const noticeDone = (id: string) => rpc('notice_done', { p_id: id });
export const myBlocks = () => rpc<{ live: string | null; post: string | null }>('my_blocks');

export const listPackages = async () => ok(await tbl('boost_packages').select('*').order('kind').order('amount')) as any[];
export const addPackage = async (kind: string, amount: number, price: number) => ok(await tbl('boost_packages').insert({ kind, amount, price }));
export const updatePackage = async (id: number, patch: Record<string, unknown>) => ok(await tbl('boost_packages').update(patch).eq('id', id));
export const deletePackage = async (id: number) => ok(await tbl('boost_packages').delete().eq('id', id));

export const listBgs = async () => ok(await tbl('live_bgs').select('*').order('created_at')) as any[];
export const addBg = async (image_url: string) => ok(await tbl('live_bgs').insert({ key: 'u' + Date.now().toString(36), image_url }));
export const replaceBg = async (id: string, image_url: string) => ok(await tbl('live_bgs').update({ image_url }).eq('id', id));
export const deleteBg = async (id: string) => ok(await tbl('live_bgs').delete().eq('id', id));

export const adminGroups = (q: string) => rpc<any[]>('adm_groups', { p_q: q });
export const adminGroupSet = (id: string, hidden: boolean | null, comments: boolean | null) => rpc('adm_group_set', { p_group: id, p_hidden: hidden, p_comments: comments });
export const adminGroupDelete = (id: string) => rpc('adm_group_delete', { p_group: id });
export const adminGroupMessages = (id: string) => rpc<any[]>('adm_group_messages', { p_group: id });
export const adminGroupMsgDelete = (id: number) => rpc('adm_group_msg_delete', { p_id: id });
