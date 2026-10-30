// Beauty presets strip (10, horizontal, with thumbnails). Sliders only for "Adjust".
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BeautyLevels } from '../../modules/gpupixel-camera';
import { commitCustom, PRESETS, selectPreset, useBeauty } from '../lib/beautyStore';
import { FastSlider } from './FastSlider';
import { colors } from '../theme';

const THUMBS: Record<string, number> = {
  none: require('../../assets/beauty/none.jpg'),
  adjust: require('../../assets/beauty/adjust.jpg'),
  natural: require('../../assets/beauty/natural.jpg'),
  soft: require('../../assets/beauty/soft.jpg'),
  clear: require('../../assets/beauty/clear.jpg'),
  glow: require('../../assets/beauty/glow.jpg'),
  fair: require('../../assets/beauty/fair.jpg'),
  porcelain: require('../../assets/beauty/porcelain.jpg'),
  silk: require('../../assets/beauty/silk.jpg'),
  bright: require('../../assets/beauty/bright.jpg'),
  studio: require('../../assets/beauty/studio.jpg'),
};
const ROWS: { k: keyof BeautyLevels; label: string }[] = [
  { k: 'smoothing', label: 'Smoothing' }, { k: 'whitening', label: 'Whitening' }
];

/** onLive pushes values straight to the native camera while dragging (no re-render). */
export function BeautyPanel({ onLive }: { onLive?: (l: BeautyLevels) => void }) {
  const st = useBeauty();
  const draft = { ...st.custom };
  return (
    <View>
      {st.preset === 'adjust' && ROWS.map((r) => (
        <FastSlider key={r.k} label={r.label} initial={st.custom[r.k]}
          onLive={(v) => { draft[r.k] = v; onLive?.({ ...draft }); }}
          onCommit={(v) => { draft[r.k] = v; commitCustom({ ...draft }); }} />
      ))}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {PRESETS.map((p) => {
          const on = st.preset === p.id;
          return (
            <Pressable key={p.id} accessibilityLabel={`Beauty ${p.name}`} onPress={() => selectPreset(p.id)} style={s.item}>
              <Image source={THUMBS[p.id]} style={[s.img, on && s.imgOn]} />
              <Text style={[s.t, on && { color: colors.primary }]}>{p.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  strip: { gap: 10, paddingHorizontal: 12, paddingVertical: 6 },
  item: { alignItems: 'center', width: 62 },
  img: { width: 56, height: 56, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  imgOn: { borderColor: colors.primary },
  t: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 3 },
});
