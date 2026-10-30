// Duet: floating original video over the camera / recorded video. Drag with one finger, pinch (or ctrl/wheel on web) to zoom.
import { useVideoPlayer, VideoView } from 'expo-video';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View } from 'react-native';
import type { MediaEdit } from '../editor/edit';

export type DuetEdit = NonNullable<MediaEdit['duet']>;
export type DuetSource = Pick<DuetEdit, 'postId' | 'url' | 'username' | 'soundId'>;
export interface DuetLayout { x: number; y: number; scale: number }
export const DEFAULT_DUET_LAYOUT: DuetLayout = { x: 0.57, y: 0.12, scale: 0.4 };
const MIN_SCALE = 0.3;
const MAX_SCALE = 1;
const DRIFT = 0.35;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type PlayerProps = { url: string; time: number; playing: boolean; muted?: boolean; onMeta: (dur: number, aspect: number) => void };

/** Web <video>: shows its first frame immediately and follows the master time. */
function WebDuetVideo({ url, time, playing, muted, onMeta }: PlayerProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !!muted;
    if (!playing || (v.duration > 0 && time >= v.duration - 0.05)) { v.pause(); return; }
    if (Math.abs(v.currentTime - time) > DRIFT) v.currentTime = time;
    if (v.paused) void v.play().catch(() => { v.muted = true; void v.play().catch(() => undefined); });
  }, [time, playing]);
  useEffect(() => { const v = ref.current; return () => { if (v) { v.pause(); v.removeAttribute('src'); v.load(); } }; }, []);
  return createElement('video', {
    ref, src: url, preload: 'auto', playsInline: true, crossOrigin: 'anonymous',
    onLoadedMetadata: (e: { currentTarget: HTMLVideoElement }) => {
      const v = e.currentTarget;
      onMeta(v.duration || 0, v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 9 / 16);
      if (v.currentTime === 0) v.currentTime = 0.05;
    },
    style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#111' },
  });
}

/** Native expo-video player following the master time. */
function NativeDuetVideo({ url, time, playing, muted, onMeta }: PlayerProps) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.pause(); });
  const meta = useRef(onMeta);
  meta.current = onMeta;
  useEffect(() => {
    const id = setInterval(() => {
      if (player.duration > 0) {
        const size = (player as unknown as { videoTrack?: { size?: { width: number; height: number } } }).videoTrack?.size;
        meta.current(player.duration, size?.width && size.height ? size.width / size.height : 9 / 16);
        clearInterval(id);
      }
    }, 400);
    return () => clearInterval(id);
  }, [player]);
  useEffect(() => {
    try {
      player.muted = !!muted;
      if (!playing || (player.duration > 0 && time >= player.duration - 0.05)) { player.pause(); return; }
      if (Math.abs(player.currentTime - time) > DRIFT) player.currentTime = time;
      if (!player.playing) player.play();
    } catch { /* released */ }
  }, [player, time, playing]);
  useEffect(() => () => { try { player.pause(); } catch { /* released */ } }, [player]);
  // Hidden until THIS player renders a frame: avoids a stale frame of a previous duet flashing on a reused surface.
  const [shown, setShown] = useState(false);
  return <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }]} contentFit="cover" nativeControls={false} surfaceType="textureView" onFirstFrameRender={() => setShown(true)} />;
}

export function DuetLayer({ url, layout, cw, ch, time, playing, muted, onChange, onDuration }: {
  url: string; layout: DuetLayout; cw: number; ch: number; time: number; playing: boolean; muted?: boolean;
  onChange?: (l: DuetLayout) => void; onDuration?: (d: number) => void;
}) {
  const [aspect, setAspect] = useState(9 / 16);
  const live = useRef({ layout, cw, ch, aspect, onChange });
  live.current = { layout, cw, ch, aspect, onChange };
  const box = useRef<View>(null);

  const fit = (l: DuetLayout): DuetLayout => {
    const { cw: w, ch: h, aspect: a } = live.current;
    const scale = clamp(l.scale, MIN_SCALE, Math.min(MAX_SCALE, (h * a) / w));
    const bw = scale * w;
    const bh = bw / a;
    return { scale, x: clamp(l.x, 0, Math.max(0, 1 - bw / w)), y: clamp(l.y, 0, Math.max(0, 1 - bh / h)) };
  };

  const pan = useMemo(() => {
    let start: DuetLayout = DEFAULT_DUET_LAYOUT;
    let pinchBase = 0;
    let pinchScale = 1;
    const dist = (t: readonly { pageX: number; pageY: number }[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !!live.current.onChange,
      onMoveShouldSetPanResponder: () => !!live.current.onChange,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start = live.current.layout; pinchBase = 0; },
      onPanResponderMove: (e, g) => {
        const { onChange: set, cw: w, ch: h, layout: cur } = live.current;
        const touches = e.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          const d = dist(touches);
          if (!pinchBase) { pinchBase = d; pinchScale = cur.scale; return; }
          set?.(fit({ ...cur, scale: (pinchScale * d) / pinchBase }));
          return;
        }
        if (pinchBase) { pinchBase = 0; start = { ...cur, x: cur.x - g.dx / w, y: cur.y - g.dy / h }; }
        set?.(fit({ ...start, x: start.x + g.dx / w, y: start.y + g.dy / h }));
      },
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !onChange) return undefined;
    const el = box.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return undefined;
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const cur = live.current.layout;
      live.current.onChange?.(fit({ ...cur, scale: cur.scale * (ev.deltaY < 0 ? 1.06 : 0.94) }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [!!onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const l = fit(layout);
  const bw = l.scale * cw;
  const Player = Platform.OS === 'web' ? WebDuetVideo : NativeDuetVideo;
  return (
    <View ref={box} testID="duet-overlay" {...pan.panHandlers}
      style={[s.box, { left: l.x * cw, top: l.y * ch, width: bw, height: bw / aspect }, Platform.OS === 'web' ? ({ touchAction: 'none', cursor: onChange ? 'grab' : 'default' } as object) : null]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Player url={url} time={time} playing={playing} muted={muted} onMeta={(d, a) => { setAspect(a); onDuration?.(d); }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { position: 'absolute', borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: '#111', zIndex: 5 },
});
