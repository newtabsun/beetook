// Sticker rendering on the live screen. Host: tap selects (shows ×), drag moves, pinch resizes.
// Removing with × only takes the sticker off this live screen; it stays saved in Live settings.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LiveSticker } from '../../lib/api';
import { TEXT_LOOKS } from './liveStickers';

export const IMAGE_BOX = 140;
const MIN_S = 0.4;
const MAX_S = 4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function StickerBody({ st }: { st: LiveSticker }) {
  if (st.kind === 'image') return st.url ? <Image source={{ uri: st.url }} style={{ width: IMAGE_BOX, height: IMAGE_BOX }} resizeMode="contain" /> : null;
  const look = TEXT_LOOKS[st.bg ?? 0] ?? TEXT_LOOKS[0];
  return <View style={look.box}><Text style={[s.text, look.text]}>{st.text}</Text></View>;
}

type Pos = { x: number; y: number; s: number };

function StickerItem({ st, host, selected, box, onTap, onHide, onCommit }: {
  st: LiveSticker; host: boolean; selected: boolean; box: { w: number; h: number };
  onTap: () => void; onHide: () => void; onCommit: (st: LiveSticker) => void;
}) {
  const [pos, setPos] = useState<Pos>({ x: st.x, y: st.y, s: st.s ?? 1 });
  const cur = useRef<Pos>(pos);
  const dragging = useRef(false);
  const live = useRef({ st, box, onCommit, onTap, host });
  live.current = { st, box, onCommit, onTap, host };

  // Picked up during the first render, so the gesture starts from the stored position.
  const home = useRef<Pos>({ x: st.x, y: st.y, s: st.s ?? 1 });

  // Viewers (and the host after a commit) follow the position stored in the room.
  useEffect(() => {
    if (dragging.current) return;
    const p = { x: st.x, y: st.y, s: st.s ?? 1 };
    cur.current = p; setPos(p);
  }, [st.x, st.y, st.s]);

  const pan = useMemo(() => {
    let start: Pos = home.current; let base = 0; let baseS = 1; let moved = false;
    const dist = (t: readonly { pageX: number; pageY: number }[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
    const apply = (p: Pos) => { cur.current = p; setPos(p); };
    const finish = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (!moved) { live.current.onTap(); return; }
      const { st: it, onCommit: commit } = live.current;
      commit({ ...it, x: Math.round(cur.current.x * 10) / 10, y: Math.round(cur.current.y * 10) / 10, s: Math.round(cur.current.s * 100) / 100 });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.host,
      onMoveShouldSetPanResponder: () => live.current.host,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { dragging.current = true; moved = false; start = cur.current; base = 0; },
      onPanResponderMove: (e, g) => {
        const { w, h } = live.current.box;
        const touches = e.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          const d = dist(touches);
          if (!base) { base = d; baseS = cur.current.s; return; }
          moved = true;
          apply({ ...cur.current, s: clamp((baseS * d) / base, MIN_S, MAX_S) });
          return;
        }
        if (Math.abs(g.dx) + Math.abs(g.dy) > 4) moved = true;
        if (base) { base = 0; start = { ...cur.current, x: cur.current.x - (g.dx / w) * 100, y: cur.current.y - (g.dy / h) * 100 }; }
        apply({ ...cur.current, x: clamp(start.x + (g.dx / w) * 100, 0, 92), y: clamp(start.y + (g.dy / h) * 100, 0, 92) });
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, []);

  return (
    <View {...pan.panHandlers} style={[s.item, { left: `${pos.x}%`, top: `${pos.y}%`, transform: [{ scale: pos.s }] }]}>
      <StickerBody st={st} />
      {host && selected && (
        <Pressable accessibilityLabel="Remove sticker from live" hitSlop={10} onPress={onHide} style={[s.close, { transform: [{ scale: 1 / pos.s }] }]}>
          <Text style={s.closeT}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

export function StickerLayer({ stickers, host, onHide, onCommit }: { stickers: LiveSticker[]; host: boolean; onHide: (id: number) => void; onCommit: (st: LiveSticker) => void }) {
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [picked, setPicked] = useState<number | null>(null);
  const shown = stickers.filter((st) => !st.hidden);
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 5 }]}
      onLayout={(e) => setBox({ w: Math.max(1, e.nativeEvent.layout.width), h: Math.max(1, e.nativeEvent.layout.height) })}>
      {shown.map((st) => (
        <StickerItem key={st.id} st={st} host={host} selected={picked === st.id} box={box}
          onTap={() => setPicked((p) => (p === st.id ? null : st.id))}
          onHide={() => { setPicked(null); onHide(st.id); }}
          onCommit={onCommit} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  item: { position: 'absolute', padding: 6 },
  text: { fontSize: 18, fontWeight: '900' },
  close: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  closeT: { color: '#fff', fontSize: 12, fontWeight: '900', lineHeight: 14 },
});
