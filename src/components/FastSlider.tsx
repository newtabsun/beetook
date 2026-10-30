import { useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

/**
 * Lag-free 0..1 slider: knob/fill move via Animated (no React re-render while dragging),
 * onLive is throttled to ~30 fps for native setters, onCommit fires once on release.
 */
export function FastSlider({ label, initial, onLive, onCommit }: {
  label: string; initial: number; onLive: (v: number) => void; onCommit: (v: number) => void;
}) {
  const w = useRef(1);
  const v = useRef(initial);
  const pos = useRef(new Animated.Value(initial)).current;
  const last = useRef(0);
  const live = useRef(onLive); live.current = onLive;
  const commit = useRef(onCommit); commit.current = onCommit;
  const txt = useRef<Text>(null);
  const move = (x: number, force = false) => {
    v.current = Math.round(Math.max(0, Math.min(1, x / w.current)) * 100) / 100;
    pos.setValue(v.current);
    txt.current?.setNativeProps({ text: String(Math.round(v.current * 100)) });
    const now = Date.now();
    if (force || now - last.current >= 33) { last.current = now; live.current(v.current); }
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => move(e.nativeEvent.locationX),
    onPanResponderMove: (e) => move(e.nativeEvent.locationX),
    onPanResponderRelease: () => { live.current(v.current); commit.current(v.current); },
    onPanResponderTerminate: () => { live.current(v.current); commit.current(v.current); },
  })).current;
  const [wd] = [useRef(new Animated.Value(1)).current];
  const px = Animated.multiply(pos, wd);
  return (
    <View style={s.row}>
      <Text style={s.lbl}>{label}</Text>
      <View style={s.hit} onLayout={(e) => { w.current = Math.max(1, e.nativeEvent.layout.width); wd.setValue(w.current); }} {...pan.panHandlers}>
        <View pointerEvents="none" style={s.track} />
        <Animated.View pointerEvents="none" style={[s.fill, { width: px }]} />
        <Animated.View pointerEvents="none" style={[s.knob, { transform: [{ translateX: Animated.add(px, -8) }] }]} />
      </View>
      <Text ref={txt} style={s.val}>{Math.round(initial * 100)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6, gap: 10 },
  lbl: { color: '#fff', fontSize: 12, fontWeight: '600', width: 72 },
  hit: { flex: 1, height: 30, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  fill: { position: 'absolute', left: 0, height: 2, borderRadius: 1, backgroundColor: '#fff' },
  knob: { position: 'absolute', left: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  val: { color: '#fff', fontSize: 12, width: 26, textAlign: 'right' },
});
