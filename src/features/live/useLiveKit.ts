// One LiveKit room per live. Publishing follows the DB state the UI already has (host / seated guest = publish,
// viewer = subscribe only); the server enforces the same rule in the token. Mic/camera state mirrors real tracks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  ConnectionQuality, ConnectionState, DisconnectReason, Room, RoomEvent, Track, VideoPresets, createLocalVideoTrack,
  type LocalVideoTrack, type RemoteParticipant, type RemoteTrack, type VideoTrack,
} from 'livekit-client';

/** Rejects when `p` does not settle within `ms` (no await in the live flow may hang forever). */
const lim = <T,>(p: Promise<T>, what: string, ms = 10_000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer after ${ms / 1000}s`)), ms))]);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const maskUrl = (u: string) => u.replace(/^(wss?:\/\/)([^.]{0,4})[^.]*/, '$1$2…');
import { fetchLiveToken, initLiveKit, reapLive, syncLivePermissions } from '../../lib/livekit';
import { attachLiveBeauty, jsMark, setLiveBeauty, type BeautyLevels } from '../../../modules/gpupixel-camera';
import { useAppActive } from '../../lib/appActive';
import { WebBeautyProcessor } from './webBeautyProcessor';
import { hasLivePermissions } from '../../lib/livePermissions';
import { fxMark, traced } from '../../lib/liveFlags';

export type LiveLink = 'connecting' | 'connected' | 'reconnecting' | 'offline';
type DataCb = (from: string, msg: Record<string, unknown>) => void;

interface Opts {
  roomId: string; me: string;
  hostId: string;           // only the host (or the server) may announce the end of the live
  canPublish: boolean;      // host or seated guest
  micOn: boolean;           // desired mic state (seat.muted / host toggle)
  camOn: boolean;           // desired camera state (video lives only)
  video: boolean;           // video live (false = audio live: never open the camera)
  muted: boolean;           // live paused by host: everything off
  beauty: BeautyLevels;     // camera beauty (0/0 = raw camera, no processing at all)
}

const IS_WEB = Platform.OS === 'web';
/** A viewer asks the server to close the live when the host has been gone this long (the server double-checks). */
const HOST_GRACE_MS = 60_000;
/** Disconnect of the previous live (switching lives): the next join waits for it, so two rooms never run at once. */
let prevLeave: Promise<unknown> = Promise.resolve();

// ~24 kbps speech Opus + DTX + RED; simulcast so viewers on weak links drop to a lower layer. maintain-framerate keeps motion
// smooth (and latency low) by lowering resolution instead of frame rate when the link or CPU is short.
const ROOM_OPTS = {
  adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true,
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  videoCaptureDefaults: { resolution: (IS_WEB ? VideoPresets.h720 : VideoPresets.h540).resolution, facingMode: 'user' as const },
  publishDefaults: {
    dtx: true, red: true, simulcast: true, audioPreset: { maxBitrate: 24_000 },
    videoEncoding: { maxBitrate: 1_400_000, maxFramerate: 24 },
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    degradationPreference: 'maintain-framerate' as const,
  },
};

async function setAudioSession(on: boolean, publishing: boolean) {
  if (IS_WEB) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AudioSession, AndroidAudioTypePresets } = require('@livekit/react-native') as typeof import('@livekit/react-native');
  try {
    if (!on) { await AudioSession.stopAudioSession(); return; }
    // Publishers need the platform echo canceller (communication mode); pure viewers use the loud media stream.
    await AudioSession.configureAudio({
      android: { preferredOutputList: ['bluetooth', 'headset', 'speaker'], audioTypeOptions: publishing ? AndroidAudioTypePresets.communication : AndroidAudioTypePresets.media },
      ios: { defaultOutput: 'speaker' },
    });
    await AudioSession.startAudioSession();
  } catch { /* audio routing is best effort */ }
}

export function useLiveKit(o: Opts) {
  const { roomId, me, hostId, canPublish, micOn, camOn, video, muted, beauty } = o;
  const fgNow = useAppActive();
  // Backgrounded: release the camera and stop pulling video (battery + data). Android reports "background" for every system
  // dialog / notification shade too; reacting at once closed and reopened the camera in a loop (black video, frozen UI), so
  // going to the background only counts after it lasted 2 s. Coming back is immediate.
  const [appActive, setAppActive] = useState(fgNow);
  useEffect(() => {
    if (fgNow) { setAppActive(true); return undefined; }
    const t = setTimeout(() => setAppActive(false), 2000);
    return () => clearTimeout(t);
  }, [fgNow]);
  const beautyRef = useRef(beauty);
  const webBeauty = useRef<WebBeautyProcessor | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [link, setLink] = useState<LiveLink>('connecting');
  const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [rev, setRev] = useState(0); // bumps when tracks / mute state change → re-render video + indicators
  const [error, setError] = useState('');
  const [ended, setEnded] = useState(false);     // the host (or the server) closed the live
  const [dropped, setDropped] = useState(0);      // connection lost for another reason: the screen re-checks the DB state
  const [permRev, setPermRev] = useState(0);      // the server moved my publish permission (seat taken / left): publish state re-runs
  const fxTracks = useRef(new WeakMap<object, boolean>()); // native beauty effect state per camera track
  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const videoPaused = useRef(false);
  const listeners = useRef<Record<string, Set<DataCb>>>({});
  const pub = useRef(canPublish); pub.current = canPublish;
  const hostRef = useRef(hostId); hostRef.current = hostId;
  const roomRef = useRef<Room | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Local camera opened BEFORE the LiveKit connection: the host sees himself even if the server cannot be reached,
  // and the same track is published once connected (no second camera open).
  const [preview, setPreview] = useState<LocalVideoTrack | null>(null);
  const previewRef = useRef<LocalVideoTrack | null>(null);
  // Join steps go to the native freeze report in development builds only (no state, no re-render, nothing in production).
  const log = useCallback((line: string) => { if (__DEV__) jsMark(line); }, []);
  const [hostHere, setHostHere] = useState(true); // the host is in the LiveKit room (viewers: false for long = live is over)
  const audioMode = useRef<boolean | null>(null); // audio session role already configured (publisher / viewer)
  const retry = useCallback(() => { setError(''); setLink('connecting'); setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    if (!me) return undefined;
    initLiveKit();
    let dead = false;
    const r = new Room(ROOM_OPTS);
    roomRef.current = r;
    const bump = traced('ev bump', () => setRev((n) => n + 1));
    const audioEls = new Map<string, HTMLMediaElement>();
    r.on(RoomEvent.ActiveSpeakersChanged, traced('ev speakers', (s: { identity: string }[]) => {
      const ids = s.map((p) => p.identity);
      // Only a real change re-renders (the event fires several times per second while somebody talks).
      setSpeaking((prev) => (prev.size === ids.length && ids.every((i) => prev.has(i)) ? prev : new Set(ids)));
    }))
      .on(RoomEvent.ConnectionQualityChanged, traced('ev quality', (q: ConnectionQuality, p: { isLocal: boolean }) => { if (p.isLocal) setQuality(q); }))
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        log(`state: ${s}`);
        setLink(s === ConnectionState.Connected ? 'connected' : s === ConnectionState.Disconnected ? 'offline' : s === ConnectionState.Connecting ? 'connecting' : 'reconnecting');
      })
      .on(RoomEvent.SignalConnected, () => log('signal connected (websocket ok)'))
      .on(RoomEvent.MediaDevicesError, (e: Error) => log(`media device error: ${errText(e)}`))
      .on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => {
        // Browsers never play remote audio on their own: every remote audio track needs an element (native plays it itself).
        if (IS_WEB && t.kind === Track.Kind.Audio) {
          const el = t.attach(); el.style.display = 'none'; document.body.appendChild(el); audioEls.set(t.sid ?? '', el);
        }
        bump();
      })
      .on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => {
        if (IS_WEB && t.kind === Track.Kind.Audio) { t.detach().forEach((e) => e.remove()); audioEls.delete(t.sid ?? ''); }
        bump();
      })
      .on(RoomEvent.TrackMuted, bump).on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump).on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ParticipantConnected, bump).on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.ParticipantPermissionsChanged, traced('ev permissions', (_prev: unknown, p: { isLocal: boolean }) => { if (p.isLocal) setPermRev((n) => n + 1); }))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (dead) return; // our own cleanup
        log(`disconnected: ${reason !== undefined ? DisconnectReason[reason] ?? reason : 'unknown'}`);
        if (reason === DisconnectReason.ROOM_DELETED) setEnded(true); else setDropped((n) => n + 1);
      })
      .on(RoomEvent.DataReceived, (payload, p: RemoteParticipant | undefined, _k, topic) => {
        if (topic === 'live_ended') { if (!p || p.identity === hostRef.current) setEnded(true); return; }
        const set = topic ? listeners.current[topic] : undefined;
        if (!set?.size) return;
        try { const msg = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>; set.forEach((cb) => cb(p?.identity ?? '', msg)); } catch { /* ignore */ }
      })
      // ROOT CAUSE of the v43 "JS FROZEN after connected": this listener used to call r.startAudio() whenever playback was
      // reported blocked. On React Native there is no window.AudioContext, so acquireAudioContext() always finds "not
      // running" and emits AudioPlaybackStatusChanged(false), while startAudio() then emits (true) → our listener ran
      // startAudio() again → an endless chain of promise microtasks (the Mutex in livekit-client is promise-only), so no
      // timer, render or beat could ever run again. Native plays remote audio by itself; web unlocks via a user gesture
      // (effect below). The status is only logged now, never answered with startAudio().
      .on(RoomEvent.AudioPlaybackStatusChanged, traced('ev audioPlayback', (ok: boolean) => { jsMark(`audio playback ${ok ? 'on' : 'blocked'}`); }));
    const hostCheck = () => setHostHere(r.localParticipant.identity === hostRef.current || !!r.getParticipantByIdentity(hostRef.current));
    r.on(RoomEvent.ParticipantConnected, hostCheck).on(RoomEvent.ParticipantDisconnected, hostCheck);
    void (async () => {
      await lim(prevLeave, 'Previous live', 3000).catch(() => undefined);
      if (dead) return;
      log(`join attempt ${attempt + 1} (${Platform.OS})`);
      void hasLivePermissions(true).then((ok) => log(`permissions camera+mic: ${ok ? 'granted' : 'MISSING'}`));
      if (pub.current && video && camOn && !previewRef.current) {
        void (async () => {
          if (!(await hasLivePermissions(true))) { log('camera preview skipped: permission missing'); return; }
          log('camera preview: opening…');
          try {
            const tr = await lim(createLocalVideoTrack(ROOM_OPTS.videoCaptureDefaults), 'Camera preview', 8000);
            if (dead) { tr.stop(); return; }
            previewRef.current = tr; setPreview(tr); setCamStatus('on');
            log('camera preview ok');
          } catch (e) { if (!dead) log(`camera preview FAILED: ${errText(e)}`); }
        })();
      }
      // Audio routing is best effort and must never hold up the join (a hanging native call used to stall here).
      audioMode.current = pub.current;
      await lim(setAudioSession(true, pub.current), 'Audio session', 4000).then(() => log('audio session ok'), (e) => log(`audio session: ${errText(e)}`));
      if (dead) return;
      let step = 'Token';
      try {
        log('token: requesting…');
        const t = await lim(fetchLiveToken(roomId), 'Token', 12_000);
        if (dead) return;
        log(`token ok · role=${t.role} · url=${maskUrl(t.url)}${/^wss?:\/\//.test(t.url) ? '' : ' · INVALID URL'}`);
        step = 'Connect';
        log('connecting to LiveKit…');
        // Android: the experimental SCTP "snap" (WARP) that @livekit/react-native 3.1 switches on by default is turned off
        // here; the freeze starts right after "signal connected", where the peer connections are created with it.
        const rtcConfig = (IS_WEB ? undefined : { enableSctpSnap: false }) as RTCConfiguration | undefined;
        await lim(r.connect(t.url, t.token, { autoSubscribe: true, websocketTimeout: 10_000, peerConnectionTimeout: 12_000, rtcConfig }), 'Connect', 16_000);
        if (dead) { void r.disconnect(); return; }
        log('connected');
        // Web only: browsers need startAudio() for autoplay. Never on native (see the AudioPlaybackStatusChanged note above).
        if (IS_WEB) await lim(r.startAudio(), 'Audio', 3000).catch(() => undefined);
        log('room ready → UI');
        setRoom(r); hostCheck(); setError(''); setLink('connected');
      } catch (e) {
        if (dead) return;
        log(`${step} FAILED: ${errText(e)}`);
        void r.disconnect().catch(() => undefined);
        setError(`${step === 'Token' ? 'Could not get a live token' : 'Could not connect to the live server'}: ${errText(e)}`);
        setLink('offline');
      }
    })();
    return () => {
      dead = true; setRoom(null); roomRef.current = null;
      const pv = previewRef.current; previewRef.current = null; setPreview(null);
      if (pv && !r.localParticipant.getTrackPublication(Track.Source.Camera)) pv.stop(); // unpublished preview: release camera
      audioEls.forEach((e) => e.remove()); audioEls.clear();
      prevLeave = r.disconnect(true).catch(() => undefined); // stops mic + camera tracks and frees listeners
      void setAudioSession(false, false); audioMode.current = null;
    };
  }, [roomId, me, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Never an endless "connecting / reconnecting": after 20 s the join is abandoned with a clear error and a Try again button.
  useEffect(() => {
    if (!me || link === 'connected' || link === 'offline') return undefined;
    const t = setTimeout(() => {
      log(`still ${link} after 20s → stopped`);
      setError('Could not connect to the live server (timeout). Check your internet, then tap Try again.');
      setLink('offline');
      void roomRef.current?.disconnect().catch(() => undefined);
    }, 20_000);
    return () => clearTimeout(t);
  }, [link, me, attempt, log]);

  // Browser autoplay policy: if audio is blocked, the first tap / key press anywhere on the page unlocks it (no extra UI).
  useEffect(() => {
    if (!IS_WEB || !room) return undefined;
    const unlock = () => { if (!room.canPlaybackAudio) void room.startAudio().catch(() => undefined); };
    const evs = ['pointerdown', 'touchend', 'keydown'] as const;
    evs.forEach((e) => document.addEventListener(e, unlock, { passive: true }));
    return () => evs.forEach((e) => document.removeEventListener(e, unlock));
  }, [room]);

  // Host gone (crash / lost network) for a whole grace period: ask the server, which re-checks and closes the live for everybody.
  useEffect(() => {
    fxMark('hostReap');
    if (!room || !hostId || me === hostId) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (room.getParticipantByIdentity(hostId)) return;
      timer = setTimeout(() => {
        if (room.getParticipantByIdentity(hostId) || room.state !== ConnectionState.Connected) { arm(); return; }
        void reapLive(roomId).then((r) => { if (!r.ended) arm(); }).catch(() => arm());
      }, HOST_GRACE_MS);
    };
    arm();
    room.on(RoomEvent.ParticipantConnected, arm).on(RoomEvent.ParticipantDisconnected, arm);
    return () => { if (timer) clearTimeout(timer); room.off(RoomEvent.ParticipantConnected, arm).off(RoomEvent.ParticipantDisconnected, arm); };
  }, [room, roomId, hostId, me]);

  // Seat taken / left: let the server move my permissions, then (un)publish. No reconnect.
  useEffect(() => {
    fxMark('syncPermissions');
    if (!room) return;
    void syncLivePermissions(roomId).catch(() => undefined);
    // The join already configured the audio session for this role: only a real role change (seat taken / left) redoes it.
    if (audioMode.current !== canPublish) { audioMode.current = canPublish; void setAudioSession(true, canPublish); }
  }, [room, roomId, canPublish]);

  // Web beauty: "None" publishes the raw camera (no processor at all); any level inserts the beauty processor into the
  // already-published track. Toggling swaps the sender's track in place, so there is no reconnect and no republish.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const applyWebBeauty = useCallback(() => {
    chain.current = chain.current.then(async () => {
      const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as LocalVideoTrack | undefined;
      if (!track) return;
      const lv = beautyRef.current;
      const on = lv.smoothing > 0 || lv.whitening > 0;
      if (on && !track.getProcessor()) {
        const pr = webBeauty.current ?? (webBeauty.current = new WebBeautyProcessor());
        pr.setLevels(lv);
        await track.setProcessor(pr as unknown as Parameters<typeof track.setProcessor>[0]);
        if (pr.unsupported) {
          await track.stopProcessor().catch(() => undefined); // raw camera keeps publishing, never a black frame
          setError('Beauty is not supported on this browser — your normal camera is used.');
        }
      } else if (!on && track.getProcessor()) await track.stopProcessor();
      else if (on) webBeauty.current?.setLevels(lv);
    }).catch((e) => { console.warn('beauty processor', e); }); // beauty is optional: on failure the raw camera keeps publishing
  }, [room]);
  // Native: the GPUPixel frame processor is attached only while beauty is ON and fully removed when OFF (raw camera, zero cost).
  const applyNativeBeauty = useCallback(() => {
    if (IS_WEB) return;
    const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    const mst = track?.mediaStreamTrack;
    if (!track || !mst) return;
    const on = beautyRef.current.smoothing > 0 || beautyRef.current.whitening > 0;
    if (fxTracks.current.get(track) === on) return;
    fxTracks.current.set(track, on);
    attachLiveBeauty(mst, on);
  }, [room]);
  useEffect(() => {
    fxMark('beauty');
    beautyRef.current = beauty;
    setLiveBeauty(beauty); // native: the frame effect reads these levels (0/0 = untouched frames)
    if (IS_WEB) applyWebBeauty(); else applyNativeBeauty();
  }, [beauty, applyWebBeauty, applyNativeBeauty]);

  // Publish state follows the UI state. ONE serialized, idempotent pass per change: each track is published once (the camera
  // reuses the preview track, no 2nd capture); afterwards only mute/unmute (muting the camera also releases it).
  // Before: the preview track was published and then setCameraEnabled(true) ran again ("camera enable"), and every state
  // change re-ran setMicrophoneEnabled / setCameraEnabled even when nothing had to change.
  const pubChain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    fxMark('publish');
    if (!room || link !== 'connected') return undefined;
    const lp = room.localParticipant;
    const wantMic = canPublish && micOn && !muted;
    const wantCam = canPublish && video && camOn && !muted && appActive;
    let cancelled = false;
    const pass = async () => {
      if (cancelled) return; // a newer pass is already queued
      // Never trigger an Android permission dialog inside the room (it pauses the activity → black camera): check only.
      if ((wantMic || wantCam) && !(await hasLivePermissions(wantCam))) {
        if (!cancelled) { setCamStatus('error'); setError('Camera / microphone permission is off. Allow it in Settings, then start the live again.'); }
        return;
      }
      if (cancelled) return;
      const mic = lp.getTrackPublication(Track.Source.Microphone);
      try {
        if (!mic) { if (wantMic) { log('mic: publish'); await lim(lp.setMicrophoneEnabled(true), 'Microphone'); } }
        else if (wantMic === mic.isMuted) { log(`mic: ${wantMic ? 'unmute' : 'mute'}`); await lim((wantMic ? mic.unmute() : mic.mute()) as Promise<unknown>, 'Microphone'); }
      } catch (e) { log(`mic FAILED: ${errText(e)}`); if (wantMic) setError(`Microphone: ${errText(e)}`); }
      if (cancelled) return;
      try {
        const cam = lp.getTrackPublication(Track.Source.Camera);
        const pv = previewRef.current;
        if (!cam) {
          if (wantCam) {
            if (!pv) setCamStatus('starting');
            log(pv ? 'camera: publish preview track' : 'camera: publish');
            await lim((pv ? lp.publishTrack(pv, { source: Track.Source.Camera }) : lp.setCameraEnabled(true)) as Promise<unknown>, 'Camera');
          } else if (pv) { pv.stop(); previewRef.current = null; setPreview(null); } // never published: release the camera
        } else if (wantCam === cam.isMuted) { log(`camera: ${wantCam ? 'unmute' : 'mute'}`); await lim((wantCam ? cam.unmute() : cam.mute()) as Promise<unknown>, 'Camera'); }
        const now = lp.getTrackPublication(Track.Source.Camera);
        if (now?.track && previewRef.current === now.track) { previewRef.current = null; setPreview(null); } // the publication owns it now
        const on = !!now?.track && !now.isMuted;
        setCamStatus(wantCam ? (on ? 'on' : 'error') : 'off');
        if (on) { if (IS_WEB) applyWebBeauty(); else applyNativeBeauty(); }
      } catch (e) { log(`camera FAILED: ${errText(e)}`); if (wantCam) { setCamStatus('error'); setError(`Camera: ${errText(e)}`); } }
    };
    // Small delay: the server-side permission update must land before publishing.
    const t = setTimeout(() => { pubChain.current = pubChain.current.then(pass).catch(() => undefined); }, canPublish ? 350 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [room, link, canPublish, micOn, camOn, video, muted, appActive, applyWebBeauty, permRev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Backgrounded app / hidden tab: stop pulling video (audio keeps flowing). Signals only on real changes, never per re-render.
  useEffect(() => {
    fxMark('videoPaused');
    if (!room) return;
    if (appActive && !videoPaused.current) return;
    videoPaused.current = !appActive;
    room.remoteParticipants.forEach((p) => p.videoTrackPublications.forEach((pub) => pub.setSubscribed(appActive)));
  }, [room, appActive, rev]);

  const videoOf = useCallback((uid: string): VideoTrack | undefined => {
    if (!room) return uid === me && preview ? preview : undefined;
    const p = uid === me ? room.localParticipant : room.getParticipantByIdentity(uid);
    const pubn = p?.getTrackPublication(Track.Source.Camera);
    const live = pubn && !pubn.isMuted ? (pubn.videoTrack as VideoTrack | undefined) : undefined;
    return live ?? (uid === me ? preview ?? undefined : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, me, rev, preview]);

  const send = useCallback((topic: string, msg: Record<string, unknown>, reliable = true) => {
    if (!room || link !== 'connected') return;
    void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable, topic }).catch(() => undefined);
  }, [room, link]);

  const on = useCallback((topic: string, cb: DataCb) => {
    (listeners.current[topic] ??= new Set()).add(cb);
    return () => { listeners.current[topic]?.delete(cb); };
  }, []);

  // Stable API object: only changes when its parts change (screens may safely list `lk` in effect deps).
  const count = useMemo(() => (room ? room.numParticipants : 0), [room, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({ room, link, quality, speaking, videoOf, send, on, error, participants: count, ended, dropped, camStatus, retry, hostHere }),
    [room, link, quality, speaking, videoOf, send, on, error, count, ended, dropped, camStatus, retry, hostHere]);
}
