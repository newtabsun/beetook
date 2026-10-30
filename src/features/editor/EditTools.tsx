// Shared edit tools (web MediaEditor parity): filters, adjust, text overlay + the frame that renders them.
import { CropOverlay, cropOf, cropTransform, type CropRect } from './CropTool';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle, Platform } from 'react-native';
import { activeFx, fxFrame, ObjLayer, TransformBox } from './ObjTools';
import { Icon, type IconName } from '../../components/Icons';
import { colors } from '../../theme';
import type { MediaEdit, TextOverlay } from './edit';
import { FILTERS, filterOf } from './motion';

export { FILTERS };

/** Color-grade layer drawn above media/camera: tint + vignette. Works on every Android version and over SurfaceViews. */
export function FilterLayer({ id }: { id?: string }) {
  const f = filterOf(id);
  // Preview layers (camera / Live / editor, all platforms); the real grade is baked by Media3 on export.
  if (!f || f.id === 'none') return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {f.glow ? <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFF4EC', opacity: f.glow * 0.45 }]} /> : null}
      {f.tint ? <View style={[StyleSheet.absoluteFill, { backgroundColor: f.tint, opacity: f.tintA ?? 0.15 }]} /> : null}
      {f.vignette ? <View style={[StyleSheet.absoluteFill, { borderWidth: 70, borderColor: `rgba(0,0,0,${f.vignette * 0.5})`, borderRadius: 60, margin: -36 }]} /> : null}
    </View>
  );
}

/** Preview APPROXIMATION of beauty (soft bright skin-tone light). Real skin smoothing is only baked on export (Android Media3). */
export function BeautyLayer({ v }: { v?: number }) {
  if (!v) return null;
  const k = Math.pow(Math.min(1, v > 1 ? v / 100 : v), 0.6);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFE4D6', opacity: 0.2 * k }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity: 0.1 * k }]} />
    </View>
  );
}

export function filterCss(e?: MediaEdit): string {
  return `brightness(${e?.brightness ?? 1}) contrast(${e?.contrast ?? 1}) saturate(${e?.saturation ?? 1})`.trim();
}

export const TEXT_COLORS = ['#FFFFFF', '#FFA500', '#FF3B30', '#34C759', '#0A84FF', '#000000'];
const DEFAULT_TEXT: TextOverlay = { value: '', color: '#FFFFFF', y: 0.8, bg: true };

/** Renders media children with filter/adjust and the text overlay applied. */
export function EditedFrame({ edit, width, height, children, time, editable, ui }: {
  edit?: MediaEdit; width: number; height: number; children: ReactNode; time?: number; ui?: ReactNode;
  editable?: { selected: string | null; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void; crop?: (r: CropRect) => void };
}) {
  const cropping = !!editable?.crop;
  const ct = cropping ? [] : cropTransform(cropOf(edit), width, height);
  const t = edit?.text;
  const fx = time != null ? activeFx(edit?.fx, time) : undefined;
  const fr = fx ? fxFrame(fx.type, (time! - fx.at) / fx.dur, width, height) : null;
  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#000' }}>
      <View style={[StyleSheet.absoluteFill, { transform: ct } as ViewStyle]}>
        <TransformBox edit={edit} style={{ ...(fr?.style ?? {}), filter: filterCss(edit) } as ViewStyle}>{children}</TransformBox>
      </View>
      {fr?.overlay && <View pointerEvents="none" style={[StyleSheet.absoluteFill, fr.overlay]} />}
      {ui}
      <ObjLayer edit={edit} width={width} height={height} time={time} selected={editable?.selected} onSelect={editable?.onSelect} onMove={editable?.onMove} />
      {t?.value ? (
        <View pointerEvents="none" style={[s.textWrap, { top: `${Math.round(t.y * 88)}%` }]}>
          <Text style={[s.text, { color: t.color, backgroundColor: t.bg ? 'rgba(0,0,0,0.55)' : 'transparent' }]}>{t.value}</Text>
        </View>
      ) : null}
      {cropping && <CropOverlay rect={cropOf(edit)} aspect={edit?.cropAspect ?? 0} W={width} H={height} onChange={editable!.crop!} />}
    </View>
  );
}

export function ToolBar<T extends string>({ tools, value, onChange }: { tools: { k: T; label: string; icon: IconName }[]; value: T; onChange: (k: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.tools}>
      {tools.map((t) => (
        <Pressable key={t.k} accessibilityLabel={t.label} onPress={() => onChange(t.k)} style={s.tool}>
          <View style={[s.toolIc, value === t.k && { backgroundColor: colors.primary }]}><Icon name={t.icon} size={18} color={value === t.k ? '#000' : '#fff'} /></View>
          <Text style={[s.toolT, value === t.k && { color: colors.primary }]}>{t.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[s.chip, on && s.on]}><Text style={[s.chipT, on && s.onT]}>{label}</Text></Pressable>;
}

type Set = (patch: Partial<MediaEdit>) => void;

export function FilterPanel({ edit, set }: { edit: MediaEdit; set: Set }) {
  return (
    <View style={s.wrap}>
      {FILTERS.map((f) => <Chip key={f.id} on={(edit.filter ?? 'none') === f.id} label={f.name} onPress={() => set({ filter: f.id })} />)}
    </View>
  );
}

const ADJUST = [['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation']] as const;
export function AdjustPanel({ edit, set }: { edit: MediaEdit; set: Set }) {
  const clamp = (v: number) => Math.max(0.5, Math.min(1.5, Math.round(v * 10) / 10));
  return (
    <View style={{ gap: 6 }}>
      {ADJUST.map(([k, label]) => {
        const v = edit[k] ?? 1;
        return (
          <View key={k} style={s.stepper}>
            <Text style={s.label}>{label}</Text>
            <Pressable accessibilityLabel={`Decrease ${label}`} style={s.btn} onPress={() => set({ [k]: clamp(v - 0.1) })}><Icon name="minus" size={16} /></Pressable>
            <View style={s.track}><View style={[s.fill, { width: `${(v - 0.5) * 100}%` }]} /></View>
            <Pressable accessibilityLabel={`Increase ${label}`} style={s.btn} onPress={() => set({ [k]: clamp(v + 0.1) })}><Icon name="plus" size={16} /></Pressable>
            <Text style={s.val}>{Math.round(v * 100)}%</Text>
          </View>
        );
      })}
      <Pressable onPress={() => set({ brightness: 1, contrast: 1, saturation: 1 })}><Text style={s.reset}>Reset</Text></Pressable>
    </View>
  );
}

export function TextPanel({ edit, set }: { edit: MediaEdit; set: Set }) {
  const t = edit.text ?? DEFAULT_TEXT;
  const put = (p: Partial<TextOverlay>) => set({ text: { ...t, ...p } });
  return (
    <View style={{ gap: 8 }}>
      <TextInput value={t.value} onChangeText={(value) => put({ value })} placeholder="Add text on your media" maxLength={80}
        placeholderTextColor="rgba(255,255,255,0.4)" style={s.input} />
      <View style={s.wrap}>
        {TEXT_COLORS.map((c) => (
          <Pressable key={c} accessibilityLabel={`Color ${c}`} onPress={() => put({ color: c })} style={[s.swatch, { backgroundColor: c }, t.color === c && s.swatchOn]} />
        ))}
      </View>
      <View style={s.wrap}>
        {([['Top', 0.05], ['Middle', 0.45], ['Bottom', 0.8]] as const).map(([l, y]) => <Chip key={l} on={t.y === y} label={l} onPress={() => put({ y })} />)}
        <Chip on={t.bg} label="Background" onPress={() => put({ bg: !t.bg })} />
      </View>
    </View>
  );
}

export const editorStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  headT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
  doneT: { color: '#000', fontWeight: '900' },
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
});

const s = StyleSheet.create({
  textWrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  text: { fontSize: 22, fontWeight: '900', textAlign: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  tools: { paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  tool: { alignItems: 'center', width: 64, gap: 4 },
  toolIc: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  toolT: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)' },
  chipT: { color: '#fff', fontWeight: '700', fontSize: 12 },
  on: { backgroundColor: colors.primary },
  onT: { color: '#000' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: 'rgba(255,255,255,0.7)', fontWeight: '700', width: 78, fontSize: 12 },
  btn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
  val: { color: '#fff', fontWeight: '800', width: 44, textAlign: 'right', fontSize: 12 },
  reset: { color: colors.primary, fontWeight: '800', textAlign: 'right' },
  input: { backgroundColor: '#1c1c1c', color: '#fff', borderRadius: 12, padding: 12 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  swatchOn: { borderColor: colors.primary, transform: [{ scale: 1.15 }] },
});
