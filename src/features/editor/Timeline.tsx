// Clip timeline (CapCut-style): tap a clip to select, drag its edge handles to trim, Split at the playhead,
// Delete the selected clip, Undo. Result is stored as edit.segments (source-time ranges played back-to-back).
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icons';
import { notify } from '../../lib/notify';
import { colors } from '../../theme';
import { editedLength, segmentsOf, type MediaEdit, type Seg } from './edit';

const MIN = 0.5;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
const r1 = (v: number) => Math.round(v * 100) / 100;

export function VideoTimeline({ dur, now, edit, set, onSeek }: {
  dur: number; now: number; edit: MediaEdit; set: (p: Partial<MediaEdit>) => void; onSeek: (t: number) => void;
}) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState(0);
  const [hist, setHist] = useState<Seg[][]>([]);
  const segs = segmentsOf(edit, dur);
  const drag = useRef<{ i: number; side: 's' | 'e'; x0: number; v0: number; base: Seg[] } | null>(null);
  const px = (t: number) => (dur ? (t / dur) * w : 0);

  const commit = (next: Seg[], record = true, base = segs) => {
    if (record) setHist((h) => [...h.slice(-29), base]);
    set({ segments: next, trimStart: next[0].s, trimEnd: next[next.length - 1].e });
  };
  const split = () => {
    const i = segs.findIndex((g) => now > g.s + 0.3 && now < g.e - 0.3);
    if (i < 0) { notify('Move the playhead inside a clip to split'); return; }
    const g = segs[i];
    commit([...segs.slice(0, i), { s: g.s, e: r1(now) }, { s: r1(now), e: g.e }, ...segs.slice(i + 1)]);
    setSel(i + 1);
  };
  const del = () => {
    if (segs.length <= 1) { notify('Split first — at least one clip must remain'); return; }
    const i = Math.min(sel, segs.length - 1);
    const next = segs.filter((_, j) => j !== i);
    commit(next);
    setSel(Math.max(0, i - 1));
    onSeek(next[Math.max(0, i - 1)].s);
  };
  const undo = () => {
    const prev = hist[hist.length - 1];
    if (!prev) return;
    setHist((h) => h.slice(0, -1));
    commit(prev, false);
    setSel((x) => Math.min(x, prev.length - 1));
  };
  const reset = () => { commit([{ s: 0, e: dur }]); setSel(0); };

  const handle = (i: number, side: 's' | 'e') => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (ev: { nativeEvent: { pageX: number } }) => {
      setSel(i);
      drag.current = { i, side, x0: ev.nativeEvent.pageX, v0: segs[i][side], base: segs };
    },
    onResponderMove: (ev: { nativeEvent: { pageX: number } }) => {
      const d = drag.current; if (!d || !w) return;
      const g = d.base[d.i];
      const lo = side === 's' ? (d.base[d.i - 1]?.e ?? 0) : g.s + MIN;
      const hi = side === 's' ? g.e - MIN : (d.base[d.i + 1]?.s ?? dur);
      const v = r1(Math.max(lo, Math.min(hi, d.v0 + ((ev.nativeEvent.pageX - d.x0) / w) * dur)));
      const next = d.base.map((x, j) => (j === d.i ? { ...x, [side]: v } : x));
      set({ segments: next, trimStart: next[0].s, trimEnd: next[next.length - 1].e });
      onSeek(v);
    },
    onResponderRelease: () => { const d = drag.current; drag.current = null; if (d) setHist((h) => [...h.slice(-29), d.base]); },
  });

  if (!dur) return <Text style={s.muted}>Loading video…</Text>;
  return (
    <View style={{ gap: 10 }}>
      <View style={s.bar} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={(e) => {
          const t = Math.max(0, Math.min(dur, (e.nativeEvent.locationX / Math.max(1, w)) * dur));
          const i = segs.findIndex((g) => t >= g.s && t <= g.e);
          if (i >= 0) setSel(i);
          onSeek(i >= 0 ? t : segs.find((g) => g.s > t)?.s ?? segs[0].s);
        }} />
        {w > 0 && segs.map((g, i) => (
          <View key={`${i}-${g.s}`} pointerEvents="box-none" style={[s.seg, { left: px(g.s), width: Math.max(4, px(g.e) - px(g.s)) }, i === sel && s.segOn]}>
            <Text pointerEvents="none" style={s.segT} numberOfLines={1}>{fmt(g.e - g.s)}</Text>
            {i === sel && <>
              <View testID="trim-start" {...handle(i, 's')} hitSlop={12} style={[s.handle, { left: -8 }]}><View style={s.grip} /></View>
              <View testID="trim-end" {...handle(i, 'e')} hitSlop={12} style={[s.handle, { right: -8 }]}><View style={s.grip} /></View>
            </>}
          </View>
        ))}
        {w > 0 && <View pointerEvents="none" style={[s.head, { left: px(now) - 1 }]} />}
      </View>
      <Text style={s.muted}>Clip {sel + 1}/{segs.length} · {fmt(segs[sel]?.s ?? 0)}–{fmt(segs[sel]?.e ?? 0)} · total {fmt(editedLength(edit, dur))} · now {fmt(now)}</Text>
      <View style={s.row}>
        <Btn icon="scissors" label="Split" onPress={split} />
        <Btn icon="trash" label="Delete" onPress={del} danger />
        <Btn icon="back" label="Undo" onPress={undo} disabled={!hist.length} />
        <Btn icon="x" label="Reset" onPress={reset} />
      </View>
    </View>
  );
}

function Btn({ icon, label, onPress, danger, disabled }: { icon: 'scissors' | 'trash' | 'back' | 'x'; label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[s.btn, disabled && { opacity: 0.35 }]}>
      <Icon name={icon} size={16} color={danger ? '#FF5252' : '#fff'} />
      <Text style={[s.btnT, danger && { color: '#FF5252' }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: { height: 48, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: 8 },
  seg: { position: 'absolute', top: 4, bottom: 4, borderRadius: 6, backgroundColor: 'rgba(255,165,0,0.35)', borderWidth: 2, borderColor: 'rgba(255,165,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  segOn: { backgroundColor: 'rgba(255,165,0,0.55)', borderColor: colors.primary },
  segT: { color: '#fff', fontSize: 10, fontWeight: '800' },
  handle: { position: 'absolute', top: -4, bottom: -4, width: 16, borderRadius: 4, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2, height: 16, backgroundColor: '#000', borderRadius: 1 },
  head: { position: 'absolute', top: -4, bottom: -4, width: 2, backgroundColor: '#fff' },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  btn: { alignItems: 'center', gap: 2, minWidth: 60, paddingVertical: 6 },
  btnT: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
