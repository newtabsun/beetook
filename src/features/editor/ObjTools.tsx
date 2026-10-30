// Web MediaEditor parity tools: Crop (rotate/flip/inset), Transition (timed FX), Stickers, Overlay (photo/video/GIF).
import * as ImagePicker from 'expo-image-picker';
import { TRANSITIONS, transitionFrame } from './motion';
import { createElement, useRef, type ReactNode } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../../components/Icons';
import { colors } from '../../theme';
import { NO_CROP, uid, type MediaEdit, type ObjOverlay, type VideoFx } from './edit';
import { Chip } from './EditTools';

type Set = (patch: Partial<MediaEdit>) => void;

export const EMOJI_STICKERS = ['🔥', '❤️', '😂', '😍', '✨', '🎉', '👑', '🐝', '🌹', '💯', '😎', '🥳', '🌟', '💛', '🎵', '📍'];

const grad = (a: string): TextStyle => ({ color: a, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 6 });
const script = (a: string): TextStyle => ({ ...grad(a), fontStyle: 'italic', fontFamily: Platform.OS === 'web' ? 'cursive' : undefined });
const neon = (c: string): TextStyle => ({ color: '#fff', textShadowColor: c, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14 });
const outline = (c: string, fill = '#fff'): TextStyle => ({ color: fill, textShadowColor: c, textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 1 });
const bubble = (bg: string, fg = '#fff'): TextStyle => ({ backgroundColor: bg, color: fg, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' });
const tag = (bg: string, fg = '#fff'): TextStyle => ({ backgroundColor: bg, color: fg, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 8, overflow: 'hidden', transform: [{ rotate: '-4deg' }] });

export const TEXT_STICKERS: { id: string; text: string; style: TextStyle }[] = [
  { id: 'love', text: 'Love', style: script('#FF4FD8') }, { id: '2026', text: '2026', style: grad('#FFB000') },
  { id: 'congrats', text: 'Congratulations', style: script('#FFD400') }, { id: 'live', text: '● LIVE', style: bubble('#FF2D55') },
  { id: 'great', text: 'Great!', style: outline('#FFA500') }, { id: 'beetook', text: 'Bee Took 🐝', style: bubble('#FFA500', '#000') },
  { id: 'bday', text: 'Happy Birthday', style: script('#00F0FF') }, { id: 'wow', text: 'WOW', style: neon('#FF4FD8') },
  { id: 'omg', text: 'OMG!', style: tag('#FFD400', '#000') }, { id: 'thanks', text: 'Thank You', style: script('#22FF88') },
  { id: 'best', text: 'Best Day Ever', style: bubble('#3FA9FF') }, { id: 'vibes', text: 'Good Vibes', style: neon('#22FF88') },
  { id: 'new', text: 'NEW', style: tag('#FF4D5E') }, { id: 'sale', text: 'SALE %', style: tag('#000', '#FFD400') },
  { id: 'welcome', text: 'Welcome', style: outline('#00F0FF') }, { id: 'cool', text: 'So Cool 😎', style: neon('#3FA9FF') },
  { id: 'enjoy', text: 'Enjoy', style: script('#FFB020') }, { id: 'amazing', text: 'Amazing', style: grad('#B6FF3B') },
  { id: 'miss', text: 'Miss You', style: bubble('#FF4FD8') }, { id: 'family', text: 'Family ❤', style: outline('#FF2D55') },
  { id: 'weekend', text: 'Weekend', style: neon('#FFB020') }, { id: 'yes', text: 'YES!', style: tag('#22FF88', '#000') },
  { id: 'blessed', text: 'Blessed', style: script('#FFD400') }, { id: 'follow', text: 'Follow Me', style: bubble('#FF2D55') },
];

export const VIDEO_FX = TRANSITIONS.map((t) => [t.id, t.name] as const);

/** Frame style + optional flash/tint layer for an FX at progress p (0..1); peaks mid-way like the web version. */
export function fxFrame(type: string, p: number, W = 400, H = 710): { style: ViewStyle; overlay?: ViewStyle; rate?: number } {
  if (type === 'ramp') return { style: {}, rate: 1 + 2 * Math.sin(Math.PI * p) };
  const f = transitionFrame(type, p, W, H);
  return { style: { transform: f.transform, opacity: f.opacity, ...(f.filter ? { filter: f.filter } : {}) } as ViewStyle, overlay: f.overlay };
}
export const activeFx = (fx: VideoFx[] | undefined, t: number) => fx?.find((f) => t >= f.at && t < f.at + f.dur);

/** Draws crop bars + sticker/label/media overlays (timed for video); draggable when `onMove` is given. */
export function ObjLayer({ edit, width, height, time, selected, onSelect, onMove }: {
  edit?: MediaEdit; width: number; height: number; time?: number; selected?: string | null;
  onSelect?: (id: string) => void; onMove?: (id: string, x: number, y: number) => void;
}) {
  const drag = useRef<{ id: string; x: number; y: number; px: number; py: number } | null>(null);
  const list = (edit?.overlays ?? []).filter((o) => time == null || ((o.start ?? 0) <= time + 0.01 && time <= (o.end ?? Infinity)));
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {list.map((o) => (
        <View key={o.id} accessibilityLabel={`Overlay ${o.kind}`}
          onStartShouldSetResponder={() => !!onMove}
          onResponderGrant={(e) => { onSelect?.(o.id); drag.current = { id: o.id, x: o.x, y: o.y, px: e.nativeEvent.pageX, py: e.nativeEvent.pageY }; }}
          onResponderMove={(e) => {
            const d = drag.current;
            if (!d || !onMove) return;
            const clamp = (v: number) => Math.min(98, Math.max(2, v));
            onMove(d.id, clamp(d.x + ((e.nativeEvent.pageX - d.px) / width) * 100), clamp(d.y + ((e.nativeEvent.pageY - d.py) / height) * 100));
          }}
          onResponderRelease={() => (drag.current = null)}
          style={[s.ov, { left: `${o.x}%`, top: `${o.y}%`, opacity: o.opacity / 100 },
            o.kind === 'media' && { width: (width * o.size) / 100 },
            { transform: [{ translateX: '-50%' as unknown as number }, { translateY: '-50%' as unknown as number }, { rotate: `${o.rotate}deg` }] },
            selected === o.id && s.sel]}>
          <OverlayContent o={o} width={(width * o.size) / 100} />
        </View>
      ))}
    </View>
  );
}

function OverlayContent({ o, width }: { o: ObjOverlay; width: number }) {
  if (o.kind === 'media') {
    if (o.mediaType === 'video') {
      return Platform.OS === 'web'
        ? createElement('video', { src: o.content, autoPlay: true, loop: true, muted: true, playsInline: true, style: { width, display: 'block', borderRadius: 6 } })
        : <Image source={{ uri: o.content }} style={{ width, height: width, borderRadius: 6 }} />;
    }
    return <Image accessibilityLabel="Overlay image" source={{ uri: o.content }} style={{ width, height: width, borderRadius: 6 }} resizeMode="contain" />;
  }
  const st = TEXT_STICKERS.find((x) => x.id === o.styleId)?.style;
  return <Text style={[{ fontSize: o.size, fontWeight: '900' }, st]} numberOfLines={1}>{o.content}</Text>;
}

/* ---------- panels ---------- */

function IconBtn({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} onPress={onPress} style={s.ib}><Icon name={icon} size={18} /></Pressable>;
}
export function Stepper({ label, value, unit = '', step, min, max, onSet }: {
  label: string; value: number; unit?: string; step: number; min: number; max: number; onSet: (v: number) => void;
}) {
  const put = (d: number) => onSet(Math.max(min, Math.min(max, Math.round((value + d) * 100) / 100)));
  return (
    <View style={s.stepper}>
      <Text style={s.label}>{label}</Text>
      <Pressable accessibilityLabel={`Decrease ${label}`} style={s.btn} onPress={() => put(-step)}><Icon name="minus" size={14} /></Pressable>
      <View style={s.track}><View style={[s.fill, { width: `${((value - min) / (max - min)) * 100}%` }]} /></View>
      <Pressable accessibilityLabel={`Increase ${label}`} style={s.btn} onPress={() => put(step)}><Icon name="plus" size={14} /></Pressable>
      <Text style={s.val}>{value}{unit}</Text>
    </View>
  );
}

export { CropPanel } from './CropTool';

/** Applies rotate/flip to the media layer (crop bars are drawn by ObjLayer). */
export function TransformBox({ edit, children, style }: { edit?: MediaEdit; children: ReactNode; style?: ViewStyle }) {
  const r = edit?.rotate ?? 0;
  const k = r % 180 ? 0.72 : 1;
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, style,
      { transform: [...((style?.transform as object[]) ?? []), { rotate: `${r}deg` }, { scaleX: (edit?.flipH ? -1 : 1) * k }, { scaleY: (edit?.flipV ? -1 : 1) * k }] } as ViewStyle]}>
      {children}
    </View>
  );
}

function ObjControls({ o, patch, remove }: { o: ObjOverlay; patch: (p: Partial<ObjOverlay>) => void; remove: () => void }) {
  const media = o.kind === 'media';
  return (
    <View style={s.box}>
      <Stepper label="Size" value={o.size} step={media ? 5 : 4} min={media ? 10 : 16} max={media ? 100 : 140} onSet={(v) => patch({ size: v })} />
      <Stepper label="Opacity" value={o.opacity} unit="%" step={10} min={10} max={100} onSet={(v) => patch({ opacity: v })} />
      <Stepper label="Rotate" value={o.rotate} unit="°" step={15} min={-180} max={180} onSet={(v) => patch({ rotate: v })} />
      <Pressable accessibilityLabel="Delete overlay" onPress={remove} style={s.del}><Icon name="trash" size={14} color="#FF2D55" /><Text style={s.delT}>Delete</Text></Pressable>
    </View>
  );
}

/** Overlay CRUD shared by the Stickers and Overlay panels. */
export function useOverlays(edit: MediaEdit, set: Set, sel: string | null, setSel: (id: string | null) => void, time?: number, dur?: number) {
  const list = edit.overlays ?? [];
  const add = (o: Pick<ObjOverlay, 'kind' | 'content'> & Partial<ObjOverlay>) => {
    const id = uid('ov');
    const timed = dur ? { start: +(time ?? 0).toFixed(2), end: +Math.min(dur, (time ?? 0) + 3).toFixed(2) } : {};
    set({ overlays: [...list, { x: 50, y: 45, size: 32, opacity: 100, rotate: 0, ...timed, ...o, id }] });
    setSel(id);
  };
  const patch = (id: string, p: Partial<ObjOverlay>) => set({ overlays: list.map((o) => (o.id === id ? { ...o, ...p } : o)) });
  const remove = (id: string) => { set({ overlays: list.filter((o) => o.id !== id) }); setSel(null); };
  return { list, add, patch, remove, cur: list.find((o) => o.id === sel) ?? null };
}
type Ov = ReturnType<typeof useOverlays>;

export function StickersPanel({ ov }: { ov: Ov }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={s.grid3}>
        {TEXT_STICKERS.map((t) => (
          <Pressable key={t.id} accessibilityLabel={`Sticker ${t.text}`} onPress={() => ov.add({ kind: 'label', content: t.text, styleId: t.id, size: 30 })} style={s.stk}>
            <Text style={[{ fontSize: 13, fontWeight: '900' }, t.style]} numberOfLines={1}>{t.text}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.row}>
        {EMOJI_STICKERS.map((e) => (
          <Pressable key={e} accessibilityLabel={`Emoji ${e}`} onPress={() => ov.add({ kind: 'sticker', content: e, size: 44 })} style={s.emo}><Text style={{ fontSize: 20 }}>{e}</Text></Pressable>
        ))}
      </View>
      {ov.cur && ov.cur.kind !== 'media' && <ObjControls o={ov.cur} patch={(p) => ov.patch(ov.cur!.id, p)} remove={() => ov.remove(ov.cur!.id)} />}
    </View>
  );
}

export function OverlayPanel({ ov, isVideo }: { ov: Ov; isVideo?: boolean }) {
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: isVideo ? ['images', 'videos'] : ['images'], quality: 0.85 });
    const a = r.canceled ? null : r.assets[0];
    if (a) ov.add({ kind: 'media', content: a.uri, mediaType: a.type === 'video' ? 'video' : 'image', size: 40 });
  };
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={pick} style={s.dash}>
        <Icon name="layers" size={16} color={colors.primary} />
        <Text style={s.dashT}>{isVideo ? 'Add photo, video or GIF from gallery' : 'Add photo or GIF on top'}</Text>
      </Pressable>
      {ov.cur?.kind === 'media' ? <ObjControls o={ov.cur} patch={(p) => ov.patch(ov.cur!.id, p)} remove={() => ov.remove(ov.cur!.id)} />
        : <Text style={s.hint}>Drag the overlay to move it · tap it to adjust</Text>}
    </View>
  );
}

export function TransitionPanel({ edit, set, time, dur, fxDur, setFxDur }: {
  edit: MediaEdit; set: Set; time: number; dur: number; fxDur: number; setFxDur: (v: number) => void;
}) {
  const list = edit.fx ?? [];
  const at = Math.max(0, Math.min(Math.max(0, dur - fxDur), time - fxDur / 2));
  const here = list.find((f) => Math.abs(f.at + f.dur / 2 - time) < 0.6);
  const pick = (type: string) => {
    const rest = list.filter((f) => f !== here);
    set({ fx: type ? [...rest, { id: uid('fx'), type, at: +at.toFixed(2), dur: fxDur }].sort((a, b) => a.at - b.at) : rest });
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.hint}>{here ? `Transition at ${time.toFixed(1)}s` : 'Pause at a moment, then pick a transition to add it there'}</Text>
      <View style={s.row}>
        <Chip on={!here} label="⊘ None" onPress={() => pick('')} />
        {VIDEO_FX.map(([id, name]) => <Chip key={id} on={here?.type === id} label={name} onPress={() => pick(id)} />)}
      </View>
      <Stepper label="Duration" value={fxDur} unit="s" step={0.1} min={0.2} max={2} onSet={(v) => { setFxDur(v); if (here) set({ fx: list.map((f) => (f === here ? { ...f, dur: v } : f)) }); }} />
      {list.length > 0 && (
        <View style={s.row}>
          {list.map((f) => (
            <Pressable key={f.id} accessibilityLabel={`Remove transition ${f.type}`} onPress={() => set({ fx: list.filter((x) => x !== f) })} style={s.pill}>
              <Text style={s.pillT}>{(VIDEO_FX.find(([i]) => i === f.type)?.[1] ?? f.type)} @{f.at.toFixed(1)}s ✕</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { position: 'absolute', backgroundColor: '#000' },
  ov: { position: 'absolute', alignItems: 'center' },
  sel: { borderWidth: 2, borderColor: colors.primary, borderRadius: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stk: { width: '31%', height: 44, borderRadius: 12, backgroundColor: '#1A1A1E', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  emo: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  ib: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  reset: { color: 'rgba(255,255,255,0.5)', fontWeight: '700', fontSize: 11 },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: 'rgba(255,255,255,0.7)', fontWeight: '700', width: 62, fontSize: 12 },
  btn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
  val: { color: '#fff', fontWeight: '800', width: 46, textAlign: 'right', fontSize: 12 },
  box: { gap: 6, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' },
  del: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  delT: { color: '#FF2D55', fontWeight: '700', fontSize: 11 },
  dash: { height: 48, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dashT: { color: 'rgba(255,255,255,0.8)', fontWeight: '700', fontSize: 13 },
  pill: { backgroundColor: 'rgba(255,45,85,0.15)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillT: { color: '#FF8FA3', fontWeight: '700', fontSize: 10 },
});
