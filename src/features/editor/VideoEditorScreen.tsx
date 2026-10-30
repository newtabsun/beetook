// Video editor (web MediaEditor parity, same order): Filters, Adjust, Edit, Crop, Transition, Speed, Text, Stickers, Overlay, Audio.
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '../../theme';
import { Icon, type IconName } from '../../components/Icons';
import { VIDEO_SPEEDS, type MediaEdit } from './edit';
import { EditedVideo } from './PostMedia';
import { AdjustPanel, Chip, editorStyles as e, FilterPanel, TextPanel, ToolBar } from './EditTools';
import { CropPanel, OverlayPanel, StickersPanel, TransitionPanel, useOverlays } from './ObjTools';

type Tool = 'filters' | 'adjust' | 'trim' | 'crop' | 'fx' | 'speed' | 'text' | 'stickers' | 'overlay' | 'audio';
const TOOLS: { k: Tool; label: string; icon: IconName }[] = [
  { k: 'filters', label: 'Filters', icon: 'sparkles' }, { k: 'adjust', label: 'Adjust', icon: 'sliders' },
  { k: 'trim', label: 'Edit', icon: 'film' }, { k: 'crop', label: 'Crop', icon: 'crop' },
  { k: 'fx', label: 'Transition', icon: 'wand' }, { k: 'speed', label: 'Speed', icon: 'gauge' },
  { k: 'text', label: 'Text', icon: 'type' }, { k: 'stickers', label: 'Stickers', icon: 'smile' },
  { k: 'overlay', label: 'Overlay', icon: 'layers' }, { k: 'audio', label: 'Audio', icon: 'music' },
];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

export function VideoEditorScreen({ uri, initial, onDone, onCancel }: {
  uri: string; initial?: MediaEdit; onDone: (e: MediaEdit) => void; onCancel: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [edit, setEdit] = useState<MediaEdit>({ speed: 1, ...initial });
  const [tool, setTool] = useState<Tool>('filters');
  const [dur, setDur] = useState(0);
  const [now, setNow] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [fxDur, setFxDur] = useState(0.8);
  const set = (p: Partial<MediaEdit>) => setEdit((x) => ({ ...x, ...p }));
  const ov = useOverlays(edit, set, sel, setSel, now, dur);
  const start = edit.trimStart ?? 0;
  const end = edit.trimEnd ?? dur;

  const step = (v: number, d: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round((v + d) * 10) / 10));
  const Stepper = ({ label, value, onSet, min, max }: { label: string; value: number; onSet: (v: number) => void; min: number; max: number }) => (
    <View style={s.stepper}>
      <Text style={s.label}>{label}</Text>
      <Pressable accessibilityLabel={`${label} earlier`} style={s.btn} onPress={() => onSet(step(value, -0.5, min, max))}><Icon name="minus" size={16} /></Pressable>
      <Text style={s.val}>{fmt(value)}</Text>
      <Pressable accessibilityLabel={`${label} later`} style={s.btn} onPress={() => onSet(step(value, 0.5, min, max))}><Icon name="plus" size={16} /></Pressable>
    </View>
  );
  const previewH = Math.min(height * 0.4, 380);

  return (
    <View style={e.root}>
      <View style={e.head}>
        <Pressable accessibilityLabel="Back" onPress={onCancel} style={e.iconBtn}><Icon name="back" size={18} /></Pressable>
        <Text style={e.headT}>Edit video</Text>
        <Pressable style={e.done} onPress={() => onDone({ ...edit, trimEnd: edit.trimEnd && edit.trimEnd < dur ? edit.trimEnd : undefined })}>
          <Icon name="check" size={16} color="#000" strokeWidth={3} /><Text style={e.doneT}>Next</Text>
        </Pressable>
      </View>
      <EditedVideo uri={uri} edit={edit} width={width > 430 ? 430 : width} height={previewH}
        onProgress={(n, d) => { setNow(n); if (d && !dur) setDur(d); }} onDuetMove={(d) => set({ duet: d })}
        editable={{ selected: sel, onSelect: (id) => { setSel(id); const o = ov.list.find((x) => x.id === id); if (o) setTool(o.kind === 'media' ? 'overlay' : 'stickers'); }, onMove: (id, x, y) => ov.patch(id, { x, y }), crop: tool === 'crop' ? (r) => set({ cropRect: r, crop: undefined }) : undefined }} />
      <View style={s.bar}>
        {dur > 0 && (<>
          <View style={[s.sel, { left: `${(start / dur) * 100}%`, width: `${((end - start) / dur) * 100}%` }]} />
          {(edit.fx ?? []).map((f) => <View key={f.id} style={[s.fx, { left: `${(f.at / dur) * 100}%`, width: `${(f.dur / dur) * 100}%` }]} />)}
          <View style={[s.head2, { left: `${(now / dur) * 100}%` }]} />
        </>)}
      </View>
      <Text style={s.meta}>{fmt(now)} / {fmt(dur)} · clip {fmt(Math.max(0, end - start))}</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={e.panel} showsVerticalScrollIndicator={false}>
        {tool === 'filters' && <FilterPanel edit={edit} set={set} />}
        {tool === 'adjust' && <AdjustPanel edit={edit} set={set} />}
        {tool === 'text' && <TextPanel edit={edit} set={set} />}
        {tool === 'crop' && <CropPanel edit={edit} set={set} isVideo frame={{ w: width > 430 ? 430 : width, h: previewH }} />}
        {tool === 'fx' && <TransitionPanel edit={edit} set={set} time={now} dur={dur} fxDur={fxDur} setFxDur={setFxDur} />}
        {tool === 'stickers' && <StickersPanel ov={ov} />}
        {tool === 'overlay' && <OverlayPanel ov={ov} isVideo />}
        {tool === 'trim' && (<>
          <Stepper label="Start" value={start} onSet={(v) => set({ trimStart: v })} min={0} max={Math.max(0, end - 0.5)} />
          <Stepper label="End" value={end} onSet={(v) => set({ trimEnd: v })} min={start + 0.5} max={dur} />
        </>)}
        {tool === 'speed' && (
          <View style={s.row}>{VIDEO_SPEEDS.map((v) => <Chip key={v} on={(edit.speed ?? 1) === v} label={`${v}x`} onPress={() => set({ speed: v })} />)}</View>
        )}
        {tool === 'audio' && (
          <View style={s.row}>
            <Chip on={!edit.muted} label="Original sound" onPress={() => set({ muted: false })} />
            <Chip on={!!edit.muted} label="Mute video" onPress={() => set({ muted: true })} />
          </View>
        )}
      </ScrollView>
      <ToolBar tools={TOOLS} value={tool} onChange={setTool} />
      {Platform.OS === 'web' && <View style={{ height: 4 }} />}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { height: 10, marginHorizontal: 16, marginTop: 12, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.15)' },
  sel: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.primary, borderRadius: 5 },
  fx: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#B388FF' },
  head2: { position: 'absolute', top: -4, width: 2, height: 18, backgroundColor: '#fff' },
  meta: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 12, marginTop: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: 'rgba(255,255,255,0.7)', fontWeight: '700', width: 50 },
  btn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  val: { color: '#fff', fontWeight: '800', minWidth: 60, textAlign: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
