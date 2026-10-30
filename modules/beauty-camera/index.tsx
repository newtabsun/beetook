import { forwardRef, useEffect, useImperativeHandle, useRef, type ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { colorSpecOf, skinOf } from '../../src/features/editor/motion';

type NativeProps = ViewProps & {
  beauty: number; color: Record<string, number> | null; facing: 'front' | 'back'; torch: boolean;
  onReady?: () => void; onCameraError?: (e: { nativeEvent: { message: string } }) => void;
};
type NativeRef = {
  takePicture(flash: boolean): Promise<string>;
  startRecording(mute: boolean, maxSeconds: number): Promise<string>;
  stopRecording(): Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Native: ComponentType<any> | null = null;
if (Platform.OS === 'android') {
  try { Native = requireNativeViewManager('BeautyCamera'); } catch { Native = null; }
}
/** True when the native GPU beauty camera is linked into this build (Android only). */
/** Feature flag (T27 off, T28 on after single-rotation/aspect fix; 2s first-frame watchdog → expo-camera): the native GL preview showed rotated/distorted frames on device (vC25). Until its
 *  rotation/aspect mapping is verified on real phones, the stable expo-camera path is used everywhere;
 *  beauty + filter are still baked at export by Media3 (BeautyEffect). Flip to true to re-enable. */
export const NATIVE_BEAUTY_CAMERA_ENABLED = false;
export const beautyCameraAvailable = NATIVE_BEAUTY_CAMERA_ENABLED && !!Native;

export interface BeautyCameraHandle {
  takePicture(flash: boolean): Promise<string>;
  record(mute: boolean, maxSeconds: number): Promise<string>;
  stop(): void;
}
export interface BeautyCameraProps extends ViewProps {
  /** 0..100 */
  beauty: number; filter: string; facing: 'front' | 'back'; torch: boolean;
  onReady?: () => void; onError?: (message: string) => void; onDiag?: (text: string) => void;
}

/** Maps the shared filter spec (colorSpecOf) to the shader's grade uniforms. */
function gradeOf(filter: string): Record<string, number> | null {
  const s = colorSpecOf(filter); const k = skinOf(filter);
  if (!s && !k) return null;
  const fx: Record<string, number> = k ? { skinWarm: k[0], skinLift: k[1], clarity: k[2] } : {};
  if (!s) return fx;
  return { ...fx, brightness: s.brightness, contrast: 1 + s.contrast, saturation: 1 + s.saturation / 100, r: s.r, g: s.g, b: s.b, warmth: 0 };
}

export const BeautyCamera = forwardRef<BeautyCameraHandle, BeautyCameraProps>(function BeautyCamera(
  { beauty, filter, facing, torch, onReady, onError, onDiag, ...rest }, ref) {
  const n = useRef<NativeRef>(null);
  useImperativeHandle(ref, () => ({
    takePicture: (flash) => (n.current ? n.current.takePicture(flash) : Promise.reject(new Error('Camera is not ready yet.'))),
    record: (mute, max) => (n.current ? n.current.startRecording(mute, max) : Promise.reject(new Error('Camera is not ready yet.'))),
    stop: () => { void n.current?.stopRecording().catch(() => undefined); },
  }), []);
  const shown = useRef(false);
  const errRef = useRef(onError); errRef.current = onError;
  useEffect(() => {
    const t = setTimeout(() => { if (!shown.current) errRef.current?.('No camera frame within 2s'); }, 2500);
    return () => clearTimeout(t);
  }, [facing]);
  const N = Native;
  if (!N) return null;
  return (
    <N ref={n} {...rest} beauty={beauty} color={gradeOf(filter)} facing={facing} torch={torch}
      onReady={() => onReady?.()} onFirstFrame={() => { shown.current = true; }} onDiag={(e: { nativeEvent: { text: string } }) => onDiag?.(e.nativeEvent.text)} onCameraError={(e: { nativeEvent: { message: string } }) => onError?.(e.nativeEvent.message)} />
  );
});
