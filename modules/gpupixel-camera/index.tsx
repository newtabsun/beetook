// GPUPixel beauty camera (Android): Camera2 → GPUPixel BeautyFace (smoothing/whitening) → preview / JPEG / MP4.
// The only camera. Errors → silent restart ×3, then a Retry button.
import { forwardRef, useImperativeHandle, useRef, useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewProps } from 'react-native';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { BeautyLevels, BeautyCameraHandle } from './types';

export type { BeautyLevels, BeautyCameraHandle } from './types';

type NativeRef = {
  setLevels(s: number, w: number): Promise<void>;
  takePicture(): Promise<string>;
  startRecording(mute: boolean, maxSeconds: number): Promise<string>;
  stopRecording(): Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Native: ComponentType<any> | null = null;
try { Native = requireNativeViewManager('GpuPixelCamera'); } catch { Native = null; }

// LiveKit bridge: the native module owns the beauty levels; the camera track gets the "gpupixel-beauty" frame effect.
let NativeMod: { setLiveBeauty(s: number, w: number): void; jsBeat?(): void; jsBeatStop?(): void; jsMark?(l: string): void } | null = null;
try { NativeMod = requireNativeModule('GpuPixelCamera'); } catch { NativeMod = null; }
/** Freeze watchdog (native): heartbeat while a live is open, and step marks that survive a frozen JS thread. */
export function jsBeat() { if (!__DEV__) return; try { NativeMod?.jsBeat?.(); } catch { /* optional */ } }
export function jsBeatStop() { try { NativeMod?.jsBeatStop?.(); } catch { /* optional */ } }
export function jsMark(line: string) { if (!__DEV__) return; try { NativeMod?.jsMark?.(line); } catch { /* optional */ } }
export function setLiveBeauty(l: BeautyLevels) { try { NativeMod?.setLiveBeauty(l.smoothing, l.whitening); } catch { /* beauty is optional */ } }
/** on: the GPUPixel frame effect is inserted into the camera track; off: no processor at all (raw WebRTC camera). */
export function attachLiveBeauty(track: unknown, on = true) {
  try {
    (track as { _setVideoEffects?: (n: string[] | null) => void })._setVideoEffects?.(on ? ['gpupixel-beauty'] : null);
  } catch { /* raw camera is used */ }
}

export interface BeautyCameraProps extends ViewProps { facing: 'front' | 'back'; torch: boolean; levels: BeautyLevels }

const MAX_RETRY = 3;

export const BeautyCamera = forwardRef<BeautyCameraHandle, BeautyCameraProps>(function BeautyCamera({ facing, torch, levels, style }, ref) {
  const n = useRef<NativeRef>(null);
  const lv = useRef(levels); lv.current = levels;
  const [gen, setGen] = useState(0);
  const [failed, setFailed] = useState(false);
  const tries = useRef(0);
  const push = (l: BeautyLevels) => { void n.current?.setLevels(l.smoothing, l.whitening).catch(() => undefined); };
  useImperativeHandle(ref, () => ({
    setLevels: push,
    takePicture: () => (n.current ? n.current.takePicture() : Promise.reject(new Error('Camera is not ready yet.'))),
    record: (mute, max) => (n.current ? n.current.startRecording(mute, max) : Promise.reject(new Error('Camera is not ready yet.'))),
    stop: () => { void n.current?.stopRecording().catch(() => undefined); },
  }), []);
  push(levels);
  const onError = () => {
    if (tries.current < MAX_RETRY) { tries.current += 1; setTimeout(() => setGen((g) => g + 1), 400 * tries.current); } else setFailed(true);
  };
  const N = Native;
  return (
    <View style={[style, { backgroundColor: '#000' }]}>
      {N && !failed ? (
        <N key={gen} ref={n} style={StyleSheet.absoluteFill} facing={facing} torch={torch}
          onFirstFrame={() => { tries.current = 0; push(lv.current); }} onCameraError={onError} />
      ) : (
        <View style={s.center}>
          <Pressable accessibilityLabel="Retry camera" onPress={() => { tries.current = 0; setFailed(false); setGen((g) => g + 1); }} style={s.btn}><Text style={s.t}>Retry</Text></Pressable>
        </View>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: '#FFA500', borderRadius: 22, paddingHorizontal: 26, paddingVertical: 11 },
  t: { color: '#000', fontWeight: '900' },
});
