import { requireSignIn } from '../../lib/guest';
import { friendlyError } from '../../lib/errors';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Image } from '../../components/CachedImage';
import { activeBanner } from '../../lib/admin';
import { ActivityIndicator, Alert, FlatList, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createLiveRoom, fetchLiveRooms, initSeats, type LiveRoom } from '../../lib/api';
import { liveAccess } from '../../lib/liveAccess';
import { LiveAccessCard } from './LiveAccessCard';
import { LiveRoomView } from './LiveRoom';
import { BgPicker, setLiveBg, useLiveBg } from './BgPicker';
import { GoLiveCamera } from './GoLiveCamera';

import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/notify';
import { Icon, type IconName } from '../../components/Icons';

import { colors } from '../../theme';
import { dedupe, hydrate, needsRefresh, peek, persist, PERSIST_LIMIT, put, STALE_MS } from '../../lib/swr';
import { isAppActive, onAppActiveChange } from '../../lib/appActive';

const LIVE_KEY = 'live:rooms';
const CATEGORIES = ['All', 'Music', 'Food', 'Dance', 'Fashion', 'Talk', 'Gaming'];
const hostName = (r: LiveRoom) => r.host?.display_name || r.host?.username || 'Host';

type Layout = 'fullscreen' | 'seats' | 'seats2' | 'seats3';

/** Seat layouts (web parity): seats = 2 big + 8 small; seats2 = host column + 8 small. */
function SeatGrid({ layout, host }: { layout: Exclude<Layout, 'fullscreen'>; host: string }) {
  const Seat = ({ i, big }: { i: number; big?: boolean }) => (
    <View style={[s.seat, big && { borderColor: colors.primary }]}>
      {i === 0 ? <Text style={s.avT}>{host[0]}</Text> : <Icon name="mic" size={big ? 20 : 14} color="rgba(255,255,255,0.45)" />}
      <Text style={s.seatN}>{i === 0 ? 'Host' : `${i + 1}`}</Text>
    </View>
  );
  if (layout === 'seats3') return (
    <View style={s.seatWrap}>
      {[[0], [1, 2, 3], [4, 5, 6], [7, 8, 9]].map((r) => <View key={r[0]} style={[s.seatRow, { justifyContent: 'center' }]}>{r.map((i) => <View key={i} style={{ width: '23%', aspectRatio: 1 }}><Seat i={i} /></View>)}</View>)}
    </View>
  );
  if (layout === 'seats') return (
    <View style={s.seatWrap}>
      <View style={s.seatRow}>{[0, 1].map((i) => <View key={i} style={{ flex: 1, aspectRatio: 1 }}><Seat i={i} big /></View>)}</View>
      <View style={s.seatRow}>{[2, 3, 4, 5].map((i) => <View key={i} style={{ flex: 1, aspectRatio: 1 }}><Seat i={i} /></View>)}</View>
      <View style={s.seatRow}>{[6, 7, 8, 9].map((i) => <View key={i} style={{ flex: 1, aspectRatio: 1 }}><Seat i={i} /></View>)}</View>
    </View>
  );
  return (
    <View style={[s.seatWrap, { flexDirection: 'row' }]}>
      <View style={{ flex: 1 }}><Seat i={0} big /></View>
      <View style={{ flex: 1, gap: 6 }}>
        {[[1, 2], [3, 4], [5, 6], [7, 8]].map((r) => <View key={r[0]} style={[s.seatRow, { flex: 1 }]}>{r.map((i) => <View key={i} style={{ flex: 1 }}><Seat i={i} /></View>)}</View>)}
      </View>
    </View>
  );
}

function LayoutThumb({ k }: { k: Exclude<Layout, 'fullscreen'> }) {
  const b = (on?: boolean) => [s.tb, { backgroundColor: on ? 'rgba(255,165,0,0.7)' : 'rgba(255,255,255,0.2)' }];
  if (k === 'seats3') return (
    <View style={{ gap: 2 }}>
      {[[0], [1, 2, 3], [4, 5, 6], [7, 8, 9]].map((r) => <View key={r[0]} style={{ flexDirection: 'row', justifyContent: 'center', gap: 2 }}>{r.map((i) => <View key={i} style={[b(i === 0), { width: '22%', aspectRatio: 1 }]} />)}</View>)}
    </View>
  );
  if (k === 'seats') return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 2 }}><View style={[b(true), { flex: 1, aspectRatio: 1 }]} /><View style={[b(), { flex: 1, aspectRatio: 1 }]} /></View>
      {[0, 1].map((r) => <View key={r} style={{ flexDirection: 'row', gap: 2 }}>{[0, 1, 2, 3].map((i) => <View key={i} style={[b(), { flex: 1, aspectRatio: 1 }]} />)}</View>)}
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 2, aspectRatio: 1 }}>
      <View style={[b(true), { flex: 1 }]} />
      <View style={{ flex: 1, gap: 2 }}>{[0, 1, 2, 3].map((r) => <View key={r} style={{ flex: 1, flexDirection: 'row', gap: 2 }}><View style={[b(), { flex: 1 }]} /><View style={[b(), { flex: 1 }]} /></View>)}</View>
    </View>
  );
}

function GoLive({ onCreated, onClose }: { onCreated: (r: LiveRoom) => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState('Music');
  const [cover, setCover] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [layout, setLayout] = useState<Layout>('fullscreen');
  const bg = useLiveBg();
  const bgAllowed = mode === 'audio' || layout !== 'fullscreen';
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (!r.canceled) setCover(r.assets[0].uri);
  };
  const go = async () => {
    if (!cover) return notify('Add a cover photo', 'Viewers see it in the Live list.');
    setBusy(true);
    try { onCreated(await createLiveRoom(title.trim() || `${cat} live`, cat, cover, mode, layout, bgAllowed ? bg : null)); } catch (e) { notify('Could not start live', friendlyError(e)); }
    setBusy(false);
  };
  const Opt = ({ on, label, desc, onPress }: { on: boolean; label: string; desc: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={[s.opt, on && s.optOn]}><Text style={s.optT}>{label}</Text><Text style={s.optD}>{desc}</Text></Pressable>
  );
  return (
    <View style={s.page}>
      <View style={s.pageHead}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={s.closeBtn}><Icon name="x" size={16} /></Pressable>
        <Text style={s.host}>Go Live</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={s.lbl}>Cover photo · 1:1</Text>
          <Pressable accessibilityLabel="Pick cover photo" onPress={() => void pick()} style={s.coverBox}>
            {cover ? <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} /> : (
              <View style={{ alignItems: 'center', gap: 8 }}><Icon name="image" size={32} color={colors.primary} /><Text style={s.optD}>Pick a cover from your gallery</Text></View>
            )}
          </Pressable>
        </View>
        <TextInput value={title} onChangeText={setTitle} placeholder="Live title (optional)" maxLength={120} placeholderTextColor="rgba(255,255,255,0.4)" style={s.input} />
        <View>
          <Text style={s.lbl}>Stream type</Text>
          <View style={s.two}>
            <Opt on={mode === 'video'} label="Video live" desc="Camera stream" onPress={() => setMode('video')} />
            <Opt on={mode === 'audio'} label="Audio live" desc="Voice only" onPress={() => setMode('audio')} />
          </View>
        </View>
        <View>
          <Text style={s.lbl}>Room layout</Text>
          <View style={s.two}>
            <Opt on={layout === 'fullscreen'} label="Fullscreen" desc="Classic live view" onPress={() => setLayout('fullscreen')} />
            <Opt on={layout !== 'fullscreen'} label="Seats" desc="Choose a seat layout" onPress={() => setLayout(layout === 'fullscreen' ? 'seats' : layout)} />
          </View>
          {layout !== 'fullscreen' && (
            <View style={[s.two, { marginTop: 8 }]}>
              {(['seats', 'seats2', 'seats3'] as const).map((k, i) => (
                <Pressable key={k} accessibilityLabel={`Layout ${i + 1}`} onPress={() => setLayout(k)} style={[s.opt, { padding: 8 }, layout === k && s.optOn]}>
                  <LayoutThumb k={k} /><Text style={[s.optT, { fontSize: 12, marginTop: 6 }]}>Layout {i + 1}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        {bgAllowed && (
          <View>
            <Text style={s.lbl}>Background (optional)</Text>
            <BgPicker value={bg} onPick={setLiveBg} />
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {CATEGORIES.slice(1).map((c) => (
            <Pressable key={c} onPress={() => setCat(c)} style={[s.cat, cat === c && { backgroundColor: colors.primary }]}><Text style={[s.catT, cat === c && { color: '#000' }]}>{c}</Text></Pressable>
          ))}
        </ScrollView>
        <Pressable disabled={busy} onPress={() => void go()} style={[s.primary, busy && { opacity: 0.6 }]}>{busy ? <ActivityIndicator color="#000" /> : <Text style={s.gamesT}>Go Live</Text>}</Pressable>
      </ScrollView>
    </View>
  );
}

export function LiveScreen({ autoCreate, onFull }: { autoCreate?: boolean; onFull?: (on: boolean) => void }) {
  const [open, setOpen] = useState<LiveRoom | null>(null);
  const [rooms, setRooms] = useState<LiveRoom[] | null>(() => peek<LiveRoom[]>(LIVE_KEY) ?? null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [denied, setDenied] = useState<number | null>(null);
  const [me, setMe] = useState<string>();
  // Going live needs VIP or 1,000+ followers (also enforced by the server).
  const startCreate = useCallback(async () => {
    if (!requireSignIn()) return;
    try {
      const a = await liveAccess();
      if (a.allowed) setCreating(true); else setDenied(a.followers);
    } catch (e) { notify('Could not start live', friendlyError(e)); }
  }, []);
  useEffect(() => { if (autoCreate) void startCreate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [listW, setListW] = useState(0);
  const [banner, setBanner] = useState<{ image_url: string; link: string | null } | null>(null);
  const [bannerRatio, setBannerRatio] = useState(3);
  useEffect(() => { void activeBanner().then(setBanner).catch(() => undefined); }, []);
  const featuredSize = listW;
  const tileSize = listW > 0 ? Math.floor((listW - 12) / 2) : 0;
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id)); }, []);
  // Rooms are kept in memory and on disk: returning to the tab paints instantly and the server is asked
  // again only when the list is older than STALE_MS.live (one shared request even if triggered twice).
  const load = useCallback((force = false) => dedupe('live:rooms', async () => {
    if (!force && !needsRefresh(LIVE_KEY, STALE_MS.live)) return;
    try {
      const next = await fetchLiveRooms('All', peek<LiveRoom[]>(LIVE_KEY));
      setRooms(next); setErr(''); put(LIVE_KEY, next);
      void persist(LIVE_KEY, next.slice(0, PERSIST_LIMIT.live));
    } catch (e) { setErr(friendlyError(e)); }
  }), []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!rooms) { const c = await hydrate<LiveRoom[]>(LIVE_KEY); if (alive && c) setRooms(c); }
      if (alive && isAppActive()) await load();
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onAppActiveChange((a) => { if (a && !open) void load(); }), [load, open]);
  useEffect(() => { onFull?.(!!open || creating); return () => onFull?.(false); }, [open, creating, onFull]);
  if (open) return <LiveRoomView room={open} onClose={() => { setOpen(null); void load(true); }} />;
  if (creating) return <GoLiveCamera onClose={() => setCreating(false)} onCreated={(r) => { void initSeats(r.id).finally(() => { setCreating(false); setOpen(r); }); }} />;
  const list = (rooms ?? []).filter((r) => `${r.title} ${hostName(r)} ${r.host?.username ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const [featured, ...rest] = list;
  const Cover = ({ r }: { r: LiveRoom }) => r.cover_url ? <Image source={{ uri: r.cover_url }} style={s.poster} /> : <View style={[s.poster, { backgroundColor: '#222' }]} />;
  return (
    <>
    {denied !== null && <LiveAccessCard followers={denied} onClose={() => setDenied(null)} />}
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 110 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' }} />
        <Text style={s.h2}>Live <Text style={{ color: colors.primary }}>now</Text></Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => void startCreate()} style={[s.cat, s.goLive, { backgroundColor: '#FF3B30' }]}><Icon name="radio" size={14} /><Text style={s.catT}>Go Live</Text></Pressable>
      </View>
      <TextInput value={q} onChangeText={setQ} placeholder="Search live rooms…" placeholderTextColor="rgba(255,255,255,0.35)" style={s.search} />
      {banner && (
        <Pressable onPress={() => { if (banner.link) void Linking.openURL(banner.link); }} style={{ marginBottom: 12 }}>
          <Image source={{ uri: banner.image_url }} style={{ width: '100%', aspectRatio: bannerRatio, borderRadius: 8 }} resizeMode="cover" onLoad={(e: any) => { const w = e?.source?.width, h = e?.source?.height; if (w && h) setBannerRatio(w / h); }} />
        </Pressable>
      )}
      {rooms === null && !err ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> : featured ? (
        <View onLayout={(e) => setListW(Math.floor(e.nativeEvent.layout.width))} style={{ width: '100%' }}>
          {listW > 0 && <>
          <Pressable testID="live-featured" onPress={() => { if (requireSignIn()) setOpen(featured); }} style={[s.tile, { width: featuredSize, height: featuredSize, borderRadius: 24, marginBottom: 16 }]}>
            <Cover r={featured} /><View style={s.shade} />
            <Text style={s.live}>LIVE</Text>
            {!!featured.join_fee && <Text style={s.fee}>🪙 {featured.join_fee}</Text>}
            <View style={s.meta}><Text style={[s.host, { fontSize: 15 }]}>{hostName(featured)}</Text><Text style={s.catLbl}>{featured.category}</Text></View>
          </Pressable>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {rest.map((r) => (
              <Pressable key={r.id} onPress={() => { if (requireSignIn()) setOpen(r); }} style={[s.tile, { width: tileSize, height: tileSize, borderRadius: 16 }]}>
                <Cover r={r} /><View style={s.shade} />
                <Text style={s.live}>LIVE</Text>
                {!!r.join_fee && <Text style={s.fee}>🪙 {r.join_fee}</Text>}
                <View style={[s.meta, { left: 8, bottom: 8 }]}><Text style={[s.host, { fontSize: 12 }]} numberOfLines={2}>{hostName(r)}</Text><Text style={[s.catLbl, { fontSize: 10 }]}>{r.category}</Text></View>
              </Pressable>
            ))}
          </View>
          </>}
        </View>
      ) : (
        <View style={s.empty}><Text style={[s.host, { fontSize: 14 }]}>{err || 'No live rooms found'}</Text><Text style={s.sub}>{q ? 'Try a different search.' : 'Tap Go Live to start one.'}</Text></View>
      )}
    </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  fee: { position: 'absolute', top: 10, right: 10, color: '#000', backgroundColor: '#FFD700', fontWeight: '900', fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' },
  page: { flex: 1, backgroundColor: '#000' },
  pageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  lbl: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  coverBox: { width: '100%', aspectRatio: 1, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,165,0,0.05)', alignItems: 'center', justifyContent: 'center' },
  two: { flexDirection: 'row', gap: 8 },
  opt: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 12 },
  optOn: { borderColor: colors.primary, backgroundColor: 'rgba(255,165,0,0.1)' },
  optT: { color: '#fff', fontWeight: '700', fontSize: 14 },
  optD: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  tb: { borderRadius: 2 },
  seatWrap: { marginHorizontal: 14, marginTop: 12, gap: 6 },
  seatRow: { flexDirection: 'row', gap: 6 },
  seat: { flex: 1, minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', gap: 2 },
  seatN: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700' },
  h2: { color: '#fff', fontSize: 24, fontWeight: '900' },
  search: { height: 44, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff', paddingHorizontal: 18, marginBottom: 20 },
  tile: { overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#1a1a1a' },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.3)' },
  meta: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  catLbl: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  empty: { height: 192, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cats: { padding: 10, gap: 8 },
  cat: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)' },
  catT: { color: '#fff', fontWeight: '700' },
  goLive: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  card: { flex: 1 / 2, margin: 4, borderRadius: 14, overflow: 'hidden', height: 240 },
  poster: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  live: { margin: 8, alignSelf: 'flex-start', backgroundColor: '#E53935', color: '#fff', fontSize: 11, fontWeight: '800', paddingHorizontal: 6, borderRadius: 4 },
  cardMeta: { marginTop: 'auto', padding: 8, backgroundColor: 'rgba(0,0,0,0.45)' },
  host: { color: '#fff', fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  roomHead: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, padding: 6, borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.45)' },
  av: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avT: { fontWeight: '900' },
  x: { color: '#fff', fontSize: 20, paddingHorizontal: 8 },
  roomTitle: { color: '#fff', marginHorizontal: 14, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  gamesBtn: { position: 'absolute', bottom: 20, right: 16, backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 18, paddingVertical: 10 },
  endBtn: { position: 'absolute', bottom: 20, left: 16, backgroundColor: '#E53935', borderRadius: 99, paddingHorizontal: 18, paddingVertical: 10 },
  endT: { color: '#fff', fontWeight: '900' },
  events: { position: 'absolute', left: 14, bottom: 130, gap: 2 },
  stickers: { position: 'absolute', left: 14, bottom: 72, flexDirection: 'row', gap: 10 },
  gamesT: { color: '#000', fontWeight: '900' },
  sheet: { backgroundColor: '#161616', padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetT: { color: '#fff', fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  game: { width: '33.33%', alignItems: 'center', paddingVertical: 10 },
  gName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  soon: { color: colors.primary, fontSize: 9, fontWeight: '800', backgroundColor: 'rgba(255,165,0,0.2)', paddingHorizontal: 5, borderRadius: 99 },
  input: { backgroundColor: '#222', color: '#fff', borderRadius: 12, padding: 12 },
  link: { color: colors.primary, fontWeight: '800' },
  primary: { backgroundColor: colors.primary, borderRadius: 99, padding: 13, alignItems: 'center' },
});
