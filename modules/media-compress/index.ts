import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export interface RenderSpec {
  segments?: { s: number; e: number }[];
  speed?: number;
  volume?: number;
  /** false = original video audio removed ("Use this sound"). */
  keepOriginal?: boolean;
  soundUrl?: string;
  soundVolume?: number;
  bitrate?: number;
  /** GPU beauty strength 0..1 (skin smoothing). */
  beauty?: number;
  /** Filter skin params [skinWarm, skinLift, clarity] (shader-side). */
  skin?: number[] | null;
  /** Filter bake (see colorSpecOf in editor/motion.ts). */
  color?: { brightness: number; contrast: number; saturation: number; hue: number; r: number; g: number; b: number } | null;
}
interface Native {
  compress(uri: string, bitrate: number): Promise<string>;
  render(uri: string, spec: RenderSpec): Promise<string>;
  slideshow?(uris: string[], spec: SlideshowSpec): Promise<string>;
  saveToGallery?(path: string, mime: string): Promise<string>;
  openUri?(uri: string, mime: string): Promise<boolean>;
}
export interface SlideshowSpec {
  seconds: number;
  soundUrl?: string;
  soundVolume?: number;
  color?: RenderSpec['color'];
}

/** Android-only: photos → one 1080x1920 H.264/AAC MP4 (sound trimmed to the slideshow). Throws the real error. */
export async function renderSlideshow(uris: string[], spec: SlideshowSpec): Promise<string> {
  if (!native?.slideshow) throw new Error('Slideshow export needs the latest Android app');
  return native.slideshow(uris, spec);
}
const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('MediaCompress') : null;

/** Android-only Media3 compression (≤1080p, ~4 Mbps). Returns the original URI on any failure or other platforms. */
export async function compressVideo(uri: string): Promise<string> {
  if (!native) return uri;
  // ~2.5 Mbps: roughly 720p quality, about 3× smaller than before → faster uploads and playback.
  try { return await native.compress(uri, 2_500_000); } catch { return uri; }
}

/** Android-only low-bitrate copy (~700 kbps) for weak networks. Returns the original URI on failure. */
export async function compressVideoLow(uri: string): Promise<string> {
  if (!native) return uri;
  try { return await native.compress(uri, 700_000); } catch { return uri; }
}

/** Android-only on-device mux (segments + speed + sound → one MP4). Returns null when unavailable or failed. */
export async function renderVideo(uri: string, spec: RenderSpec): Promise<string | null> {
  if (!native?.render) return null;
  try { return await native.render(uri, { bitrate: 2_500_000, ...spec }); } catch { return null; }
}

/** Same as renderVideo but rejects with the native error message (download step diagnostics). */
export async function renderVideoStrict(uri: string, spec: RenderSpec): Promise<string> {
  if (!native?.render) throw new Error('Render needs the latest Android app');
  return native.render(uri, { bitrate: 8_000_000, ...spec });
}

/** Android: MediaStore insert into Pictures/BeeTook or Movies/BeeTook; returns content:// URI. */
export async function saveToMediaStore(path: string, mime: string): Promise<string> {
  if (!native?.saveToGallery) throw new Error('Gallery save needs the latest Android app');
  return native.saveToGallery(path, mime);
}
/** Android: opens a content:// URI in the default viewer/player (ACTION_VIEW + read grant). */
export async function openMediaUri(uri: string, mime: string): Promise<void> {
  if (!native?.openUri) throw new Error('Open needs the latest Android app');
  await native.openUri(uri, mime);
}
