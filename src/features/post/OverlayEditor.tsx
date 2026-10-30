import { friendlyError } from '../../lib/errors';
// Full-screen overlay editor: media fills the screen, tools stack on the right edge, each opens a translucent
// bottom panel with live preview (✓ keep / ✕ revert). Swipe = next filter. Next → Details sheet → Post.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { notify } from '../../lib/notify';
import { useAudible } from '../../lib/media';
import { uploadAudio } from '../../lib/api';
import { MAX_GAIN, retryAudio, useAudioDebug } from '../../lib/slideAudio';
import { useSlideshowAudio } from '../../lib/slideAudio';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { showConfirm } from '../../components/DialogHost';
import { Icon, type IconName } from '../../components/Icons';
import { RichTextInput, richToPlain } from '../../components/RichText';
import { colors } from '../../theme';
import { DEFAULT_THEME_ID, SLIDE_SECONDS, VIDEO_SPEEDS, type MediaEdit } from '../editor/edit';
import { AdjustPanel, Chip, EditedFrame, TextPanel } from '../editor/EditTools';
import { CropPanel, OverlayPanel, StickersPanel, TransitionPanel, useOverlays } from '../editor/ObjTools';
import { VideoTimeline } from '../editor/Timeline';
import { EditedVideo } from '../editor/PostMedia';
import { catLabel, THEME105_CATS, THEMES_105 } from '../editor/themes105';
import { Theme105Stage } from '../editor/themes105/Theme105Stage';
import { DEFAULT_PUBLISH_OPTIONS, parseSchedule, PostOptionsPanel, scheduleError } from './PostOptions';
import type { PostDraft } from './usePosts';

type Tool = 'theme' | 'duration' | 'filters' | 'adjust' | 'trim' | 'crop' | 'fx' | 'speed' | 'text' | 'stickers' | 'overlay' | 'audio';
type ToolDef = { k: Tool; label: string; icon: IconName };
const PHOTO_TOOLS: ToolDef[] = [
  { k: 'theme', label: 'Themes', icon: 'palette' }, { k: 'audio', label: 'Audio', icon: 'music' }, { k: 'duration', label: 'Timing', icon: 'wand' },
  { k: 'adjust', label: 'Adjust', icon: 'sliders' },
  { k: 'crop', label: 'Crop', icon: 'crop' }, { k: 'text', label: 'Text', icon: 'type' },
  { k: 'stickers', label: 'Stickers', icon: 'smile' }, { k: 'overlay', label: 'Overlay', icon: 'layers' },
];
const VIDEO_TOOLS: ToolDef[] = [
  { k: 'adjust', label: 'Adjust', icon: 'sliders' },
  { k: 'trim', label: 'Edit', icon: 'scissors' }, { k: 'crop', label: 'Crop', icon: 'crop' },
  { k: 'fx', label: 'Transition', icon: 'wand' }, { k: 'speed', label: 'Speed', icon: 'gauge' },
  { k: 'text', label: 'Text', icon: 'type' }, { k: 'stickers', label: 'Stickers', icon: 'smile' },
  { k: 'overlay', label: 'Overlay', icon: 'layers' }, { k: 'audio', label: 'Sound', icon: 'music' },
];
const MAX_PHOTOS = 15;
const SPEED_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
const SPEED_MIN = 0.5;
const SPEED_MAX = 5;

/** Thin draggable slideshow speed slider (0.5x–5x). */
function SpeedSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const pct = Math.max(0, Math.min(1, (value - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)));
  const at = (x: number) => {
    if (!w) return;
    const p = Math.max(0, Math.min(1, x / w));
    onChange(Math.round((SPEED_MIN + p * (SPEED_MAX - SPEED_MIN)) * 10) / 10);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name="gauge" size={14} />
      <View testID="speed-slider" style={{ flex: 1, height: 28, justifyContent: 'center' }}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => at(e.nativeEvent.locationX)}
        onResponderMove={(e) => at(e.nativeEvent.locationX)}>
        <View pointerEvents="none" style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' }}>
          <View style={{ width: `${pct * 100}%`, height: 3, borderRadius: 2, backgroundColor: colors.primary }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: pct * w - 8, width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' }} />
      </View>
      <Text style={{ color: '#fff', fontSize: 12, width: 34, textAlign: 'right' }}>{value.toFixed(1)}x</Text>
    </View>
  );
}

function confirmDiscard(onYes: () => void) {
  void showConfirm({ title: 'Discard edits?', message: 'Discard edits and go back to the camera?', ok: 'Discard', cancel: 'Keep editing', destructive: true })
    .then((y) => { if (y) onYes(); });
}

export function OverlayEditor({ post, update, busy, progress, onBack, onPublish, onDraft }: {
  post: PostDraft;
  update: (fn: (p: PostDraft) => PostDraft) => void;
  busy: boolean;
  progress: number | null;
  onBack: () => void;
  onPublish: (scheduleAt?: PostDraft['scheduleAt']) => void;
  onDraft: (scheduleAt?: PostDraft['scheduleAt']) => void;
}) {
  // Measure the app frame (maxWidth 430), not the browser window: on wide web screens the window is wider
  // than the frame, which made the media overflow to the left under correctly-placed overlay icons.
  const [box, setBox] = useState({ w: 0, h: 0 });
  const W = box.w, H = box.h;
  const isVideo = post.kind === 'video';
  const edit: MediaEdit = { ...(isVideo ? { speed: 1 } : { themeId: DEFAULT_THEME_ID, seconds: 2 }), ...post.edit };
  const set = (p: Partial<MediaEdit>) => update((x) => ({ ...x, edit: { ...x.edit, ...p } }));
  const [tool, setTool] = useState<Tool | null>(null);
  const [snap, setSnap] = useState<MediaEdit | undefined>();
  const [step, setStep] = useState(0);
  const details = step > 0;
  const setDetails = (v: boolean) => setStep(v ? 1 : 0);
  const [sel, setSel] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(0);
  const [fxDur, setFxDur] = useState(0.8);
  const [toast, setToast] = useState('');
  const [pv, setPv] = useState({ w: 0, h: 0 });
  const [cat, setCat] = useState(THEMES_105.find((t) => t.id === edit.themeId)?.cat ?? THEME105_CATS[0]);
  const touch = useRef({ x: 0, y: 0 });
  const ov = useOverlays(edit, set, sel, setSel, now, dur);
  const tools = isVideo ? VIDEO_TOOLS : PHOTO_TOOLS;
  const [active, setActive] = useState(0);
  const act = Math.min(active, Math.max(0, post.sources.length - 1));
  const ordered = isVideo ? post.sources : [...post.sources.slice(act), ...post.sources.slice(0, act)];
  const setSources = (fn: (src: string[]) => string[]) => update((x) => ({ ...x, sources: fn(x.sources) }));
  const removeAt = (i: number) => {
    if (post.sources.length <= 1) { notify('At least one photo is required'); return; }
    setSources((src) => src.filter((_, j) => j !== i));
    if (act >= i && act > 0) setActive(act - 1);
  };
  const copyAt = (i: number) => {
    if (post.sources.length >= MAX_PHOTOS) { notify(`Up to ${MAX_PHOTOS} photos`); return; }
    setSources((src) => [...src.slice(0, i + 1), src[i], ...src.slice(i + 1)]);
  };
  const addPhotos = async () => {
    const room = MAX_PHOTOS - post.sources.length;
    if (room <= 0) { notify(`Up to ${MAX_PHOTOS} photos`); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
    if (r.canceled || !r.assets.length) return;
    if (r.assets.length > room) notify(`Only ${room} more photo(s) could be added`);
    setSources((src) => [...src, ...r.assets.slice(0, room).map((a) => a.uri)]);
  };
  const pickAudio = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    // Upload right away so the editor, preview, feed and "Use this sound" all play the same https file
    // (the path that already works for sounds taken from feed videos).
    const info = { name: a.name, size: a.size ?? 0, mime: a.mimeType || '(empty)' };
    setPick({ ...info, upload: 'uploading…' });
    notify('Uploading audio…');
    try {
      const url = await uploadAudio(a.uri, a.name, (a as { file?: Blob }).file ?? null);
      set(isVideo ? { soundUrl: url, soundTitle: a.name, soundId: undefined, soundDuration: undefined, mix: true, soundVolume: edit.soundVolume ?? 1 }
        : { soundUrl: url, soundTitle: a.name, soundId: undefined, muted: false });
      setAudioPaused(false);
      setPick({ ...info, upload: 'ok', https: /^https:/.test(url) });
      notify(`Audio added: ${a.name}`);
    } catch (e) {
      setPick({ ...info, upload: `error: ${friendlyError(e)}` });
      notify('Audio upload failed', friendlyError(e));
    }
  };
  const [pick, setPick] = useState<{ name: string; size: number; mime: string; upload: string; https?: boolean } | null>(null);
  const dbg = useAudioDebug(!!pick);
  const audioUrl = !isVideo ? edit.soundUrl ?? null : null;
  const [audioPaused, setAudioPaused] = useState(false);
  const audioMuted = !isVideo && !!edit.muted;
  // Plays in the editor (incl. fullscreen) and the final post preview; silent on caption/audience steps.
  const showing = !details || step === 3;
  const audible = useAudible(!!audioUrl && !audioPaused && showing);
  const sound = useSlideshowAudio(audioUrl, audible, audioMuted, edit.soundVolume ?? 1, false);
  // One clock for photos + sound: total = photos × seconds; the sound restarts with the first photo.
  const clock = useRef(0);
  const slideDur = Math.max(0.3, edit.seconds ?? 2) * Math.max(1, post.sources.length);
  const soundRef = useRef(sound); soundRef.current = sound;
  useEffect(() => {
    if (isVideo) return undefined;
    clock.current = 0; soundRef.current.seek(0);
    let prev = Date.now();
    const t = setInterval(() => {
      const n = Date.now();
      let next = clock.current + (n - prev) / 1000; prev = n;
      // Sound = master clock (photos follow it); no drift seeks during playback, one seek per loop.
      const at = soundRef.current.time();
      if (at >= 0 && at < slideDur && Math.abs(at - next) > 0.15 && Math.abs(at - next) < 2) next = at;
      if (next >= slideDur) { soundRef.current.seek(0); next %= slideDur; }
      clock.current = next;
    }, 50);
    return () => clearInterval(t);
  }, [isVideo, slideDur, audioUrl, act]);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const open = (t: Tool) => { setSnap(post.edit); setTool(t); };
  const keep = () => setTool(null);
  const revert = () => { update((x) => ({ ...x, edit: snap })); setTool(null); setSel(null); };
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 900); };

  const editable = {
    selected: sel,
    onSelect: (id: string | null) => {
      setSel(id);
      const o = ov.list.find((x) => x.id === id);
      if (o) open(o.kind === 'media' ? 'overlay' : 'stickers');
    },
    onMove: (id: string, x: number, y: number) => ov.patch(id, { x, y }),
    crop: tool === 'crop' ? (r: NonNullable<MediaEdit['cropRect']>) => set({ cropRect: r, crop: undefined }) : undefined,
  };
  const swipe = (dx: number, dy: number) => {
    if (tool || details || sel || Math.abs(dy) > 60) return;
    if (!isVideo) {
      if (Math.abs(dx) < 30) return;
      const cur = 2 / (edit.seconds ?? 2);
      const i = SPEED_STEPS.reduce((b, v, j) => (Math.abs(v - cur) < Math.abs(SPEED_STEPS[b] - cur) ? j : b), 0);
      const n = Math.max(0, Math.min(SPEED_STEPS.length - 1, i + (dx > 0 ? 1 : -1) * Math.max(1, Math.round(Math.abs(dx) / 80))));
      set({ seconds: Math.round((2 / SPEED_STEPS[n]) * 100) / 100 });
      flash(`Speed ${SPEED_STEPS[n]}x`);
      return;
    }
  };

  const opts = post.options ?? DEFAULT_PUBLISH_OPTIONS;
  const schedErr = scheduleError(opts);
  const scheduleAt = parseSchedule(opts.scheduleAt) ?? undefined;
  const captionOk = post.caption.trim().length > 0 && !schedErr;
  const label = tools.find((t) => t.k === tool)?.label;

  return (
    <View style={st.root} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width !== W || height !== H) setBox({ w: width, h: height }); }}>
      {W > 0 && <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }]}
        onTouchStart={(e) => { touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; }}
        onTouchEnd={(e) => swipe(e.nativeEvent.pageX - touch.current.x, e.nativeEvent.pageY - touch.current.y)}>
        {isVideo ? (
          <EditedVideo sound active={!details} seekTo={seekTo} uri={post.sources[0]} edit={edit} width={W} height={H} editable={editable}
            onProgress={(n, d) => { setNow(n); if (d && d !== dur) setDur(d); }} />
        ) : (
          <EditedFrame edit={edit} width={W} height={H} editable={editable}>
            <Theme105Stage sources={ordered} themeId={edit.themeId ?? DEFAULT_THEME_ID} seconds={edit.seconds ?? 2} width={Math.max(W, (H * 720) / 1280)} playing clock={clock} />
          </EditedFrame>
        )}
      </View>}
      <View pointerEvents="none" style={st.scrimTop} />
      <View pointerEvents="none" style={st.scrimBottom} />

      <View style={st.top}>
        <Pressable accessibilityLabel="Back to camera" onPress={() => confirmDiscard(onBack)} style={st.round}><Icon name="back" size={20} /></Pressable>
        <Text style={st.title}>{isVideo ? 'Edit video' : post.sources.length > 1 ? `Edit · ${post.sources.length} photos` : 'Edit photo'}</Text>
        {isVideo ? (
          <Pressable accessibilityLabel="Sound" onPress={() => open('audio')} style={st.round}><Icon name={edit.muted ? 'mute' : 'volume'} size={18} /></Pressable>
        ) : (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          {!!audioUrl && (
            <Pressable testID="audio-badge" accessibilityLabel={audioMuted ? 'Unmute audio' : 'Mute audio'} onPress={() => set({ muted: !edit.muted })} style={st.speed}>
              <Icon name={audioMuted || audioPaused ? 'mute' : 'volume'} size={14} />
              <Text style={st.speedT} numberOfLines={1}>{(edit.soundTitle ?? 'Audio').slice(0, 12)}</Text>
            </Pressable>
          )}
          <View testID="speed-indicator" style={st.speed}><Icon name="gauge" size={14} /><Text style={st.speedT}>{Math.round(20 / (edit.seconds ?? 2)) / 10}x</Text></View>
          </View>
        )}
      </View>
      {!!toast && <View pointerEvents="none" style={st.toast}><Text style={st.toastT}>{toast}</Text></View>}

      {!tool && !details && (
        <ScrollView style={[st.rail, { maxHeight: H - 230 }]} contentContainerStyle={{ gap: 10, paddingVertical: 4 }} showsVerticalScrollIndicator={false}>
          {tools.map((t) => (
            <Pressable key={t.k} accessibilityLabel={t.label} onPress={() => open(t.k)} style={st.side}>
              <View style={st.sideIc}><Icon name={t.icon} size={20} /></View>
              <Text style={st.sideT}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {tool && (
        <View style={[st.panel, { maxHeight: H * 0.46 }]}>
          <View style={st.panelHead}>
            <Pressable accessibilityLabel="Cancel" onPress={revert} style={st.round}><Icon name="x" size={18} /></Pressable>
            <Text style={st.panelT}>{label}</Text>
            <Pressable accessibilityLabel="Apply" onPress={keep} style={[st.round, { backgroundColor: colors.primary }]}><Icon name="check" size={18} color="#000" strokeWidth={3} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {tool === 'theme' && (<>
              <SpeedSlider value={2 / (edit.seconds ?? 2)} onChange={(v) => set({ seconds: Math.round((2 / v) * 100) / 100 })} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {THEME105_CATS.map((c) => <Chip key={c} on={cat === c} label={catLabel(c)} onPress={() => setCat(c)} />)}
              </ScrollView>
              <FlatList horizontal data={THEMES_105.filter((t) => t.cat === cat)} keyExtractor={(t) => String(t.id)} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}
                renderItem={({ item }) => (
                  <Pressable onPress={() => set({ themeId: item.id })} style={[st.theme, edit.themeId === item.id && st.themeOn]}>
                    <Text style={st.themeId}>#{item.id}</Text>
                    <Text style={st.themeName} numberOfLines={2}>{item.name}</Text>
                  </Pressable>
                )} />
            </>)}
            {tool === 'duration' && <View style={st.row}>{SLIDE_SECONDS.map((sec) => <Chip key={sec} on={edit.seconds === sec} label={`${sec}s / photo`} onPress={() => set({ seconds: sec })} />)}</View>}
            {tool === 'adjust' && <AdjustPanel edit={edit} set={set} />}
            {tool === 'crop' && <CropPanel edit={edit} set={set} isVideo={isVideo} frame={{ w: W, h: H }} />}
            {tool === 'text' && <TextPanel edit={edit} set={set} />}
            {tool === 'stickers' && <StickersPanel ov={ov} />}
            {tool === 'overlay' && <OverlayPanel ov={ov} isVideo={isVideo} />}
            {tool === 'fx' && <TransitionPanel edit={edit} set={set} time={now} dur={dur} fxDur={fxDur} setFxDur={setFxDur} />}
            {tool === 'speed' && <View style={st.row}>{VIDEO_SPEEDS.map((v) => <Chip key={v} on={(edit.speed ?? 1) === v} label={`${v}x`} onPress={() => set({ speed: v })} />)}</View>}
            {tool === 'trim' && <VideoTimeline dur={dur} now={now} edit={edit} set={set} onSeek={(t) => setSeekTo(t + Math.random() * 1e-4)} />}
            {tool === 'audio' && !isVideo && (
              <View style={st.row}>
                <Chip on={false} label={edit.soundUrl ? 'Change audio' : 'Choose audio file'} onPress={() => void pickAudio()} />
                {!!edit.soundUrl && <Chip on label={`♪ ${edit.soundTitle ?? 'Audio'}`} onPress={() => setAudioPaused((p) => !p)} />}
                {!!edit.soundUrl && <Chip on={!audioPaused} label={audioPaused ? 'Play' : 'Pause'} onPress={() => setAudioPaused((p) => !p)} />}
                {!!edit.soundUrl && <Chip on={audioMuted} label={audioMuted ? 'Unmute' : 'Mute'} onPress={() => set({ muted: !edit.muted })} />}
                {!!edit.soundUrl && <Chip on={false} label="Remove" onPress={() => set({ soundUrl: undefined, soundTitle: undefined, soundId: undefined })} />}
              </View>
            )}
            {tool === 'audio' && !isVideo && !!edit.soundUrl && <VolumeSwipe label="Audio" value={edit.soundVolume ?? 1} onChange={(v) => set({ soundVolume: v })} />}
            {tool === 'audio' && isVideo && (
              <View style={st.row}>
                <Chip on={!!edit.muted} label={edit.muted ? 'Unmute original' : 'Mute original'} onPress={() => set({ muted: !edit.muted })} />
                <Chip on={false} label={edit.soundUrl && edit.mix ? 'Change audio' : 'Add audio file'} onPress={() => void pickAudio()} />
                {!!edit.soundUrl && edit.mix && <Chip on label={`♪ ${edit.soundTitle ?? 'Audio'}`} onPress={() => undefined} />}
                {!!edit.soundUrl && edit.mix && <Chip on={false} label="Remove" onPress={() => set({ soundUrl: undefined, soundTitle: undefined, mix: undefined, soundVolume: undefined })} />}
              </View>
            )}
            {tool === 'audio' && isVideo && <VolumeSwipe label="Original" value={edit.muted ? 0 : edit.volume ?? 1} onChange={(v) => set({ volume: v, muted: v === 0 })} />}
            {tool === 'audio' && isVideo && !!edit.soundUrl && edit.mix && <VolumeSwipe label="Added" value={edit.soundVolume ?? 1} onChange={(v) => set({ soundVolume: v })} />}
            {tool === 'audio' && !!pick && (
              <Text testID="audio-debug" style={[st.muted, { marginTop: 8 }]}>
                {`${pick.name} · ${pick.size} B · ${pick.mime} · upload ${pick.upload}${pick.https !== undefined ? ` · https ${pick.https ? 'yes' : 'NO'}` : ''} · player ${dbg.state}${dbg.error ? ` (${dbg.error})` : ''} · ${dbg.t.toFixed(1)}s${dbg.gain !== undefined ? ` · gain ${dbg.gain.toFixed(2)}` : ''}`}
              </Text>
            )}
            {tool === 'audio' && !!pick && (dbg.state === 'error' || dbg.state === 'blocked') && (
              <Pressable testID="audio-retry" onPress={retryAudio} style={{ marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#FFA500' }}>
                <Text style={{ color: '#000', fontWeight: '800' }}>{dbg.state === 'error' ? "Can't play this file — Retry" : 'Tap to play — Retry'}</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}

      {!tool && !details && (
        <View style={st.bottomWrap}>
          {!isVideo && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.strip} testID="photo-strip">
              {post.sources.map((u, i) => (
                <Pressable key={`${u}-${i}`} accessibilityLabel={`Photo ${i + 1}`} onPress={() => setActive(i)} style={[st.thumb, i === act && st.thumbOn]}>
                  <Image source={{ uri: u }} style={st.thumbImg} />
                  <Pressable accessibilityLabel="Remove photo" hitSlop={6} onPress={() => removeAt(i)} style={[st.tBtn, { right: 2 }]}><Icon name="x" size={11} /></Pressable>
                  <Pressable accessibilityLabel="Duplicate photo" hitSlop={6} onPress={() => copyAt(i)} style={[st.tBtn, { left: 2 }]}><Icon name="copy" size={11} /></Pressable>
                </Pressable>
              ))}
              {post.sources.length < MAX_PHOTOS && (
                <Pressable accessibilityLabel="Add photo" onPress={() => void addPhotos()} style={[st.thumb, st.add]}>
                  <Icon name="plus" size={20} /><Text style={st.addT}>Add photo</Text>
                </Pressable>
              )}
            </ScrollView>
          )}
          <View style={st.bottom}>
          <Pressable onPress={() => onDraft(scheduleAt)} disabled={busy} style={st.draft}><Text style={st.draftT}>Save draft</Text></Pressable>
          <Pressable onPress={() => { setSel(null); setDetails(true); }} style={st.next}><Text style={st.nextT}>Next</Text></Pressable>
          </View>
        </View>
      )}

      {details && (
        <View style={[StyleSheet.absoluteFill, st.flow]}>
          <View style={st.flowHead}>
            <Pressable accessibilityLabel="Back" disabled={busy} onPress={() => setStep(step - 1)} style={st.round}><Icon name="back" size={20} /></Pressable>
            <Text style={st.title}>{['', 'Caption & cover', 'Audience & schedule', 'Preview'][step]}</Text>
            <Text style={st.stepT}>{step}/3</Text>
          </View>
          <View style={st.dots}>{[1, 2, 3].map((i) => <View key={i} style={[st.dot, i <= step && { backgroundColor: colors.primary }]} />)}</View>
          {step < 3 ? (
            <ScrollView key={step} contentContainerStyle={{ gap: 12, padding: 16 }} keyboardShouldPersistTaps="handled">
              {step === 1 && (<>
                <View style={st.miniPv}>
                  {post.options?.thumbnail || !isVideo ? (
                    <Text style={st.muted}>{post.sources.length} item(s)</Text>
                  ) : null}
                  <View style={{ width: 90, height: 160, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' }}>
                    {isVideo ? <EditedVideo silent uri={post.sources[0]} edit={edit} width={90} height={160} />
                      : <EditedFrame edit={edit} width={90} height={160}><Theme105Stage sources={ordered} themeId={edit.themeId ?? DEFAULT_THEME_ID} seconds={edit.seconds ?? 2} width={90} playing /></EditedFrame>}
                  </View>
                </View>
                <RichTextInput label="Caption" multiline value={post.captionHtml ?? post.caption} placeholder="Write a caption… #tags @mentions"
                  onChange={(h) => update((x) => ({ ...x, captionHtml: h, caption: richToPlain(h) }))} />
                {!post.caption.trim() && <Text style={st.muted}>Add a caption to post.</Text>}
                <PostOptionsPanel part="cover" value={opts} onChange={(o) => update((x) => ({ ...x, options: o }))} captionHtml={post.captionHtml ?? post.caption}
                  images={isVideo ? undefined : post.sources} />
              </>)}
              {step === 2 && <PostOptionsPanel part="audience" value={opts} onChange={(o) => update((x) => ({ ...x, options: o }))} captionHtml={post.captionHtml ?? post.caption} />}
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>
              <View testID="final-preview-area" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 10 }}
                onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (w !== pv.w || h !== pv.h) setPv({ w, h }); }}>
                {pv.w > 0 && (() => {
                  // Same frame (W×H) as the editor and feed, uniformly scaled to fit — nothing cut, nothing covered.
                  const k = Math.min(pv.w / W, (pv.h - 10) / H);
                  return (
                    <View testID="final-preview" style={{ width: W * k, height: H * k, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
                      <View style={{ position: 'absolute', width: W, height: H, left: (W * k - W) / 2, top: (H * k - H) / 2, transform: [{ scale: k }] }}>
                        {isVideo ? <EditedVideo sound uri={post.sources[0]} edit={edit} width={W} height={H} />
                          : <EditedFrame edit={edit} width={W} height={H}><Theme105Stage sources={ordered} themeId={edit.themeId ?? DEFAULT_THEME_ID} seconds={edit.seconds ?? 2} width={Math.max(W, (H * 720) / 1280)} playing clock={clock} /></EditedFrame>}
                      </View>
                    </View>
                  );
                })()}
              </View>
              <View style={st.pvCap}>
                <Text style={[st.title, { fontSize: 14 }]} numberOfLines={2}>{post.caption}</Text>
                <Text style={st.muted}>{scheduleAt ? `Scheduled · ${opts.scheduleAt}` : 'Posts now'}</Text>
              </View>
            </View>
          )}
          <View style={st.flowFoot}>
            {progress !== null && <View style={st.track}><View style={[st.fill, { width: `${progress}%` }]} /></View>}
            {step < 3 ? (
              <Pressable disabled={(step === 1 && !post.caption.trim()) || (step === 2 && !!schedErr)} onPress={() => setStep(step + 1)}
                style={[st.next, ((step === 1 && !post.caption.trim()) || (step === 2 && !!schedErr)) && { opacity: 0.45 }]}><Text style={st.nextT}>Next</Text></Pressable>
            ) : (
              <Pressable disabled={!captionOk || busy} onPress={() => onPublish(scheduleAt)} style={[st.next, (!captionOk || busy) && { opacity: 0.45 }]}>
                {busy ? <ActivityIndicator color="#000" /> : <Text style={st.nextT}>{scheduleAt ? 'Schedule' : 'Post'}{progress !== null ? ` · ${progress}%` : ''}</Text>}
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  flow: { backgroundColor: '#0c0c0c', zIndex: 20 },
  flowHead: { paddingTop: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepT: { color: colors.primary, fontWeight: '900', width: 44, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 10 },
  dot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  miniPv: { alignItems: 'center', gap: 6 },
  pvCap: { paddingHorizontal: 16, paddingTop: 8, gap: 2 },
  flowFoot: { padding: 16, paddingBottom: 28, gap: 8 },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, backgroundColor: 'rgba(0,0,0,0.3)' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, backgroundColor: 'rgba(0,0,0,0.3)' },
  top: { position: 'absolute', top: 44, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontWeight: '800', fontSize: 15, ...shadow },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', top: '42%', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18 },
  toastT: { color: '#fff', fontWeight: '900', fontSize: 18 },
  rail: { position: 'absolute', right: 8, top: 100 },
  side: { alignItems: 'center', gap: 2, minWidth: 54 },
  sideIc: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  sideT: { color: '#fff', fontSize: 11, fontWeight: '700', ...shadow },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,12,12,0.82)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, paddingBottom: 26, gap: 10 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelT: { color: '#fff', fontWeight: '900', fontSize: 15 },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 28, gap: 10 },
  bottom: { marginHorizontal: 16, flexDirection: 'row', gap: 10, alignItems: 'center' },
  strip: { gap: 8, paddingHorizontal: 16 },
  thumb: { width: 54, height: 72, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(0,0,0,0.5)' },
  thumbOn: { borderColor: colors.primary },
  thumbImg: { width: '100%', height: '100%' },
  tBtn: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  add: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.6)', gap: 2 },
  addT: { color: '#fff', fontSize: 9, fontWeight: '800', textAlign: 'center' },
  speed: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 44, height: 32, paddingHorizontal: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' },
  speedT: { color: '#fff', fontWeight: '900', fontSize: 12 },
  draft: { minHeight: 48, paddingHorizontal: 18, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  draftT: { color: '#fff', fontWeight: '800' },
  next: { flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: colors.primary, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  nextT: { color: '#000', fontWeight: '900', fontSize: 16 },
  sheet: { backgroundColor: 'rgba(16,16,16,0.94)', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 28, gap: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  theme: { width: 92, height: 64, borderRadius: 12, padding: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 2, borderColor: 'transparent' },
  themeOn: { borderColor: colors.primary },
  themeId: { color: colors.primary, fontWeight: '900', fontSize: 11 },
  themeName: { color: '#fff', fontSize: 11, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
});

/** Label + % above a thin draggable bar; 0–200%, 100% default (marked). */
function VolumeSwipe({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(1);
  const at = (x: number) => Math.round(Math.max(0, Math.min(1, x / w)) * MAX_GAIN * 100) / 100;
  const pct = Math.round(value * 100);
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginBottom: 6 }}>{`${label} · ${pct}%`}</Text>
      <View testID={`vol-${label}`} accessibilityLabel={`${label} volume ${pct}%`} onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => onChange(at(e.nativeEvent.locationX))} onResponderMove={(e) => onChange(at(e.nativeEvent.locationX))}
        style={{ height: 22, justifyContent: 'center' }}>
        <View pointerEvents="none" style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' }}>
          <View style={{ height: 3, borderRadius: 2, width: `${(value / MAX_GAIN) * 100}%`, backgroundColor: '#FFA500' }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: '50%', width: 1, height: 9, backgroundColor: 'rgba(255,255,255,0.6)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: `${(value / MAX_GAIN) * 100}%`, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' }} />
      </View>
    </View>
  );
}
