import { Platform } from 'react-native';
// Single data-access layer for Supabase. All screens go through here.
import * as ImageManipulator from 'expo-image-manipulator';
import type { MediaEdit } from '../features/editor/edit';
import { BUCKET, RPC, supabase, T } from './supabase';
import { videoThumb } from './videoThumb';
import { compressVideo, compressVideoLow, renderSlideshow, renderVideo } from '../../modules/media-compress';
import { withRetry } from './retry';
import { invalidate } from './swr';
import { colorSpecOf } from '../features/editor/motion';

export const PAGE = 8;

/** Promotes my scheduled posts that are due (the server also does this every minute). Never throws. */
export async function publishDuePosts(): Promise<void> { await supabase.rpc('app_9e1318caf6_publish_due_posts').then(() => undefined, () => undefined); }

export interface Profile { id: string; is_private?: boolean; public_id?: number | null; username: string | null; display_name: string | null; bio: string; avatar_url: string | null; links: Record<string, string>; followers_count?: number; following_count?: number; likes_count?: number; views_count?: number }
export interface Post {
  id: string; user_id: string; kind: 'photos' | 'video'; media_urls: string[]; caption: string;
  status: 'draft' | 'scheduled' | 'published'; publish_at: string; edit: MediaEdit | null;
  like_count: number; comment_count: number; save_count: number; view_count?: number; share_count?: number; gift_count?: number;
  author?: (Pick<Profile, 'username' | 'display_name' | 'avatar_url'> & { links?: Record<string, string> | null }) | null;
  sound_name?: string | null; sound_id?: string | null; boosted_until?: string | null;
  caption_html?: string; thumbnail_url?: string | null; privacy?: 'everyone' | 'friends' | 'only_me';
  allow_download?: boolean; allow_comments?: boolean; allow_duet?: boolean; age_restricted?: boolean; location?: string;
  liked?: boolean; saved?: boolean; pinned?: boolean; partner_enabled?: boolean;
}
export interface Comment { id: string; body: string; body_html?: string | null; parent_id?: string | null; reply_to_user?: string | null; created_at: string; user_id: string; author?: { username: string | null; display_name?: string | null; avatar_url?: string | null; links?: Record<string, string> | null } | null }
export interface LiveRoom { id: string; host_id: string; title: string; category: string; cover_url: string | null; created_at: string; pin_coins?: number; mode?: 'video' | 'audio'; layout?: 'fullscreen' | 'seats' | 'seats2' | 'seats3'; bg?: string | null; join_fee?: number; host?: { display_name: string | null; username: string | null } | null }

/** Mention lookup: `@abebe` → that user's id (by handle, then by exact display name). */
export async function userIdByHandle(name: string): Promise<string | null> {
  const h = name.trim().replace(/^@+/, '');
  if (!h) return null;
  const a = await supabase.from('app_9e1318caf6_profiles').select('id').eq('username', h.toLowerCase()).maybeSingle();
  if (a.data) return (a.data as { id: string }).id;
  const b = await supabase.from('app_9e1318caf6_profiles').select('id').eq('display_name', h).limit(1);
  return ((b.data as { id: string }[] | null)?.[0]?.id) ?? null;
}

export function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function must<D>(r: { data: D; error: { message: string } | null }): D {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

async function uid(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please log in first');
  return session.user.id;
}

async function attachAuthors<X extends { user_id: string }>(rows: X[]): Promise<(X & { author: Post['author'] })[]> {
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (!ids.length) return rows.map((r) => ({ ...r, author: null }));
  const profs = must(await supabase.from(T.profiles).select('id,username,display_name,avatar_url,links').in('id', ids)) as (Profile)[];
  const map = new Map(profs.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, author: map.get(r.user_id) ?? null }));
}

export async function attachPostAuthors(rows: Post[]): Promise<Post[]> { return attachAuthors(rows); }

/** Feed page (cursor = publish_at of last item). With `after`, returns only posts newer than it. */
export async function fetchFeed(before?: string, after?: string): Promise<Post[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const me = session?.user.id;
  let q = supabase.from(T.posts).select('*').in('status', ['published', 'scheduled'])
    .lte('publish_at', new Date().toISOString()).order('publish_at', { ascending: false }).limit(PAGE)
    .or(`privacy.is.null,privacy.neq.only_me${me ? `,user_id.eq.${me}` : ''}`);
  if (before) q = q.lt('publish_at', before);
  if (after) q = q.gt('publish_at', after);
  let rows = must(await q) as Post[];
  // "Friends/Followers" posts are shown only to the author's followers.
  const friendsOnly = [...new Set(rows.filter((r) => r.privacy === 'friends' && r.user_id !== me).map((r) => r.user_id))];
  if (friendsOnly.length) {
    const ok = new Set(me ? await fetchFollowing(friendsOnly) : []);
    rows = rows.filter((r) => r.privacy !== 'friends' || r.user_id === me || ok.has(r.user_id));
  }
  const withAuthors = await attachAuthors(rows);
  if (!session || !rows.length) return withAuthors;
  const ids = rows.map((r) => r.id);
  const [likes, saves] = await Promise.all([
    supabase.from(T.likes).select('post_id').in('post_id', ids),
    supabase.from(T.saves).select('post_id').in('post_id', ids),
  ]);
  const L = new Set((likes.data ?? []).map((x) => x.post_id)); const S = new Set((saves.data ?? []).map((x) => x.post_id));
  return withAuthors.map((p) => ({ ...p, liked: L.has(p.id), saved: S.has(p.id) }));
}

export async function toggleReaction(kind: 'like' | 'save', postId: string, on: boolean) {
  const me = await uid();
  const table = kind === 'like' ? T.likes : T.saves;
  if (on) {
    const r = await supabase.from(table).insert({ post_id: postId, user_id: me });
    if (r.error && r.error.code !== '23505') throw new Error(r.error.message);
  } else must(await supabase.from(table).delete().eq('post_id', postId).eq('user_id', me));
  invalidate('me:tab:');
}

export async function fetchComments(postId: string): Promise<Comment[]> {
  const rows = must(await supabase.from(T.comments).select('*').eq('post_id', postId).order('created_at', { ascending: true }).limit(500)) as Comment[];
  return attachAuthors(rows);
}
/** Adds a (formatted) comment or reply. Falls back to plain text if migration 010 is not applied yet. */
export async function addComment(postId: string, body: string, opts: { html?: string; parentId?: string; replyTo?: string } = {}) {
  const me = await uid();
  const base = { post_id: postId, user_id: me, body: body.trim().slice(0, 500) };
  const full = { ...base, body_html: opts.html ?? null, parent_id: opts.parentId ?? null, reply_to_user: opts.replyTo ?? null };
  const r = await supabase.from(T.comments).insert(full);
  if (r.error && /body_html|parent_id|reply_to_user|schema cache/i.test(r.error.message) && !opts.parentId) must(await supabase.from(T.comments).insert(base));
  else if (r.error) throw new Error(r.error.message);
}
export async function deleteComment(id: string) { must(await supabase.from(T.comments).delete().eq('id', id)); }
export async function fetchCommentCount(postId: string): Promise<number> {
  const r = must(await supabase.from(T.posts).select('comment_count').eq('id', postId).single()) as { comment_count: number };
  return r.comment_count ?? 0;
}

/** Uploads a local file (photos are resized/compressed first). Remote URLs are returned as-is. */
/** Uploads a picked audio file to the media bucket and returns its public URL. */
export async function uploadAudio(uri: string, name?: string, file?: Blob | null): Promise<string> {
  if (/^https?:/.test(uri)) return uri;
  const me = await uid();
  let res: Response | null = null;
  let buf: ArrayBuffer;
  if (file) buf = await file.arrayBuffer();
  else {
    // Android document-picker URIs (file:// cache copy or content://): fetch().arrayBuffer can fail there, so fall back to XHR.
    try { res = await fetch(uri); buf = await res.arrayBuffer(); } catch {
      buf = await new Promise<ArrayBuffer>((ok, bad) => {
        const x = new XMLHttpRequest(); x.responseType = 'arraybuffer';
        x.onload = () => ok(x.response as ArrayBuffer); x.onerror = () => bad(new Error('Could not read the audio file.'));
        x.open('GET', uri); x.send();
      });
    }
  }
  if (!buf.byteLength) throw new Error('The audio file is empty. Please choose it again.');
  const head = (file?.type || res?.headers.get('content-type'))?.split(';')[0].trim() ?? '';
  const ext = (name?.match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? (head.includes('wav') ? 'wav' : head.includes('ogg') ? 'ogg' : head.includes('amr') ? 'amr' : head.includes('mp4') || head.includes('aac') ? 'm4a' : 'mp3')).toLowerCase();
  const type = ext === 'm4a' || ext === 'aac' || head === 'audio/x-m4a' ? 'audio/mp4' : head.startsWith('audio/') ? head : ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : ext === 'amr' ? 'audio/amr' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
  const path = `${me}/audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  must(await supabase.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: false }));
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
// 5 MB tus chunks (Cloudflare minimum): small enough to retry cheaply on weak networks.
const TUS_CHUNK = 5 * 1024 * 1024;
export const streamHls = (uid: string) => `https://videodelivery.net/${uid}/manifest/video.m3u8`;

export { withRetry };

/** Direct upload to Cloudflare Stream (resumable tus, chunked, retried). Returns the Stream uid. */
export async function uploadToStream(uri: string, onFrac?: (f: number) => void): Promise<string> {
  const buf = await (await fetch(uri)).arrayBuffer();
  if (!buf.byteLength) throw new Error('The media file is empty. Please record or choose it again.');
  if (buf.byteLength > MAX_VIDEO_BYTES) throw new Error('Video is larger than 1 GB.');
  const { data } = await withRetry(async () => {
    const r = await supabase.functions.invoke('stream-upload-url', { body: { size: buf.byteLength } });
    if (r.error || !r.data?.uploadURL) throw new Error(r.data?.error || r.error?.message || 'Could not start the video upload');
    return r;
  });
  const url = data.uploadURL as string;
  let off = 0;
  while (off < buf.byteLength) {
    const from = off;
    off = await withRetry(async () => {
      const r = await fetch(url, {
        method: 'PATCH', body: buf.slice(from, from + TUS_CHUNK),
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(from), 'Content-Type': 'application/offset+octet-stream' },
      });
      if (r.ok) return Number(r.headers.get('Upload-Offset')) || Math.min(from + TUS_CHUNK, buf.byteLength);
      if (r.status === 409) {
        // Offset mismatch after a dropped request: ask the server where to resume.
        const h = await fetch(url, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
        const o = Number(h.headers.get('Upload-Offset'));
        if (h.ok && Number.isFinite(o)) return o;
      }
      throw new Error(`Video upload failed (${r.status})`);
    });
    onFrac?.(off / buf.byteLength);
  }
  return data.uid as string;
}

/** Records how long a post was watched (feeds post_scores). Silently ignored before migration 019. */
export async function recordWatch(postId: string, watchMs: number) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || watchMs < 500) return;
  await supabase.from(`${T.posts.replace('posts', 'view_events')}`).insert({ post_id: postId, user_id: session.user.id, watch_ms: Math.round(watchMs) });
}

/** For You page via feed_for_you RPC (70/20/10 mix, unseen first); falls back to the chronological feed. */
export async function fetchForYou(offset: number, before?: string): Promise<Post[]> {
  const r = await supabase.rpc('app_9e1318caf6_feed_for_you', { p_offset: offset, p_limit: PAGE });
  if (r.error) return fetchFeed(before);
  const rows = (r.data ?? []) as Post[];
  const withAuthors = await attachAuthors(rows);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !rows.length) return withAuthors;
  const ids = rows.map((x) => x.id);
  const [likes, saves] = await Promise.all([
    supabase.from(T.likes).select('post_id').in('post_id', ids),
    supabase.from(T.saves).select('post_id').in('post_id', ids),
  ]);
  const L = new Set((likes.data ?? []).map((x) => x.post_id)); const S = new Set((saves.data ?? []).map((x) => x.post_id));
  return withAuthors.map((p) => ({ ...p, liked: L.has(p.id), saved: S.has(p.id) }));
}

/** Longest photo side per use: avatars are shown ≤112 px, covers/thumbnails as posters. */
export const PHOTO_MAX = { post: 1080, cover: 720, avatar: 320 } as const;

export async function uploadMedia(uri: string, kind: 'photo' | 'video', maxSide: number = PHOTO_MAX.post): Promise<string> {
  if (/^https?:/.test(uri)) return uri;
  const me = await uid();
  let local = uri; let ext = 'jpg'; let type = 'image/jpeg';
  if (kind === 'photo') {
    // Longest side ≤ maxSide (1080 px for posts), JPEG 72%.
    const orig = await ImageManipulator.ImageManipulator.manipulate(uri).renderAsync();
    const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
    if (Math.max(orig.width, orig.height) > maxSide) ctx.resize(orig.width >= orig.height ? { width: maxSide } : { height: maxSide });
    const img = await ctx.renderAsync();
    local = (await img.saveAsync({ compress: 0.72, format: ImageManipulator.SaveFormat.JPEG })).uri;
  }
  const res = await fetch(local);
  const blobType = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error('The media file is empty. Please record or choose it again.');
  if (kind === 'video') {
    // blob:/data: URIs have no extension (previously produced keys like "x.dev/" → HTTP 400). Use the real
    // MIME (blob type or file signature) first, then a clean path extension.
    const head = new Uint8Array(buf.slice(0, 12));
    const sig = head[0] === 0x1a && head[1] === 0x45 ? 'webm' : String.fromCharCode(...head.slice(4, 8)) === 'ftyp'
      ? (String.fromCharCode(...head.slice(8, 10)) === 'qt' ? 'mov' : 'mp4') : '';
    const m = uri.match(/^(?:file|https?|content):.*\.([a-z0-9]{2,4})(?:[?#].*)?$/i)?.[1]?.toLowerCase();
    ext = sig || (blobType.includes('webm') ? 'webm' : blobType.includes('quicktime') ? 'mov' : m && ['mp4', 'mov', 'm4v', 'webm'].includes(m) ? m : 'mp4');
    type = ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  }
  const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await withRetry(async () => must(await supabase.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true })));
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const STICKER_MAX_SIDE = 720;
const STICKER_GIF_MAX_BYTES = 3 * 1024 * 1024;
/** Compresses (longest side ≤ 720 px; PNG/WebP stay transparent, others JPEG 78%) and uploads a live image sticker.
 *  GIFs are uploaded untouched so the animation survives (max 3 MB). */
export async function uploadStickerImage(uri: string, mime?: string | null, name?: string | null): Promise<string> {
  const me = await uid();
  const hint = `${mime ?? ''} ${name ?? ''} ${uri}`.toLowerCase();
  const isGif = /gif/.test(mime ?? '') || /\.gif(\?|#|$)/.test(name ?? uri.toLowerCase());
  const keepAlpha = !isGif && (/png|webp/.test(mime ?? '') || /\.(png|webp)(\?|#|$)/.test(name ?? uri.toLowerCase()) || /image\/(png|webp)/.test(hint));
  let local = uri; let ext = 'gif'; let type = 'image/gif';
  if (!isGif) {
    const orig = await ImageManipulator.ImageManipulator.manipulate(uri).renderAsync();
    const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
    if (Math.max(orig.width, orig.height) > STICKER_MAX_SIDE) ctx.resize(orig.width >= orig.height ? { width: STICKER_MAX_SIDE } : { height: STICKER_MAX_SIDE });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: 0.78, format: keepAlpha ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG });
    local = out.uri; ext = keepAlpha ? 'png' : 'jpg'; type = keepAlpha ? 'image/png' : 'image/jpeg';
  }
  const buf = await (await fetch(local)).arrayBuffer();
  if (!buf.byteLength) throw new Error('The image file is empty. Please choose it again.');
  if (isGif && buf.byteLength > STICKER_GIF_MAX_BYTES) throw new Error('This GIF is larger than 3 MB. Choose a smaller GIF.');
  const path = `${me}/sticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await withRetry(async () => must(await supabase.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true })));
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export interface PostSettings {
  thumbnail: string | null; privacy: 'everyone' | 'friends' | 'only_me'; download: boolean; comments: boolean;
  duet: boolean; ageRestricted: boolean; partner?: boolean;
}
export interface PostInput { id?: string; kind: Post['kind']; sources: string[]; caption: string; captionHtml: string; edit?: MediaEdit; scheduleAt?: number; settings: PostSettings }

/** Save as draft or publish/schedule. Uploads media (and custom thumbnail) first. */
export async function savePost(p: PostInput, mode: 'draft' | 'publish', onProgress?: (done: number, total: number) => void): Promise<'draft' | 'scheduled' | 'posted'> {
  const me = await uid();
  const total = p.sources.length + (p.settings.thumbnail ? 1 : 0) + 1;
  let done = 0;
  const tick = () => onProgress?.(++done, total);
  onProgress?.(0, total);
  const media_urls: string[] = [];
  let stream_uid: string | null = null;
  let baked = false;
  /** Set when the video went to Storage (no Stream ABR): a low-bitrate copy is uploaded too. */
  let lowSrc: string | null = null;
  for (const s of p.sources) {
    if (p.kind === 'video' && mode === 'publish' && !/^https?:/.test(s)) {
      // Android: on-device Media3 mux of segments/speed/sound into one MP4 (falls back to compression only).
      const e = p.edit;
      // Filter + brightness/contrast/saturation are baked into the uploaded file (Android render).
      const color = e ? colorSpecOf(e.filter, { brightness: e.brightness, contrast: e.contrast, saturation: e.saturation }) : null;
      const beauty = 0;
      const skin = null;
      const needsMux = !!e && !e.duet && (!!color || !!skin || beauty > 0 || !!e.segments?.length || e.trimStart || e.trimEnd || (e.speed && e.speed !== 1) || !!e.soundUrl || e.muted);
      const muxed = needsMux && e ? await renderVideo(s, {
        segments: e.segments?.length ? e.segments : (e.trimStart || e.trimEnd) ? [{ s: e.trimStart ?? 0, e: e.trimEnd ?? 1e6 }] : undefined,
        speed: e.speed, volume: e.volume, keepOriginal: !e.muted && (!e.soundUrl || !!e.mix),
        soundUrl: e.soundUrl, soundVolume: e.soundVolume, color, beauty, skin,
      }) : null;
      if (muxed) baked = true;
      const small = muxed ?? await compressVideo(s);
      const base = done;
      try { stream_uid = await uploadToStream(small, (f) => onProgress?.(base + f * 0.98, total)); media_urls.push(streamHls(stream_uid)); }
      catch (e) { if (/1 GB|10 minutes|1080p/.test((e as Error).message)) throw e; media_urls.push(await uploadMedia(small, 'video')); lowSrc = small; }
    } else media_urls.push(await uploadMedia(s, p.kind === 'photos' ? 'photo' : 'video'));
    tick();
  }
  let thumbnail_url = p.settings.thumbnail ? await uploadMedia(p.settings.thumbnail, 'photo', PHOTO_MAX.cover) : null;
  if (!thumbnail_url && p.kind === 'video') {
    const frame = await videoThumb(p.sources[0]).catch(() => null);
    if (frame) thumbnail_url = await uploadMedia(frame, 'photo', PHOTO_MAX.cover).catch(() => null);
  }
  if (p.settings.thumbnail) tick();
  // Local audio (blob:/file:/content:) must live in Storage, otherwise the feed can never play it.
  let edit = p.edit ?? null;
  // Muxed file already contains cuts, speed and sound: drop them so players don't apply them twice.
  if (edit && baked) edit = { ...edit, segments: undefined, trimStart: undefined, trimEnd: undefined, speed: undefined, muted: undefined, volume: undefined, soundUrl: undefined, soundVolume: undefined, mix: undefined, filter: undefined, beauty: undefined, brightness: undefined, contrast: undefined, saturation: undefined };
  if (edit?.soundUrl && !/^https?:/.test(edit.soundUrl)) edit = { ...edit, soundUrl: await uploadAudio(edit.soundUrl, edit.soundTitle) };
  // T32: bake the download file at post time (one MP4 with picture + final audio). Never blocks posting.
  if (Platform.OS === 'android' && mode === 'publish' && p.kind === 'photos' && edit?.soundUrl && !edit.muted) {
    try {
      const mp4 = await renderSlideshow(p.sources, { seconds: Math.max(0.3, edit.seconds ?? 2), soundUrl: edit.soundUrl, soundVolume: edit.soundVolume });
      edit = { ...edit, dlUid: await uploadToStream(mp4) };
    } catch { /* download falls back to the on-device path */ }
  }
  if (baked && stream_uid && edit) edit = { ...edit, dlUid: stream_uid };
  // Storage videos have no adaptive streams: add a ~700 kbps copy for weak networks / Data Saver. Never blocks posting.
  if (lowSrc) {
    try {
      const low = await compressVideoLow(lowSrc);
      if (low !== lowSrc) edit = { ...(edit ?? {}), lowUrl: await uploadMedia(low, 'video') };
    } catch { /* optional */ }
  }
  // Photo posts: small ~480px previews so slow networks show a quick (soft) picture first. Never blocks posting.
  if (mode === 'publish' && p.kind === 'photos') {
    try {
      const thumbs: string[] = [];
      for (const src of p.sources) {
        const img = await ImageManipulator.ImageManipulator.manipulate(src).resize({ width: 480 }).renderAsync();
        const small = (await img.saveAsync({ compress: 0.5, format: ImageManipulator.SaveFormat.JPEG })).uri;
        thumbs.push(await uploadMedia(small, 'photo'));
      }
      edit = { ...(edit ?? {}), thumbs };
    } catch { /* previews are optional */ }
  }
  const scheduled = mode === 'publish' && !!p.scheduleAt && p.scheduleAt > Date.now();
  const st = p.settings;
  const row = {
    user_id: me, kind: p.kind, media_urls, caption: p.caption.trim(), caption_html: p.captionHtml, edit,
    thumbnail_url, privacy: st.privacy, allow_download: st.download, allow_comments: st.comments, allow_duet: st.duet,
    age_restricted: st.ageRestricted, partner_enabled: st.partner !== false,
    status: mode === 'draft' ? 'draft' : scheduled ? 'scheduled' : 'published',
    publish_at: new Date(scheduled ? p.scheduleAt! : Date.now()).toISOString(),
  };
  const links = { ...(p.edit?.soundId ? { sound_id: p.edit.soundId } : {}), ...(p.edit?.duet ? { duet_of: p.edit.duet.postId } : {}) };
  const extra = { ...links, ...(stream_uid ? { stream_uid, stream_status: 'processing' } : {}) };
  const full = Object.keys(extra).length ? { ...row, ...extra } : row;
  const write = (r: typeof row) => (p.id ? supabase.from(T.posts).update(r).eq('id', p.id) : supabase.from(T.posts).insert(r));
  const res = await write(full);
  if (res.error && full !== row && /sound_id|duet_of|stream_|schema cache/i.test(res.error.message)) must(await write(row));
  else if (res.error) throw new Error(res.error.message);
  tick();
  return mode === 'draft' ? 'draft' : scheduled ? 'scheduled' : 'posted';
}

// Profile grids only need the cover, counters and crop; the full row is loaded when a video is opened.
const GRID_COLS = 'id,user_id,kind,media_urls,thumbnail_url,status,privacy,pinned,view_count,publish_at,created_at,cropRect:edit->cropRect,crop:edit->crop';
type GridRow = Post & { cropRect?: MediaEdit['cropRect'] | null; crop?: MediaEdit['crop'] | null };
type Rows = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Runs a grid query with the light columns; falls back to `*` on older schemas (e.g. no view_count). */
async function gridQuery(run: (cols: string) => Rows): Promise<Post[]> {
  const r = await run(GRID_COLS);
  if (r.error) return must(await run('*')) as Post[];
  return ((r.data as GridRow[] | null) ?? []).map(({ cropRect, crop, ...p }) => ({
    ...p, edit: cropRect || crop ? { cropRect: cropRect ?? undefined, crop: crop ?? undefined } : null,
  }) as Post);
}

/** A grid row has no caption/edit payload yet. */
export const isPartialPost = (p: Post) => p.caption === undefined;

/** Full rows (with authors) for the given ids, in the same order. */
export async function fetchPostsByIds(ids: string[]): Promise<Post[]> {
  if (!ids.length) return [];
  const rows = must(await supabase.from(T.posts).select('*').in('id', ids)) as Post[];
  const at = new Map(ids.map((id, i) => [id, i]));
  return attachAuthors(rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0)));
}

export async function fetchMyPosts(status: Post['status']): Promise<Post[]> {
  const me = await uid();
  return must(await supabase.from(T.posts).select('*').eq('user_id', me).eq('status', status).order('created_at', { ascending: false }).limit(60)) as Post[];
}
/** Own profile tabs: Videos = published/scheduled not only_me; Private = only_me + drafts. */
export async function fetchMyTab(tab: 'videos' | 'private'): Promise<Post[]> {
  const me = await uid();
  const rows = await gridQuery((cols) => supabase.from(T.posts).select(cols).eq('user_id', me).order('created_at', { ascending: false }).limit(120));
  const priv = (r: Post) => r.status === 'draft' || r.privacy === 'only_me';
  return tab === 'private' ? rows.filter(priv) : rows.filter((r) => !priv(r)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
}
const deletedIds = new Set<string>();
const deletedSubs = new Set<(id: string) => void>();
/** Every screen hides a post the moment it is deleted (own, admin, or from another screen). */
export const isPostDeleted = (id: string) => deletedIds.has(id);
export function onPostDeleted(f: (id: string) => void) { deletedSubs.add(f); return () => { deletedSubs.delete(f); }; }
export function markPostDeleted(id: string) {
  deletedIds.add(id); deletedSubs.forEach((f) => f(id));
  invalidate('me:'); invalidate('feed:');
}
export async function deletePost(id: string) {
  const rows = must(await supabase.from(T.posts).delete().eq('id', id).select('id')) as { id: string }[];
  if (!rows.length) throw new Error('Only the owner can delete this video');
  markPostDeleted(id);
}
export const MAX_PINS = 3;
export type PostPatch = Partial<Pick<Post, 'caption' | 'caption_html' | 'privacy' | 'allow_comments' | 'allow_download' | 'allow_duet' | 'pinned' | 'partner_enabled'>>;
/** Owner-only edit; RLS rejects others (0 rows updated → error). */
export async function updatePostFields(id: string, patch: PostPatch) {
  const me = await uid();
  const rows = must(await supabase.from(T.posts).update(patch).eq('id', id).eq('user_id', me).select('id')) as { id: string }[];
  if (!rows.length) throw new Error('Only the owner can edit this video');
  invalidate('me:tab:');
}
export async function setPinned(id: string, on: boolean) {
  if (on) {
    const me = await uid();
    const { count, error } = await supabase.from(T.posts).select('id', { count: 'exact', head: true }).eq('user_id', me).eq('pinned', true);
    if (error) throw new Error(error.message);
    if ((count ?? 0) >= MAX_PINS) throw new Error(`You can pin up to ${MAX_PINS} videos`);
  }
  await updatePostFields(id, { pinned: on });
}

export async function fetchMyProfile(): Promise<Profile | null> {
  const me = await uid();
  return must(await supabase.from(T.profiles).select('*').eq('id', me).maybeSingle()) as Profile | null;
}
export async function updateProfile(patch: Partial<Omit<Profile, 'id'>>) {
  await uid();
  const r = await supabase.rpc('app_9e1318caf6_update_profile', { p_patch: patch });
  if (r.error) {
    console.warn('[profile] update_profile failed', r.error.code, r.error.message);
    // Server function not installed yet (migration 049 not applied) → say so instead of a vague error.
    if (r.error.code === 'PGRST202' || /could not find the function|schema cache/i.test(r.error.message)) {
      throw new Error('Profile update is not enabled on the server yet. Please update the app backend.');
    }
    throw new Error(r.error.message);
  }
  invalidate('me:profile');
}
/** Server-validated handle change (normalises, checks format, reserved words and uniqueness). Returns the saved handle. */
export async function setUsername(username: string): Promise<string> {
  const r = must(await supabase.rpc('app_9e1318caf6_set_username', { p_username: username })) as string;
  invalidate('me:profile');
  return r;
}
export async function usernameAvailable(username: string): Promise<boolean> {
  return must(await supabase.rpc('app_9e1318caf6_username_available', { p_username: username })) as boolean;
}

/** Live rooms: pinned (most coins first, earliest pin wins ties), then newest. */
export async function fetchLiveRooms(category: string, prev?: LiveRoom[]): Promise<LiveRoom[]> {
  let q = supabase.from(T.live).select('*').eq('is_live', true).order('pin_coins', { ascending: false }).order('pin_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(40);
  if (category !== 'All') q = q.eq('category', category);
  const rows = must(await q) as LiveRoom[];
  const hosts = new Map<string, LiveRoom['host']>((prev ?? []).filter((r) => r.host).map((r) => [r.host_id, r.host]));
  const missing = rows.filter((r) => !hosts.has(r.host_id));
  const withA = await attachAuthors(missing.map((r) => ({ ...r, user_id: r.host_id })));
  withA.forEach((r) => hosts.set(r.host_id, r.author ?? null));
  return rows.map((r) => ({ ...r, host: hosts.get(r.host_id) ?? null }));
}
export async function createLiveRoom(title: string, category: string, cover?: string, mode: 'video' | 'audio' = 'video', layout: 'fullscreen' | 'seats' | 'seats2' | 'seats3' = 'fullscreen', bg: string | null = null, joinFee = 0, stickers: LiveSticker[] = []): Promise<LiveRoom> {
  const me = await uid();
  const cover_url = cover ? (/^https?:\/\//.test(cover) ? cover : await uploadMedia(cover, 'photo', PHOTO_MAX.cover)) : null;
  const row: Record<string, unknown> = { host_id: me, title: title.trim(), category, cover_url, mode, layout, ...(joinFee > 0 ? { join_fee: Math.floor(joinFee) } : {}) };
  let res = await supabase.from(T.live).insert({ ...row, ...(bg ? { bg } : {}), ...(stickers.length ? { stickers } : {}) }).select().single();
  if (res.error && stickers.length) res = await supabase.from(T.live).insert(bg ? { ...row, bg } : row).select().single();
  if (bg && res.error && /\bbg\b/.test(res.error.message)) res = await supabase.from(T.live).insert(row).select().single();
  return must(res) as LiveRoom;
}
/** Host's most recent live title/cover, reused to prefill the next Go Live. */
export async function lastLiveSetup(): Promise<{ title: string; cover_url: string | null } | null> {
  const me = await uid();
  const { data } = await supabase.from(T.live).select('title, cover_url').eq('host_id', me).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as { title: string; cover_url: string | null } | null) ?? null;
}
export async function endLiveRoom(id: string) { must(await supabase.from(T.live).update({ is_live: false }).eq('id', id)); }
/** Lives of mine still marked live (app killed / end request lost): closed before a new live starts. Returns their ids. */
export async function endMyStaleLives(): Promise<string[]> {
  const me = await uid();
  const { data } = await supabase.from(T.live).select('id').eq('host_id', me).eq('is_live', true);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) await supabase.from(T.live).update({ is_live: false }).in('id', ids);
  return ids;
}

export async function getWallet(): Promise<number> {
  const w = must(await supabase.rpc(RPC.wallet)) as { purchased?: number; earnings?: number } | null;
  return (Number(w?.purchased) || 0) + (Number(w?.earnings) || 0);
}
export async function placeRaceWager(pick: number, stake: number): Promise<{ winner: number; payout: number; coins: number }> {
  return must(await supabase.rpc(RPC.race, { p_pick: pick, p_stake: stake })) as { winner: number; payout: number; coins: number };
}
import { handleHtml, normalizeUsername } from './username';
export async function myId(): Promise<string> { return uid(); }
/** Current user id, or '' for a guest (no session, never throws). */
export async function myIdOrNull(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id ?? '';
}
type Who = Pick<Profile, 'id' | 'username' | 'display_name'> & { avatar_url?: string | null; links?: Record<string, string> | null };
const WHO_COLS = 'id,username,display_name,avatar_url,links';
async function profilesById(ids: string[]): Promise<Map<string, Who>> {
  if (!ids.length) return new Map();
  const rows = must(await supabase.from(T.profiles).select(WHO_COLS).in('id', ids)) as Who[];
  return new Map(rows.map((p) => [p.id, p]));
}
export const whoName = (p?: Who | null) => p?.display_name || p?.username || 'User';
/** Rich (formatted) display name stored in links._profile.nameHtml; falls back to escaped plain name. */
export function whoNameHtml(p?: Who | null): string {
  try { const n = (JSON.parse(p?.links?._profile ?? '{}') as { nameHtml?: string }).nameHtml; if (n) return n; } catch { /* plain */ }
  return whoName(p).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
type Styled = { username?: string | null; display_name?: string | null; links?: Record<string, string> | null } | null | undefined;
const escHtml = (t: string) => t.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
function styleField(p: Styled, k: 'nameHtml' | 'usernameHtml'): string {
  try { const v = (JSON.parse(p?.links?._profile ?? '{}') as Record<string, unknown>)[k]; return typeof v === 'string' ? v : ''; } catch { return ''; }
}
/** Colored display name (user's own formatting) for any profile-like object. */
export const nameHtmlOf = (p: Styled, fb = 'User') => styleField(p, 'nameHtml') || escHtml(p?.display_name || p?.username || fb);
/** Colored username (without leading @). */
export const usernameHtmlOf = (p: Styled, fb = 'user') => handleHtml(styleField(p, 'usernameHtml'), p?.username ?? fb);
async function hiddenIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from(T.messageHides).select('message_id');
  if (error) return new Set(); // table missing until migration 013 is applied
  return new Set((data as { message_id: string }[]).map((r) => r.message_id));
}
export async function deleteMessageForMe(id: string) {
  const me = await uid();
  must(await supabase.from(T.messageHides).upsert({ user_id: me, message_id: String(id) }, { onConflict: 'user_id,message_id' }));
}
export async function deleteMessageForEveryone(id: string) {
  const me = await uid();
  const rows = must(await supabase.from(T.messages).delete().eq('id', id).eq('sender_id', me).select('id')) as { id: string }[];
  if (!rows.length) throw new Error('Only the sender can delete this message for everyone.');
}
export async function fetchPostById(id: string): Promise<Post | null> {
  const row = must(await supabase.from(T.posts).select('*').eq('id', id).maybeSingle()) as Post | null;
  return row ? (await attachAuthors([row]))[0] : null;
}
export async function fetchLiveRoomById(id: string): Promise<(LiveRoom & { is_live?: boolean }) | null> {
  return must(await supabase.from(T.live).select('*').eq('id', id).maybeSingle()) as (LiveRoom & { is_live?: boolean }) | null;
}
export async function groupExists(id: string): Promise<boolean> {
  return !!must(await supabase.from(T.groups).select('id').eq('id', id).maybeSingle());
}

export interface Message { id: string; sender_id: string; recipient_id: string; body: string; read: boolean; created_at: string }
export interface Conversation { peer: Who; last: Message; unread: number }
export async function fetchConversations(): Promise<Conversation[]> {
  const me = await uid();
  const hidden = await hiddenIds();
  const msgs = (must(await supabase.from(T.messages).select('id,sender_id,recipient_id,body,read,created_at').order('created_at', { ascending: false }).limit(300)) as Message[]).filter((m) => !hidden.has(String(m.id)));
  const byPeer = new Map<string, { last: Message; unread: number }>();
  for (const m of msgs) {
    const peer = m.sender_id === me ? m.recipient_id : m.sender_id;
    const c = byPeer.get(peer) ?? { last: m, unread: 0 };
    if (m.recipient_id === me && !m.read) c.unread += 1;
    byPeer.set(peer, c);
  }
  const people = await profilesById([...byPeer.keys()]);
  return [...byPeer.entries()].map(([id, c]) => ({ ...c, peer: people.get(id) ?? { id, username: null, display_name: null } }));
}
export async function fetchThread(peer: string): Promise<Message[]> {
  const me = await uid();
  const rows = must(await supabase.from(T.messages).select('id,sender_id,recipient_id,body,read,created_at')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${peer}),and(sender_id.eq.${peer},recipient_id.eq.${me})`)
    .order('created_at', { ascending: true }).limit(200)) as Message[];
  await supabase.from(T.messages).update({ read: true }).eq('sender_id', peer).eq('recipient_id', me).eq('read', false);
  const hidden = await hiddenIds();
  return rows.filter((m) => !hidden.has(String(m.id)));
}
export async function sendMessage(peer: string, body: string) {
  const me = await uid();
  must(await supabase.from(T.messages).insert({ sender_id: me, recipient_id: peer, body: body.trim().slice(0, 1000) }));
}
export async function findUser(username: string): Promise<Who | null> {
  const u = normalizeUsername(username);
  if (!u) return null;
  return must(await supabase.from(T.profiles).select(WHO_COLS).eq('username', u).maybeSingle()) as Who | null;
}

export interface Notification {
  id: string; actor_id: string | null; kind: string; text: string; read: boolean; created_at: string;
  ref_type?: string | null; ref_id?: string | null; actor?: Who | null;
}
export const NOTES_PAGE = 25;
export type NoteCursor = { created_at: string; id: string };
const NOTE_COLS = 'id,actor_id,kind,text,read,created_at';
let noteRefCols = true; // turns false when migration 037 (ref_type/ref_id) is not applied yet
const actorCache = new Map<string, Who>();
async function noteActors(rows: Notification[]): Promise<Notification[]> {
  const miss = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x && !actorCache.has(x)))];
  if (miss.length) (await profilesById(miss)).forEach((v, k) => actorCache.set(k, v));
  return rows.map((r) => ({ ...r, actor: r.actor_id ? actorCache.get(r.actor_id) ?? null : null }));
}
/** One page of alerts, newest first (created_at DESC, id DESC); `cursor` = the last item already shown. */
export async function fetchNotificationsPage(cursor?: NoteCursor): Promise<Notification[]> {
  const me = await uid();
  const run = (cols: string) => {
    let q = supabase.from(T.notifications).select(cols).eq('user_id', me)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(NOTES_PAGE);
    if (cursor) q = q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    return q;
  };
  let res = await run(noteRefCols ? `${NOTE_COLS},ref_type,ref_id` : NOTE_COLS);
  if (res.error && noteRefCols && /ref_type|ref_id/.test(res.error.message)) { noteRefCols = false; res = await run(NOTE_COLS); }
  return noteActors(must(res) as unknown as Notification[]);
}
export async function attachNoteActor(row: Notification): Promise<Notification> {
  return (await noteActors([row]))[0];
}
const noteOrder = (a: Notification, b: Notification) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
/** Merges pages / realtime rows: dedupe by id (incoming wins), newest first. */
export function mergeNotifications(prev: Notification[], incoming: Notification[]): Notification[] {
  const m = new Map(prev.map((n) => [n.id, n]));
  incoming.forEach((n) => m.set(n.id, { ...m.get(n.id), ...n }));
  return [...m.values()].sort(noteOrder);
}
/** Marks only the listed, still-unread alerts as read (one UPDATE). */
export async function markNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  const me = await uid();
  must(await supabase.from(T.notifications).update({ read: true }).eq('user_id', me).in('id', ids).eq('read', false));
}
/** Capped unread counters (RPC; head-count fallback until migration 037 is applied). */
export async function fetchUnreadCounts(): Promise<{ alerts: number; messages: number }> {
  const me = await uid();
  const r = await supabase.rpc(RPC.unread);
  if (!r.error && r.data) {
    const d = r.data as { alerts?: number; messages?: number };
    return { alerts: Number(d.alerts) || 0, messages: Number(d.messages) || 0 };
  }
  const [a, m] = await Promise.all([
    supabase.from(T.notifications).select('id', { count: 'exact', head: true }).eq('user_id', me).eq('read', false).neq('kind', 'message'),
    supabase.from(T.messages).select('id', { count: 'exact', head: true }).eq('recipient_id', me).eq('read', false),
  ]);
  return { alerts: a.count ?? 0, messages: m.count ?? 0 };
}
/** Marks every alert and message of the current user read in ONE call (set-based, idempotent). */
export async function markAllRead(): Promise<void> {
  const me = await uid();
  const r = await supabase.rpc(RPC.markAll);
  if (!r.error) return;
  if (!/function|schema cache|PGRST202/i.test(r.error.message)) throw new Error(r.error.message);
  must(await supabase.from(T.notifications).update({ read: true }).eq('user_id', me).eq('read', false));
  must(await supabase.from(T.messages).update({ read: true }).eq('recipient_id', me).eq('read', false));
}

export type GroupFeeKind = 'text' | 'photo' | 'voice' | 'video';
export interface GroupFees { join: number; text: number; photo: number; voice: number }
export interface Group {
  id: string; owner_id: string; name: string; member_count: number; joined: boolean; description: string; photo: string;
  avatar_color: string; comments_enabled?: boolean; fee_join: number; fee_text: number; fee_photo: number; fee_voice: number;
  co_owners?: string[]; pin_coins?: number; hidden?: boolean;
}
export interface GroupMessage { id: number; group_id: string; user_id: string; kind: GroupFeeKind; body: string; media: string | null; fee: number; created_at: string; author?: Post['author']; edited_at?: string | null; reply_to?: number | null; like_count: number; dislike_count: number; reply_count: number }
export interface GroupExtra { co_owners?: string[]; pin_coins?: number; hidden?: boolean }
export interface GroupEarning { id: number; from_user: string; kind: 'join' | GroupFeeKind; coins: number; created_at: string; from?: string }
export async function fetchGroups(): Promise<Group[]> {
  const me = await myIdOrNull();
  const g = await supabase.from(T.groups).select('*').order('pin_coins', { ascending: false }).order('member_count', { ascending: false }).limit(100);
  const mine = new Set<string>();
  if (me) (must(await supabase.from(T.groupMembers).select('group_id').eq('user_id', me)) as { group_id: string }[]).forEach((x) => mine.add(x.group_id));
  // A group the admin hid from the list stays visible only to its owners.
  return (must(g) as Omit<Group, 'joined'>[]).filter((x) => !x.hidden || (!!me && (x.owner_id === me || !!x.co_owners?.includes(me)))).map((x) => ({ ...x, joined: mine.has(x.id) }));
}
export interface GroupInput { title: string; description: string; photo: string; fees: GroupFees }
export async function createGroup(g: GroupInput): Promise<string> {
  const photo = g.photo ? await uploadMedia(g.photo, 'photo') : '';
  return must(await supabase.rpc(RPC.grpCreate, { p_title: g.title, p_desc: g.description, p_photo: photo, p_color: '#FFA500',
    p_join: g.fees.join, p_text: g.fees.text, p_photo_fee: g.fees.photo, p_voice: g.fees.voice })) as string;
}
export async function updateGroup(id: string, g: GroupInput) {
  const photo = g.photo ? await uploadMedia(g.photo, 'photo') : '';
  must(await supabase.rpc(RPC.grpUpdate, { p_group: id, p_title: g.title, p_desc: g.description, p_photo: photo,
    p_join: g.fees.join, p_text: g.fees.text, p_photo_fee: g.fees.photo, p_voice: g.fees.voice }));
}
/** Join charges the owner's joining fee server-side; returns coins paid. Leave is a plain delete. */
export async function setGroupMembership(id: string, join: boolean): Promise<number> {
  const me = await uid();
  if (join) return must(await supabase.rpc(RPC.grpJoin, { p_group: id })) as number;
  must(await supabase.from(T.groupMembers).delete().eq('group_id', id).eq('user_id', me));
  return 0;
}
/** Owner-only (checked server-side in RPC). */
export async function setGroupComments(id: string, on: boolean) {
  must(await supabase.rpc(RPC.grpComments, { p_group: id, p_on: on }));
}
export async function fetchGroupMessages(id: string): Promise<GroupMessage[]> {
  const rows = must(await supabase.from(T.groupMessages).select('*').eq('group_id', id).order('created_at', { ascending: true }).limit(200)) as GroupMessage[];
  return attachAuthors(rows);
}
/** Uploads media (photo or recorded voice) then sends; server charges the per-kind fee. */
export async function sendGroupMessage(id: string, kind: GroupFeeKind, body: string, localMedia?: string, replyTo?: number | null): Promise<number> {
  let media: string | null = null;
  if (localMedia) media = kind === 'photo' ? await uploadMedia(localMedia, 'photo') : kind === 'video' ? await uploadMedia(localMedia, 'video') : await uploadVoice(localMedia);
  return must(await supabase.rpc(RPC.grpSend, { p_group: id, p_kind: kind, p_body: body, p_media: media, p_reply: replyTo ?? null })) as number;
}
export async function editGroupMessage(id: number, body: string) { must(await supabase.rpc(RPC.grpEdit, { p_id: id, p_body: body })); }
export async function deleteGroupMessage(id: number) { must(await supabase.rpc(RPC.grpDel, { p_id: id })); }
export async function reactGroupMessage(id: number, kind: 'like' | 'dislike'): Promise<'like' | 'dislike' | null> { return must(await supabase.rpc(RPC.grpReact, { p_msg: id, p_kind: kind })) as 'like' | 'dislike' | null; }
export async function myGroupReactions(ids: number[]): Promise<Record<number, 'like' | 'dislike'>> {
  if (!ids.length) return {};
  const rows = must(await supabase.from(`${'app_9e1318caf6_'}group_msg_reactions`).select('message_id,kind').in('message_id', ids)) as { message_id: number; kind: 'like' | 'dislike' }[];
  return Object.fromEntries(rows.map((r) => [r.message_id, r.kind]));
}
export async function groupReplies(parent: number): Promise<GroupMessage[]> {
  const rows = must(await supabase.from(T.groupMessages).select('*').eq('reply_to', parent).order('created_at', { ascending: true }).limit(200)) as GroupMessage[];
  return attachAuthors(rows);
}
export async function groupUnread(): Promise<Record<string, number>> {
  const { data } = await supabase.rpc(RPC.grpUnread);
  return Object.fromEntries(((data ?? []) as { group_id: string; n: number }[]).map((r) => [r.group_id, r.n]));
}
export async function markGroupRead(id: string) { await supabase.rpc(RPC.grpRead, { p_group: id }); }
export async function pinGroup(id: string, coins: number): Promise<number> { return must(await supabase.rpc(RPC.grpPin, { p_group: id, p_coins: coins })) as number; }
export async function unpinGroup(id: string) { must(await supabase.rpc(RPC.grpUnpin, { p_group: id })); }
export async function findGroupUser(q: string): Promise<{ id: string; username: string | null; display_name: string | null; public_id: string | null }[]> {
  return must(await supabase.rpc(RPC.grpFind, { p_q: q })) as never;
}
export async function replaceGroupOwner(id: string, user: string) { must(await supabase.rpc(RPC.grpReplace, { p_group: id, p_user: user })); }
export async function addGroupOwner(id: string, user: string) { must(await supabase.rpc(RPC.grpAddOwner, { p_group: id, p_user: user })); }
export async function removeGroupOwner(id: string, user: string) { must(await supabase.rpc(RPC.grpRemoveOwner, { p_group: id, p_user: user })); }
export async function deleteGroupOwner(id: string) { must(await supabase.rpc(RPC.grpDelete, { p_group: id })); }
export async function fetchGroupEarnings(id: string): Promise<GroupEarning[]> {
  const rows = must(await supabase.from(T.groupEarnings).select('*').eq('group_id', id).order('created_at', { ascending: false }).limit(200)) as GroupEarning[];
  const people = await profilesById([...new Set(rows.map((r) => r.from_user))]);
  return rows.map((r) => ({ ...r, from: whoName(people.get(r.from_user)) }));
}
async function uploadVoice(uri: string): Promise<string> {
  const me = await uid();
  const blob = await (await fetch(uri)).blob();
  const type = blob.type || 'audio/m4a';
  const ext = type.includes('webm') ? 'webm' : type.includes('mpeg') ? 'mp3' : 'm4a';
  const path = `${me}/voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  must(await supabase.storage.from(BUCKET).upload(path, await blob.arrayBuffer(), { contentType: type, upsert: false }));
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ── Marketplace balance + escrow (all state transitions are server RPCs) ──
export type OrderStatus = 'requested' | 'accepted' | 'shipped' | 'completed' | 'cancelled' | 'disputed' | 'admin_review';
export interface Order {
  id: string; item_id: string | null; item_title: string; item_photo: string | null; buyer_id: string; seller_id: string; price: number;
  status: OrderStatus; message: string | null; notice: string | null; history: { status: OrderStatus; at: number; note?: string }[];
  dispute: { reason?: string; photo?: string | null; buyer?: 'refund' | 'release'; seller?: 'refund' | 'release' } | null;
  rating: number | null; created_at: string; buyerName?: string; sellerName?: string;
}
export type OrderAction = 'cancel' | 'decline' | 'accept' | 'ship' | 'confirm' | 'dispute' | 'propose' | 'admin' | 'rate' | 'dismiss';
export async function getMarketBalance(): Promise<{ balance: number; locked: number }> {
  return must(await supabase.rpc(RPC.mktBalance)) as { balance: number; locked: number };
}
export async function marketTransfer(dir: 'in' | 'out', amount: number) {
  return must(await supabase.rpc(RPC.mktTransfer, { p_dir: dir, p_amount: Math.floor(amount) })) as { balance: number; locked: number };
}
export async function requestPurchase(itemId: string, message: string): Promise<string> {
  return must(await supabase.rpc(RPC.mktRequest, { p_item: itemId, p_msg: message })) as string;
}
/** Buyer shows interest: the server sends the seller's auto-reply once per product + buyer (no-op when off, repeated or self). */
export async function marketInquiry(itemId: string): Promise<boolean> {
  const r = await supabase.rpc(RPC.mktInquiry, { p_item: itemId });
  return !r.error && !!(r.data as { auto_replied?: boolean } | null)?.auto_replied;
}
export async function orderAction(id: string, action: OrderAction, arg?: string, photo?: string) {
  const media = photo ? await uploadMedia(photo, 'photo') : null;
  must(await supabase.rpc(RPC.mktAct, { p_order: id, p_action: action, p_arg: arg ?? null, p_photo: media }));
}
export async function runMarketTimers() { await supabase.rpc(RPC.mktTimers); }
export async function fetchOrders(): Promise<Order[]> {
  const me = await uid();
  const rows = must(await supabase.from(T.marketOrders).select('*').or(`buyer_id.eq.${me},seller_id.eq.${me}`).order('created_at', { ascending: false }).limit(100)) as Order[];
  const people = await profilesById([...new Set(rows.flatMap((r) => [r.buyer_id, r.seller_id]))]);
  return rows.map((r) => ({ ...r, buyerName: whoName(people.get(r.buyer_id)), sellerName: whoName(people.get(r.seller_id)) }));
}
export async function sellerRating(id: string): Promise<{ avg: number; count: number }> {
  return must(await supabase.rpc(RPC.mktRating, { p_seller: id })) as { avg: number; count: number };
}
export async function amIAdmin(): Promise<boolean> {
  const me = await uid();
  const r = await supabase.from(T.profiles).select('is_admin').eq('id', me).maybeSingle();
  return !!(r.data as { is_admin?: boolean } | null)?.is_admin;
}

/** Live-updates any tables' rows via Supabase Realtime; returns an unsubscribe. */
export function subscribeTables(name: string, specs: { table: string; filter?: string }[], onChange: (row: Record<string, unknown>, table: string) => void): () => void {
  let ch = supabase.channel(`${name}-${Math.random().toString(36).slice(2, 8)}`);
  for (const sp of specs) {
    ch = ch.on('postgres_changes' as never, { event: '*', schema: 'public', table: sp.table, ...(sp.filter ? { filter: sp.filter } : {}) } as never,
      (p: { new: Record<string, unknown> }) => onChange(p.new ?? {}, sp.table));
  }
  ch.subscribe();
  return () => { void supabase.removeChannel(ch); };
}
export async function deleteGroup(id: string) { must(await supabase.from(T.groups).delete().eq('id', id)); }

export const MARKET_CATS = ['Fashion', 'Electronics', 'Food', 'Services'] as const;
export interface MarketItem { id: string; user_id: string; title: string; category: string; price_etb: number; description: string; photos: string[]; phone: string; address: string; delivery: boolean; auto_reply_on: boolean; auto_reply: string; status: string; seller?: string }
export interface NewMarketItem { title: string; description: string; photos: string[]; priceEtb: number; phone: string; address: string; delivery: boolean; autoReplyOn: boolean; autoReply: string }
export async function fetchMarket(category: string): Promise<MarketItem[]> {
  let q = supabase.from(T.market).select('*').order('created_at', { ascending: false }).limit(60);
  if (category !== 'All') q = q.eq('category', category);
  const rows = must(await q) as MarketItem[];
  const people = await profilesById([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({ ...r, seller: whoName(people.get(r.user_id)) }));
}
export async function createMarketItem(n: NewMarketItem) {
  const me = await myId();
  const photos = await Promise.all(n.photos.map((u) => uploadMedia(u, 'photo')));
  must(await supabase.from(T.market).insert({ user_id: me, title: n.title.trim(), category: 'General', price_etb: Math.round(n.priceEtb), description: n.description,
    photos, phone: n.phone, address: n.address, delivery: n.delivery, auto_reply_on: n.autoReplyOn, auto_reply: n.autoReply }));
}
export async function deleteMarketItem(id: string) { must(await supabase.rpc(RPC.mktDelete, { p_item: id })); }

export interface Wager { id: number; pick: number; winner: number; stake: number; payout: number; created_at: string }
export async function fetchWagers(): Promise<Wager[]> {
  return must(await supabase.from(T.wagers).select('*').order('created_at', { ascending: false }).limit(30)) as Wager[];
}

/** Profile (any user) + whether I follow them. Counts are server-maintained. */
export async function fetchProfile(id: string): Promise<(Profile & { followed: boolean; isMe: boolean }) | null> {
  const me = await uid();
  const [p, f] = await Promise.all([
    supabase.from(T.profiles).select('*').eq('id', id).maybeSingle(),
    supabase.from(T.follows).select('following_id').eq('follower_id', me).eq('following_id', id).maybeSingle(),
  ]);
  const prof = must(p) as Profile | null;
  return prof ? { ...prof, followed: !!f.data, isMe: id === me } : null;
}
export async function setFollow(id: string, on: boolean) {
  const me = await uid();
  if (!me) throw new Error('Sign in to follow');
  markFollowing(id, on);
  try {
    if (on) {
      const r = await supabase.from(T.follows).insert({ follower_id: me, following_id: id });
      if (r.error && r.error.code !== '23505') throw new Error(r.error.message);
    } else must(await supabase.from(T.follows).delete().eq('follower_id', me).eq('following_id', id));
  } catch (e) { markFollowing(id, !on); throw e; }
}
/** Server-side, one view per user per post (011 record_view); returns the current view_count. */
export async function recordView(postId: string): Promise<number | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const r = await supabase.rpc('app_9e1318caf6_record_view', { p_post: postId });
  if (!r.error) return Number(r.data);
  const ins = await supabase.from(T.views).insert({ post_id: postId, user_id: u.user.id });
  if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message);
  return null;
}
export async function recordShare(postId: string) {
  const me = await uid();
  const r = await supabase.from(T.shares).insert({ post_id: postId, user_id: me });
  if (r.error && r.error.code !== '23505') throw new Error(r.error.message);
}
import { markFollowing } from './follows';
export async function sendGift(recipient: string, gift: string, qty: number, roomId?: string, postId?: string): Promise<{ coins: number; spent: number }> {
  return must(await supabase.rpc(RPC.gift, { p_recipient: recipient, p_gift: gift, p_qty: qty, p_room: roomId ?? null, p_post: postId ?? null })) as { coins: number; spent: number };
}
export const BOOST_OPTIONS = [6, 24, 72] as const;
export async function boostPost(postId: string, hours: number): Promise<{ coins: number; boosted_until: string }> {
  return must(await supabase.rpc(RPC.boost, { p_post: postId, p_hours: hours })) as { coins: number; boosted_until: string };
}
export async function reportPost(postId: string, reason: string) {
  const me = await uid();
  const r = await supabase.from(T.reports).insert({ post_id: postId, user_id: me, reason });
  if (r.error?.code === '23505') throw new Error('You already reported this post');
  if (r.error) throw new Error(r.error.message);
}
export const soundOf = (p: Pick<Post, 'author'> & { sound_name?: string | null; edit?: MediaEdit | null }) =>
  p.edit?.soundTitle || p.sound_name || `Original sound · ${p.author?.display_name || p.author?.username || 'user'}`;

// ---------------- search (feed: people + videos) ----------------
export type SearchResults = { profiles: Profile[]; posts: Post[] };

const likePattern = (t: string) => `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/**
 * Feed search: people by name / @username, videos by caption, sound_name or sounds.title.
 * Only public posts (or the viewer's own) are returned, exactly like the feed.
 */
export async function searchAll(term: string): Promise<SearchResults> {
  const t = term.trim().replace(/[,()]/g, ' ');
  if (!t) return { profiles: [], posts: [] };
  const like = likePattern(t);
  const { data: { session } } = await supabase.auth.getSession();
  const me = session?.user.id;
  const privacy = `privacy.is.null,privacy.eq.everyone${me ? `,user_id.eq.${me}` : ''}`;
  const base = () => supabase.from(T.posts).select('*').in('status', ['published', 'scheduled'])
    .lte('publish_at', new Date().toISOString()).or(privacy);
  const [profiles, posts, soundsQ] = await Promise.all([
    supabase.from(T.profiles).select('*').or(`username.ilike.${like},display_name.ilike.${like}`).limit(20),
    base().or(`caption.ilike.${like},sound_name.ilike.${like}`).order('publish_at', { ascending: false }).limit(24),
    supabase.from(T.sounds).select('id').ilike('title', like).limit(10),
  ]);
  // Videos whose sound title matches (sounds.title), merged with the caption / sound_name matches.
  const ids = ((soundsQ.data ?? []) as { id: string }[]).map((x) => x.id);
  let bySound: Post[] = [];
  if (ids.length) {
    const r = await base().in('sound_id', ids).order('publish_at', { ascending: false }).limit(24);
    bySound = (r.data ?? []) as Post[];
  }
  const seen = new Set<string>();
  const merged = [...((posts.data ?? []) as Post[]), ...bySound].filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  return { profiles: (profiles.data ?? []) as Profile[], posts: await attachAuthors(merged) };
}

export interface Sound {
  id: string; title: string; original_post_id: string | null; creator_user_id: string | null; audio_url: string;
  duration: number | null; use_count: number; creator?: Post['author'];
}
export async function fetchSound(id: string): Promise<Sound> {
  const row = must(await supabase.from(T.sounds).select('*').eq('id', id).single()) as Sound;
  if (!row.creator_user_id) return { ...row, creator: null };
  const [a] = await attachAuthors([{ user_id: row.creator_user_id }]);
  return { ...row, creator: a.author };
}
/** Sound of a post; old videos get their original sound created lazily. */
export async function soundForPost(p: Pick<Post, 'id' | 'sound_id' | 'edit'>): Promise<Sound> {
  const known = p.sound_id || p.edit?.soundId;
  if (known) return fetchSound(known);
  const r = await supabase.rpc(RPC.ensureSound, { p_post: p.id });
  // Photo slideshow soundtrack (edit.soundUrl) works even before migration 018 is applied.
  const track = p.edit?.soundUrl;
  if (r.error && track && /^https?:/.test(track)) {
    return { id: p.id, title: p.edit?.soundTitle || 'Original sound', original_post_id: p.id, creator_user_id: null, audio_url: track, duration: null, use_count: 1, created_at: new Date().toISOString(), creator: null } as unknown as Sound;
  }
  if (r.error) throw new Error(/function|schema cache|does not exist/i.test(r.error.message) ? 'Sounds are not set up yet. Apply migration 016_sounds.sql.' : r.error.message);
  return fetchSound(r.data as string);
}
export const SOUND_PAGE = 12;
/** Published videos using a sound; page 0 starts with the original video. */
export async function fetchSoundPosts(sound: Sound, page: number): Promise<{ posts: Post[]; total: number; more: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  const me = session?.user.id;
  let q = supabase.from(T.posts).select('*', { count: 'exact' }).eq('sound_id', sound.id).in('status', ['published', 'scheduled'])
    .lte('publish_at', new Date().toISOString()).or(`privacy.is.null,privacy.eq.everyone${me ? `,user_id.eq.${me}` : ''}`)
    .order('publish_at', { ascending: false }).range(page * SOUND_PAGE, page * SOUND_PAGE + SOUND_PAGE - 1);
  if (sound.original_post_id) q = q.neq('id', sound.original_post_id);
  const r = await q;
  // A page past the last video answers 416 "Requested range not satisfiable": it only means there are no more videos.
  const pastEnd = !!r.error && (r.error.code === 'PGRST103' || /range not satisfiable/i.test(r.error.message));
  let rows = pastEnd ? [] : (must(r) as Post[]);
  let total = r.count ?? rows.length;
  // `more` counts only this page's own rows (the original video added below is not part of the paging).
  const more = rows.length >= SOUND_PAGE && (r.count == null || (page + 1) * SOUND_PAGE < r.count);
  if (page === 0 && sound.original_post_id) {
    const o = (await supabase.from(T.posts).select('*').eq('id', sound.original_post_id).neq('status', 'draft').maybeSingle()).data as Post | null;
    if (o) { rows = [o, ...rows]; total += 1; }
  }
  return { posts: await attachAuthors(rows), total, more };
}
export type LiveEventKind = 'sticker' | 'gift' | 'comment' | 'like' | 'request' | 'decline' | 'kick' | 'invite' | 'share';
export interface LiveEvent { id: number; user_id: string; kind: LiveEventKind; payload: string; created_at: string }
export async function fetchLiveEvents(roomId: string): Promise<LiveEvent[]> {
  return must(await supabase.from(T.liveEvents).select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(200)) as LiveEvent[];
}
/** Only events newer than `afterId` (newest first) — an empty answer is a few bytes. */
export async function fetchLiveEventsSince(roomId: string, afterId: number): Promise<LiveEvent[]> {
  return must(await supabase.from(T.liveEvents).select('*').eq('room_id', roomId).gt('id', afterId).order('created_at', { ascending: false }).limit(200)) as LiveEvent[];
}
export async function postLiveEvent(roomId: string, kind: LiveEventKind, payload: string) {
  const me = await uid();
  must(await supabase.from(T.liveEvents).insert({ room_id: roomId, user_id: me, kind, payload: payload.slice(0, 2000) }));
}
export interface LiveSeat { room_id: string; idx: number; user_id: string | null; muted: boolean; cam_off: boolean; locked: boolean }
export interface LiveViewer { room_id: string; user_id: string; joined_at: string; last_seen: string; kicked: boolean }
export interface LiveRoomState {
  allow_comments: boolean; allow_gifts: boolean; auto_accept: boolean; fs_split: boolean; paused: boolean;
  peak_viewers: number; is_live: boolean; bg?: string | null; stickers: LiveSticker[]; pin_coins?: number; removed_reason?: string | null;
}
export interface LivePinStatus { pin_coins: number; rank: number; top: number; need: number; live: boolean }
export async function livePinStatus(room: string): Promise<LivePinStatus> {
  return must(await supabase.rpc('app_9e1318caf6_live_pin_status', { p_room: room })) as LivePinStatus;
}
export async function livePin(room: string, coins: number): Promise<LivePinStatus> {
  return must(await supabase.rpc('app_9e1318caf6_live_pin', { p_room: room, p_coins: coins })) as LivePinStatus;
}
export interface LiveAnalytics { lives: number; secs: number; peak: number; gifts: number; joins: number; recent: { id: string; title: string; cover_url: string | null; created_at: string; is_live: boolean; peak: number; secs: number; gifts: number }[] }
export async function liveAnalytics(): Promise<LiveAnalytics> {
  return must(await supabase.rpc('app_9e1318caf6_live_analytics')) as LiveAnalytics;
}
/** One text sticker and/or one image sticker. x/y are % of the screen, s is the pinch scale.
 *  `hidden` means the host took it off the live screen but it stays saved in Live settings. Old text-only rows stay valid. */
export interface LiveSticker { id: number; kind?: 'text' | 'image'; text: string; bg?: number; url?: string; x: number; y: number; s?: number; hidden?: boolean }
export type MiniProfile = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> & { links?: Record<string, string> | null };
/** Row security hides an ended live from everybody but its host, so `null` for a viewer means "this live has ended". */
export async function fetchRoomState(roomId: string): Promise<LiveRoomState | null> {
  return must(await supabase.from(T.live).select('*').eq('id', roomId).maybeSingle()) as LiveRoomState | null;
}
export async function updateRoom(roomId: string, patch: Partial<LiveRoomState>) {
  const res = await supabase.from(T.live).update(patch).eq('id', roomId);
  if (res.error && 'bg' in patch && /\bbg\b/.test(res.error.message)) {
    const { bg: _bg, ...rest } = patch;
    if (Object.keys(rest).length) must(await supabase.from(T.live).update(rest).eq('id', roomId));
    return;
  }
  must(res);
}
export async function fetchSeats(roomId: string): Promise<LiveSeat[]> {
  return must(await supabase.from(T.liveSeats).select('*').eq('room_id', roomId).order('idx')) as LiveSeat[];
}
export async function patchSeat(roomId: string, idx: number, patch: Partial<Pick<LiveSeat, 'user_id' | 'muted' | 'cam_off' | 'locked'>>) {
  must(await supabase.from(T.liveSeats).update(patch).eq('room_id', roomId).eq('idx', idx));
}
/** Host takes seat 0 and creates the 9 guest seats. */
export async function initSeats(roomId: string) {
  const me = await uid();
  const rows = Array.from({ length: 10 }, (_, idx) => ({ room_id: roomId, idx, user_id: idx === 0 ? me : null }));
  must(await supabase.from(T.liveSeats).upsert(rows, { onConflict: 'room_id,idx', ignoreDuplicates: true }));
}
export async function heartbeatViewer(roomId: string): Promise<boolean> {
  const me = await uid();
  const cur = (await supabase.from(T.liveViewers).select('kicked').eq('room_id', roomId).eq('user_id', me).maybeSingle()).data as { kicked: boolean } | null;
  if (cur?.kicked) return false;
  if (cur) must(await supabase.from(T.liveViewers).update({ last_seen: new Date().toISOString() }).eq('room_id', roomId).eq('user_id', me));
  else must(await supabase.from(T.liveViewers).insert({ room_id: roomId, user_id: me }));
  return true;
}
export async function leaveViewer(roomId: string) {
  const me = await uid();
  await supabase.from(T.liveViewers).delete().eq('room_id', roomId).eq('user_id', me);
}
export async function fetchViewers(roomId: string): Promise<LiveViewer[]> {
  const since = new Date(Date.now() - 45_000).toISOString();
  return must(await supabase.from(T.liveViewers).select('*').eq('room_id', roomId).eq('kicked', false).gte('last_seen', since)) as LiveViewer[];
}
export async function kickViewer(roomId: string, userId: string) {
  must(await supabase.from(T.liveViewers).upsert({ room_id: roomId, user_id: userId, kicked: true }, { onConflict: 'room_id,user_id' }));
}
export async function fetchRoomGifts(roomId: string): Promise<{ sender_id: string; recipient_id: string; gift: string; coins: number; qty: number }[]> {
  return must(await supabase.from(T.gifts).select('sender_id,recipient_id,gift,coins,qty').eq('room_id', roomId)) as { sender_id: string; recipient_id: string; gift: string; coins: number; qty: number }[];
}
export async function fetchMiniProfiles(ids: string[]): Promise<Record<string, MiniProfile>> {
  const u = [...new Set(ids.filter(Boolean))];
  if (!u.length) return {};
  const rows = must(await supabase.from(T.profiles).select('id,username,display_name,avatar_url,links').in('id', u)) as MiniProfile[];
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}
export async function fetchFollowing(ids: string[]): Promise<string[]> {
  const me = await uid();
  if (!ids.length) return [];
  return (must(await supabase.from(T.follows).select('following_id').eq('follower_id', me).in('following_id', ids)) as { following_id: string }[]).map((r) => r.following_id);
}
export async function fetchFriends(): Promise<MiniProfile[]> {
  const me = await uid();
  const ids = (must(await supabase.from(T.follows).select('following_id').eq('follower_id', me).limit(30)) as { following_id: string }[]).map((r) => r.following_id);
  return Object.values(await fetchMiniProfiles(ids));
}
export async function fetchLiveCounts(roomIds: string[]): Promise<Record<string, number>> {
  if (!roomIds.length) return {};
  const since = new Date(Date.now() - 45_000).toISOString();
  const rows = must(await supabase.from(T.liveViewers).select('room_id').in('room_id', roomIds).eq('kicked', false).gte('last_seen', since)) as { room_id: string }[];
  return rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.room_id]: (m[r.room_id] ?? 0) + 1 }), {});
}
export async function sendSticker(roomId: string, sticker: string) {
  const me = await uid();
  must(await supabase.from(T.liveEvents).insert({ room_id: roomId, user_id: me, kind: 'sticker', payload: sticker }));
}
/** Posts I liked or saved (private to me via RLS). */
export async function fetchReactedPosts(kind: 'like' | 'save'): Promise<Post[]> {
  const me = await uid();
  const ids = (must(await supabase.from(kind === 'like' ? T.likes : T.saves).select('post_id').eq('user_id', me).limit(200)) as { post_id: string }[]).map((x) => x.post_id);
  if (!ids.length) return [];
  const rows = await gridQuery((cols) => supabase.from(T.posts).select(cols).in('id', ids).neq('status', 'draft')
    .or(`privacy.is.null,privacy.neq.only_me,user_id.eq.${me}`));
  const at = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
}
export async function fetchUserPosts(id: string): Promise<Post[]> {
  // Scheduled posts whose time has come count as published even before the server job flips their status.
  return gridQuery((cols) => supabase.from(T.posts).select(cols).eq('user_id', id).in('status', ['published', 'scheduled']).lte('publish_at', new Date().toISOString()).or('privacy.is.null,privacy.neq.only_me')
    .order('pinned', { ascending: false, nullsFirst: false }).order('publish_at', { ascending: false }).limit(30));
}
