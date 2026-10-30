import { handleOf } from '../../lib/username';
import { friendlyError } from '../../lib/errors';
// Full-screen camera-first create entry: tap = photo, hold = video, upload, Go Live, filters, theme slideshows.
// WYSIWYG: what the preview shows (incl. front-camera mirroring) is exactly what gets saved.
import { useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { uploadAudio } from '../../lib/api';
import type { PickedSound } from '../sound/SoundScreen';
import { DEFAULT_DUET_LAYOUT, DuetLayer, type DuetLayout, type DuetSource } from '../duet/DuetLayer';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Icon, type IconName } from '../../components/Icons';
import { notify } from '../../lib/notify';
import { colors } from '../../theme';
import { BeautyCamera, type BeautyCameraHandle } from '../../../modules/gpupixel-camera';
import { BeautyPanel } from '../../components/BeautyPanel';
import { levelsOf, useBeauty } from '../../lib/beautyStore';
import { CameraBlocked } from '../../components/CameraBlocked';
import { DEFAULT_THEME_ID, type MediaEdit } from '../editor/edit';
import { THEMES_105 } from '../editor/themes105';
import type { PostDraft } from './usePosts';

export interface CapturedMedia { kind: PostDraft['kind']; sources: string[]; edit?: MediaEdit }

const MAX_THEME_PHOTOS = 15;
const MAX_VIDEO_SECONDS = 180;
const MIN_VIDEO_MS = 1000;
const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;
const themeFor = (cats: string[]) => THEMES_105.find((t) => cats.includes(t.cat))?.id ?? DEFAULT_THEME_ID;
const THEMES = [
  { key: 'celebrate', name: 'Celebrate', cats: ['ethio_flag'], img: require('../../../assets/themes/theme-celebrate-1.jpg') },
  { key: 'travel', name: 'Travel', cats: ['exaggerated'], img: require('../../../assets/themes/theme-travel-1.jpg') },
  { key: 'neon', name: 'Neon Night', cats: ['nightclub', 'neon_curtain'], img: require('../../../assets/themes/theme-neon-1.jpg') },
  { key: 'soft', name: 'Soft Love', cats: ['heart_visualizer'], img: require('../../../assets/themes/theme-soft-2.jpg') },
];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CreateCamera({ onMedia, onLive, onClose, sound: routeSound, onClearSound, duet, onClearDuet }: {
  onMedia: (m: CapturedMedia) => void; onLive: () => void; onClose: () => void; sound?: PickedSound | null; onClearSound?: () => void;
  duet?: DuetSource | null; onClearDuet?: () => void;
}) {
  const [duetLayout, setDuetLayout] = useState<DuetLayout>(DEFAULT_DUET_LAYOUT);
  const [duetDur, setDuetDur] = useState(0);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [fileSound, setFileSound] = useState<PickedSound | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const sound = routeSound ?? fileSound;
  const silentMic = !!sound || !!duet;
  const music = useAudioPlayer(sound?.url ?? null);
  const musicSt = useAudioPlayerStatus(music);
  const musicReady = !sound || !!musicSt?.isLoaded;
  const pickAudio = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    const a = r.canceled ? null : r.assets?.[0];
    if (!a) return;
    setAudioBusy(true); notify('Uploading audio…');
    try {
      const url = await uploadAudio(a.uri, a.name, (a as unknown as { file?: Blob }).file ?? null);
      setFileSound({ id: '', url, title: a.name });
      notify(`Audio added: ${a.name}`);
    } catch (e) { notify('Audio upload failed', friendlyError(e)); } finally { setAudioBusy(false); }
  };
  const clearSound = () => { if (routeSound) onClearSound?.(); else setFileSound(null); };
  useEffect(() => { try { music.pause(); music.loop = false; } catch { /* noop */ } }, [music]);
  useEffect(() => () => { try { music.pause(); } catch { /* released */ } }, [music]);
  const [perm, askPerm] = useCameraPermissions();
  const [mic, askMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [timer, setTimer] = useState(0);
  const [count, setCount] = useState(0);
  const levels = levelsOf(useBeauty());
  const gpu = useRef<BeautyCameraHandle>(null);
  const [panel, setPanel] = useState<'none' | 'filters' | 'themes'>('none');
  const [mode, setMode] = useState<'picture' | 'video'>(duet ? 'video' : 'picture');
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const phase = useRef<'idle' | 'starting' | 'rec'>('idle');
  const stopWanted = useRef(false);
  const startedAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxSecs = (): number => (duet && duetDur > 0.5 ? Math.min(MAX_VIDEO_SECONDS, duetDur) : sound && music.duration > 0.5 ? Math.min(MAX_VIDEO_SECONDS, music.duration) : MAX_VIDEO_SECONDS);
  const recLen = (): number => Math.min(maxSecs(), (Date.now() - startedAt.current) / 1000);

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); }, []);

  const edit = (extra?: MediaEdit): MediaEdit | undefined => {
    const e = { ...(sound && !duet ? { ...(sound.id ? { soundId: sound.id } : { mix: true, muted: true }), soundUrl: sound.url, soundTitle: sound.title } : {}),
      ...(duet ? { duet: { ...duet, ...duetLayout }, ...(duet.soundId ? { soundId: duet.soundId } : {}) } : {}), ...extra };
    return Object.keys(e).length ? e : undefined;
  };
  const countdown = async () => {
    for (let i = timer; i > 0; i--) { setCount(i); await sleep(1000); }
    setCount(0);
  };

  const takePhoto = async () => {
    if (phase.current !== 'idle') return;
    await countdown();
    try {
      if (!gpu.current) throw new Error('Camera is not ready yet.');
      onMedia({ kind: 'photos', sources: [await gpu.current.takePicture()], edit: edit() });
    } catch (e) { notify('Could not take photo', friendlyError(e)); }
  };

  const finishStop = () => {
    gpu.current?.stop();
  };
  const stopRec = () => {
    if (phase.current === 'starting') { stopWanted.current = true; return; }
    if (phase.current !== 'rec') return;
    setTimeout(finishStop, Math.max(0, MIN_VIDEO_MS - (Date.now() - startedAt.current)));
  };
  const begin = () => {
    phase.current = 'rec';
    if (sound) { music.pause(); void music.seekTo(0).then(() => { if (phase.current === 'rec') music.play(); }); }
    startedAt.current = Date.now();
    setRecording(true); setSecs(0);
    tick.current = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSecs(s);
      if (s >= maxSecs()) finishStop();
    }, 200);
    if (stopWanted.current) stopRec();
  };

  const record = async () => {
    if (!silentMic && !mic?.granted && !(await askMic()).granted) throw new Error('Microphone access was denied. Allow it in Settings to record video.');
    if (!gpu.current) throw new Error('Camera is not ready yet.');
    const p = gpu.current.record(silentMic, Math.ceil(maxSecs()));
    begin();
    const uri = await p;
    onMedia({ kind: 'video', sources: [uri], edit: edit(silentMic ? { soundDuration: recLen() } : undefined) });
  };

  const startRec = async (hold: boolean) => {
    if (phase.current !== 'idle') return;
    phase.current = 'starting';
    stopWanted.current = false;
    try {
      for (let i = 0; i < 50 && sound && !music.isLoaded; i++) await sleep(100);
      if (sound && !music.isLoaded) throw new Error("Audio isn't ready yet — tap Retry or pick it again.");
      if (!hold) await countdown();
      await record();
    } catch (e) {
      notify('Could not record video', friendlyError(e) || 'Please try again.');
    } finally {
      if (tick.current) clearInterval(tick.current);
      tick.current = null;
      phase.current = 'idle';
      stopWanted.current = false;
      setRecording(false); try { music.pause(); } catch { /* noop */ }; setSecs(0);
    }
  };

  const upload = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: MAX_THEME_PHOTOS, quality: 1 });
    if (r.canceled || !r.assets.length) return;
    const vid = r.assets.find((a) => a.type === 'video');
    if (vid) { onMedia({ kind: 'video', sources: [vid.uri], edit: edit() }); return; }
    if (r.assets.length > MAX_THEME_PHOTOS) notify(`Only the first ${MAX_THEME_PHOTOS} photos were used`);
    onMedia({ kind: 'photos', sources: r.assets.slice(0, MAX_THEME_PHOTOS).map((a) => a.uri), edit: edit() });
  };

  const useTheme = async (t: (typeof THEMES)[number]) => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_THEME_PHOTOS, quality: 1 });
    if (r.canceled || !r.assets.length) return;
    if (r.assets.length > MAX_THEME_PHOTOS) notify(`Only the first ${MAX_THEME_PHOTOS} photos were used`);
    onMedia({ kind: 'photos', sources: r.assets.slice(0, MAX_THEME_PHOTOS).map((a) => a.uri), edit: edit({ themeId: themeFor(t.cats), seconds: 2 }) });
  };

  const Side = ({ icon, label, on, onPress, onLongPress }: { icon: IconName; label: string; on?: boolean; onPress: () => void; onLongPress?: () => void }) => (
    <Pressable accessibilityLabel={label} onPress={onPress} onLongPress={onLongPress} style={s.side} disabled={recording && label !== 'Flash'}>
      <View style={[s.sideIc, on && { backgroundColor: colors.primary }]}><Icon name={icon} size={20} color={on ? '#000' : '#fff'} /></View>
      <Text style={s.sideT}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.root}>
      {perm?.granted ? (
<View nativeID="create-camera" style={StyleSheet.absoluteFill}>
          <BeautyCamera ref={gpu} style={StyleSheet.absoluteFill} facing={facing} torch={flash === 'on'} levels={levels} />
        </View>
      ) : (
        <View style={s.perm}>
          <Icon name="camera" size={40} />
          <Text style={s.permT}>Allow camera access to shoot photos and videos</Text>
          <CameraBlocked perm={perm} ask={askPerm} />
          <Text style={s.permS}>You can still Upload, Go Live or use a Theme below.</Text>
        </View>
      )}
      {duet && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {area.w > 0 && <DuetLayer url={duet.url} layout={duetLayout} cw={area.w} ch={area.h} time={recording ? secs : 0} playing={recording}
            onChange={recording ? undefined : setDuetLayout} onDuration={setDuetDur} />}
        </View>
      )}
      <View pointerEvents="none" style={s.scrimTop} />
      <View pointerEvents="none" style={s.scrimBottom} />

      <View style={s.top}>
        <Pressable accessibilityLabel="Close" onPress={onClose} disabled={recording} style={s.close}><Icon name="x" size={22} /></Pressable>
        {recording && <View style={s.rec}><View style={s.recDot} /><Text style={s.recT}>{fmt(secs)} / {fmt(maxSecs())}</Text></View>}
        {sound ? (
          <Pressable testID="camera-sound-chip" onPress={recording ? undefined : clearSound} style={s.soundChip}>
            <Icon name="music" size={13} color="#000" /><Text numberOfLines={1} style={s.soundChipT}>{sound.title}</Text>{!recording && <Icon name="x" size={12} color="#000" />}
          </Pressable>
        ) : duet ? (
          <Pressable testID="camera-duet-chip" onPress={recording ? undefined : onClearDuet} style={s.soundChip}>
            <Icon name="columns" size={13} color="#000" /><Text numberOfLines={1} style={s.soundChipT}>Duet with {handleOf(duet.username)}</Text>{!recording && <Icon name="x" size={12} color="#000" />}
          </Pressable>
        ) : null}
        <View style={{ width: 44 }} />
      </View>

      <View style={s.rail}>
        <Side icon="rotateR" label="Flip" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
        <Side icon={flash === 'off' ? 'flashOff' : 'flash'} label={flash === 'auto' ? 'Auto' : flash === 'on' ? 'Flash on' : 'Flash off'} on={flash !== 'off'} onPress={() => setFlash((v) => (v === 'off' ? 'on' : v === 'on' ? 'auto' : 'off'))} />
        <Side icon="clock" label={timer ? `${timer}s` : 'Timer'} on={!!timer} onPress={() => setTimer((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))} />
        <Side icon="sparkles" label="Beauty" on={panel === 'filters'} onPress={() => setPanel((p) => (p === 'filters' ? 'none' : 'filters'))} />
        {!duet && <Side icon="music" label={audioBusy ? 'Uploading' : sound ? (musicReady ? 'Audio ✓' : 'Loading') : 'Audio'} on={!!sound} onPress={() => (audioBusy ? undefined : void pickAudio())} />}
      </View>

      {count > 0 && <Text style={s.count}>{count}</Text>}

      <View style={s.bottom}>
        {panel === 'filters' && !recording && <BeautyPanel onLive={(l) => gpu.current?.setLevels(l)} />}
        {panel === 'themes' && !recording && (
          <View>
            <Text style={s.themeH}>Pick a theme, then up to {MAX_THEME_PHOTOS} photos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
              {THEMES.map((t) => (
                <Pressable key={t.key} onPress={() => void useTheme(t)} style={s.theme} accessibilityLabel={`Theme ${t.name}`}>
                  <Image source={t.img} style={s.themeImg} />
                  <Text style={s.themeT}>{t.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        {!recording && !duet && (
          <View style={s.modes}>
            {(['picture', 'video'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={s.modeBtn}><Text style={[s.mode, mode === m && s.modeOn]}>{m === 'picture' ? 'Photo' : 'Video'}</Text></Pressable>
            ))}
          </View>
        )}
        <View style={s.row}>
          <Pressable accessibilityLabel="Upload" onPress={() => void upload()} disabled={recording || !!duet} style={[s.act, (recording || !!duet) && { opacity: 0 }]}>
            <View style={s.actIc}><Icon name="image" size={22} /></View><Text style={s.actT}>Upload</Text>
          </Pressable>
          <Pressable accessibilityLabel={recording ? 'Stop recording' : mode === 'video' ? 'Record video' : 'Take photo'} disabled={!perm?.granted}
            delayLongPress={300}
            onPress={() => { if (recording) stopRec(); else if (mode === 'video') void startRec(false); else void takePhoto(); }}
            onLongPress={() => { if (mode === 'picture') void startRec(true); }}
            onPressOut={() => { if (mode === 'picture' && phase.current !== 'idle') stopRec(); }}
            style={[s.shutter, !perm?.granted && { opacity: 0.4 }]}>
            <Svg width={96} height={96} style={StyleSheet.absoluteFill}>
              <Circle cx={48} cy={48} r={RING_R} stroke={recording ? 'rgba(255,255,255,0.35)' : '#fff'} strokeWidth={5} fill="none" />
              {recording && (
                <Circle cx={48} cy={48} r={RING_R} stroke="#FF2D55" strokeWidth={5} fill="none" strokeLinecap="round"
                  strokeDasharray={`${RING_C}`} strokeDashoffset={RING_C * (1 - Math.min(1, secs / maxSecs()))} transform="rotate(-90 48 48)" />
              )}
            </Svg>
            <View style={[s.shutterIn, mode === 'video' && s.shutterRec, recording && s.shutterStop]} />
          </Pressable>
          <Pressable accessibilityLabel="Go Live" onPress={onLive} disabled={recording} style={[s.act, recording && { opacity: 0 }]}>
            <View style={[s.actIc, { backgroundColor: '#FF2D55' }]}><Icon name="radio" size={22} /></View><Text style={s.actT}>Go Live</Text>
          </Pressable>
        </View>
        <Text style={s.hint}>{recording ? 'Recording… tap / release to stop' : mode === 'video' ? 'Tap to start · tap again to stop' : 'Tap for photo · hold to record'}</Text>
      </View>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };
const s = StyleSheet.create({
  soundChip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 200, backgroundColor: '#FFA500', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  soundChipT: { color: '#000', fontWeight: '800', fontSize: 12, flexShrink: 1 },
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 50 },
  perm: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  permT: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  permS: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 13 },
  permBtn: { backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 22, paddingVertical: 11 },
  permBtnT: { color: '#000', fontWeight: '900' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 130, backgroundColor: 'rgba(0,0,0,0.28)' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 230, backgroundColor: 'rgba(0,0,0,0.32)' },
  top: { position: 'absolute', top: 44, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF2D55' },
  recT: { color: '#fff', fontWeight: '800' },
  rail: { position: 'absolute', right: 10, top: 104, gap: 14, alignItems: 'center' },
  side: { alignItems: 'center', gap: 3, minWidth: 48 },
  sideIc: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  sideT: { color: '#fff', fontSize: 11, fontWeight: '700', ...shadow },
  count: { position: 'absolute', alignSelf: 'center', top: '38%', color: '#fff', fontSize: 96, fontWeight: '900', ...shadow },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 28 },
  strip: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)' },
  chipOn: { backgroundColor: colors.primary },
  chipT: { color: '#fff', fontWeight: '800', fontSize: 13 },
  themeH: { color: '#fff', fontWeight: '700', fontSize: 12, paddingHorizontal: 16, paddingTop: 6, ...shadow },
  theme: { width: 84, alignItems: 'center', gap: 4 },
  themeImg: { width: 84, height: 120, borderRadius: 10, borderWidth: 2, borderColor: colors.primary },
  themeT: { color: '#fff', fontSize: 12, fontWeight: '800', ...shadow },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 4 },
  modeBtn: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  mode: { color: 'rgba(255,255,255,0.6)', fontWeight: '800', ...shadow },
  modeOn: { color: '#fff', textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 20 },
  act: { alignItems: 'center', gap: 4, width: 70 },
  actIc: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  actT: { color: '#fff', fontSize: 12, fontWeight: '700', ...shadow },
  shutter: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff' },
  shutterRec: { backgroundColor: '#FF2D55' },
  shutterStop: { width: 32, height: 32, borderRadius: 7, backgroundColor: '#FF2D55' },
  hint: { color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontSize: 12, marginTop: 6, ...shadow },
});
