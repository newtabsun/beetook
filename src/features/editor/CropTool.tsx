// Free crop: normalized rect (x, y, w, h in 0–1). The selected area is scaled to cover the whole frame (no black bars).
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Icon, type IconName } from '../../components/Icons';
import { colors } from '../../theme';
import type { MediaEdit } from './edit';

export type CropRect = { x: number; y: number; w: number; h: number };
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.1;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Current crop rect; converts the legacy percent insets. */
export function cropOf(e?: MediaEdit | null): CropRect {
  if (e?.cropRect) return e.cropRect;
  const c = e?.crop;
  if (!c) return FULL_CROP;
  return { x: c.l / 100, y: c.t / 100, w: Math.max(MIN, 1 - (c.l + c.r) / 100), h: Math.max(MIN, 1 - (c.t + c.b) / 100) };
}

/** Cover-scale the crop rect to the frame, keeping its center but never revealing outside the media. */
export function cropTransform(r: CropRect, W: number, H: number) {
  if (!W || !H || (r.w >= 0.999 && r.h >= 0.999)) return [];
  const s = Math.max(1 / r.w, 1 / r.h);
  const half = 1 / (2 * s);
  const cx = clamp(r.x + r.w / 2, half, 1 - half);
  const cy = clamp(r.y + r.h / 2, half, 1 - half);
  return [{ translateX: (0.5 - cx) * W * s }, { translateY: (0.5 - cy) * H * s }, { scale: s }];
}

type Kind = 'move' | 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br';
/** a = width/height in normalized units (0 = free). */
function drag(s: CropRect, k: Kind, dx: number, dy: number, a: number): CropRect | null {
  if (k === 'move') return { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
  let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
  const L = k.includes('l'), R = k.includes('r'), T = k.includes('t'), B = k.includes('b');
  if (L) x0 = clamp(x0 + dx, 0, x1 - MIN);
  if (R) x1 = clamp(x1 + dx, x0 + MIN, 1);
  if (T) y0 = clamp(y0 + dy, 0, y1 - MIN);
  if (B) y1 = clamp(y1 + dy, y0 + MIN, 1);
  if (a > 0) {
    const horiz = L || R;
    let w = x1 - x0, h = y1 - y0;
    if (horiz) h = w / a; else w = h * a;
    if (T) y0 = y1 - h; else if (B) y1 = y0 + h; else { const cy = (y0 + y1) / 2; y0 = cy - h / 2; y1 = cy + h / 2; }
    if (!horiz) { const cx = (x0 + x1) / 2; x0 = cx - w / 2; x1 = cx + w / 2; }
    if (x0 < -1e-4 || y0 < -1e-4 || x1 > 1.0001 || y1 > 1.0001 || w < MIN || h < MIN) return null;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Interactive crop box drawn over the uncropped media: drag inside to move, corners/edges to resize. */
export function CropOverlay({ rect, aspect, W, H, onChange }: { rect: CropRect; aspect: number; W: number; H: number; onChange: (r: CropRect) => void }) {
  const st = useRef<{ r: CropRect; px: number; py: number } | null>(null);
  const a = aspect > 0 ? (aspect * H) / W : 0;
  const h = (k: Kind) => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => { st.current = { r: rect, px: e.nativeEvent.pageX, py: e.nativeEvent.pageY }; },
    onResponderMove: (e: GestureResponderEvent) => {
      const d = st.current;
      if (!d) return;
      const n = drag(d.r, k, (e.nativeEvent.pageX - d.px) / W, (e.nativeEvent.pageY - d.py) / H, a);
      if (n) onChange(n);
    },
    onResponderRelease: () => { st.current = null; },
  });
  const { x, y, w, h: rh } = rect;
  const dim = 'rgba(0,0,0,0.55)';
  return (
    <View testID="crop-overlay" style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: y * H, backgroundColor: dim }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (y + rh) * H, bottom: 0, backgroundColor: dim }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: x * W, top: y * H, height: rh * H, backgroundColor: dim }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: (x + w) * W, right: 0, top: y * H, height: rh * H, backgroundColor: dim }} />
      <View testID="crop-box" {...h('move')} style={[s.box, { left: x * W, top: y * H, width: w * W, height: rh * H }]}>
        {[1, 2].map((i) => <View key={`v${i}`} pointerEvents="none" style={[s.grid, { left: `${(i * 100) / 3}%`, top: 0, bottom: 0, width: 1 }]} />)}
        {[1, 2].map((i) => <View key={`h${i}`} pointerEvents="none" style={[s.grid, { top: `${(i * 100) / 3}%`, left: 0, right: 0, height: 1 }]} />)}
        <View {...h('t')} style={[s.edge, { top: -12, left: 24, right: 24, height: 24 }]}><View style={s.barH} /></View>
        <View {...h('b')} style={[s.edge, { bottom: -12, left: 24, right: 24, height: 24 }]}><View style={s.barH} /></View>
        <View {...h('l')} style={[s.edge, { left: -12, top: 24, bottom: 24, width: 24 }]}><View style={s.barV} /></View>
        <View {...h('r')} style={[s.edge, { right: -12, top: 24, bottom: 24, width: 24 }]}><View style={s.barV} /></View>
        {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
          <View key={k} testID={`crop-${k}`} {...h(k)} style={[s.corner, k.includes('t') ? { top: -14 } : { bottom: -14 }, k.includes('l') ? { left: -14 } : { right: -14 }]}>
            <View style={[s.cornerIn, { [k.includes('t') ? 'borderTopWidth' : 'borderBottomWidth']: 4, [k.includes('l') ? 'borderLeftWidth' : 'borderRightWidth']: 4 }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

const RATIOS: { label: string; v: number }[] = [
  { label: 'Free', v: 0 }, { label: '9:16', v: 9 / 16 }, { label: '1:1', v: 1 }, { label: '4:5', v: 4 / 5 }, { label: '16:9', v: 16 / 9 },
];

export function CropPanel({ edit, set, frame }: { edit: MediaEdit; set: (p: Partial<MediaEdit>) => void; isVideo?: boolean; frame?: { w: number; h: number } }) {
  const fw = frame?.w || 9, fh = frame?.h || 16;
  const cur = edit.cropAspect ?? 0;
  const pick = (v: number) => {
    if (!v) return set({ cropAspect: 0 });
    const an = (v * fh) / fw;
    const w = an <= 1 ? an : 1, h = an <= 1 ? 1 : 1 / an;
    set({ cropAspect: v, crop: undefined, cropRect: { x: (1 - w) / 2, y: (1 - h) / 2, w, h } });
  };
  const btn = (label: string, icon: IconName, on: () => void) => (
    <Pressable key={label} accessibilityLabel={label} onPress={on} style={s.ib}><Icon name={icon} size={18} /></Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.hint}>Drag the corners or edges in any direction — the selected area fills the whole screen.</Text>
      <View style={s.row}>
        {RATIOS.map((r) => (
          <Pressable key={r.label} accessibilityLabel={`Crop ${r.label}`} onPress={() => pick(r.v)} style={[s.chip, cur === r.v && s.chipOn]}>
            <Text style={[s.chipT, cur === r.v && { color: '#000' }]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.row}>
        {btn('Rotate left', 'rotateL', () => set({ rotate: ((edit.rotate ?? 0) + 270) % 360 }))}
        {btn('Rotate right', 'rotateR', () => set({ rotate: ((edit.rotate ?? 0) + 90) % 360 }))}
        {btn('Flip horizontal', 'flipH', () => set({ flipH: !edit.flipH }))}
        {btn('Flip vertical', 'flipV', () => set({ flipV: !edit.flipV }))}
        <Pressable style={{ marginLeft: 'auto' }} onPress={() => set({ crop: undefined, cropRect: undefined, cropAspect: 0, rotate: 0, flipH: false, flipV: false })}>
          <Text style={s.reset}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { position: 'absolute', borderWidth: 1.5, borderColor: '#fff' },
  grid: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  edge: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  barH: { width: 28, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  barV: { width: 4, height: 28, borderRadius: 2, backgroundColor: '#fff' },
  corner: { position: 'absolute', width: 32, height: 32, padding: 6 },
  cornerIn: { flex: 1, borderColor: '#fff' },
  hint: { color: 'rgba(255,255,255,0.65)', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  chipOn: { backgroundColor: colors.primary },
  chipT: { color: '#fff', fontWeight: '800', fontSize: 13 },
  ib: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  reset: { color: colors.primary, fontWeight: '800' },
});
