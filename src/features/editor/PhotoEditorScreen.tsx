// Photo editor (web MediaEditor parity): Theme (105), Duration, Filters, Adjust, Text — live preview.
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '../../theme';
import { Icon, type IconName } from '../../components/Icons';
import { DEFAULT_THEME_ID, SLIDE_SECONDS, type MediaEdit } from './edit';
import { AdjustPanel, Chip, EditedFrame, editorStyles as e, FilterPanel, TextPanel, ToolBar } from './EditTools';
import { CropPanel, OverlayPanel, StickersPanel, useOverlays } from './ObjTools';
import { catLabel, THEME105_CATS, THEMES_105 } from './themes105';
import { Theme105Stage } from './themes105/Theme105Stage';

type Tool = 'theme' | 'duration' | 'filters' | 'adjust' | 'crop' | 'text' | 'stickers' | 'overlay';
const TOOLS: { k: Tool; label: string; icon: IconName }[] = [
  { k: 'theme', label: 'Theme', icon: 'palette' }, { k: 'duration', label: 'Transitions', icon: 'wand' },
  { k: 'filters', label: 'Filters', icon: 'sparkles' }, { k: 'adjust', label: 'Adjust', icon: 'sliders' }, { k: 'crop', label: 'Crop', icon: 'crop' },
  { k: 'text', label: 'Text', icon: 'type' }, { k: 'stickers', label: 'Stickers', icon: 'smile' }, { k: 'overlay', label: 'Overlay', icon: 'layers' },
];

export function PhotoEditorScreen({ sources, initial, onDone, onCancel }: {
  sources: string[]; initial?: MediaEdit; onDone: (e: MediaEdit) => void; onCancel: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [edit, setEdit] = useState<MediaEdit>({ themeId: DEFAULT_THEME_ID, seconds: 2, ...initial });
  const [tool, setTool] = useState<Tool>('theme');
  const [playing, setPlaying] = useState(true);
  const themeId = edit.themeId ?? DEFAULT_THEME_ID;
  const [cat, setCat] = useState(THEMES_105.find((t) => t.id === themeId)?.cat ?? THEME105_CATS[0]);
  const list = useMemo(() => THEMES_105.filter((t) => t.cat === cat), [cat]);
  const set = (p: Partial<MediaEdit>) => setEdit((x) => ({ ...x, ...p }));
  const [sel, setSel] = useState<string | null>(null);
  const ov = useOverlays(edit, set, sel, setSel);
  const frameW = Math.min(width, 430);
  const frameH = Math.min(height * 0.44, 420);
  const stageW = Math.min(frameW - 32, (frameH * 720) / 1280);
  const current = THEMES_105.find((t) => t.id === themeId);

  return (
    <View style={e.root}>
      <View style={e.head}>
        <Pressable accessibilityLabel="Back" onPress={onCancel} style={e.iconBtn}><Icon name="back" size={18} /></Pressable>
        <Text style={e.headT}>Edit photos · {sources.length}</Text>
        <Pressable onPress={() => onDone(edit)} style={e.done}><Icon name="check" size={16} color="#000" strokeWidth={3} /><Text style={e.doneT}>Done</Text></Pressable>
      </View>
      <Pressable accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={() => setPlaying(!playing)}>
        <EditedFrame edit={edit} width={frameW} height={frameH}
          editable={{ selected: sel, onSelect: (id) => { setSel(id); const o = ov.list.find((x) => x.id === id); if (o) setTool(o.kind === 'media' ? 'overlay' : 'stickers'); }, onMove: (id, x, y) => ov.patch(id, { x, y }), crop: tool === 'crop' ? (r) => set({ cropRect: r, crop: undefined }) : undefined }}>
          <Theme105Stage sources={sources} themeId={themeId} seconds={edit.seconds ?? 2} width={stageW} playing={playing} />
          {!playing && <View style={s.paused}><Icon name="play" size={40} /></View>}
        </EditedFrame>
      </Pressable>
      <Text style={s.name} numberOfLines={1}>#{themeId} · {current?.name}</Text>
      <ToolBar tools={TOOLS} value={tool} onChange={setTool} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={e.panel} showsVerticalScrollIndicator={false}>
        {tool === 'theme' && (<>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {THEME105_CATS.map((c) => <Chip key={c} on={cat === c} label={catLabel(c)} onPress={() => setCat(c)} />)}
          </ScrollView>
          <FlatList horizontal data={list} keyExtractor={(t) => String(t.id)} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}
            renderItem={({ item }) => (
              <Pressable onPress={() => set({ themeId: item.id })} style={[s.theme, themeId === item.id && s.themeOn]}>
                <Text style={s.themeId}>#{item.id}</Text>
                <Text style={s.themeName} numberOfLines={2}>{item.name}</Text>
              </Pressable>
            )} />
        </>)}
        {tool === 'duration' && (
          <View style={s.row}>{SLIDE_SECONDS.map((sec) => <Chip key={sec} on={edit.seconds === sec} label={`${sec}s / photo`} onPress={() => set({ seconds: sec })} />)}</View>
        )}
        {tool === 'filters' && <FilterPanel edit={edit} set={set} />}
        {tool === 'adjust' && <AdjustPanel edit={edit} set={set} />}
        {tool === 'text' && <TextPanel edit={edit} set={set} />}
        {tool === 'crop' && <CropPanel edit={edit} set={set} frame={{ w: frameW, h: frameH }} />}
        {tool === 'stickers' && <StickersPanel ov={ov} />}
        {tool === 'overlay' && <OverlayPanel ov={ov} />}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  paused: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', textAlign: 'center', fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  theme: { width: 110, padding: 8, borderRadius: 12, backgroundColor: '#1c1c1c', borderWidth: 2, borderColor: 'transparent' },
  themeOn: { borderColor: colors.primary },
  themeId: { color: colors.primary, fontWeight: '900', fontSize: 11 },
  themeName: { color: '#fff', fontSize: 11 },
});
