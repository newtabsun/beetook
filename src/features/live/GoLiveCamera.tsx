import { friendlyError } from '../../lib/errors';
// Full-screen Go Live setup: camera preview, title overlay on top, live settings stacked on the right edge,
// big Go Live button with a 3-2-1 countdown, then the existing createLiveRoom flow.
import { useCameraPermissions, type CameraType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../../components/Icons';
import { createLiveRoom, endMyStaleLives, lastLiveSetup, type LiveRoom } from '../../lib/api';
import { closeLiveRoom } from '../../lib/livekit';
import { ensureLivePermissions } from '../../lib/livePermissions';
import { notify } from '../../lib/notify';
import { colors } from '../../theme';
import { BeautyCamera, type BeautyCameraHandle } from '../../../modules/gpupixel-camera';
import { BeautyPanel } from '../../components/BeautyPanel';
import { NO_BEAUTY, levelsOf, setLiveBeautyOn, useBeauty, useLiveBeautyOn } from '../../lib/beautyStore';
import { CameraBlocked } from '../../components/CameraBlocked';
import { BgPicker, setLiveBg, useLiveBg } from './BgPicker';
import { loadStickerKit } from './liveStickers';

type Layout = 'fullscreen' | 'seats' | 'seats2' | 'seats3';
type Panel = 'none' | 'filters' | 'type' | 'layout' | 'fee' | 'category' | 'bg';
const CATS = ['Music', 'Food', 'Dance', 'Fashion', 'Talk', 'Gaming'];
function LayoutThumb({ k }: { k: Layout }) {
  const b = (on?: boolean): ViewStyle => ({ borderRadius: 2, backgroundColor: on ? 'rgba(255,165,0,0.85)' : 'rgba(255,255,255,0.3)' });
  if (k === 'fullscreen') return <View style={[b(true), { width: '100%', aspectRatio: 0.75 }]} />;
  if (k === 'seats3') return (
    <View style={{ aspectRatio: 0.75, justifyContent: 'center', gap: 2 }}>
      {[[0], [1, 2, 3], [4, 5, 6], [7, 8, 9]].map((r) => <View key={r[0]} style={{ flexDirection: 'row', justifyContent: 'center', gap: 2 }}>{r.map((i) => <View key={i} style={[b(i === 0), { width: '28%', aspectRatio: 1 }]} />)}</View>)}
    </View>
  );
  if (k === 'seats') return (
    <View style={{ gap: 2, aspectRatio: 0.75, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 2 }}><View style={[b(true), { flex: 1, aspectRatio: 1 }]} /><View style={[b(), { flex: 1, aspectRatio: 1 }]} /></View>
      {[0, 1].map((r) => <View key={r} style={{ flexDirection: 'row', gap: 2 }}>{[0, 1, 2, 3].map((i) => <View key={i} style={[b(), { flex: 1, aspectRatio: 1 }]} />)}</View>)}
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 2, aspectRatio: 0.75 }}>
      <View style={[b(true), { flex: 1 }]} />
      <View style={{ flex: 1, gap: 2 }}>{[0, 1, 2, 3].map((r) => <View key={r} style={{ flex: 1, flexDirection: 'row', gap: 2 }}><View style={[b(), { flex: 1 }]} /><View style={[b(), { flex: 1 }]} /></View>)}</View>
    </View>
  );
}

const LAYOUTS: { k: Layout; label: string }[] = [{ k: 'fullscreen', label: 'Fullscreen' }, { k: 'seats', label: 'Seats 1' }, { k: 'seats2', label: 'Seats 2' }, { k: 'seats3', label: 'Seats 3' }];

export function GoLiveCamera({ onCreated, onClose }: { onCreated: (r: LiveRoom) => void; onClose: () => void }) {
  const [perm, askPerm] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('front');
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState('Music');
  const [cover, setCover] = useState<string>();
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [layout, setLayout] = useState<Layout>('fullscreen');
  const [feeOn, setFeeOn] = useState(false);
  const [fee, setFee] = useState('');
  const beautyOn = useLiveBeautyOn(); // OFF by default: preview and live use the plain camera
  const look = levelsOf(useBeauty());
  const levels = beautyOn ? look : NO_BEAUTY;
  const gpu = useRef<BeautyCameraHandle>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState(false); // preview camera closed so the live stream can open it
  const bg = useLiveBg();
  // Camera + microphone (+ Bluetooth / notifications on Android) are asked here, before Go Live, never inside the room.
  useEffect(() => {
    void ensureLivePermissions(true, { quiet: true }).then((ok) => { if (ok) void askPerm().catch(() => undefined); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bgAllowed = mode === 'audio' || layout !== 'fullscreen';
  useEffect(() => { if (!bgAllowed) setPanel((p) => (p === 'bg' ? 'none' : p)); }, [bgAllowed]);
  const toggle = (p: Panel) => setPanel((x) => (x === p ? 'none' : p));
  useEffect(() => {
    void lastLiveSetup().then((r) => {
      if (!r) return;
      setTitle((t) => t || r.title || '');
      if (r.cover_url) setCover((c) => c ?? r.cover_url!);
    }).catch(() => undefined);
  }, []);

  const pickCover = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: true, aspect: [1, 1] });
    if (!r.canceled) setCover(r.assets[0].uri);
  };
  const go = async () => {
    if (!cover) { notify('Add a cover photo', 'Viewers see it in the Live list.'); return; }
    const joinFee = feeOn ? Math.floor(Number(fee) || 0) : 0;
    if (feeOn && joinFee < 1) { notify('Set a joining fee', 'Enter the coin amount or turn the joining fee off.'); setPanel('fee'); return; }
    if (!(await ensureLivePermissions(mode === 'video'))) return;
    setBusy(true);
    for (let i = 3; i > 0; i--) { setCount(i); await new Promise((r) => setTimeout(r, 1000)); }
    setCount(0);
    // Hand the camera over: the preview releases the device first, otherwise LiveKit can open a busy camera (black video).
    setReleasing(true);
    const released = Date.now();
    try {
      const stale = await endMyStaleLives().catch(() => [] as string[]);
      stale.forEach((id) => { void closeLiveRoom(id).catch(() => undefined); });
      const r = await createLiveRoom(title.trim() || `${cat} live`, cat, cover, mode, layout, bgAllowed ? bg : null, feeOn ? Math.floor(Number(fee) || 0) : 0, await loadStickerKit());
      const left = 800 - (Date.now() - released);
      if (left > 0) await new Promise((res) => setTimeout(res, left));
      onCreated(r);
    } catch (e) { setReleasing(false); notify('Could not start live', friendlyError(e)); }
    setBusy(false);
  };

  const Side = ({ icon, label, on, onPress }: { icon: IconName; label: string; on?: boolean; onPress: () => void }) => (
    <Pressable accessibilityLabel={label} onPress={onPress} disabled={busy} style={s.side}>
      <View style={[s.sideIc, on && { backgroundColor: colors.primary }]}><Icon name={icon} size={20} color={on ? '#000' : '#fff'} /></View>
      <Text style={s.sideT}>{label}</Text>
    </Pressable>
  );
  const Chips = <T extends string>({ items, value, onPick }: { items: { k: T; label: string }[]; value: T; onPick: (k: T) => void }) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
      {items.map((i) => (
        <Pressable key={i.k} onPress={() => onPick(i.k)} style={[s.chip, value === i.k && s.chipOn]}>
          <Text style={[s.chipT, value === i.k && { color: '#000' }]}>{i.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <View style={s.root}>
      {mode === 'video' && perm?.granted && !releasing ? (
        <View style={StyleSheet.absoluteFill}>
          <BeautyCamera ref={gpu} style={StyleSheet.absoluteFill} facing={facing} torch={false} levels={levels} />
        </View>
      ) : (
        <View style={s.center}>
          {cover ? <Image source={{ uri: cover }} style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} blurRadius={20} /> : null}
          <Icon name={mode === 'audio' ? 'mic' : 'camera'} size={40} />
          <Text style={s.centerT}>{mode === 'audio' ? 'Audio live · voice only' : 'Allow camera to preview your live'}</Text>
          {mode === 'video' && <CameraBlocked perm={perm} ask={askPerm} />}
        </View>
      )}
      <View pointerEvents="none" style={s.scrimTop} />
      <View pointerEvents="none" style={s.scrimBottom} />

      <View style={s.top}>
        <Pressable accessibilityLabel="Close" onPress={onClose} disabled={busy} style={s.round}><Icon name="x" size={20} /></Pressable>
        <Pressable accessibilityLabel="Pick cover photo" onPress={() => void pickCover()} style={s.cover}>
          {cover ? <Image source={{ uri: cover }} style={s.coverImg} /> : <Icon name="image" size={18} color={colors.primary} />}
        </Pressable>
        <TextInput value={title} onChangeText={setTitle} placeholder="Add a live title…" maxLength={120}
          placeholderTextColor="rgba(255,255,255,0.6)" style={s.title} />
      </View>
      {!cover && <Text style={s.coverHint}>Tap the square to add a cover photo</Text>}

      <View style={s.rail}>
        <Side icon="rotateR" label="Flip" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
        <Side icon="sparkles" label={beautyOn ? 'Beauty ON' : 'Beauty OFF'} on={beautyOn} onPress={() => { const next = !beautyOn; setLiveBeautyOn(next); setPanel(next ? 'filters' : (p) => (p === 'filters' ? 'none' : p)); }} />
        <Side icon={mode === 'video' ? 'video' : 'mic'} label={mode === 'video' ? 'Video' : 'Audio'} on={panel === 'type'} onPress={() => toggle('type')} />
        <Side icon="grid" label="Layout" on={panel === 'layout'} onPress={() => toggle('layout')} />
        <Side icon="coin" label={feeOn && Number(fee) > 0 ? `🪙 ${fee}` : 'Join fee'} on={panel === 'fee' || feeOn} onPress={() => toggle('fee')} />
        {bgAllowed && <Side icon="image" label="Background" on={panel === 'bg'} onPress={() => toggle('bg')} />}
        <Side icon="music" label={cat} on={panel === 'category'} onPress={() => toggle('category')} />
      </View>

      {count > 0 && <Text style={s.count}>{count}</Text>}

      <View style={s.bottom}>
        {panel === 'filters' && beautyOn && <BeautyPanel onLive={(l) => gpu.current?.setLevels(l)} />}
        {panel === 'type' && <Chips items={[{ k: 'video' as const, label: 'Video live' }, { k: 'audio' as const, label: 'Audio live' }]} value={mode} onPick={setMode} />}
        {panel === 'layout' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
            {LAYOUTS.map((l) => (
              <Pressable key={l.k} accessibilityLabel={l.label} onPress={() => setLayout(l.k)} style={[{ width: 64, padding: 6, borderRadius: 12, borderWidth: 2, borderColor: layout === l.k ? colors.primary : 'rgba(255,255,255,0.25)', backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                <LayoutThumb k={l.k} />
              </Pressable>
            ))}
          </ScrollView>
        )}
        {panel === 'fee' && (
          <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, padding: 12, gap: 10 }}>
            <Pressable accessibilityLabel="Toggle joining fee" onPress={() => setFeeOn((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View><Text style={{ color: '#fff', fontWeight: '800' }}>Joining fee</Text><Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>Viewers pay once to enter this live</Text></View>
              <View style={{ width: 46, height: 26, borderRadius: 13, padding: 3, backgroundColor: feeOn ? colors.primary : 'rgba(255,255,255,0.25)', alignItems: feeOn ? 'flex-end' : 'flex-start' }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }} /></View>
            </Pressable>
            {feeOn && <TextInput value={fee} onChangeText={(t) => setFee(t.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" placeholder="Coins to join" placeholderTextColor="rgba(255,255,255,0.5)" style={{ color: '#fff', height: 42, borderRadius: 12, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.12)', fontWeight: '800' }} />}
          </View>
        )}
        {panel === 'bg' && bgAllowed && <BgPicker value={bg} onPick={setLiveBg} />}
        {panel === 'category' && <Chips items={CATS.map((c) => ({ k: c, label: c }))} value={cat} onPick={setCat} />}
        <Pressable accessibilityLabel="Go Live" disabled={busy} onPress={() => void go()} style={[s.go, busy && { opacity: 0.7 }]}>
          {busy && !count ? <ActivityIndicator color="#fff" /> : <><Icon name="radio" size={20} /><Text style={s.goT}>Go Live</Text></>}
        </Pressable>
      </View>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  centerT: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  permBtn: { backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 22, paddingVertical: 11 },
  permBtnT: { color: '#000', fontWeight: '900' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 130, backgroundColor: 'rgba(0,0,0,0.3)' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 170, backgroundColor: 'rgba(0,0,0,0.3)' },
  top: { position: 'absolute', top: 44, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  cover: { width: 48, height: 48, borderRadius: 10, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverImg: { width: '100%', height: '100%' },
  coverHint: { position: 'absolute', top: 98, left: 72, color: '#fff', fontSize: 11, ...shadow },
  title: { flex: 1, minHeight: 44, color: '#fff', fontSize: 16, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 12, paddingHorizontal: 12 },
  rail: { position: 'absolute', right: 10, top: 124, gap: 14, alignItems: 'center' },
  side: { alignItems: 'center', gap: 3, minWidth: 52 },
  sideIc: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  sideT: { color: '#fff', fontSize: 11, fontWeight: '700', ...shadow },
  count: { position: 'absolute', alignSelf: 'center', top: '38%', color: '#fff', fontSize: 110, fontWeight: '900', ...shadow },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 28, gap: 10 },
  strip: { gap: 8, paddingHorizontal: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)' },
  chipOn: { backgroundColor: colors.primary },
  chipT: { color: '#fff', fontWeight: '800', fontSize: 13 },
  go: { marginHorizontal: 24, minHeight: 56, borderRadius: 28, backgroundColor: '#FF2D55', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  goT: { color: '#fff', fontWeight: '900', fontSize: 18 },
});
