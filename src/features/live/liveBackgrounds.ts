// Generated: bundled live backgrounds (max 720px WebP) + 96px picker thumbs.
import { supabase } from '../../lib/supabase';
export const LIVE_BGS: { key: string; full: number; thumb: number }[] = [
  { key: 'bg1', full: require('../../../assets/live-bg/bg1.webp'), thumb: require('../../../assets/live-bg/t1.webp') },
  { key: 'bg2', full: require('../../../assets/live-bg/bg2.webp'), thumb: require('../../../assets/live-bg/t2.webp') },
  { key: 'bg3', full: require('../../../assets/live-bg/bg3.webp'), thumb: require('../../../assets/live-bg/t3.webp') },
  { key: 'bg4', full: require('../../../assets/live-bg/bg4.webp'), thumb: require('../../../assets/live-bg/t4.webp') },
  { key: 'bg5', full: require('../../../assets/live-bg/bg5.webp'), thumb: require('../../../assets/live-bg/t5.webp') },
  { key: 'bg6', full: require('../../../assets/live-bg/bg6.webp'), thumb: require('../../../assets/live-bg/t6.webp') },
  { key: 'bg7', full: require('../../../assets/live-bg/bg7.webp'), thumb: require('../../../assets/live-bg/t7.webp') },
  { key: 'bg8', full: require('../../../assets/live-bg/bg8.webp'), thumb: require('../../../assets/live-bg/t8.webp') },
  { key: 'bg9', full: require('../../../assets/live-bg/bg9.webp'), thumb: require('../../../assets/live-bg/t9.webp') },
  { key: 'bg10', full: require('../../../assets/live-bg/bg10.webp'), thumb: require('../../../assets/live-bg/t10.webp') },
  { key: 'bg11', full: require('../../../assets/live-bg/bg11.webp'), thumb: require('../../../assets/live-bg/t11.webp') },
  { key: 'bg12', full: require('../../../assets/live-bg/bg12.webp'), thumb: require('../../../assets/live-bg/t12.webp') },
  { key: 'bg13', full: require('../../../assets/live-bg/bg13.webp'), thumb: require('../../../assets/live-bg/t13.webp') },
  { key: 'bg14', full: require('../../../assets/live-bg/bg14.webp'), thumb: require('../../../assets/live-bg/t14.webp') },
  { key: 'bg15', full: require('../../../assets/live-bg/bg15.webp'), thumb: require('../../../assets/live-bg/t15.webp') },
  { key: 'bg16', full: require('../../../assets/live-bg/bg16.webp'), thumb: require('../../../assets/live-bg/t16.webp') },
  { key: 'bg17', full: require('../../../assets/live-bg/bg17.webp'), thumb: require('../../../assets/live-bg/t17.webp') },
  { key: 'bg18', full: require('../../../assets/live-bg/bg18.webp'), thumb: require('../../../assets/live-bg/t18.webp') },
  { key: 'bg19', full: require('../../../assets/live-bg/bg19.webp'), thumb: require('../../../assets/live-bg/t19.webp') },
  { key: 'bg20', full: require('../../../assets/live-bg/bg20.webp'), thumb: require('../../../assets/live-bg/t20.webp') },
  { key: 'bg21', full: require('../../../assets/live-bg/bg21.webp'), thumb: require('../../../assets/live-bg/t21.webp') },
  { key: 'bg22', full: require('../../../assets/live-bg/bg22.webp'), thumb: require('../../../assets/live-bg/t22.webp') },
];
const MAP = new Map<string, number | { uri: string }>(LIVE_BGS.map((b) => [b.key, b.full]));
export type BgItem = { key: string; thumb: number | { uri: string } };
let remote: BgItem[] = [];
const listeners = new Set<() => void>();
/** Admin-added backgrounds (server table); bundled ones stay as defaults. */
export async function loadRemoteBgs(): Promise<void> {
  try {
    const { data } = await supabase.from('app_9e1318caf6_live_bgs').select('key,image_url,removed').order('created_at');
    remote = [];
    for (const r of (data ?? []) as { key: string; image_url: string }[]) { MAP.set(r.key, { uri: r.image_url }); remote.push({ key: r.key, thumb: { uri: r.image_url } }); }
    listeners.forEach((f) => f());
  } catch { /* keep bundled set */ }
}
export const remoteBgs = () => remote;
export const onRemoteBgs = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const bgSource = (key?: string | null) => (key ? MAP.get(key) : undefined);
