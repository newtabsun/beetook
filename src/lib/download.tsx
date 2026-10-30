// In-app post download: always ONE playable MP4 with video + audio, saved to the gallery, with a % overlay.
// Stream posts → Cloudflare Stream MP4 download (stream-download Edge Function, waits until ready).
// Storage posts → the MP4 itself. Posts whose added sound is a separate file → muxed on device (Android Media3);
// if that is impossible the download is refused instead of saving a silent/wrong file.
import * as FileSystem from 'expo-file-system/legacy';
import type * as MediaLibraryT from 'expo-media-library';
// Loaded lazily: the native module does not exist on web and throws at import time.
const ml = (): typeof MediaLibraryT => require('expo-media-library');
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { openMediaUri, renderSlideshow, renderVideoStrict as renderVideo, saveToMediaStore } from '../../modules/media-compress';
import type { Post } from './api';
import { notify } from './notify';
import { supabase } from './supabase';

type State = { label: string; pct: number } | null;
let state: State = null;
let cancelFn: (() => void) | null = null;
const subs = new Set<(s: State) => void>();
const set = (s: State) => { state = s; subs.forEach((f) => f(s)); };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const streamUidOf = (p: Post): string | null =>
  (p as Post & { stream_uid?: string | null }).stream_uid ?? p.media_urls[0]?.match(/videodelivery\.net\/([a-f0-9]{32})\//)?.[1] ?? null;

class Cancelled extends Error {}

/** Asks Stream for the MP4 rendition and waits (≤3 min) until it is ready. */
async function streamMp4(uid: string, isCancelled: () => boolean): Promise<string> {
  for (let i = 0; i < 90; i++) {
    if (isCancelled()) throw new Cancelled();
    const { data, error } = await supabase.functions.invoke('stream-download', { body: { uid } });
    if (error || !data?.status) throw new Error(data?.error || error?.message || 'Could not prepare the download');
    if (data.status === 'ready' && data.url) return data.url as string;
    if (data.status === 'error') throw new Error('The video could not be prepared for download');
    set({ label: 'Preparing video', pct: Math.round((data.percent ?? 0) * 0.3) });
    await sleep(2000);
  }
  throw new Error('Preparing the download took too long. Please try again.');
}

/** Checks the saved file is a real MP4/MOV (ftyp box) and not an HLS manifest / HTML / empty file. */
async function assertMp4(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !info.size || info.size < 10_000) throw new Error('The downloaded file is empty or incomplete');
  const head = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 12 });
  const bytes = atob(head);
  if (bytes.slice(4, 8) !== 'ftyp') throw new Error('The server did not return a video file');
}

/** JPEG/PNG/WebP magic check for downloaded photos. */
async function assertImage(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !info.size || info.size < 1_000) throw new Error('The downloaded photo is empty or incomplete');
  const b = atob(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 12 }));
  const ok = (b.charCodeAt(0) === 0xff && b.charCodeAt(1) === 0xd8) || b.slice(1, 4) === 'PNG' || b.slice(8, 12) === 'WEBP';
  if (!ok) throw new Error('The server did not return an image file');
}

type Saved = { uri: string; mime: string };
let saved: Saved | null = null;
/** Saves to the gallery. Android: MediaStore first (no permission needed on 10+), expo-media-library fallback.
 *  Success only with a real content/asset URI; every failure carries the failing step. */
async function saveToGallery(uri: string) {
  const mime = /\.mp4$/i.test(uri) ? 'video/mp4' : /\.png$/i.test(uri) ? 'image/png' : 'image/jpeg';
  const errs: string[] = [];
  if (Platform.OS === 'android') {
    try { saved = { uri: await saveToMediaStore(uri, mime), mime }; return; } catch (e) { errs.push((e as Error).message); }
  }
  try {
    await ensurePermission();
    const M = ml();
    const asset = await M.createAssetAsync(uri);
    if (!asset?.id) throw new Error('createAssetAsync returned no asset');
    let out = asset.uri;
    try { const i = await M.getAssetInfoAsync(asset); out = i.localUri || asset.uri; } catch { /* keep asset uri */ }
    try {
      const album = await M.getAlbumAsync('Bee Took');
      if (album) await M.addAssetsToAlbumAsync([asset], album, true); else await M.createAlbumAsync('Bee Took', asset, true);
    } catch { /* album optional */ }
    saved = { uri: out, mime }; return;
  } catch (e) { errs.push(`MediaLibrary: ${(e as Error).message}`); }
  throw new Error(`Save to gallery failed — ${errs.join(' | ')}`);
}

function completed() {
  const s = saved; saved = null;
  if (!s) return notify('Download complete');
  Alert.alert('Completed', 'Saved to your gallery (Bee Took).', [
    { text: 'Close', style: 'cancel' },
    { text: 'Open', onPress: () => { void openMediaUri(s.uri, s.mime).catch((e) => notify('Could not open', (e as Error).message)); } },
  ]);
}

async function ensurePermission() {
  const M = ml();
  let perm = await M.getPermissionsAsync(true);
  if (!perm.granted) perm = await M.requestPermissionsAsync(true);
  if (!perm.granted) throw new Error('Allow photo/video access in Settings to save downloads');
}

/** Photo posts: 1 photo without sound → JPEG; otherwise a 1080p MP4 slideshow (Android, sound trimmed to length). */
async function downloadPhotos(p: Post, isCancelled: () => boolean, files: string[]) {
  const e = p.edit ?? undefined;
  const urls = p.media_urls.filter(Boolean);
  const local: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    if (isCancelled()) throw new Cancelled();
    const ext = urls[i].match(/\.(png|webp|jpe?g)(\?|$)/i)?.[1]?.toLowerCase() ?? 'jpg';
    const to = `${FileSystem.cacheDirectory}bee-dl-${p.id}-${i}-${Date.now()}.${ext}`;
    files.push(to);
    const r = await FileSystem.downloadAsync(urls[i], to);
    if (r.status !== 200) throw new Error(`Fetch failed: HTTP ${r.status} ${urls[i].slice(0, 80)}`);
    await assertImage(r.uri);
    local.push(r.uri);
    set({ label: 'Downloading photos', pct: Math.round(((i + 1) / urls.length) * 40) });
  }
  const sound = e?.soundUrl && /^https?:/.test(e.soundUrl) ? e.soundUrl : undefined;
  if (local.length === 1 && !sound) { set({ label: 'Saving', pct: 99 }); await saveToGallery(local[0]); return; }
  if (Platform.OS !== 'android') throw new Error('Slideshows can be downloaded in the Android app');
  set({ label: 'Making video', pct: 50 });
  const c = undefined;
  const mp4 = await renderSlideshow(local, { seconds: Math.max(0.3, e?.seconds ?? 2), soundUrl: sound, soundVolume: e?.soundVolume, color: c })
    .catch(async (er) => { notify('Slideshow: retrying without filter', (er as Error).message.slice(0, 120)); return renderSlideshow(local, { seconds: Math.max(0.3, e?.seconds ?? 2), soundUrl: sound, soundVolume: e?.soundVolume }); })
    .catch((er) => { throw new Error(`Render: ${(er as Error).message}`); });
  if (isCancelled()) throw new Cancelled();
  files.push(mp4);
  await assertMp4(mp4).catch((er) => { throw new Error(`Render: ${(er as Error).message}`); });
  set({ label: 'Saving', pct: 99 });
  await saveToGallery(mp4);
}

export async function downloadPost(p: Post): Promise<void> {
  if (state) return notify('A download is already running');
  if (p.allow_download === false) return notify('The creator turned off downloads for this post');
  if (!p.media_urls[0]) return notify('Nothing to download');
  if (p.edit?.dlUid) { await downloadBaked(p, p.edit.dlUid); return; }
  if (p.kind === 'photos') {
    let cancelled = false;
    const files: string[] = [];
    cancelFn = () => { cancelled = true; };
    set({ label: 'Starting', pct: 0 });
    try {
      if (Platform.OS === 'web') { await webDownload(p.media_urls[0], `beetook-${p.id}.jpg`, () => cancelled, true); return; }
      await downloadPhotos(p, () => cancelled, files);
      completed();
    } catch (err) {
      if (err instanceof Cancelled || cancelled) notify('Download cancelled');
      else notify('Download failed', (err as Error).message || 'Check your connection and try again');
    } finally {
      files.forEach((f) => void FileSystem.deleteAsync(f, { idempotent: true }).catch(() => undefined));
      cancelFn = null; set(null);
    }
    return;
  }
  const e = p.edit ?? undefined;
  const separateSound = !!e?.soundUrl && /^https?:/.test(e.soundUrl);
  if (separateSound && Platform.OS !== 'android') return notify('This video uses a separate sound and can only be downloaded in the Android app');
  let cancelled = false;
  let task: FileSystem.DownloadResumable | null = null;
  cancelFn = () => { cancelled = true; void task?.cancelAsync().catch(() => undefined); };
  set({ label: 'Starting', pct: 0 });
  const tmp = `${FileSystem.cacheDirectory}bee-dl-${p.id}-${Date.now()}.mp4`;
  try {
    const uid = streamUidOf(p);
    const src = uid ? await streamMp4(uid, () => cancelled) : p.media_urls[0];
    if (/\.m3u8(\?|$)/.test(src)) throw new Error('This video is not available as a file yet');
    if (cancelled) throw new Cancelled();
    if (Platform.OS === 'web') { await webDownload(src, `beetook-${p.id}.mp4`, () => cancelled); return; }
    const base = uid ? 30 : 0;
    task = FileSystem.createDownloadResumable(src, tmp, {}, ({ totalBytesWritten: w, totalBytesExpectedToWrite: t }) => {
      if (t > 0) set({ label: 'Downloading', pct: Math.min(99, Math.round(base + (w / t) * (separateSound ? 60 : 100 - base))) });
    });
    const res = await task.downloadAsync();
    if (cancelled || !res) throw new Cancelled();
    if (res.status !== 200) throw new Error(`Download failed (HTTP ${res.status})`);
    await assertMp4(res.uri);
    let final = res.uri;
    if (separateSound && e) {
      set({ label: 'Adding sound', pct: 92 });
      // T29: full edit render → plain sound mux → original file. A post never ends without a saved file.
      const keep = !e.muted && !!e.mix;
      const tries: [string, Parameters<typeof renderVideo>[1]][] = [
        ['render', { segments: e.segments?.length ? e.segments : undefined, speed: e.speed, volume: e.volume, keepOriginal: keep, soundUrl: e.soundUrl, soundVolume: e.soundVolume }],
        ['mux', { keepOriginal: keep, soundUrl: e.soundUrl, soundVolume: e.soundVolume }],
      ];
      const errs: string[] = [];
      for (const [step, spec] of tries) {
        try {
          const out = await renderVideo(res.uri, spec);
          await assertMp4(out); final = out; break;
        } catch (er) { errs.push(`${step}: ${(er as Error).message}`); }
      }
      if (final === res.uri) notify('Saved without the edit', errs.join(' | ').slice(0, 160));
    }
    set({ label: 'Saving', pct: 99 });
    await saveToGallery(final);
    if (final !== res.uri) void FileSystem.deleteAsync(final, { idempotent: true }).catch(() => undefined);
    completed();
  } catch (err) {
    if (err instanceof Cancelled || cancelled) notify('Download cancelled');
    else notify('Download failed', (err as Error).message || 'Check your connection and try again');
  } finally {
    if (Platform.OS !== 'web') void FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => undefined);
    cancelFn = null; set(null);
  }
}

/** T32: pre-baked MP4 (picture + final audio already mixed) → saved exactly as stored. Steps are named in errors. */
async function downloadBaked(p: Post, uid: string) {
  let cancelled = false;
  let task: FileSystem.DownloadResumable | null = null;
  cancelFn = () => { cancelled = true; void task?.cancelAsync().catch(() => undefined); };
  set({ label: 'Starting', pct: 0 });
  const tmp = `${FileSystem.cacheDirectory}bee-dl-${p.id}-${Date.now()}.mp4`;
  let step = 'Prepare';
  try {
    const src = await streamMp4(uid, () => cancelled);
    if (Platform.OS === 'web') { step = 'Download'; await webDownload(src, `beetook-${p.id}.mp4`, () => cancelled); return; }
    step = 'Download';
    task = FileSystem.createDownloadResumable(src, tmp, {}, ({ totalBytesWritten: w, totalBytesExpectedToWrite: t }) => {
      if (t > 0) set({ label: 'Downloading', pct: Math.min(98, Math.round(30 + (w / t) * 68)) });
    });
    const res = await task.downloadAsync();
    if (cancelled || !res) throw new Cancelled();
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    step = 'Check file'; await assertMp4(res.uri);
    step = 'Save'; set({ label: 'Saving', pct: 99 }); await saveToGallery(res.uri);
    completed();
  } catch (err) {
    if (err instanceof Cancelled || cancelled) notify('Download cancelled');
    else notify('Download failed', `${step}: ${(err as Error).message || 'Check your connection and try again'}`);
  } finally {
    if (Platform.OS !== 'web') void FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => undefined);
    cancelFn = null; set(null);
  }
}

async function webDownload(src: string, name: string, isCancelled: () => boolean, image = false) {
  const r = await fetch(src);
  if (!r.ok || !r.body) throw new Error(`Download failed (HTTP ${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  const reader = r.body.getReader();
  const parts: BlobPart[] = []; let got = 0;
  for (;;) {
    if (isCancelled()) { void reader.cancel(); throw new Cancelled(); }
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) set({ label: 'Downloading', pct: Math.min(99, Math.round((got / total) * 100)) });
  }
  const blob = new Blob(parts, { type: image ? 'image/jpeg' : 'video/mp4' });
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (!image && String.fromCharCode(...head.slice(4, 8)) !== 'ftyp') throw new Error('The server did not return a video file');
  if (image && blob.size < 1_000) throw new Error('The downloaded photo is empty');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  notify('Download complete');
}

/** Small % overlay shown while a download runs (mounted once in App). */
export function DownloadOverlay() {
  const [s, setS] = useState<State>(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  if (!s) return null;
  return (
    <View pointerEvents="box-none" style={st.wrap}>
      <View style={st.box} accessibilityLabel={`Download ${s.pct}%`}>
        <ActivityIndicator color="#FFA500" size="small" />
        <View style={{ flex: 1 }}>
          <Text style={st.t}>{s.label} · {s.pct}%</Text>
          <View style={st.track}><View style={[st.fill, { width: `${s.pct}%` }]} /></View>
        </View>
        <Pressable accessibilityLabel="Cancel download" onPress={() => cancelFn?.()} style={st.x}><Text style={st.xT}>✕</Text></Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', top: 54, left: 16, right: 16, alignItems: 'center', zIndex: 999, elevation: 30 },
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', maxWidth: 360, backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  t: { color: '#fff', fontWeight: '800', fontSize: 13, marginBottom: 6 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#FFA500' },
  x: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  xT: { color: '#fff', fontWeight: '900' },
});
