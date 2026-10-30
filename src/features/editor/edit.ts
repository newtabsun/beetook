/** Serializable edit result shared by the post flow, drafts and feed (mirrors web EditResult subset). */
export interface TextOverlay { value: string; color: string; y: number; bg: boolean }
export type Inset = { t: number; r: number; b: number; l: number };

/** Sticker / label / media overlay (web `Overlay` parity). Positions are % of the frame. */
export interface ObjOverlay {
  id: string;
  kind: 'sticker' | 'label' | 'media';
  content: string;
  styleId?: string;
  mediaType?: 'image' | 'video';
  x: number;
  y: number;
  size: number;
  opacity: number;
  rotate: number;
  start?: number;
  end?: number;
}

/** A timed video transition effect (web `VideoFx` parity). */
export interface VideoFx { id: string; type: string; at: number; dur: number }

export interface MediaEdit {
  themeId?: number;
  seconds?: number;
  trimStart?: number;
  trimEnd?: number;
  /** Trim/split/delete result; when set it overrides trimStart/trimEnd. */
  segments?: Seg[];
  speed?: number;
  muted?: boolean;
  filter?: string;
  /** Beauty (skin smoothing) strength 0..1; baked on Android by Media3 GPU shader. */
  beauty?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  text?: TextOverlay;
  crop?: Inset;
  /** Free crop, normalized 0–1; the area is cover-scaled to fill the frame. */
  cropRect?: { x: number; y: number; w: number; h: number };
  /** Crop ratio lock (width/height), 0 = free. */
  cropAspect?: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  overlays?: ObjOverlay[];
  fx?: VideoFx[];
  /** "Use this sound": original video audio is muted and this sound plays in sync. */
  soundId?: string;
  soundUrl?: string;
  /** Cloudflare Stream uid of a pre-baked MP4 (video + final audio) used for downloads as-is. */
  dlUid?: string;
  /** Photo posts: ~480px previews (same order as sources), shown first on slow networks. */
  thumbs?: string[];
  /** Low-bitrate copy of a Storage (non-Stream) video, used on weak networks and with Data Saver. */
  lowUrl?: string;
  soundTitle?: string;
  /** Seconds of the sound used (= recorded video length); playback stops the sound here. */
  soundDuration?: number;
  /** Original video sound level 0–1 (default 1). */
  volume?: number;
  /** Added sound level 0–1 (default 1). */
  soundVolume?: number;
  /** Added in the editor: original video sound keeps playing (mixed) and the added sound loops. */
  mix?: boolean;
  /** Duet: original post shown as a floating video; x/y/scale normalized to the frame (0–1). */
  duet?: { postId: string; url: string; username: string; soundId?: string | null; x: number; y: number; scale: number };
}

/** Kept clip ranges (source seconds) after trim/split/delete; played back-to-back. */
export type Seg = { s: number; e: number };

export function segmentsOf(e: MediaEdit | undefined, dur: number): Seg[] {
  if (e?.segments?.length) return e.segments;
  return [{ s: e?.trimStart ?? 0, e: e?.trimEnd || dur }];
}

/** Position on the edited timeline (gaps removed) for source time t. */
export function editedTime(e: MediaEdit | undefined, t: number, dur: number): number {
  let acc = 0;
  for (const g of segmentsOf(e, dur)) {
    if (t < g.s) return acc;
    if (t <= g.e) return acc + t - g.s;
    acc += g.e - g.s;
  }
  return acc;
}

export function editedLength(e: MediaEdit | undefined, dur: number): number {
  return segmentsOf(e, dur).reduce((a, g) => a + Math.max(0, g.e - g.s), 0);
}

/** Seek target when t is outside the kept segments (skips deleted gaps, loops to the first one); null = keep playing. */
export function segJump(e: MediaEdit | undefined, t: number, dur: number): number | null {
  const segs = segmentsOf(e, dur);
  for (const g of segs) {
    if (t < g.s - 0.05) return g.s;
    if (t < g.e - 0.03) return null;
  }
  return segs[0].s;
}

export const NO_CROP: Inset = { t: 0, r: 0, b: 0, l: 0 };
export const SLIDE_SECONDS = [1, 1.5, 2, 3, 5];
export const VIDEO_SPEEDS = [0.5, 1, 1.5, 2];
export const DEFAULT_THEME_ID = 901;
export const uid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
