import { friendlyError } from '../../lib/errors';
import { SvgXml } from 'react-native-svg';
import { VipAvatar, VipTag } from '../../components/Vip';
import { GAME_SVG } from '../../assets/liveGames';
import { AppModal } from '../../components/AppModal';
// Live room (host + viewer) — mirrors app/frontend/src/components/LiveRoomView.tsx, backed by Supabase.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BgPicker, setLiveBg } from './BgPicker';
import { bgSource } from './liveBackgrounds';
import { StickerLayer } from './LiveStickers';
import { StickerEditor } from './StickerEditor';
import { saveStickerKit } from './liveStickers';
import { ActivityIndicator, Animated, Easing, FlatList, Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import { T } from '../../lib/supabase';
import { useActiveInterval } from '../../lib/appActive';
import {
  endLiveRoom, fetchFriends, fetchLiveRoomById, fetchLiveRooms, fetchLiveEvents, fetchLiveEventsSince, fetchMiniProfiles, subscribeTables, fetchProfile, fetchRoomGifts, fetchRoomState, fetchSeats,
  fetchViewers, formatNum, heartbeatViewer, initSeats, kickViewer, leaveViewer, myId, patchSeat, postLiveEvent, sendGift, setFollow, updateRoom,
  type LiveEvent, type LiveRoom, type LiveRoomState, type LiveSticker, type LiveSeat, type LiveViewer, type MiniProfile,
  nameHtmlOf,
} from '../../lib/api';
import { notify } from '../../lib/notify';
import { GiftPicker } from '../gifts/GiftPicker';
import { giftById, loadGiftCatalog } from '../../lib/gifts';
import { playGift } from '../../lib/giftFx';
import { loadFollowing, useFollowingIds } from '../../lib/follows';
import { Icon, type IconName } from '../../components/Icons';
import { RichTextInput, RichTextView } from '../../components/RichText';
import { colors } from '../../theme';
import { useKeyboardHeight } from '../../components/KeyboardInset';
import { GameInviteSheet, LiveGameStage } from '../games/LiveGame';
import { PLAYABLE, liveEarnings, liveJoin, setHostingRoom, useRoomGame } from '../../lib/games';
import { NO_BEAUTY, levelsOf, toggleBeauty, useBeauty, useLiveBeautyOn } from '../../lib/beautyStore';
import { ensureLivePermissions } from '../../lib/livePermissions';
import { announceLiveEnded, markLiveEnded, onLiveEnded } from '../../lib/presence';
import { Component } from 'react';
import { BackHandler } from 'react-native';
import { closeLiveRoom, reapLive } from '../../lib/livekit';
import { useLiveKit } from './useLiveKit';
import { PartnerJoinScreen } from '../partner/PartnerJoin';
import { usePeerVideo } from './usePeerVideo';
import { LiveVideo, TileCtlContext, VideoOfContext, type TileCtl } from './LiveVideo';

const OR = colors.primary;
const RED = '#FF3B30';
const LIVE_GAMES = ['Front War:front-war', 'Car Racing:car-racing', 'Motor Racing:motor-racing', 'Marathon:marathon', 'Boxing Match:boxing-match', 'Shootout:shootout', 'Number Spin:number-spin', 'Fast Tap:fast-tap', 'Gift Bomb:gift-bomb'].map((x) => { const [name, key] = x.split(':'); return { name, key }; });
const RANK = ['#FFD54A', '#CFD8DC', '#D08A4E'];
const clip10 = (s: string) => { const c = Array.from(s); return c.length > 10 ? `${c.slice(0, 10).join('')}…` : s; };
const nameOf = (p?: MiniProfile) => p?.display_name || p?.username || 'User';
const handleOf = (p?: MiniProfile) => `@${p?.username || 'user'}`;

type Sheet =
  | { kind: 'seat'; index: number } | { kind: 'gift'; index: number } | { kind: 'viewers' } | { kind: 'invite'; index: number }
  | { kind: 'confirm'; title: string; body: string; action: string; run: () => void } | { kind: 'more' };
type Panel = null | 'gift' | 'guest' | 'game' | 'settings' | 'share';

function Action({ icon, label, badge, active, danger, fill, onPress }: { icon: IconName; label: string; badge?: number; active?: boolean; danger?: boolean; fill?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[s.act, danger ? s.actDanger : active ? s.actOn : null]}>
      <Icon name={icon} size={19} color={danger ? '#FF6B5E' : active ? OR : fill ?? '#fff'} fill={fill ?? 'none'} />
      {badge ? <View style={s.badge}><Text style={s.badgeT}>{badge}</Text></View> : null}
    </Pressable>
  );
}

function BottomSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <AppModal onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}><View style={s.grab} /><ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView></View>
    </AppModal>
  );
}

function Item({ icon, label, danger, onPress }: { icon: IconName; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.item}>
      <View style={[s.itemIc, danger && { backgroundColor: 'rgba(255,59,48,0.15)' }]}><Icon name={icon} size={16} color={danger ? '#FF6B5E' : '#fff'} /></View>
      <Text style={[s.itemT, danger && { color: '#FF6B5E' }]}>{label}</Text>
    </Pressable>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={s.tog}>
      <Text style={s.togT}>{label}</Text>
      <View style={[s.sw, on && { backgroundColor: OR }]}><View style={[s.knob, on && { transform: [{ translateX: 16 }] }]} /></View>
    </Pressable>
  );
}

const Avatar = ({ p, size, name, speaking }: { p?: MiniProfile; size: number; name?: string; speaking?: boolean }) =>
  <VipAvatar userId={p?.id} uri={p?.avatar_url} name={name ?? nameOf(p)} size={size} liveBadge={false} speaking={speaking} />;

/** A tapped heart: pops out where the finger touched, sways up, then flies into the like counter (tx, ty). */
interface Heart { id: number; x: number; y: number; tx: number; ty: number }
const FlyingHeart = memo(function FlyingHeart({ h, onEnd }: { h: Heart; onEnd: (id: number) => void }) {
  const p = useRef(new Animated.Value(0)).current;
  const sway = useMemo(() => (Math.random() - 0.5) * 90, []);
  useEffect(() => {
    Animated.timing(p, { toValue: 1, duration: 1050, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) onEnd(h.id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: h.x - 14, top: h.y - 14,
      opacity: p.interpolate({ inputRange: [0, 0.1, 0.88, 1], outputRange: [0, 1, 1, 0] }),
      transform: [
        { translateX: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, sway, h.tx - h.x] }) },
        { translateY: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, -56, h.ty - h.y] }) },
        { scale: p.interpolate({ inputRange: [0, 0.15, 0.35, 1], outputRange: [0.3, 1.5, 1.2, 0.35] }) },
        { rotate: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: ['0deg', `${sway > 0 ? 14 : -14}deg`, '0deg'] }) },
      ],
    }}>
      <Text style={s.heart}>❤️</Text>
    </Animated.View>
  );
});

type LivePart = 'state' | 'seats' | 'events' | 'viewers' | 'gifts';
const LIVE_PARTS: readonly LivePart[] = ['state', 'seats', 'events', 'viewers', 'gifts'];
const LIVE_HEARTBEAT_MS = 15_000;
const LIVE_FALLBACK_MS = 30_000;
/** Viewer: the host has been missing from the LiveKit room this long → the live is treated as over (server re-checks). */
const HOST_GONE_MS = 10_000;

/** New events first, de-duplicated, capped like the original 200-row query. */
function mergeEvents(fresh: LiveEvent[], prev: LiveEvent[]): LiveEvent[] {
  const seen = new Set(fresh.map((e) => e.id));
  return [...fresh, ...prev.filter((e) => !seen.has(e.id))].slice(0, 200);
}

const ChatRow = memo(function ChatRow({ m, p, mine }: { m: LiveEvent; p?: MiniProfile; mine: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 4 }}>
      <Avatar p={p} size={24} />
      <View style={[s.chatName, mine && { backgroundColor: OR }]}><Text style={[s.chatNameT, mine && { color: '#000' }]}>{mine ? 'you' : p?.username ?? 'user'}</Text></View><VipTag id={m.user_id} />
      <View style={{ flex: 1 }}><RichTextView html={m.payload} style={s.chatT} /></View>
    </View>
  );
});

/** A render error inside the live room never leaves a frozen black screen: it shows the error and a working Close button. */
class LiveBoundary extends Component<{ onClose: () => void; children: ReactNode }, { msg: string | null }> {
  state = { msg: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { msg: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (!this.state.msg) return this.props.children;
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }]}>
        <Text style={[s.h, { fontSize: 18 }]}>Live could not be shown</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>{this.state.msg}</Text>
        <Pressable onPress={this.props.onClose} style={[s.btn, { backgroundColor: OR, alignSelf: 'stretch', flex: 0, height: 48 }]}><Text style={[s.btnW, { color: '#000' }]}>Close</Text></Pressable>
      </View>
    );
  }
}

const roomHost = (r: LiveRoom) => r.host?.display_name || r.host?.username || 'Live';
/** Vertical swipe (TikTok-style) → next / previous live. Scroll views (chat) keep their own gesture; taps still like. */
function useSwipe(cb?: (dir: 1 | -1) => void) {
  const ref = useRef(cb); ref.current = cb;
  return useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => !!ref.current && Math.abs(g.dy) > 24 && Math.abs(g.dy) > Math.abs(g.dx) * 2,
    onPanResponderRelease: (_e, g) => { if (Math.abs(g.dy) > 90 || Math.abs(g.vy) > 0.8) ref.current?.(g.dy < 0 ? 1 : -1); },
    onPanResponderTerminationRequest: () => true,
  }).panHandlers, []);
}

/** Live room entry: the live is checked BEFORE any live UI (a stale ring / link to an ended live shows "This live has ended",
 *  never the cover + fake controls). Switching lives remounts the room (keyed), so the old LiveKit room is closed first. */
export function LiveRoomView(p: { room: LiveRoom; onClose: () => void }) {
  const [cur, setCur] = useState(p.room);
  const [status, setStatus] = useState<'check' | 'live' | 'ended'>('check');
  const [others, setOthers] = useState<LiveRoom[]>([]);
  const [hostP, setHostP] = useState<MiniProfile | undefined>();
  useEffect(() => {
    let alive = true;
    setStatus('check');
    void fetchLiveRooms('All').then((l) => { if (alive) setOthers(l); }).catch(() => undefined);
    void fetchLiveRoomById(cur.id).then((r) => {
      if (!alive) return;
      if (r && r.is_live !== false) { setStatus('live'); return; }
      markLiveEnded(cur.host_id, cur.id);
      setStatus('ended');
      void fetchMiniProfiles([cur.host_id]).then((m) => { if (alive) setHostP(m[cur.host_id]); }).catch(() => undefined);
    }).catch(() => { if (alive) setStatus('live'); }); // offline: the room shows its own connection state
    return () => { alive = false; };
  }, [cur.id, cur.host_id]);
  const list = useMemo(() => others.filter((r) => r.id !== cur.id), [others, cur.id]);
  const swipe = useCallback((dir: 1 | -1) => {
    const i = others.findIndex((r) => r.id === cur.id);
    const next = i < 0 ? (dir === 1 ? list[0] : list[list.length - 1]) : others[(i + dir + others.length) % others.length];
    if (next && next.id !== cur.id) setCur(next); else notify('No other lives right now');
  }, [others, list, cur.id]);
  if (status === 'check') return <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={OR} /></View>;
  if (status === 'ended') return <LiveEndedView hostP={hostP} hostName={hostP ? nameOf(hostP) : roomHost(cur)} others={list} onPick={setCur} onClose={p.onClose} onSwipe={swipe} />;
  return <LiveBoundary key={cur.id} onClose={p.onClose}><LiveRoomInner room={cur} onClose={p.onClose} others={list} onPick={setCur} onSwipe={swipe} /></LiveBoundary>;
}

/** Shown to viewers the moment a live is over (host ended, server closed it, host gone, or opened from a stale link). */
function LiveEndedView({ hostP, hostName, others, onPick, onClose, onSwipe }: { hostP?: MiniProfile; hostName: string; others: LiveRoom[]; onPick: (r: LiveRoom) => void; onClose: () => void; onSwipe: (dir: 1 | -1) => void }) {
  const pan = useSwipe(others.length ? onSwipe : undefined);
  const next = others[0];
  return (
    <View style={[s.root, { paddingHorizontal: 22, paddingTop: 84 }]} {...pan}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,165,0,0.06)' }]} />
      <Pressable accessibilityLabel="Close" onPress={onClose} style={[s.xBtn, { position: 'absolute', top: 48, right: 16 }]}><Icon name="x" size={18} /></Pressable>
      <View style={{ alignItems: 'center' }}>
        <View style={{ padding: 4, borderRadius: 64, borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)', opacity: 0.9 }}><Avatar p={hostP} name={hostName} size={92} /></View>
        <View style={{ marginTop: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 }}>LIVE ENDED</Text>
        </View>
        <Text style={[s.h, { fontSize: 22, marginTop: 12, textAlign: 'center' }]}>This live has ended</Text>
        <Text style={[s.muted, { textAlign: 'center', marginTop: 6 }]}>Thanks for watching {hostName}! Catch another live below.</Text>
      </View>
      <Text style={[s.h, { fontSize: 14, marginTop: 30, marginBottom: 10 }]}>Live now</Text>
      {others.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ flexGrow: 0 }}>
          {others.slice(0, 10).map((r) => (
            <Pressable key={r.id} accessibilityLabel={`Watch ${roomHost(r)}`} onPress={() => onPick(r)} style={{ width: 128, height: 172, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1c1c22', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              {r.cover_url ? <Image source={{ uri: r.cover_url }} style={StyleSheet.absoluteFill} /> : null}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
              <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: RED, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>LIVE</Text></View>
              <View style={{ position: 'absolute', left: 8, right: 8, bottom: 8 }}>
                <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{roomHost(r)}</Text>
                <Text numberOfLines={1} style={{ color: OR, fontSize: 10, fontWeight: '700' }}>{r.category}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', padding: 18, alignItems: 'center' }}>
          <Text style={[s.muted, { textAlign: 'center' }]}>No other lives right now. Check back soon!</Text>
        </View>
      )}
      <View style={{ flex: 1 }} />
      {next && <Text style={[s.rowS, { textAlign: 'center', marginBottom: 10 }]}>Swipe up for the next live</Text>}
      {next && (
        <Pressable accessibilityLabel="Watch next live" onPress={() => onPick(next)} style={[s.btn, { backgroundColor: OR, flex: 0, height: 50, marginBottom: 10 }]}><Text style={[s.btnW, { color: '#000' }]}>Watch next live</Text></Pressable>
      )}
      <Pressable accessibilityLabel="Back to home" onPress={onClose} style={[s.btn, { backgroundColor: 'rgba(255,255,255,0.1)', flex: 0, height: 48, marginBottom: 40 }]}><Text style={s.btnW}>Back to home</Text></Pressable>
    </View>
  );
}

function LiveRoomInner({ room, onClose, others, onPick, onSwipe }: { room: LiveRoom; onClose: () => void; others: LiveRoom[]; onPick: (r: LiveRoom) => void; onSwipe: (dir: 1 | -1) => void }) {
  const [me, setMe] = useState('');
  const isHost = !!me && me === room.host_id;
  const seated = room.layout === 'seats' || room.layout === 'seats2' || room.layout === 'seats3';
  const mode = room.mode ?? 'video';
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let m = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
    const prev = m.content;
    m.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    const body = document.body.style; const prevTa = body.touchAction; body.touchAction = 'pan-x pan-y';
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', block);
    const pinch = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    document.addEventListener('touchmove', pinch, { passive: false });
    return () => { m!.content = prev; body.touchAction = prevTa; document.removeEventListener('gesturestart', block); document.removeEventListener('touchmove', pinch); };
  }, []);

  const [state, setState] = useState<LiveRoomState | null>(null);
  const [seats, setSeats] = useState<LiveSeat[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [viewers, setViewers] = useState<LiveViewer[]>([]);
  const [gifts, setGifts] = useState<{ sender_id: string; recipient_id: string; gift: string; coins: number; qty: number }[]>([]);
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});
  const [followers, setFollowers] = useState(0);
  const followSet = useFollowingIds();
  const followed = [...followSet];
  const [justFollowed, setJustFollowed] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [composer, setComposer] = useState(false);
  const [draft, setDraft] = useState('');
  const [giftQty, setGiftQty] = useState(1);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [localLikes, setLocalLikes] = useState(0); // my taps not yet visible in the server count
  const [invited, setInvited] = useState<string[]>([]);
  const rootRef = useRef<View>(null);
  const likeRef = useRef<View>(null);
  const likePulse = useRef(new Animated.Value(1)).current;
  const [inviteGame, setInviteGame] = useState<string | null>(null);
  const { game: roomGame, dismiss: dismissGame, reload: reloadGame } = useRoomGame(room.id);
  const inGame = !!roomGame && (roomGame.status === 'active' || roomGame.status === 'finished');
  const forfeitRef = useRef<(() => void) | null>(null);
  const [gate, setGate] = useState<{ fee: number; paid: boolean } | null>(null);
  const [paying, setPaying] = useState(false);
  const [earn, setEarn] = useState({ game: 0, joining: 0 });
  const [summary, setSummary] = useState<null | { secs: number }>(null);
  const [friends, setFriends] = useState<MiniProfile[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [stickerSheet, setStickerSheet] = useState(false);
  const [moveFrom, setMoveFrom] = useState<number | null>(null);
  const [giftFx, setGiftFx] = useState<{ idx: number; key: number } | null>(null);
  // Keyboard height (Android edge-to-edge + mobile web): the comment box sits right on top of the keyboard.
  const kbd = useKeyboardHeight();
  const seenInvite = useRef<number>(0);
  const startedAt = useRef(new Date(room.created_at).getTime());

  // Data flow: one full load on entry, then Realtime pushes only the changed part (events are fetched
  // incrementally, profiles only for new people). Heartbeat every 15 s; a 30 s poll repairs a dropped socket.
  const lastEventId = useRef(0);
  const peopleRef = useRef<Record<string, MiniProfile>>({});
  const refresh = useCallback(async (parts: readonly LivePart[] = LIVE_PARTS) => {
    const want = new Set(parts);
    const [st, se, ev, vw, gf] = await Promise.all([
      want.has('state') ? fetchRoomState(room.id) : null,
      want.has('seats') ? fetchSeats(room.id) : null,
      want.has('events') ? (lastEventId.current ? fetchLiveEventsSince(room.id, lastEventId.current) : fetchLiveEvents(room.id)) : null,
      want.has('viewers') ? fetchViewers(room.id) : null,
      want.has('gifts') ? fetchRoomGifts(room.id) : null,
    ]);
    if (st) setState(st);
    else if (want.has('state')) setState((p) => (p ? { ...p, is_live: false } : p)); // row hidden by row security = the live ended
    if (se) setSeats(se);
    if (vw) setViewers(vw);
    if (gf) setGifts(gf);
    if (ev?.length) {
      lastEventId.current = Math.max(lastEventId.current, ...ev.map((e) => e.id));
      setEvents((prev) => mergeEvents(ev, prev));
    }
    const ids = [room.host_id, ...(se ?? []).map((x) => x.user_id ?? ''), ...(ev ?? []).map((e) => e.user_id), ...(vw ?? []).map((v) => v.user_id), ...(gf ?? []).map((g) => g.sender_id)];
    const missing = [...new Set(ids.filter((id) => id && !peopleRef.current[id]))];
    if (missing.length) {
      peopleRef.current = { ...peopleRef.current, ...(await fetchMiniProfiles(missing)) };
      setPeople(peopleRef.current);
    }
  }, [room.id, room.host_id]);
  const load = useCallback(() => refresh(), [refresh]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const meRef = useRef('');
  const removed = useRef(false);
  const kicked = useCallback(() => {
    if (removed.current) return;
    removed.current = true;
    notify('Removed', 'The host removed you from this live.');
    closeRef.current();
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = await myId(); if (!alive) return; setMe(id); meRef.current = id;
      if (id === room.host_id) await initSeats(room.id).catch(() => undefined);
      await heartbeatViewer(room.id).catch(() => undefined);
      const p = await fetchProfile(room.host_id).catch(() => null);
      if (p) setFollowers(p.followers_count ?? 0);
      await loadFollowing(true).catch(() => undefined);
      await load().catch((e) => notify('Live', friendlyError(e)));
    })();
    return () => { alive = false; void leaveViewer(room.id).catch(() => undefined); };
  }, [room.id, room.host_id, load]);

  // Realtime: batch bursts (likes, gifts) into one small refresh; viewer heartbeats are coalesced longer.
  useEffect(() => {
    const pending = new Set<LivePart>();
    const timers: Record<'fast' | 'slow', ReturnType<typeof setTimeout> | null> = { fast: null, slow: null };
    const flush = (k: 'fast' | 'slow') => {
      timers[k] = null;
      const parts = [...pending].filter((p) => (k === 'slow') === (p === 'viewers'));
      parts.forEach((p) => pending.delete(p));
      if (parts.length) void refresh(parts).catch(() => undefined);
    };
    const schedule = (p: LivePart) => {
      pending.add(p);
      const k = p === 'viewers' ? 'slow' : 'fast';
      if (!timers[k]) timers[k] = setTimeout(() => flush(k), k === 'slow' ? 5000 : 300);
    };
    const off = subscribeTables(`live-room-${room.id}`, [
      { table: T.liveEvents, filter: `room_id=eq.${room.id}` },
      { table: T.liveSeats, filter: `room_id=eq.${room.id}` },
      { table: T.live, filter: `id=eq.${room.id}` },
      { table: T.gifts, filter: `room_id=eq.${room.id}` },
      { table: T.liveViewers, filter: `room_id=eq.${room.id}` },
    ], (row, table) => {
      if (table === T.liveViewers && row.user_id === meRef.current && row.kicked === true) return kicked();
      schedule(table === T.liveEvents ? 'events' : table === T.liveSeats ? 'seats' : table === T.live ? 'state' : table === T.gifts ? 'gifts' : 'viewers');
    });
    return () => { off(); if (timers.fast) clearTimeout(timers.fast); if (timers.slow) clearTimeout(timers.slow); };
  }, [room.id, refresh, kicked]);

  useActiveInterval(() => {
    void heartbeatViewer(room.id).then((ok) => { if (!ok) kicked(); }).catch(() => undefined);
  }, LIVE_HEARTBEAT_MS);
  useActiveInterval(() => void refresh().catch(() => undefined), LIVE_FALLBACK_MS);

  const count = Math.max(viewers.length, 1);
  useEffect(() => {
    if (isHost && state && count > state.peak_viewers) void updateRoom(room.id, { peak_viewers: count }).catch(() => undefined);
  }, [isHost, state, count, room.id]);

  // Viewer: room ended by host → summary.
  useEffect(() => { if (!isHost && state && !state.is_live && !summary) setSummary({ secs: Math.round((Date.now() - startedAt.current) / 1000) }); }, [isHost, state, summary]);

  const mySeat = seats.findIndex((x) => x.user_id === me && !!me);
  const onSeat = mySeat >= 0;
  const hasMic = isHost || onSeat;
  const micOn = onSeat ? !seats[mySeat].muted : true;
  const camOn = onSeat ? !seats[mySeat].cam_off : true;
  // LiveKit carries all audio + video + speaking state; Supabase keeps seats, chat, gifts and game state.
  const beautyState = useBeauty();
  // Beauty OFF (default) = NO_BEAUTY: the raw LiveKit camera is published and no frame processor is attached at all.
  const beautyOn = useLiveBeautyOn();
  const beautyLv = useMemo(() => (beautyOn ? levelsOf(beautyState) : NO_BEAUTY), [beautyOn, beautyState]);
  const lk = useLiveKit({
    // Once the "Live ended" screen shows, leave LiveKit at once: mic and camera of hosts / seated guests are released.
    roomId: room.id, me: me && (isHost || gate?.paid) && !summary ? me : '', canPublish: hasMic, micOn, camOn: camOn && mode === 'video',
    video: mode === 'video', muted: state?.paused ?? false, beauty: beautyLv, hostId: room.host_id,
  });
  const speakingIds = lk.speaking;
  // During a game the other competitor streams from another room: add a video-only link to it (viewers + players alike).
  const peer = usePeerVideo(room.id, !!me && (isHost || !!gate?.paid) && !summary && roomGame?.status === 'active');
  const lkVideoOf = lk.videoOf; const peerVideoOf = peer.videoOf;
  const videoOf = useCallback((uid: string) => lkVideoOf(uid) ?? peerVideoOf(uid), [lkVideoOf, peerVideoOf]);
  // The two game cards behave exactly like seats: same seat rows (mic / camera state), same LiveKit tracks, same seat sheet.
  const tileCtl = useMemo<TileCtl>(() => ({
    info: (uid) => { const x = seats.find((q) => q.user_id === uid); return x ? { muted: x.muted, camOff: x.cam_off, speaking: speakingIds.has(uid) } : undefined; },
    press: (uid) => { const x = seats.find((q) => q.user_id === uid); if (x) setSheet({ kind: 'seat', index: x.idx }); },
  }), [seats, speakingIds]);
  useEffect(() => { if (lk.error) notify('Live', lk.error); }, [lk.error]);
  // The host (or the server) closed the LiveKit room: leave through the normal "Live ended" screen at once, no waiting for polling.
  useEffect(() => { if (lk.ended && !summary) setSummary({ secs: Math.round((Date.now() - startedAt.current) / 1000) }); }, [lk.ended, summary]);
  // Connection lost for any other reason: re-read the room so a live that was ended meanwhile is noticed immediately.
  useEffect(() => { if (lk.dropped) void refresh(['state']).catch(() => undefined); }, [lk.dropped, refresh]);
  // Game start/stop is pushed over the data channel (instant); the DB row stays the source of truth for late joiners.
  const lkOn = lk.on; const lkSend = lk.send;
  useEffect(() => lkOn('game', () => void reloadGame()), [lkOn, reloadGame]);
  useEffect(() => { if (isHost && roomGame) lkSend('game', { id: roomGame.id, st: roomGame.status }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isHost, roomGame?.id, roomGame?.status, lk.link]);
  const comments = state?.allow_comments ?? true;
  const giftsOn = state?.allow_gifts ?? true;
  const paused = state?.paused ?? false;
  const serverLikes = events.filter((e) => e.kind === 'like').length;
  const prevLikes = useRef(serverLikes);
  useEffect(() => {
    const d = serverLikes - prevLikes.current; prevLikes.current = serverLikes;
    if (d > 0) setLocalLikes((n) => Math.max(0, n - d));
  }, [serverLikes]);
  const likes = serverLikes + localLikes;
  // Newest first: the chat list is inverted, so the latest message always sits at the bottom.
  const messages = useMemo(() => events.filter((e) => e.kind === 'comment').slice(0, 40), [events]);
  const received = useMemo(() => gifts.reduce<Record<string, number>>((m, g) => ({ ...m, [g.recipient_id]: (m[g.recipient_id] ?? 0) + Number(g.coins) }), {}), [gifts]);
  const giftsBy = useMemo(() => gifts.reduce<Record<string, number>>((m, g) => ({ ...m, [g.sender_id]: (m[g.sender_id] ?? 0) + Number(g.coins) }), {}), [gifts]);
  const [giftBanner, setGiftBanner] = useState<string | null>(null);
  const seenGifts = useRef<number | null>(null);
  useEffect(() => {
    if (seenGifts.current === null) { seenGifts.current = gifts.length; return; }
    if (gifts.length <= seenGifts.current) return;
    const fresh = gifts.slice(seenGifts.current); seenGifts.current = gifts.length;
    const last = fresh[fresh.length - 1];
    void loadGiftCatalog().then(() => fresh.filter((g) => g.sender_id !== me).slice(-5).forEach((g) => {
      const item = giftById(g.gift);
      if (item) playGift({ gift: item, qty: Number(g.qty), from: nameOf(people[g.sender_id]), to: nameOf(people[g.recipient_id]) });
    })).catch(() => undefined);
    if (last.sender_id === me) return;
    const seatIdx = seats.find((q) => q.user_id === last.recipient_id)?.idx ?? -1;
    const key = Date.now();
    if (seatIdx >= 0) { setGiftFx({ idx: seatIdx, key }); setTimeout(() => setGiftFx((f) => (f?.key === key ? null : f)), 1600); }
    setGiftBanner(`🎁 ${nameOf(people[last.sender_id])} sent ${formatNum(Number(last.coins))} coins`);
    setTimeout(() => setGiftBanner(null), 2500);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [gifts.length]);
  const decided = new Set(events.filter((e) => e.kind === 'decline').map((e) => e.payload));
  const seatedIds = new Set(seats.map((x) => x.user_id).filter(Boolean) as string[]);
  const requests = [...new Set(events.filter((e) => e.kind === 'request').map((e) => e.user_id))].filter((u) => !decided.has(u) && !seatedIds.has(u) && viewers.some((v) => v.user_id === u));
  const requested = events.some((e) => e.kind === 'request' && e.user_id === me);
  const following = followed.includes(room.host_id);
  const host = people[room.host_id];
  const hostName = nameOf(host);

  const run = (p: Promise<unknown>, ok?: string) => p.then(() => { if (ok) notify(ok); return load(); }).catch((e) => notify('Error', friendlyError(e)));
  const freeSeat = () => seats.findIndex((x) => x.idx > 0 && (seated || x.idx <= 8) && !x.user_id && !x.locked);
  const confirm = (title: string, body: string, action: string, fn: () => void) => setSheet({ kind: 'confirm', title, body, action, run: fn });

  const accept = (u: string) => {
    const i = freeSeat();
    if (i < 0) return notify('No free seat — unlock or free a seat first');
    void run(patchSeat(room.id, seats[i].idx, { user_id: u, muted: false, cam_off: true }), `${nameOf(people[u])} joined seat ${seats[i].idx + 1}`);
  };
  // Host asks a watching viewer to come on stage: the viewer gets the same "Seat invitation" prompt as from an empty seat.
  const inviteList = viewers.map((v) => v.user_id).filter((u) => u !== me && u !== room.host_id && !seatedIds.has(u));
  const inviteViewer = (u: string) => {
    const i = freeSeat();
    if (i < 0) return notify('No free seat — unlock or free a seat first');
    setInvited((l) => [...l, u]);
    setTimeout(() => setInvited((l) => l.filter((x) => x !== u)), 30_000);
    void run(postLiveEvent(room.id, 'invite', `${u}:${seats[i].idx}`), `Invitation sent to ${nameOf(people[u])}`);
  };
  // Host auto-accept.
  useEffect(() => { if (isHost && state?.auto_accept && requests.length) accept(requests[0]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isHost, state?.auto_accept, requests.join()]);
  // Viewer: host invitation → confirm.
  useEffect(() => {
    const inv = events.find((e) => e.kind === 'invite' && e.payload.startsWith(`${me}:`) && e.id > seenInvite.current);
    if (!inv || onSeat || !me) return;
    seenInvite.current = inv.id;
    const idx = Number(inv.payload.split(':')[1]);
    confirm('Seat invitation', `The host invited you to seat ${idx + 1}.`, 'Take seat', () => { setSheet(null); takeSeat(idx); });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [events, me, onSeat]);

  // Camera + microphone are asked before taking a seat (or asking for one), never after publishing has started.
  const takeSeat = (idx: number) => {
    setSheet(null);
    void ensureLivePermissions(mode === 'video').then((ok) => { if (ok) void run(patchSeat(room.id, idx, { user_id: me, muted: false, cam_off: true }), `You took seat ${idx + 1}`); });
  };
  const leaveSeat = () => { if (mySeat < 0) return; setSheet(null); void run(patchSeat(room.id, seats[mySeat].idx, { user_id: null, muted: false, cam_off: false }), 'You left the seat'); };
  const requestSeat = () => {
    if (isHost || onSeat || requested) return;
    void ensureLivePermissions(mode === 'video').then((ok) => { if (ok) void run(postLiveEvent(room.id, 'request', ''), 'Seat request sent to the host'); });
  };
  const setMyMic = (on: boolean) => confirm(on ? 'Turn microphone on?' : 'Mute microphone?', on ? 'Others in the room will hear you.' : 'Others will not hear you until you unmute.', 'OK', () => { setSheet(null); applyMic(on); });
  const applyMic = (on: boolean) => { if (mySeat >= 0) void run(patchSeat(room.id, seats[mySeat].idx, { muted: !on }), on ? 'Microphone on' : 'Microphone muted'); };
  const setMyCam = (on: boolean) => { if (mySeat >= 0) void run(patchSeat(room.id, seats[mySeat].idx, { cam_off: !on }), on ? 'Camera on' : 'Camera off'); };
  const toggleFollow = (u = room.host_id) => {
    // Follow-only here: unfollowing happens on the user's profile.
    if (!me || u === me || followSet.has(u)) return;
    if (u === room.host_id) setFollowers((n) => n + 1);
    setJustFollowed((l) => [...l, u]);
    setTimeout(() => setJustFollowed((l) => l.filter((x) => x !== u)), 900);
    setFollow(u, true).then(() => notify(`Following ${handleOf(people[u])}`)).catch((e) => {
      if (u === room.host_id) setFollowers((n) => n - 1);
      notify('Error', friendlyError(e));
    });
  };
  const send = () => {
    if (!comments || !draft.replace(/<[^>]+>/g, '').trim()) return;
    const d = draft; setDraft('');
    void run(postLiveEvent(room.id, 'comment', d));
  };
  const endHeart = useCallback((id: number) => {
    setHearts((h) => h.filter((q) => q.id !== id));
    Animated.sequence([
      Animated.timing(likePulse, { toValue: 1.6, duration: 90, useNativeDriver: true }),
      Animated.timing(likePulse, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [likePulse]);
  /** Tap anywhere: a heart leaves the touched point and lands on the like counter in the top bar. */
  const like = (x: number, y: number) => {
    const id = Date.now() + Math.random();
    const spawn = (tx: number, ty: number) => setHearts((h) => [...h.slice(-14), { id, x, y, tx, ty }]);
    const target = likeRef.current; const root = rootRef.current;
    if (target && root) {
      target.measureInWindow((cx, cy, w, hh) => root.measureInWindow((rx, ry) => {
        if (w > 0 && hh > 0) spawn(cx - rx + w / 2, cy - ry + hh / 2); else spawn(64, 52);
      }));
    } else spawn(64, 52);
    setLocalLikes((n) => n + 1);
    setTimeout(() => setLocalLikes((n) => Math.max(0, n - 1)), 6000);
    // No full reload per tap (fast tapping used to queue 5 queries each); Realtime refreshes the like count in one batch.
    void postLiveEvent(room.id, 'like', '').catch(() => undefined);
  };
  const tapLike = (e: GestureResponderEvent) => like(e.nativeEvent.locationX, e.nativeEvent.locationY);
  // The chat list sits on top of the like layer: a short, still touch on it counts as a like too (scrolling does not).
  const chatTouch = useRef({ x: 0, y: 0, t: 0 });
  const chatDown = (e: GestureResponderEvent) => { chatTouch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now() }; };
  const chatUp = (e: GestureResponderEvent) => {
    const a = chatTouch.current; const { pageX, pageY } = e.nativeEvent;
    if (Date.now() - a.t > 350 || Math.hypot(pageX - a.x, pageY - a.y) > 10) return;
    rootRef.current?.measureInWindow((rx, ry) => like(pageX - rx, pageY - ry));
  };
  const doGift = (target: string, gid: string, idx: number) => {
    if (target === me) return notify("You can't send a gift to yourself");
    sendGift(target, gid, giftQty, room.id).then((r) => {
      const g = giftById(gid);
      if (!g) return load();
      notify(`${g.name} ×${giftQty} sent to ${handleOf(people[target])} · ${r.spent} coins`);
      playGift({ gift: g, qty: giftQty, from: 'You', to: nameOf(people[target]) });
      if (idx >= 0) { const key = Date.now(); setGiftFx({ idx, key }); setTimeout(() => setGiftFx((f) => (f?.key === key ? null : f)), 1600); }
      setGiftQty(1); return load();
    }).catch((e) => notify('Gift failed', friendlyError(e)));
  };
  // End live never waits on the network: the screen leaves at once (LiveKit disconnects, camera + mic are released) and the
  // server side is closed in the background with retries. A live that still stays open is closed on the next Go Live.
  const endLive = () => {
    setSheet(null); setPanel(null); forfeitRef.current?.();
    lk.send('live_ended', {}); // instant notice to everyone; the server repeats it and then closes the LiveKit room
    announceLiveEnded(room.id, room.host_id); // every open app: LIVE ring off + viewers outside LiveKit notified
    setSummary({ secs: Math.round((Date.now() - startedAt.current) / 1000) });
    void finishLive(room.id, Math.max(state?.peak_viewers ?? 0, count));
  };
  // Viewer side "live ended", from every source: Realtime broadcast from the host app (this hook), LiveKit data message /
  // room deleted (lk.ended), DB row ended (state), or the host gone from the LiveKit room for HOST_GONE_MS.
  const endNow = useCallback(() => setSummary((x) => x ?? { secs: Math.round((Date.now() - startedAt.current) / 1000) }), []);
  useEffect(() => onLiveEnded((id) => { if (id === room.id && meRef.current !== room.host_id) endNow(); }), [room.id, room.host_id, endNow]);
  useEffect(() => {
    if (isHost || summary || lk.link !== 'connected' || lk.hostHere) return undefined;
    const t = setTimeout(() => { void reapLive(room.id).catch(() => undefined); endNow(); }, HOST_GONE_MS);
    return () => clearTimeout(t);
  }, [isHost, summary, lk.link, lk.hostHere, room.id, endNow]);
  useEffect(() => { if (summary && !isHost) { markLiveEnded(room.host_id, room.id); setSheet(null); setPanel(null); setComposer(false); } }, [summary, isHost, room.id, room.host_id]);
  const swipe = useSwipe(!isHost && !sheet && !panel && !composer && !inGame ? onSwipe : undefined);
  useEffect(() => { if (!isHost) return; setHostingRoom(room.id); return () => setHostingRoom(null); }, [isHost, room.id]);
  // Android hardware back: host → "End this live?", everyone else leaves. Always works, even while the camera is starting.
  const backRef = useRef<() => void>(() => undefined);
  backRef.current = () => {
    if (summary) { onClose(); return; }
    if (sheet) { setSheet(null); return; }
    if (isHost) confirm('End this live?', 'Everyone in the room will be disconnected.', 'End live', () => endLive());
    else leave();
  };
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { backRef.current(); return true; });
    return () => sub.remove();
  }, []);
  useEffect(() => { if (!me || isHost) return; void liveJoin(room.id, false).then(setGate).catch(() => setGate({ fee: 0, paid: true })); }, [me, isHost, room.id]);
  useEffect(() => { if (summary && isHost) void liveEarnings(room.id).then(setEarn).catch(() => undefined); }, [summary, isHost, room.id]);
  const payJoin = async () => { setPaying(true); try { setGate(await liveJoin(room.id, true)); } catch (e) { notify('Could not join', friendlyError(e)); } finally { setPaying(false); } };
  const leave = () => { forfeitRef.current?.(); if (onSeat) void patchSeat(room.id, seats[mySeat].idx, { user_id: null }).catch(() => undefined); onClose(); };
  const setRoom = (patch: Partial<LiveRoomState>, msg?: string) => void run(updateRoom(room.id, patch), msg);
  // Stickers: show at once, store in the room for viewers, and keep the host's kit for the next lives.
  const changeStickers = (next: LiveSticker[]) => {
    setState((p) => (p ? { ...p, stickers: next } : p));
    saveStickerKit(next);
    setRoom({ stickers: next });
  };
  const commitSticker = (st: LiveSticker) => changeStickers((state?.stickers ?? []).map((q) => (q.id === st.id ? st : q)));
  // × on the live screen: only hides the sticker here; it stays in Live settings and in the saved kit.
  const hideSticker = (id: number) => changeStickers((state?.stickers ?? []).map((q) => (q.id === id ? { ...q, hidden: true } : q)));

  const onSeatTap = (idx: number) => {
    const x = seats.find((q) => q.idx === idx); if (!x) return;
    if (inGame) return notify('Seats are closed during the game');
    if (isHost && moveFrom !== null) {
      if (moveFrom !== idx && idx !== 0) {
        const a = seats.find((q) => q.idx === moveFrom)!;
        void Promise.all([patchSeat(room.id, idx, { user_id: a.user_id, muted: a.muted, cam_off: a.cam_off }), patchSeat(room.id, moveFrom, { user_id: x.user_id, muted: x.muted, cam_off: x.cam_off })]).then(load);
      }
      return setMoveFrom(null);
    }
    if (isHost || x.user_id || (!x.locked && !onSeat) || x.user_id === me) return setSheet({ kind: 'seat', index: idx });
    if (x.locked) notify('This seat is locked by the host');
  };

  const seatEl = (idx: number, o: { big?: boolean; tall?: boolean } = {}) => {
    const x = seats.find((q) => q.idx === idx);
    if (!x) return <View key={idx} style={[s.seat, o.tall ? { flex: 1 } : { aspectRatio: 1 }]} />;
    const u = x.user_id ? people[x.user_id] : undefined;
    const isMe = x.user_id === me;
    return (
      <Pressable key={idx} testID={`seat-${idx}`} accessibilityLabel={x.user_id ? `${nameOf(u)} seat` : x.locked ? 'Locked seat' : 'Empty seat'}
        onPress={() => onSeatTap(idx)} onLongPress={() => isHost && idx > 0 && x.user_id && (setMoveFrom(idx), notify('Tap another seat to move this guest'))}
        style={[s.seat, { overflow: 'hidden' }, o.tall ? { flex: 1 } : { aspectRatio: 1 }, x.user_id ? s.seatOn : s.seatEmpty, moveFrom === idx && { borderColor: '#34D399', borderWidth: 2 }]}>
        {x.user_id ? (
          <>
            {mode === 'video' && !x.cam_off ? <LiveVideo track={videoOf(x.user_id)} mirror={isMe} /> : null}
            <View style={[s.pill, { position: 'absolute', left: 4, top: 4, flexDirection: 'row', gap: 2 }]}><Icon name="users" size={9} color={OR} /><Text style={s.pillT}>{followed.includes(x.user_id) ? 1 : 0}</Text></View>
            <View testID={`seat-gifts-${idx}`} style={[s.pill, { position: 'absolute', right: 4, top: idx === 0 ? 20 : 4, zIndex: 5 }]}><Text style={[s.pillT, { color: '#FFD700' }]}>🎁 {formatNum(received[x.user_id] ?? 0)}</Text></View>
            {idx === 0 && <View style={s.hostTag}><Text style={s.hostTagT}>HOST</Text></View>}
            <View style={mode === 'video' && !x.cam_off && !!videoOf(x.user_id) ? { position: 'absolute', right: 4, bottom: 26 } : undefined}>
              {!(mode === 'video' && !x.cam_off && !!videoOf(x.user_id)) && <Avatar p={u} size={o.big ? 56 : 36} speaking={!x.muted && speakingIds.has(x.user_id)} />}
              {x.muted && <View style={[s.dot, { right: -2, backgroundColor: RED }]}><Icon name="micOff" size={10} /></View>}
            </View>
            <View style={s.seatFoot}>
              <View style={[s.pill, { flexShrink: 1 }]}><RichTextView html={nameHtmlOf(u)} numberOfLines={1} style={[s.pillT, { fontSize: o.big ? 11 : 9 }]} /></View>
              {!isMe && !!me && (!followSet.has(x.user_id) || justFollowed.includes(x.user_id)) && (
                <Pressable accessibilityLabel={`Follow ${nameOf(u)}`} onPress={() => toggleFollow(x.user_id!)} style={[s.fBtn, followed.includes(x.user_id) && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                  <Icon name={followed.includes(x.user_id) ? 'check' : 'plus'} size={10} color={followed.includes(x.user_id) ? '#fff' : '#000'} strokeWidth={3} />
                </Pressable>
              )}
            </View>
            {giftFx?.idx === idx && <Text style={s.fx}>🎁</Text>}
          </>
        ) : x.locked ? (
          <View style={[s.circle, { width: o.big ? 48 : 32, height: o.big ? 48 : 32, backgroundColor: 'rgba(255,255,255,0.1)' }]}><Icon name="lock" size={o.big ? 20 : 14} color="rgba(255,255,255,0.5)" /></View>
        ) : (
          <View style={[s.circle, { width: o.big ? 48 : 32, height: o.big ? 48 : 32, borderWidth: 1, borderColor: 'rgba(255,165,0,0.6)', backgroundColor: 'rgba(255,165,0,0.15)' }]}><Icon name="plus" size={o.big ? 24 : 16} color={OR} strokeWidth={2.6} /></View>
        )}
      </Pressable>
    );
  };

  const renderSheet = () => {
    if (!sheet) return null;
    const close = () => setSheet(null);
    if (sheet.kind === 'confirm') return (
      <BottomSheet onClose={close}>
        <Text style={s.h}>{sheet.title}</Text><Text style={s.muted}>{sheet.body}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
          <Pressable onPress={close} style={[s.btn, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={s.btnW}>Cancel</Text></Pressable>
          <Pressable onPress={sheet.run} style={[s.btn, { backgroundColor: RED }]}><Text style={s.btnW}>{sheet.action}</Text></Pressable>
        </View>
      </BottomSheet>
    );
    if (sheet.kind === 'invite') {
      const list = viewers.map((v) => v.user_id).filter((u) => u !== me && !seatedIds.has(u));
      return (
        <BottomSheet onClose={close}>
          <Text style={[s.h, { fontSize: 14, marginBottom: 8 }]}>Invite to seat {sheet.index + 1}</Text>
          {list.length === 0 && <Text style={[s.muted, { textAlign: 'center', paddingVertical: 16 }]}>Everyone is already seated.</Text>}
          {list.map((u) => (
            <View key={u} style={s.row}>
              <Avatar p={people[u]} size={36} />
              <View style={{ flex: 1 }}><Text style={s.rowT}>{nameOf(people[u])}</Text><Text style={s.rowS}>{handleOf(people[u])}</Text></View>
              <Pressable onPress={() => { const i = sheet.index; close(); void run(postLiveEvent(room.id, 'invite', `${u}:${i}`), `Invitation sent to ${nameOf(people[u])}`); }} style={s.smallBtn}><Text style={s.smallBtnT}>Invite</Text></Pressable>
            </View>
          ))}
        </BottomSheet>
      );
    }
    if (sheet.kind === 'gift') {
      const t = seats.find((q) => q.idx === sheet.index)?.user_id; if (!t) return null;
      return (
        <BottomSheet onClose={close}>
          <Text style={[s.h, { fontSize: 14 }]}>Send a gift</Text>
          <Text style={[s.rowS, { marginBottom: 12 }]}>To <Text style={{ color: OR, fontWeight: '800' }}>{handleOf(people[t])}</Text></Text>
          <GiftGrid onPick={(g) => { doGift(t, g, sheet.index); close(); }} />
          <Qty v={giftQty} set={setGiftQty} />
        </BottomSheet>
      );
    }
    if (sheet.kind === 'viewers') {
      const rows = viewers.map((v) => ({ id: v.user_id, g: giftsBy[v.user_id] ?? 0, s: (Date.now() - new Date(v.joined_at).getTime()) / 1000 }))
        .filter((r) => r.id !== room.host_id).sort((a, b) => b.g - a.g || b.s - a.s);
      return (
        <BottomSheet onClose={close}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}><Text style={[s.h, { fontSize: 14 }]}>Top viewers</Text><Text style={s.rowS}>Gifts first, then watch time</Text></View>
          {rows.length === 0 && <Text style={[s.muted, { textAlign: 'center', paddingVertical: 16 }]}>No viewers yet.</Text>}
          {rows.map((r, i) => (
            <View key={r.id} style={[s.row, r.id === me && { backgroundColor: 'rgba(255,165,0,0.1)' }]}>
              <View style={[s.rank, { backgroundColor: i < 3 ? RANK[i] : i < 10 ? 'rgba(255,255,255,0.1)' : 'transparent' }]}><Text style={[s.rankT, { color: i < 3 ? '#000' : '#fff' }]}>{i === 0 ? '👑 ' : ''}{i < 10 ? `Top ${i + 1}` : `#${i + 1}`}</Text></View>
              <Avatar p={people[r.id]} size={36} />
              <View style={{ flex: 1 }}><Text style={s.rowT} numberOfLines={1}>{clip10(nameOf(people[r.id]))}</Text><Text style={s.rowS} numberOfLines={1}>{clip10(handleOf(people[r.id]))}</Text></View>
              <View style={{ alignItems: 'flex-end' }}><Text style={[s.rowS, { color: OR, fontWeight: '800' }]}>🪙 {formatNum(r.g)}</Text><Text style={s.rowS}>⏱ {Math.floor(r.s / 60)} min</Text></View>
              {!!me && r.id !== me && !followSet.has(r.id) && <Pressable onPress={() => toggleFollow(r.id)} style={s.smallBtn}><Text style={s.smallBtnT}>Follow</Text></Pressable>}
            </View>
          ))}
        </BottomSheet>
      );
    }
    if (sheet.kind === 'more') return (
      <BottomSheet onClose={close}>
        <Item icon="send" label="Share live" onPress={() => { close(); openShare(); }} />
        {isHost && <Item icon="settings" label="Live settings" onPress={() => { close(); setPanel('settings'); }} />}
        {!isHost && <Item icon="users" label="Partner" onPress={() => { close(); setPartnerOpen(true); }} />}
        {isHost
          ? <Item icon="logout" danger label="End live" onPress={() => confirm('End this live?', 'Everyone in the room will be disconnected.', 'End live', () => void endLive())} />
          : <Item icon="logout" danger label="Leave live" onPress={() => confirm('Leave this live?', onSeat ? 'You will also leave your seat.' : 'You can come back anytime.', 'Leave', leave)} />}
      </BottomSheet>
    );
    const idx = sheet.index;
    const x = seats.find((q) => q.idx === idx); if (!x) return null;
    const u = x.user_id ?? undefined;
    const header = (
      <View style={[s.row, { marginBottom: 6 }]}>
        {u ? <Avatar p={people[u]} size={48} /> : <View style={[s.avBox, { width: 48, height: 48, borderRadius: 24 }]}><Icon name="armchair" size={20} color="#000" /></View>}
        <View style={{ flex: 1 }}>
          <Text style={s.h}>{u ? nameOf(people[u]) : `Seat ${idx + 1}`}</Text>
          <Text style={s.rowS}>{u ? `${handleOf(people[u])} · seat ${idx + 1} · ${x.muted ? 'muted' : 'mic on'}` : x.locked ? 'Locked' : 'Empty seat'}</Text>
        </View>
      </View>
    );
    const giftItem = u && u !== me ? <Item icon="gift" label={`Send gift to ${handleOf(people[u])}`} onPress={() => setSheet({ kind: 'gift', index: idx })} /> : null;
    if (u === me) return (
      <BottomSheet onClose={close}>
        {header}
        <Item icon={micOn ? 'micOff' : 'mic'} label={micOn ? 'Mute my mic' : 'Unmute my mic'} onPress={() => { setMyMic(!micOn); close(); }} />
        {mode === 'video' && <Item icon={camOn ? 'videoOff' : 'video'} label={camOn ? 'Turn camera off' : 'Turn camera on'} onPress={() => { setMyCam(!camOn); close(); }} />}
        {!isHost && <Item icon="arrowDown" label="Leave seat" onPress={leaveSeat} />}
        {isHost
          ? <Item icon="logout" danger label="End live" onPress={() => confirm('End this live?', 'Everyone in the room will be disconnected.', 'End live', () => void endLive())} />
          : <Item icon="logout" danger label="Leave live" onPress={() => confirm('Leave this live?', 'You will also leave your seat.', 'Leave', leave)} />}
      </BottomSheet>
    );
    if (!isHost && !u) return (
      <BottomSheet onClose={close}>
        {header}
        <Item icon="armchair" label="Take this seat" onPress={() => takeSeat(idx)} />
        <Item icon="userPlus" label={requested ? 'Request already sent' : 'Request a seat from host'} onPress={() => { requestSeat(); close(); }} />
      </BottomSheet>
    );
    if (!isHost && u) return <BottomSheet onClose={close}>{header}{giftItem}</BottomSheet>;
    if (!u) return (
      <BottomSheet onClose={close}>
        {header}
        {!x.locked && <Item icon="userPlus" label="Invite someone" onPress={() => setSheet({ kind: 'invite', index: idx })} />}
        <Item icon={x.locked ? 'unlock' : 'lock'} label={x.locked ? 'Unlock seat' : 'Lock seat'} onPress={() => { close(); void run(patchSeat(room.id, idx, { locked: !x.locked }), x.locked ? `Seat ${idx + 1} unlocked` : `Seat ${idx + 1} locked`); }} />
      </BottomSheet>
    );
    const n = nameOf(people[u]);
    return (
      <BottomSheet onClose={close}>
        {header}{giftItem}
        <Item icon={x.muted ? 'mic' : 'micOff'} label={x.muted ? 'Unmute' : 'Mute'} onPress={() => { close(); void run(patchSeat(room.id, idx, { muted: !x.muted }), x.muted ? `${n} unmuted` : `${n} muted`); }} />
        <Item icon="userMinus" label="Remove from seat" onPress={() => { close(); void run(patchSeat(room.id, idx, { user_id: null, muted: false }), `${n} moved to audience`); }} />
        <Item icon="lock" label="Remove & lock seat" onPress={() => { close(); void run(patchSeat(room.id, idx, { user_id: null, muted: false, locked: true }), `Seat ${idx + 1} locked`); }} />
        <Item icon="ban" danger label="Kick from live" onPress={() => confirm(`Kick ${n}?`, 'They will be removed from the live and cannot rejoin this session.', 'Kick', () => {
          setSheet(null);
          void run(Promise.all([patchSeat(room.id, idx, { user_id: null, muted: false }), kickViewer(room.id, u), postLiveEvent(room.id, 'kick', u)]), `${n} was removed from the live`);
        })} />
      </BottomSheet>
    );
  };

  const openShare = () => { setPanel('share'); void fetchFriends().then(setFriends).catch(() => setFriends([])); };

  if (summary && !isHost) return <LiveEndedView hostP={host} hostName={hostName} others={others} onPick={onPick} onClose={onClose} onSwipe={onSwipe} />;
  if (summary) {
    const peak = Math.max(state?.peak_viewers ?? 0, count, 1);
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }]}>
        <Pressable accessibilityLabel="Exit live" onPress={onClose} style={[s.xBtn, { position: 'absolute', top: 48, right: 16 }]}><Icon name="x" size={18} /></Pressable>
        <Image source={require('../../../assets/logo.png')} style={{ width: 64, height: 64, borderRadius: 16 }} resizeMode="contain" />
        <Text style={[s.h, { fontSize: 20, marginTop: 8 }]}>Live ended</Text>
        <Text style={s.muted}>Duration {Math.floor(summary.secs / 60)}m {String(summary.secs % 60).padStart(2, '0')}s</Text>
        <View style={s.stats}>
          {[['Peak viewers', formatNum(peak)], ['Likes', formatNum(likes)], ['Gifts', formatNum(gifts.reduce((a, g) => a + g.qty, 0))], ['Guests on seats', String(seats.filter((q) => q.idx > 0 && q.user_id).length)], ['Game earning', formatNum(earn.game)], ['Joining income', formatNum(earn.joining)]].map(([k, v]) => (
            <View key={k} style={s.stat}><Text style={s.statV}>{v}</Text><Text style={s.rowS}>{k}</Text></View>
          ))}
        </View>
        <Pressable onPress={onClose} style={[s.btn, { backgroundColor: OR, alignSelf: 'stretch', flex: 0, height: 48, marginTop: 24 }]}><Text style={[s.btnW, { color: '#000' }]}>Done</Text></Pressable>
      </View>
    );
  }

  if (gate && !gate.paid && !isHost) return (
    <View style={[s.root, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }]}>
      {room.cover_url && <Image source={{ uri: room.cover_url }} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} blurRadius={12} />}
      <Pressable accessibilityLabel="Leave live" onPress={onClose} style={[s.xBtn, { position: 'absolute', top: 48, right: 16 }]}><Icon name="x" size={18} /></Pressable>
      <View style={{ width: '100%', maxWidth: 340, alignItems: 'center', backgroundColor: 'rgba(20,20,28,0.92)', borderRadius: 24, padding: 22, borderWidth: 1, borderColor: 'rgba(255,215,0,0.45)' }}>
        <Avatar p={host} size={64} />
        <Text style={[s.h, { fontSize: 18, marginTop: 10 }]}>{hostName}</Text>
        <Text style={[s.muted, { textAlign: 'center' }]} numberOfLines={2}>{room.title}</Text>
        <Text style={{ color: '#FFD700', fontSize: 26, fontWeight: '900', marginTop: 14 }}>🪙 {formatNum(gate.fee)}</Text>
        <Text style={s.rowS}>One-time entry for this live</Text>
        <Pressable disabled={paying} onPress={() => void payJoin()} style={[s.btn, { backgroundColor: OR, alignSelf: 'stretch', flex: 0, height: 48, marginTop: 18, opacity: paying ? 0.6 : 1 }]}><Text style={[s.btnW, { color: '#000' }]}>{paying ? 'Joining…' : 'Pay & join'}</Text></Pressable>
        <Pressable onPress={onClose} style={[s.btn, { alignSelf: 'stretch', flex: 0, height: 44, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={s.btnW}>Not now</Text></Pressable>
      </View>
    </View>
  );
  const bgAllowed = seated || mode === 'audio';
  const bgKey = state && state.bg !== undefined ? state.bg : room.bg;
  const fsGuests = !seated ? seats.filter((q) => q.idx >= 1 && q.idx <= 8 && q.user_id).map((q) => q.idx) : [];
  const col = (ids: number[], side: 'left' | 'right') => ids.length ? (
    <ScrollView style={[s.fsCol, side === 'right' ? { right: 4 } : { left: 4 }]} contentContainerStyle={{ gap: 4 }} showsVerticalScrollIndicator={false}>{ids.map((i) => seatEl(i))}</ScrollView>
  ) : null;

  return (
    <View ref={rootRef} collapsable={false} style={s.root} {...swipe}>
      {bgAllowed && bgSource(bgKey) != null && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          <Image source={bgSource(bgKey)} style={{ width: '100%', height: '100%' }} resizeMode="cover" fadeDuration={0} />
        </View>
      )}
      {mode === 'video' && !seated && !inGame && videoOf(room.host_id) ? <LiveVideo track={videoOf(room.host_id)} mirror={isHost} />
        : room.cover_url && mode === 'video' && !seated && !isHost ? <Image source={{ uri: room.cover_url }} style={StyleSheet.absoluteFill} /> : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <Pressable testID="like-layer" style={StyleSheet.absoluteFill} onPress={tapLike} />
      {((hasMic && mode === 'video' && camOn && lk.camStatus !== 'on') || lk.link !== 'connected') && (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: '40%', left: 24, right: 24, alignItems: 'center', gap: 10, zIndex: 25 }}>
          <Text pointerEvents="none" style={[s.rowS, { textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }]}>
            {lk.link === 'offline' && lk.error ? lk.error : lk.camStatus === 'error' ? (lk.error || 'Camera could not start') : lk.link !== 'connected' ? `Connecting… (${lk.link})` : 'Starting camera…'}
          </Text>
          {lk.link === 'offline' && (
            <Pressable accessibilityLabel="Try again" onPress={lk.retry} style={[s.smallBtn, { paddingHorizontal: 22, paddingVertical: 10 }]}><Text style={s.smallBtnT}>Try again</Text></Pressable>
          )}
        </View>
      )}
      <StickerLayer stickers={state?.stickers ?? []} host={isHost} onCommit={commitSticker} onHide={hideSticker} />

      {/* top bar */}
      <View style={s.top} pointerEvents="box-none">
        <View style={s.hostPill}>
          <Avatar p={host} size={36} />
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={[s.hostN, { flexShrink: 1 }]} numberOfLines={1}>{hostName}</Text><VipTag id={host?.id} /></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View ref={likeRef} collapsable={false}>
                <Animated.View style={{ transform: [{ scale: likePulse }] }}><Icon name="heart" size={11} color={RED} fill={RED} /></Animated.View>
              </View>
              <Text style={s.rowS}>{formatNum(likes)} · {formatNum(followers)}</Text>
            </View>
          </View>
          {!isHost && me && (!following || justFollowed.includes(room.host_id)) ? (
            <Pressable onPress={() => toggleFollow()} style={[s.follow, following && { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }]}>
              <Text style={[s.followT, following && { color: '#fff' }]}>{following ? 'Following' : 'Follow'}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable accessibilityLabel="Top viewers" onPress={() => setSheet({ kind: 'viewers' })} style={s.viewers}><Icon name="users" size={14} color={OR} /><Text style={s.viewersT}>{formatNum(count)}</Text></Pressable>
          {isHost
            ? <Pressable onPress={() => confirm('End this live?', 'Everyone in the room will be disconnected.', 'End live', () => void endLive())} style={s.end}><Text style={s.endT}>End Live</Text></Pressable>
            : <Pressable accessibilityLabel="Leave live" onPress={() => (onSeat ? confirm('Leave this live?', 'You will also leave your seat.', 'Leave', leave) : leave())} style={s.xBtn}><Icon name="x" size={18} /></Pressable>}
        </View>
      </View>

      {/* stage */}
      {inGame ? null : seated ? (
        <View style={{ marginTop: 12, paddingHorizontal: 4 }}>
          {room.layout === 'seats3' ? (
            <View style={{ gap: 4 }}>
              {[[0], [1, 2, 3], [4, 5, 6], [7, 8, 9]].map((r) => <View key={r[0]} style={{ flexDirection: 'row', justifyContent: r.length > 1 ? 'space-evenly' : 'center' }}>{r.map((i) => <View key={i} style={{ width: '24.5%' }}>{seatEl(i)}</View>)}</View>)}
            </View>
          ) : room.layout === 'seats' ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 4 }}>{[0, 1].map((i) => <View key={i} style={{ flex: 1 }}>{seatEl(i, { big: true })}</View>)}</View>
              {[[2, 3, 4, 5], [6, 7, 8, 9]].map((r) => <View key={r[0]} style={{ flexDirection: 'row', gap: 4 }}>{r.map((i) => <View key={i} style={{ flex: 1 }}>{seatEl(i)}</View>)}</View>)}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <View style={{ flex: 2 }}>{seatEl(0, { big: true, tall: true })}</View>
              <View style={{ flex: 2, gap: 4 }}>{[[1, 2], [3, 4], [5, 6], [7, 8]].map((r) => <View key={r[0]} style={{ flexDirection: 'row', gap: 4 }}>{r.map((i) => <View key={i} style={{ flex: 1 }}>{seatEl(i)}</View>)}</View>)}</View>
            </View>
          )}
        </View>
      ) : mode === 'audio' ? (
        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <View style={s.bigAv}><Avatar p={host} size={112} /></View>
          {seats[0]?.muted && <View style={[s.dot, { width: 28, height: 28, borderRadius: 14, top: 84, left: '58%', backgroundColor: RED }]}><Icon name="micOff" size={16} /></View>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}><Text style={[s.hostN, { fontSize: 14 }]}>{hostName}</Text><VipTag id={host?.id} /></View>
        </View>
      ) : null}
      {inGame && roomGame && (
        <VideoOfContext.Provider value={videoOf}>
          <TileCtlContext.Provider value={tileCtl}>
            <LiveGameStage key={roomGame.id} game={roomGame} me={me} bg={bgKey} onDone={dismissGame} onForfeitRef={forfeitRef} />
          </TileCtlContext.Provider>
        </VideoOfContext.Provider>
      )}
      {!seated && !inGame && (state?.fs_split
        ? <>{col(fsGuests.filter((_, k) => k % 2 === 1), 'left')}{col(fsGuests.filter((_, k) => k % 2 === 0), 'right')}</>
        : col(fsGuests, 'right'))}

      {paused && (
        <View style={s.pause}>
          <Text style={{ fontSize: 48 }}>☕</Text>
          <Text style={[s.h, { fontSize: 18, marginTop: 12 }]}>Taking a short break</Text>
          <Text style={s.rowS}>The live will resume soon · audio is muted</Text>
          {isHost && <Pressable onPress={() => setRoom({ paused: false }, 'Live resumed')} style={[s.smallBtn, { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10 }]}><Text style={s.smallBtnT}>Resume live</Text></Pressable>}
        </View>
      )}

      <View style={{ flex: 1 }} pointerEvents="box-none" />
      {/* chat feed */}
      {comments ? (
        <FlatList testID="live-chat" style={s.chat} onTouchStart={chatDown} onTouchEnd={chatUp} data={messages} inverted keyExtractor={(m) => String(m.id)} showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 8 }} initialNumToRender={12} windowSize={5}
          renderItem={({ item }) => <ChatRow m={item} p={people[item.user_id]} mine={item.user_id === me} />} />
      ) : <View style={s.chat}><Text style={s.rowS}>Comments are turned off.</Text></View>}

      {giftBanner && <View testID="gift-banner" style={{ position: 'absolute', top: 90, alignSelf: 'center', backgroundColor: 'rgba(255,165,0,0.9)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, zIndex: 50 }}><Text style={{ color: '#000', fontWeight: '800', fontSize: 12 }}>{giftBanner}</Text></View>}
      {/* panels */}
      {partnerOpen && <PartnerJoinScreen inviterId={room.host_id} onClose={() => setPartnerOpen(false)} />}
      {panel && (
        <View style={s.panel}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.panelH}>{{ gift: 'Gift box', guest: isHost ? 'Guests' : 'Join a seat', game: 'Live games', settings: 'Live settings', share: 'Share live' }[panel]}</Text>
            <Pressable accessibilityLabel="Close panel" onPress={() => setPanel(null)}><Icon name="x" size={16} color="rgba(255,255,255,0.5)" /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
            {panel === 'gift' && <><GiftGrid onPick={(g) => doGift(room.host_id, g, seated ? 0 : -1)} /><Qty v={giftQty} set={setGiftQty} /></>}
            {panel === 'guest' && (isHost ? (
              <View style={{ gap: 8 }}>
                {requests.length === 0 && <Text style={[s.rowS, { textAlign: 'center', paddingVertical: 12 }]}>No pending requests.</Text>}
                {requests.map((u) => (
                  <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Avatar p={people[u]} size={32} />
                    <View style={{ flex: 1 }}><Text style={s.rowT}>{nameOf(people[u])}</Text><Text style={s.rowS}>{handleOf(people[u])}</Text></View>
                    <Pressable accessibilityLabel={`Accept ${nameOf(people[u])}`} onPress={() => accept(u)} style={[s.circle, { width: 32, height: 32, backgroundColor: '#34D399' }]}><Icon name="check" size={16} color="#000" /></Pressable>
                    <Pressable accessibilityLabel={`Decline ${nameOf(people[u])}`} onPress={() => void run(postLiveEvent(room.id, 'decline', u), `Declined ${nameOf(people[u])}`)} style={[s.circle, { width: 32, height: 32, backgroundColor: 'rgba(255,255,255,0.1)' }]}><Icon name="x" size={16} /></Pressable>
                  </View>
                ))}
                <Text style={[s.rowS, { fontWeight: '800', marginTop: 6 }]}>Invite a viewer</Text>
                {inviteList.length === 0 && <Text style={[s.rowS, { textAlign: 'center', paddingVertical: 8 }]}>No viewers to invite right now.</Text>}
                {inviteList.map((u) => (
                  <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Avatar p={people[u]} size={32} />
                    <View style={{ flex: 1 }}><Text style={s.rowT} numberOfLines={1}>{nameOf(people[u])}</Text><Text style={s.rowS} numberOfLines={1}>{handleOf(people[u])}</Text></View>
                    <Pressable accessibilityLabel={`Invite ${nameOf(people[u])} as guest`} disabled={invited.includes(u)} onPress={() => inviteViewer(u)} style={[s.smallBtn, invited.includes(u) && { opacity: 0.45 }]}>
                      <Text style={s.smallBtnT}>{invited.includes(u) ? 'Invited' : 'Invite'}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : onSeat ? (
              <Pressable onPress={leaveSeat} style={[s.btn, { flex: 0, height: 40, backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={s.btnW}>Leave my seat</Text></Pressable>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => { const i = freeSeat(); if (!seated || i < 0) return notify('No free seat right now'); takeSeat(seats[i].idx); setPanel(null); }} style={[s.btn, { height: 40, backgroundColor: OR }]}><Text style={[s.btnW, { color: '#000' }]}>Take a free seat</Text></Pressable>
                <Pressable disabled={requested} onPress={requestSeat} style={[s.btn, { height: 40, backgroundColor: 'rgba(255,255,255,0.1)', opacity: requested ? 0.4 : 1 }]}><Text style={s.btnW}>{requested ? 'Request sent' : 'Ask the host'}</Text></Pressable>
              </View>
            ))}
            {panel === 'game' && isHost && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {LIVE_GAMES.map((g) => (
                  <Pressable key={g.name} onPress={() => (PLAYABLE.has(g.key) ? (inGame ? notify('A game is already running') : (setPanel(null), setInviteGame(g.key))) : notify(`${g.name} — Coming soon`))} style={s.game}>
                    <SvgXml xml={GAME_SVG[g.key]} width={44} height={44} />
                    <Text style={s.gameT}>{g.name}</Text>
                    <View style={[s.tag, PLAYABLE.has(g.key) ? { backgroundColor: RED } : { backgroundColor: 'rgba(255,165,0,0.2)' }]}><Text style={[s.tagT, !PLAYABLE.has(g.key) && { color: OR }]}>{PLAYABLE.has(g.key) ? 'Challenge' : 'Coming soon'}</Text></View>
                  </Pressable>
                ))}
              </View>
            )}
            {panel === 'settings' && state && (
              <View style={{ gap: 8 }}>
                <Toggle label="Allow comments" on={comments} onPress={() => setRoom({ allow_comments: !comments })} />
                <Toggle label="Allow gifts" on={giftsOn} onPress={() => setRoom({ allow_gifts: !giftsOn })} />
                <Toggle label="Auto-accept guest requests" on={state.auto_accept} onPress={() => setRoom({ auto_accept: !state.auto_accept })} />
                {!seated && <Toggle label="Guest seats on both sides" on={state.fs_split} onPress={() => setRoom({ fs_split: !state.fs_split })} />}
                <Toggle label="Pause live (break cover, audio muted)" on={paused} onPress={() => setRoom({ paused: !paused }, paused ? 'Live resumed' : 'Live paused — audio muted')} />
                <Pressable onPress={() => void run(Promise.all(seats.filter((q) => q.idx > 0 && q.user_id).map((q) => patchSeat(room.id, q.idx, { muted: true }))), 'All guests muted')} style={s.tog}>
                  <Text style={s.togT}>Mute all guests</Text><Icon name="micOff" size={16} color="rgba(255,255,255,0.6)" />
                </Pressable>
                {bgAllowed && <>
                  <Text style={[s.rowS, { fontWeight: '800', marginTop: 4 }]}>Background</Text>
                  <BgPicker value={bgKey ?? null} onPick={(k) => { setLiveBg(k); setRoom({ bg: k }); }} />
                </>}
                <Pressable accessibilityLabel="Stickers" onPress={() => setStickerSheet(true)} style={s.tog}>
                  <Text style={s.togT}>Stickers · text &amp; image{state.stickers.length ? ` (${state.stickers.length}/2)` : ''}</Text><Icon name="image" size={16} color="rgba(255,255,255,0.6)" />
                </Pressable>
              </View>
            )}
            {panel === 'share' && (
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
                  {friends.length === 0 && <Text style={s.rowS}>Follow people to share with them.</Text>}
                  {friends.map((f) => {
                    const on = picked.includes(f.id);
                    return (
                      <Pressable key={f.id} onPress={() => setPicked((p) => (on ? p.filter((i) => i !== f.id) : [...p, f.id]))} style={{ width: 56, alignItems: 'center' }}>
                        <View><Avatar p={f} size={56} />{on && <View style={[s.dot, { right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: OR }]}><Icon name="check" size={12} color="#000" /></View>}</View>
                        <Text numberOfLines={1} style={[s.rowS, { marginTop: 4 }]}>{nameOf(f).split(' ')[0]}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable disabled={!picked.length} onPress={() => { const n = picked.length; void run(Promise.all(picked.map((u) => postLiveEvent(room.id, 'share', u))), `Live shared with ${n} friend(s)`); setPicked([]); setPanel(null); }} style={[s.btn, { flex: 0, height: 40, backgroundColor: OR, opacity: picked.length ? 1 : 0.4 }]}>
                  <Text style={[s.btnW, { color: '#000' }]}>Send {picked.length ? `(${picked.length})` : ''}</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {/* bottom bar */}
      <View style={[s.bottom, { paddingBottom: kbd ? kbd + 8 : 16 }]} pointerEvents="box-none">
        {composer && !comments && <Text testID="live-comments-off" style={[s.hint, { textAlign: 'center', marginBottom: 12 }]}>Comments are turned off for this LIVE</Text>}
        {composer && comments && (
          <View testID="live-composer" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: kbd ? 0 : 12 }}>
            <View style={{ flex: 1 }}><RichTextInput value={draft} onChange={setDraft} placeholder={isHost ? 'Say something to your viewers…' : 'Say something nice…'} /></View>
            <Pressable accessibilityLabel="Send comment" onPress={send} style={[s.circle, { width: 44, height: 44, backgroundColor: OR }]}><Icon name="send" size={18} color="#000" /></Pressable>
          </View>
        )}
        {!kbd && (<View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Action icon="comment" label="Comments" active={composer} onPress={() => { setComposer((c) => !c); setPanel(null); }} />
          {hasMic && <Action icon={micOn ? 'mic' : 'micOff'} label={micOn ? 'Mute microphone' : 'Unmute microphone'} danger={!micOn} onPress={() => (onSeat ? setMyMic(!micOn) : notify('Microphone'))} />}
          {hasMic && mode === 'video' && camOn && <Action icon="sparkles" label={beautyOn ? 'Beauty off' : 'Beauty on'} active={beautyOn} onPress={() => { toggleBeauty(); notify(beautyOn ? 'Beauty off · normal camera' : 'Beauty on'); }} />}
          {giftsOn && !isHost && <Action icon="gift" label="Gift box" active={panel === 'gift'} onPress={() => setPanel(panel === 'gift' ? null : 'gift')} />}
          <Action icon="userPlus" label={isHost ? 'Seat requests' : 'Join a seat'} badge={isHost ? requests.length : undefined} active={panel === 'guest'} onPress={() => setPanel(panel === 'guest' ? null : 'guest')} />
          {isHost && <Action icon="gamepad" label="Live games" active={panel === 'game'} onPress={() => setPanel(panel === 'game' ? null : 'game')} />}
          {!isHost && <Action icon="send" label="Share live" active={panel === 'share'} onPress={() => (panel === 'share' ? setPanel(null) : openShare())} />}
          {!isHost && <Action icon="logout" danger label="Leave live" onPress={() => confirm('Leave this live?', onSeat ? 'You will also leave your seat.' : 'You can come back anytime.', 'Leave', leave)} />}
          {isHost && <Action icon="more" label="More" onPress={() => setSheet({ kind: 'more' })} />}
        </View>)}
        {!giftsOn && !kbd && <Text style={[s.hint, { marginTop: 6 }]}>Gifts are disabled</Text>}
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 60 }]}>
        {hearts.map((h) => <FlyingHeart key={h.id} h={h} onEnd={endHeart} />)}
      </View>
      {renderSheet()}
      {stickerSheet && isHost && <StickerEditor stickers={state?.stickers ?? []} onChange={changeStickers} onClose={() => setStickerSheet(false)} />}
      {inviteGame && isHost && <GameInviteSheet game={inviteGame} roomId={room.id} me={me} onClose={() => setInviteGame(null)} />}
    </View>
  );
}

/** Closes the live on the server: DB row + LiveKit room, each retried with back-off and bounded by a timeout. */
async function finishLive(id: string, peak: number) {
  const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const retry = async (fn: () => Promise<unknown>) => {
    for (let i = 0; i < 3; i++) {
      try { await timeout(fn(), 8000); return; } catch { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    }
  };
  void updateRoom(id, { peak_viewers: peak }).catch(() => undefined);
  await Promise.all([retry(() => endLiveRoom(id)), retry(() => closeLiveRoom(id))]);
}

function GiftGrid({ onPick }: { onPick: (id: string) => void }) {
  return <GiftPicker onPick={onPick} cols={4} />;
}
function Qty({ v, set }: { v: number; set: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
      <Text style={s.rowS}>Quantity</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable accessibilityLabel="Decrease" onPress={() => set(Math.max(1, v - 1))} style={[s.circle, { width: 28, height: 28, backgroundColor: 'rgba(255,255,255,0.1)' }]}><Icon name="minus" size={14} /></Pressable>
        <Text style={s.rowT}>×{v}</Text>
        <Pressable accessibilityLabel="Increase" onPress={() => set(Math.min(99, v + 1))} style={[s.circle, { width: 28, height: 28, backgroundColor: OR }]}><Icon name="plus" size={14} color="#000" /></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#000' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingTop: 16, zIndex: 10 },
  hostPill: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.45)', paddingVertical: 4, paddingLeft: 4, paddingRight: 8 },
  hostN: { color: '#fff', fontWeight: '800', fontSize: 13 },
  follow: { marginLeft: 4, backgroundColor: OR, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4 },
  followT: { color: '#000', fontSize: 10, fontWeight: '900' },
  viewers: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 6 },
  viewersT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  end: { height: 36, borderRadius: 99, backgroundColor: RED, paddingHorizontal: 12, justifyContent: 'center' },
  endT: { color: '#fff', fontSize: 11, fontWeight: '900' },
  xBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  avBox: { backgroundColor: OR, alignItems: 'center', justifyContent: 'center' },
  avT: { color: '#000', fontWeight: '900' },
  bigAv: { borderRadius: 60, borderWidth: 4, borderColor: 'rgba(255,165,0,0.3)' },
  seat: { borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  seatOn: { borderColor: 'rgba(255,165,0,0.4)', backgroundColor: 'rgba(255,165,0,0.1)' },
  seatEmpty: { borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.05)' },
  pill: { borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center' },
  pillT: { color: '#fff', fontSize: 9, fontWeight: '800' },
  hostTag: { position: 'absolute', right: 4, top: 4, backgroundColor: RED, borderRadius: 99, paddingHorizontal: 6 },
  hostTagT: { color: '#fff', fontSize: 8, fontWeight: '900' },
  dot: { position: 'absolute', bottom: -2, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  seatFoot: { position: 'absolute', left: 4, right: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  fBtn: { width: 16, height: 16, borderRadius: 8, backgroundColor: OR, alignItems: 'center', justifyContent: 'center' },
  fx: { position: 'absolute', fontSize: 30 },
  seatGift: { position: 'absolute', top: 4, right: 4, borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 5, paddingVertical: 1, zIndex: 5 },
  seatGiftT: { color: '#FFD400', fontSize: 9, fontWeight: '800' },
  circle: { borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  fsCol: { position: 'absolute', top: 96, bottom: 112, width: '23%', zIndex: 20 },
  heart: { position: 'absolute', fontSize: 24 },
  sticker: { position: 'absolute', backgroundColor: 'rgba(255,165,0,0.9)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, zIndex: 5 },
  stickerT: { color: '#000', fontWeight: '900' },
  pause: { ...StyleSheet.absoluteFill, zIndex: 16, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  chat: { maxHeight: 250, paddingHorizontal: 12, flexGrow: 0, flexShrink: 1 },
  chatName: { borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 8, paddingVertical: 2 },
  chatNameT: { color: '#fff', fontSize: 10, fontWeight: '800' },
  chatT: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  panel: { marginHorizontal: 12, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.8)', padding: 12, zIndex: 20 },
  panelH: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  bottom: { paddingHorizontal: 12, paddingTop: 4, zIndex: 20 },
  act: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  actOn: { borderColor: OR, backgroundColor: 'rgba(255,165,0,0.2)' },
  actDanger: { borderColor: 'rgba(255,59,48,0.6)', backgroundColor: 'rgba(255,59,48,0.2)' },
  badge: { position: 'absolute', right: -2, top: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: RED, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeT: { color: '#fff', fontSize: 9, fontWeight: '900' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '85%', backgroundColor: '#141416', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 16 },
  itemIc: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  itemT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  h: { color: '#fff', fontSize: 16, fontWeight: '900' },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4 },
  btn: { flex: 1, height: 44, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  btnW: { color: '#fff', fontWeight: '900', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 16 },
  rowT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  rowS: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  rank: { minWidth: 52, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  rankT: { fontSize: 10, fontWeight: '900' },
  smallBtn: { backgroundColor: OR, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  smallBtnT: { color: '#000', fontSize: 11, fontWeight: '900' },
  tog: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 8 },
  togT: { color: '#fff', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  sw: { width: 36, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', padding: 2 },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  stIn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 12, paddingHorizontal: 12, height: 36 },
  game: { width: '31%', alignItems: 'center', gap: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 8 },
  gameIc: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,165,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  gameT: { color: '#fff', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  tag: { borderRadius: 99, paddingHorizontal: 6 },
  tagT: { color: '#fff', fontSize: 8, fontWeight: '800' },
  gift: { width: '23%', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 8 },
  giftN: { color: '#fff', fontSize: 10, fontWeight: '800', marginTop: 2 },
  giftP: { color: OR, fontSize: 10, fontWeight: '700' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24, alignSelf: 'stretch' },
  stat: { width: '48.5%', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 12 },
  statV: { color: OR, fontSize: 18, fontWeight: '900' },
});
