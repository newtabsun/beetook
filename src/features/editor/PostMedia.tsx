// Renders a post's media with every edit applied (filters/adjust/crop/text/stickers/overlays/transitions, trim/speed/sound, 105 photo themes).
import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createElement, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icons';
import { useAudible } from '../../lib/media';
import { lowQuality, markDataSaverNoticeSeen, useDataSaverNoticeSeen, useEffectiveDataSaver, whenGood } from '../../lib/network';
import { Image as ExpoImage } from 'expo-image';
import { isCacheable, markPlayed } from '../../lib/offline';
import { applyGain, useSlideshowAudio } from '../../lib/slideAudio';
import { colors } from '../../theme';
import { DuetLayer, type DuetEdit } from '../duet/DuetLayer';
import { DEFAULT_THEME_ID, editedTime, segJump, type MediaEdit } from './edit';
import { EditedFrame } from './EditTools';
import { activeFx, fxFrame } from './ObjTools';
import { Theme105Stage } from './themes105/Theme105Stage';

type Editable = ComponentProps<typeof EditedFrame>['editable'];
type VideoProps = { poster?: string | null; uri: string; edit?: MediaEdit; width: number; height: number; onProgress?: (now: number, dur: number) => void; editable?: Editable; sound?: boolean; active?: boolean; onPaused?: (p: boolean) => void; onDuetMove?: (d: DuetEdit) => void;
  /** External seek request (source seconds); a new value triggers a seek. */ seekTo?: number | null;
  /** Plays muted without taking audio ownership (thumbnail-size previews). */ silent?: boolean;
  /** Feed playback: network failures show no text and recover automatically. */ feed?: boolean };

/** Edits that must follow the video clock closely (timed FX/overlays, cuts, speed, synced sound, duet). */
const isTimed = (e?: MediaEdit | null) => !!(e?.fx?.length || e?.overlays?.some((o) => o.start != null || o.end != null)
  || e?.segments?.length || e?.trimStart || e?.trimEnd || (e?.speed && e.speed !== 1) || e?.soundUrl || e?.duet);

const rateAt = (edit: MediaEdit | undefined, t: number) => {
  const f = activeFx(edit?.fx, t);
  return Math.min(16, Math.max(0.1, (edit?.speed ?? 1) * (f ? (fxFrame(f.type, (t - f.at) / f.dur).rate ?? 1) : 1)));
};

/** Shared sound state: first user gesture on web unlocks sound for every video. */
let globalSound = Platform.OS !== 'web';
const soundSubs = new Set<(on: boolean) => void>();
export function setGlobalSound(on: boolean) { globalSound = on; soundSubs.forEach((f) => f(on)); }
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const unlock = () => { setGlobalSound(true); document.removeEventListener('pointerdown', unlock, true); };
  document.addEventListener('pointerdown', unlock, true);
}
function useSound(forceOn?: boolean) {
  const [on, setOn] = useState(forceOn || globalSound);
  useEffect(() => { const f = (v: boolean) => setOn(v); soundSubs.add(f); return () => { soundSubs.delete(f); }; }, []);
  return [on, (v: boolean) => { setOn(v); setGlobalSound(v); }] as const;
}

const fmtT = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Tap = pause/play; bottom bar drag = seek (claims the responder so the feed list doesn't swipe). */
function Controls({ width, now, dur, paused, onToggle, onSeek, tap }: { width: number; now: number; dur: number; paused: boolean; onToggle: () => void; onSeek: (t: number) => void; tap: boolean }) {
  const [drag, setDrag] = useState<number | null>(null);
  const barW = width - 24;
  const at = (x: number) => Math.max(0, Math.min(dur, (x / barW) * dur));
  const shown = drag ?? now;
  return (
    <>
      {tap && <Pressable testID="video-tap" accessibilityLabel={paused ? 'Play' : 'Pause'} onPress={onToggle} style={StyleSheet.absoluteFill}>
        {paused && <View style={s.play}><Icon name="play" size={34} /></View>}
      </Pressable>}
      {dur > 0 && (
        <View testID="video-scrub" style={s.scrub} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => setDrag(at(e.nativeEvent.locationX))}
          onResponderMove={(e) => setDrag(at(e.nativeEvent.locationX))}
          onResponderRelease={(e) => { onSeek(at(e.nativeEvent.locationX)); setDrag(null); }}>
          {drag !== null && <Text style={s.time}>{fmtT(shown)} / {fmtT(dur)}</Text>}
          <View pointerEvents="none" style={[s.track, drag !== null && { height: 6 }]}><View style={[s.fill, { width: `${Math.min(100, (shown / dur) * 100)}%` }]} /></View>
        </View>
      )}
    </>
  );
}

/** Web: native <video> element; a rAF loop enforces trim, speed ramps and feeds time to timed FX/overlays. */
function WebVideo({ uri, edit, width, height, onProgress, editable, sound, active = true, onPaused, seekTo, poster, feed }: VideoProps) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  // Feed: a failed load silently reloads once the connection is good again (the parent shows the spinner).
  useEffect(() => { if (!feed || !failed) return undefined; return whenGood(() => { setFailed(false); setRetry((n) => n + 1); }); }, [feed, failed]);
  const ref = useRef<HTMLVideoElement | null>(null);
  const [soundOn, setSoundOn] = useSound(sound);
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  const cfg = useRef({ edit, onProgress });
  cfg.current = { edit, onProgress };
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!active) { v.pause(); v.muted = true; return; }
    v.muted = !!edit?.muted || !soundOn;
    applyGain(v, edit?.volume ?? 1);
    if (!paused) void v.play().catch(() => { v.muted = true; void v.play().catch(() => undefined); });
  }, [edit?.muted, edit?.volume, soundOn, paused, active]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    if (activeRef.current) void v.play().catch(() => { v.muted = true; void v.play().catch(() => undefined); });
    let raf = 0;
    let last = -1;
    const loop = () => {
      // Off-screen <video> elements are paused: skip the per-frame work entirely.
      if (!activeRef.current) { raf = requestAnimationFrame(loop); return; }
      const { edit: e, onProgress: cb } = cfg.current;
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      if (d > 0) { const j = segJump(e, v.currentTime, d); if (j !== null) v.currentTime = j; }
      const r = rateAt(e, v.currentTime);
      if (Math.abs(v.playbackRate - r) > 0.01) v.playbackRate = r;
      setDur((o) => (o === d ? o : d));
      if (Math.abs(v.currentTime - last) > (isTimed(e) ? 0.03 : 0.25)) {
        last = v.currentTime;
        setNow(last);
        cb?.(last, d);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [uri, retry]);
  useEffect(() => { const v = ref.current; return () => { if (v) { v.pause(); v.muted = true; v.removeAttribute('src'); v.load(); } }; }, []);
  const toggle = () => {
    const v = ref.current; if (!v) return;
    if (v.paused) { setPaused(false); onPaused?.(false); void v.play().catch(() => undefined); } else { v.pause(); setPaused(true); onPaused?.(true); }
  };
  const seek = (t: number) => { const v = ref.current; if (v) { v.currentTime = t; setNow(t); } };
  useEffect(() => { if (seekTo != null) seek(seekTo); }, [seekTo]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <EditedFrame edit={edit} width={width} height={height} time={now} editable={editable} ui={<>
      <Controls width={width} now={now} dur={dur} paused={paused} onToggle={toggle} onSeek={seek} tap={width > 120} />
      {failed && !feed && (
        <Pressable onPress={() => { setFailed(false); setRetry((n) => n + 1); }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>This video can't be played</Text>
          <Text style={{ color: '#FFA500', fontWeight: '800', marginTop: 6 }}>Tap to retry</Text>
        </Pressable>
      )}
      {!edit?.muted && width > 120 && (
        <Pressable testID="video-sound" accessibilityLabel={soundOn ? 'Mute' : 'Unmute'} onPress={() => setSoundOn(!soundOn)} style={s.sound}>
          <Icon name={soundOn ? 'volume' : 'mute'} size={16} />
        </Pressable>
      )}
    </>}>
      {createElement('video', { ref, src: uri, key: `${uri}#${retry}`, crossOrigin: /^https?:/.test(uri) ? 'anonymous' : undefined, autoPlay: true, muted: true, loop: true, playsInline: true, preload: 'auto', poster: poster ?? undefined, onError: () => setFailed(true), onPlaying: () => setFailed(false), style: { width, height, objectFit: 'cover', background: '#000', display: 'block' } })}
    </EditedFrame>
  );
}

/** "Use this sound": the video's own audio is muted and the picked sound loops in sync with video time. */
function SoundVideo(props: VideoProps & { soundUrl: string }) {
  const { soundUrl, edit, onProgress } = props;
  const audio = useAudioPlayer(soundUrl);
  const [soundOn] = useSound(props.sound);
  const last = useRef(-1);
  const userPaused = useRef(false);
  const onPaused = (p: boolean) => { userPaused.current = p; props.onPaused?.(p); if (p) { try { audio.pause(); } catch { /* released */ } } };
  useEffect(() => { audio.loop = false; audio.muted = !soundOn; }, [audio, soundOn]);
  useEffect(() => () => { try { audio.pause(); } catch { /* released */ } }, [audio]);
  useEffect(() => { if (props.active === false) { try { audio.pause(); } catch { /* released */ } } }, [audio, props.active]);
  const sync = (now: number, dur: number) => { try { syncRaw(now, dur); } catch { /* released */ } };
  const syncRaw = (now: number, dur: number) => {
    if (props.active === false) { if (audio.playing) audio.pause(); return; }
    onProgress?.(now, dur);
    if (userPaused.current) { if (audio.playing) audio.pause(); return; }
    const ad = audio.duration || 0;
    // Sound is cut at the recorded length (or its own end); never loops on its own — after that it stays silent.
    const end = Math.min(edit?.soundDuration || Infinity, ad > 0 ? ad : Infinity);
    const target = editedTime(edit, now, dur) / Math.max(0.1, edit?.speed ?? 1);
    const jumped = last.current >= 0 && (now < last.current - 0.3 || now - last.current > 0.6);
    const paused = now === last.current;
    last.current = now;
    if (paused || target >= end - 0.05) { if (audio.playing) audio.pause(); return; }
    if (jumped || Math.abs(audio.currentTime - target) > 0.8) void audio.seekTo(target);
    if (!audio.playing) audio.play();
  };
  const Impl = Platform.OS === 'web' ? WebVideo : NativeVideo;
  return <Impl {...props} edit={{ ...edit, muted: true }} onProgress={sync} onPaused={onPaused} />;
}

/** Editor-added sound: original video audio stays (own mute/volume), the added file loops on the video clock. */
function MixVideo(props: VideoProps & { soundUrl: string }) {
  const { soundUrl, edit, onProgress } = props;
  const [soundOn] = useSound(props.sound);
  const [userPaused, setUserPaused] = useState(false);
  const [stalled, setStalled] = useState(false);
  const run = props.active !== false && !userPaused && !stalled;
  const audio = useSlideshowAudio(soundUrl, run, !soundOn, edit?.soundVolume ?? 1, !edit?.soundDuration);
  const last = useRef({ t: -1, at: 0 });
  const sync = (now: number, dur: number) => {
    onProgress?.(now, dur);
    const ms = Date.now();
    const moved = now !== last.current.t;
    if (moved) last.current = { t: now, at: ms };
    // Video stopped advancing (buffering / end) for >250ms → hold the added sound too.
    const stall = !moved && ms - last.current.at > 250;
    if (stall !== stalled) setStalled(stall);
    if (!moved || !dur) return;
    // One master clock = the video: the added sound follows the edited timeline and is corrected on drift.
    const target = editedTime(edit, now, dur) / Math.max(0.1, edit?.speed ?? 1);
    const cur = audio.time();
    // expo-audio reports time coarsely; tight thresholds caused audible re-seeks. Only correct real jumps.
    if (cur >= 0 && Math.abs(cur - target) > 0.8) audio.seek(target);
  };
  const Impl = Platform.OS === 'web' ? WebVideo : NativeVideo;
  return <Impl {...props} onProgress={sync} onPaused={(pz) => { setUserPaused(pz); props.onPaused?.(pz); }} />;
}

/** Duet: recorded video (muted) + original video overlay that carries the only audio, both on one clock. */
function DuetVideo(props: VideoProps & { duet: DuetEdit }) {
  const { duet, edit, onProgress, width, height, onDuetMove, active = true } = props;
  const [t, setT] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const sync = (now: number, dur: number) => { onProgress?.(now, dur); setT(now); };
  const Impl = Platform.OS === 'web' ? WebVideo : NativeVideo;
  return (
    <View style={{ width, height }}>
      <Impl {...props} edit={{ ...edit, muted: true }} onProgress={sync} onPaused={(pz) => { setUserPaused(pz); props.onPaused?.(pz); }} />
      <DuetLayer url={duet.url} layout={duet} cw={width} ch={height} time={t} playing={active && !userPaused} muted={props.silent}
        onChange={onDuetMove ? (l) => onDuetMove({ ...duet, ...l }) : undefined} />
    </View>
  );
}

function VideoImpl(p: VideoProps) {
  if (p.edit?.duet) return <DuetVideo {...p} duet={p.edit.duet} />;
  if (p.edit?.soundUrl && p.edit.mix && !p.silent) return <MixVideo {...p} soundUrl={p.edit.soundUrl} />;
  if (p.edit?.soundUrl && !p.silent) return <SoundVideo {...p} soundUrl={p.edit.soundUrl} />;
  return Platform.OS === 'web' ? <WebVideo {...p} /> : <NativeVideo {...p} />;
}

/** No progress for this long → show the loading spinner. */
const SPIN_MS = 700;
/** No progress for this long → network stall: switch to low quality, then reload automatically when connected. */
const STALL_MS = 3000;

/** Every video goes through the MediaCoordinator: it plays only while it is the single audible owner.
 * Feed videos also get weak-network handling with no on-screen text: a small spinner while the video is
 * stuck, automatic low quality on stall, and automatic reload once the connection is good again. */
export function EditedVideo(props: VideoProps) {
  const want = (props.active ?? true) && !props.silent;
  const audible = useAudible(want);
  const feed = props.width > 120 && !props.editable && !props.silent;
  const saver = useEffectiveDataSaver();
  const low = lowQuality(props.uri) ?? props.edit?.lowUrl ?? null;
  const [forceLow, setForceLow] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const userPaused = useRef(false);
  const stalledRef = useRef(false);
  stalledRef.current = stalled;
  const last = useRef({ t: -1, at: Date.now() });
  const uri = low && (saver || forceLow) ? low : props.uri;
  const noticeSeen = useDataSaverNoticeSeen();
  const gated = feed && saver && !noticeSeen && !tapped;
  const watching = feed && audible && !gated;

  useEffect(() => {
    if (!watching) { setStalled(false); setBuffering(false); return undefined; }
    last.current = { t: -1, at: Date.now() };
    const iv = setInterval(() => {
      if (userPaused.current) { setBuffering(false); return; }
      const idle = Date.now() - last.current.at;
      setBuffering(idle > SPIN_MS);
      if (idle > STALL_MS) setStalled(true);
    }, 250);
    return () => clearInterval(iv);
  }, [watching, uri, nonce]);
  // First stall with a low variant available → drop to low quality silently.
  useEffect(() => { if (stalled && low && !forceLow) { setForceLow(true); setStalled(false); } }, [stalled, low, forceLow]);
  // Still stalled → wait for a good connection, then reload the video automatically.
  useEffect(() => { if (feed && stalled) setWaiting(true); }, [feed, stalled]);
  useEffect(() => {
    if (!waiting) return undefined;
    return whenGood(() => { setWaiting(false); if (stalledRef.current) { setStalled(false); setNonce((n) => n + 1); } });
  }, [waiting]);

  const onProgress = (now: number, dur: number) => {
    if (now !== last.current.t) {
      last.current = { t: now, at: Date.now() };
      if (buffering) setBuffering(false);
      if (stalled) { setStalled(false); setWaiting(false); }
      if (now > 1) markPlayed(uri);
    }
    props.onProgress?.(now, dur);
  };
  const onPaused = (pz: boolean) => { userPaused.current = pz; last.current.at = Date.now(); if (pz) setBuffering(false); props.onPaused?.(pz); };
  const base: VideoProps = props.silent ? { ...props, edit: { ...props.edit, muted: true } } : { ...props, active: audible, feed };
  const { width, height, poster } = props;

  if (gated) {
    return (
      <View style={{ width, height, backgroundColor: '#000' }}>
        {poster ? <ExpoImage source={{ uri: poster }} style={{ width, height }} contentFit="cover" cachePolicy="memory-disk" transition={0} /> : null}
        <Pressable testID="poster-play" accessibilityLabel="Play video" onPress={() => { markDataSaverNoticeSeen(); setTapped(true); setNonce((n) => n + 1); }} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={s.play}><Icon name="play" size={34} /></View>
          <Text style={s.hint}>Data Saver is on — tap to play</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ width, height }}>
      <VideoImpl key={`${uri}#${nonce}`} {...base} uri={uri} onProgress={onProgress} onPaused={onPaused} />
      {feed && (buffering || stalled) && !userPaused.current && (
        <View testID="video-spinner" pointerEvents="none" style={s.spin}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}
    </View>
  );
}

function NativeVideo({ uri, edit, width, height, onProgress, editable, sound, active = true, onPaused, seekTo, poster }: VideoProps) {
  const [shown, setShown] = useState(false);
  const [soundOn, setSoundOn] = useSound(sound ?? true);
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const activeRef = useRef(active);
  activeRef.current = active;
  // Progressive MP4s are cached on disk so a video seen once is not downloaded again (HLS is streamed).
  const player = useVideoPlayer(/\.m3u8/.test(uri) ? uri : { uri, useCaching: true }, (p) => {
    p.loop = true; p.muted = !active; p.volume = 1;
    try { p.bufferOptions = { preferredForwardBufferDuration: 8, minBufferForPlayback: 1, waitsToMinimizeStalling: true }; } catch { /* unsupported */ }
    if (active) p.play();
  });
  const cfg = useRef({ edit, onProgress });
  cfg.current = { edit, onProgress };
  useEffect(() => { player.muted = !active || !!edit?.muted || !soundOn; player.volume = Math.max(0, Math.min(1, edit?.volume ?? 1)); if (!active) player.pause(); }, [player, edit?.muted, edit?.volume, soundOn, active]);
  // Off-screen players do no work; plain videos tick at 4/s, videos with timed edits keep 10/s for sync.
  const timed = isTimed(edit);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => {
      try {
        const { edit: e, onProgress: cb } = cfg.current;
        const d = player.duration || 0;
        const cur = player.currentTime || 0;
        if (d > 0) {
          const j = segJump(e, cur, d);
          if (j !== null) player.currentTime = j;
          const r = rateAt(e, cur);
          if (Number.isFinite(r) && r > 0 && Math.abs(player.playbackRate - r) > 0.01) player.playbackRate = r;
        }
        if (!player.playing && !pausedRef.current && activeRef.current && player.status === 'readyToPlay') player.play();
        setNow((o) => (Math.abs(o - cur) < (timed ? 0.08 : 0.2) ? o : cur));
        setDur((o) => (o === d ? o : d));
        cb?.(cur, d);
      } catch { /* player released or not ready */ }
    }, timed ? 100 : 250);
    return () => clearInterval(t);
  }, [player, active, timed]);
  const toggle = () => { if (pausedRef.current) { player.play(); setPaused(false); onPaused?.(false); } else { player.pause(); setPaused(true); onPaused?.(true); } };
  const seek = (t: number) => { try { player.currentTime = t; } catch { /* released */ } setNow(t); };
  useEffect(() => { if (seekTo != null) seek(seekTo); }, [seekTo]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <EditedFrame edit={edit} width={width} height={height} time={now} editable={editable} ui={<>
      <Controls width={width} now={now} dur={dur} paused={paused} onToggle={toggle} onSeek={seek} tap={width > 120} />
      {!edit?.muted && width > 120 && (
        <Pressable accessibilityLabel={soundOn ? 'Mute' : 'Unmute'} onPress={() => setSoundOn(!soundOn)} style={s.sound}>
          <Icon name={soundOn ? 'volume' : 'mute'} size={16} />
        </Pressable>
      )}
    </>}>
      <VideoView player={player} style={{ width, height }} contentFit="cover" nativeControls={false} surfaceType="textureView" onFirstFrameRender={() => setShown(true)} />
      {!shown && poster ? <ExpoImage source={{ uri: poster }} style={[StyleSheet.absoluteFill, { width, height }]} contentFit="cover" cachePolicy="memory-disk" transition={0} /> : null}
    </EditedFrame>
  );
}

/** Warms up the first seconds of an upcoming video without playing it (no sound, not shown).
 * Native: a paused player buffers the start (MP4s go to the disk cache). Web: fetches the first ~1 MB. */
export function VideoPreloader({ uri }: { uri: string }) {
  if (Platform.OS === 'web') return <WebPreload uri={uri} />;
  return <NativePreload uri={uri} />;
}
function WebPreload({ uri }: { uri: string }) {
  useEffect(() => {
    const ctl = new AbortController();
    void fetch(uri, { headers: isCacheable(uri) ? { Range: 'bytes=0-1048575' } : {}, signal: ctl.signal }).catch(() => undefined);
    return () => ctl.abort();
  }, [uri]);
  return null;
}
function NativePreload({ uri }: { uri: string }) {
  const player = useVideoPlayer(/\.m3u8/.test(uri) ? uri : { uri, useCaching: true }, (p) => {
    p.muted = true;
    try { p.bufferOptions = { preferredForwardBufferDuration: 4, minBufferForPlayback: 1, waitsToMinimizeStalling: true }; } catch { /* unsupported */ }
  });
  useEffect(() => () => { try { player.pause(); } catch { /* released */ } }, [player]);
  return null;
}

export function PostMedia({ kind, sources, edit, width, height, active = true, poster }: {
  kind: 'photos' | 'video'; sources: string[]; edit?: MediaEdit; width: number; height: number; active?: boolean; poster?: string | null;
}) {
  if (kind === 'video') return <EditedVideo uri={sources[0]} edit={edit} width={width} height={height} active={active} poster={poster} />;
  return <PhotoSlideshow sources={sources} edit={edit} width={width} height={height} active={active} />;
}

/** Photo post: every photo through the chosen theme with its soundtrack on one shared timeline
 * (photos × seconds). Tap = pause/play, bottom bar drag = seek — same controls as real videos. */
/** Shows the small previews first, then swaps to the full photos once they are downloaded. */
function useProgressivePhotos(sources: string[], thumbs?: string[]): { list: string[]; loading: boolean } {
  const hasThumbs = !!thumbs && thumbs.length === sources.length;
  const remote = sources.some((u) => /^https?:/.test(u));
  const [ready, setReady] = useState(!remote);
  useEffect(() => {
    if (!remote) { setReady(true); return undefined; }
    let dead = false;
    setReady(false);
    // Only the first photo blocks the placeholder; the rest load in the background.
    void Promise.all(sources.slice(0, hasThumbs ? sources.length : 1).map((u) => Image.prefetch(u).catch(() => false))).then(() => { if (!dead) setReady(true); });
    return () => { dead = true; };
  }, [sources, hasThumbs, remote]);
  if (ready) return { list: sources, loading: false };
  return hasThumbs ? { list: thumbs!, loading: false } : { list: sources, loading: true };
}

function PhotoSlideshow({ sources: full, edit, width, height, active }: { sources: string[]; edit?: MediaEdit; width: number; height: number; active: boolean }) {
  const { list: sources, loading } = useProgressivePhotos(full, edit?.thumbs);
  const url = edit?.soundUrl && /^https?:/.test(edit.soundUrl) ? edit.soundUrl : null;
  const audible = useAudible(!!url && active);
  const [soundOn, setSoundOn] = useSound();
  const [paused, setPaused] = useState(false);
  const run = active && !paused;
  const audio = useSlideshowAudio(url, audible && !paused, !soundOn || !!edit?.muted, edit?.soundVolume ?? 1, false);
  const dur = Math.max(0.3, edit?.seconds ?? 2) * Math.max(1, sources.length);
  const clock = useRef(0);
  const [now, setNow] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    let prev = Date.now();
    const t = setInterval(() => {
      const n = Date.now();
      if (runRef.current) {
        let next = clock.current + (n - prev) / 1000;
        // The SOUND is the master clock: photos follow it; the audio is never seeked during playback
        // (periodic drift seeks were what chopped the music at photo changes). Only at the end of the
        // last photo does the sound restart with photo 1 (one seek per loop).
        const at = audio.time();
        if (at >= 0 && at < dur && Math.abs(at - next) > 0.15 && Math.abs(at - next) < 2) next = at;
        if (next >= dur) { audio.seek(0); next %= dur; }
        clock.current = next; setNow(next);
      }
      prev = n;
    }, 50);
    return () => clearInterval(t);
  }, [dur]);
  useEffect(() => { if (!active) setPaused(false); }, [active]);
  const seek = (t: number) => { clock.current = t; setNow(t); audio.seek(t); };
  const w = Math.max(width, (height * 720) / 1280);
  const big = width > 120;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    (window as unknown as { __slideshow?: unknown }).__slideshow = active ? { t: clock.current, dur, paused, slide: Math.floor(clock.current / Math.max(0.3, edit?.seconds ?? 2)) } : (window as unknown as { __slideshow?: unknown }).__slideshow;
  }
  return (
    <EditedFrame edit={edit} width={width} height={height} ui={big ? (<>
      <Controls width={width} now={now} dur={dur} paused={paused} onToggle={() => setPaused((p) => !p)} onSeek={seek} tap />
      {url && (
        <Pressable testID="slideshow-sound" accessibilityLabel={soundOn ? 'Mute' : 'Unmute'} onPress={() => setSoundOn(!soundOn)} style={s.sound}>
          <Icon name={soundOn ? 'volume' : 'mute'} size={16} />
        </Pressable>
      )}
    </>) : undefined}>
      <Theme105Stage sources={sources} themeId={edit?.themeId ?? DEFAULT_THEME_ID} seconds={edit?.seconds ?? 2} width={w} playing={run} clock={clock} />
      {loading && (
        <View testID="photo-loading" pointerEvents="none" style={[StyleSheet.absoluteFill, s.photoWait]}>
          <ActivityIndicator color="#FFA500" />
          <Text style={s.photoWaitT}>Loading photo…</Text>
        </View>
      )}
    </EditedFrame>
  );
}

const s = StyleSheet.create({
  play: { position: 'absolute', top: '50%', left: '50%', marginLeft: -32, marginTop: -32, width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  scrub: { position: 'absolute', left: 12, right: 12, bottom: 2, height: 28, justifyContent: 'flex-end', paddingBottom: 6 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#fff' },
  time: { position: 'absolute', bottom: 18, alignSelf: 'center', color: '#fff', fontWeight: '800', fontSize: 15, textShadowColor: '#000', textShadowRadius: 4 },
  photoWait: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoWaitT: { color: 'rgba(255,255,255,0.7)', fontWeight: '700', fontSize: 12 },
  hint: { color: '#fff', fontWeight: '800', fontSize: 13, marginTop: 84, textShadowColor: '#000', textShadowRadius: 4 },
  spin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -12, marginTop: -12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  sound: { position: 'absolute', right: 10, top: 60, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
