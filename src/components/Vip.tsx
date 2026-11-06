// VIP RGB ring + badge — mirrors web UserAvatar `.vip-ring` (conic RGB, 2.4s spin) and VipExtras VipBadge.
import { useWarningText } from '../lib/warnings';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { openLive, useUserStatus } from '../lib/presence';
import { isAppActive } from '../lib/appActive';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from './Icons';

const RGB = ['#ff0040', '#ff8a00', '#ffe600', '#00ff6a', '#00c8ff', '#7a00ff', '#ff00c8', '#ff0040'];

// ---- VIP status cache (server-owned: wallets.vip_expires_at via RPC vip_ids) ----
const cache = new Map<string, boolean>();
const subs = new Set<() => void>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const ids = [...queue];
  queue = new Set();
  if (!ids.length) return;
  const { data, error } = await supabase.rpc('app_9e1318caf6_vip_ids', { p_ids: ids });
  if (error) return;
  const vip = new Set((data as string[] | null) ?? []);
  ids.forEach((id) => cache.set(id, vip.has(id)));
  subs.forEach((f) => f());
}

export function refreshVip(id?: string | null) {
  if (!id) return;
  cache.delete(id);
  queue.add(id);
  if (!timer) timer = setTimeout(() => void flush(), 30);
}

// Expiry: cached "true" is re-checked every 60s so the ring disappears when vip_expires_at passes.
let sweep: ReturnType<typeof setInterval> | null = null;
function ensureSweep() {
  if (sweep) return;
  sweep = setInterval(() => { if (!isAppActive()) return; [...cache.entries()].forEach(([id, v]) => { if (v) queue.add(id); }); if (queue.size && !timer) timer = setTimeout(() => void flush(), 30); }, 60000);
}

export function useIsVip(id?: string | null): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    ensureSweep();
    if (id && !cache.has(id)) { queue.add(id); if (!timer) timer = setTimeout(() => void flush(), 30); }
    return () => { subs.delete(f); };
  }, [id]);
  return !!id && cache.get(id) === true;
}

/** True when the signed-in user is VIP (guests and signed-out users are never VIP). */
export function useMyVip(): boolean {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setId(data.session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return useIsVip(id);
}

function Ring({ size }: { size: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, isInteraction: false, useNativeDriver: Platform.OS !== 'web' }),
      { iterations: -1, resetBeforeIteration: true },
    );
    a.start();
    return () => a.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const r = size / 2;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden', transform: [{ rotate }] }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="vipg" x1="0" y1="0" x2="1" y2="1">
            {RGB.map((c, i) => <Stop key={i} offset={i / (RGB.length - 1)} stopColor={c} />)}
          </LinearGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r} fill="url(#vipg)" />
      </Svg>
    </Animated.View>
  );
}

/** Pulsing red ripple + solid red ring around a live user's avatar. */
function LivePulse({ size }: { size: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), isInteraction: false, useNativeDriver: Platform.OS !== 'web' }), { iterations: -1, resetBeforeIteration: true });
    a.start();
    return () => a.stop();
  }, [t]);
  const bw = Math.max(2, Math.round(size / 18));
  const box = { position: 'absolute' as const, left: -bw - 1, top: -bw - 1, width: size + (bw + 1) * 2, height: size + (bw + 1) * 2, borderRadius: size, borderWidth: bw, borderColor: '#FF1744' };
  return (
    <>
      <Animated.View pointerEvents="none" style={[box, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }] }]} />
      <View pointerEvents="none" style={box} />
    </>
  );
}

/** Soft double ripple + glowing ring shown while a seated user is speaking. */
function SpeakRing({ size }: { size: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), isInteraction: false, useNativeDriver: Platform.OS !== 'web' }));
    a.start();
    return () => a.stop();
  }, [t]);
  const bw = Math.max(2, Math.round(size / 20));
  const box = { position: 'absolute' as const, left: -bw - 2, top: -bw - 2, width: size + (bw + 2) * 2, height: size + (bw + 2) * 2, borderRadius: size, borderWidth: bw, borderColor: '#34D399' };
  const wave = (d: number) => {
    const p = Animated.modulo(Animated.add(t, d), 1);
    return { opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0] }), transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] };
  };
  return (
    <>
      <Animated.View testID="speak-ring" pointerEvents="none" style={[box, wave(0)]} />
      <Animated.View pointerEvents="none" style={[box, wave(0.5)]} />
      <View pointerEvents="none" style={[box, { shadowColor: '#34D399', shadowOpacity: 0.9, shadowRadius: 8 }]} />
    </>
  );
}

/** Admin warning ring: true when the user has an active warning (public, cached per session). */
function useWarned(id?: string | null): boolean {
  return useWarningText(id) !== null;
}

/** The admin's warning text, in red, shown under a profile name. Appears/disappears live. */
export function WarnLine({ id }: { id?: string | null }) {
  const t = useWarningText(id);
  if (!t) return null;
  return <Text testID="warn-text" style={{ color: '#FF3B30', fontWeight: '800', fontSize: 13, textAlign: 'center', marginTop: 4, paddingHorizontal: 16 }}>⚠ {t}</Text>;
}

/** Avatar with web-identical VIP ring (padding = max(2, size/20)) + live ring/LIVE label or online dot. */
export function VipAvatar({ userId, uri, name, size, color = '#FFA500', vip, status = true, liveBadge = true, speaking = false }: { userId?: string | null; uri?: string | null; name?: string | null; size: number; color?: string; vip?: boolean; status?: boolean; liveBadge?: boolean; speaking?: boolean }) {
  const fetched = useIsVip(vip === undefined ? userId : null);
  const warned = useWarned(userId);
  const st = useUserStatus(status ? userId : null);
  const online = st.online;
  const room = liveBadge ? st.room : null;
  const on = vip ?? fetched;
  const pad = on ? Math.max(2, Math.round(size / 20)) : 0;
  const inner = size - pad * 2;
  const letter = (name ?? '').replace(/<[^>]+>/g, '').trim().charAt(0).toUpperCase() || '?';
  const dot = Math.max(8, Math.round(size * 0.24));
  // Dot centre on the circle edge at ~-35° (right side, above centre).
  const ang = (-35 * Math.PI) / 180;
  const cx = size / 2 + (size / 2) * Math.cos(ang);
  const cy = size / 2 + (size / 2) * Math.sin(ang);
  const avatar = (
    <View style={{ width: size, height: size }}>
      {room && <LivePulse size={size} />}
      {speaking && <SpeakRing size={size} />}
      <View testID={on ? 'vip-ring' : undefined} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {on && <Ring size={size} />}
        <View style={{ width: inner, height: inner, borderRadius: inner / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: uri ? '#0A0A0B' : color }}>
          {uri ? <ExpoImage source={{ uri }} style={{ width: inner, height: inner }} contentFit="cover" cachePolicy="memory-disk" transition={0} recyclingKey={uri} /> : <Text style={{ color: '#000', fontWeight: '800', fontSize: Math.max(10, inner * 0.4) }}>{letter}</Text>}
        </View>
      </View>
      {warned && <View testID="warn-ring" pointerEvents="none" style={{ position: 'absolute', left: -3, top: -3, width: size + 6, height: size + 6, borderRadius: size, borderWidth: Math.max(3, Math.round(size / 18)), borderColor: '#FF1744' }} />}
      {!room && online ? (
        <View testID="online-dot" pointerEvents="none" style={{ position: 'absolute', left: cx - dot / 2, top: cy - dot / 2, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: '#22C55E', borderWidth: Math.max(1.5, dot / 6), borderColor: '#0A0A0B' }} />
      ) : null}
    </View>
  );
  return room ? <Pressable accessibilityLabel="Open live" hitSlop={4} onPress={() => openLive(room)}>{avatar}</Pressable> : avatar;
}

/** Orange pill: black crown + black "VIP", placed beside the display name. */
export function VipBadge(): ReactNode {
  return (
    <View testID="vip-badge" style={b.wrap}>
      <Icon name="crown" size={12} color="#000" />
      <Text style={b.t}>VIP</Text>
    </View>
  );
}

const b = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'center', backgroundColor: '#FF8C00', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  t: { color: '#000', fontSize: 11, fontWeight: '800' },
  live: { position: 'absolute', alignSelf: 'center', backgroundColor: '#FF1744', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, borderWidth: 1.5, borderColor: '#0A0A0B' },
  liveT: { color: '#fff', fontWeight: '900', letterSpacing: 0.5 },
});

/** Shared: shows the orange VIP label only when user `id` is VIP (batched vip_ids). */
export function VipTag({ id }: { id?: string | null }): ReactNode {
  return useIsVip(id) ? <VipBadge /> : null;
}
