import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

/** Thin horizontal 0..1 slider (no deps). Drag or tap anywhere on the track. */
export function ThinSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label?: string }) {
  const [w, setW] = useState(1);
  const wRef = useRef(1); wRef.current = w;
  const cb = useRef(onChange); cb.current = onChange;
  const set = (x: number) => cb.current(Math.round(Math.max(0, Math.min(1, x / wRef.current)) * 100) / 100);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
    onPanResponderMove: (e) => set(e.nativeEvent.locationX),
  })).current;
  return (
    <View style={s.row}>
      {label ? <Text style={s.lbl}>{label}</Text> : null}
      <View style={s.hit} onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))} {...pan.panHandlers}
        accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
        <View pointerEvents="none" style={s.track} />
        <View pointerEvents="none" style={[s.fill, { width: value * w }]} />
        <View pointerEvents="none" style={[s.knob, { left: value * w - 8 }]} />
      </View>
      <Text style={s.val}>{Math.round(value * 100)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 10 },
  lbl: { color: '#fff', fontSize: 12, fontWeight: '600' },
  hit: { flex: 1, height: 28, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  fill: { position: 'absolute', left: 0, height: 2, borderRadius: 1, backgroundColor: '#fff' },
  knob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  val: { color: '#fff', fontSize: 12, width: 26, textAlign: 'right' },
});
