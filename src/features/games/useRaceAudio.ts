// Native (Android/iOS) engine sound with expo-audio. Web uses useRaceAudio.web.ts (Web Audio API).
// Same layers, same mix rules (raceAudioConfig.ts). The audio session is forced to the loudspeaker
// with no ducking (lib/audioMode.ts) and re-applied once the camera and mic have started, so the
// live camera/mic can never pull the race sound down to call volume.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAudioPlayer } from 'expo-audio';
import { useAppActive } from '../../lib/appActive';
import { applyAudioMode } from '../../lib/audioMode';
import { LAYERS, RACE_AUDIO, clamp01, loadOf, mixOf, revOf, voice, type CarTone } from './raceAudioConfig';

export type { CarTone } from './raceAudioConfig';

interface Applied { load: number; vc: number; vh: number; rc: number; rh: number }
const fresh = (): Applied => ({ load: 0, vc: -1, vh: -1, rc: -1, rh: -1 });

export function useRaceAudio(cars: { 0: CarTone; 1: CarTone }, playing: boolean, level: number, primarySide: 0 | 1 | null) {
  const c0 = useAudioPlayer(LAYERS.cruise); const c1 = useAudioPlayer(LAYERS.cruise);
  const h0 = useAudioPlayer(LAYERS.high); const h1 = useAudioPlayer(LAYERS.high);
  const r0 = useAudioPlayer(LAYERS.rev); const r1 = useAudioPlayer(LAYERS.rev);
  const cruise = useMemo(() => [c0, c1], [c0, c1]);
  const high = useMemo(() => [h0, h1], [h0, h1]);
  const rev = useMemo(() => [r0, r1], [r0, r1]);
  const all = useMemo(() => [c0, c1, h0, h1, r0, r1], [c0, c1, h0, h1, r0, r1]);
  const live = useRef({ cars, playing, level, primarySide, applied: [fresh(), fresh()] });
  live.current.cars = cars; live.current.playing = playing;
  live.current.level = level; live.current.primarySide = primarySide;
  const active = useAppActive();
  const on = playing && level > 0 && active;

  useEffect(() => {
    for (const p of all) { p.shouldCorrectPitch = false; p.loop = false; }
    for (const p of [...cruise, ...high]) p.loop = true;
    return () => { for (const p of all) { try { p.pause(); } catch { /* not playing */ } } };
  }, [all, cruise, high]);

  const stop = useCallback(() => {
    live.current.applied = [fresh(), fresh()];
    for (const p of all) { try { p.pause(); } catch { /* not playing */ } }
  }, [all]);

  const burst = useCallback((side: 0 | 1) => {
    const s = live.current;
    if (!s.playing || s.level <= 0) return;
    const p = rev[side];
    try { p.volume = clamp01(revOf(side, s.primarySide) * s.level); void p.seekTo(0); p.play(); } catch { /* ignore */ }
  }, [rev]);

  useEffect(() => {
    if (!on) { stop(); return undefined; }
    // Speaker route + no ducking now, and again after the camera/mic finished starting.
    void applyAudioMode();
    const again = setTimeout(() => void applyAudioMode(), 1500);
    cruise.forEach((c, sd) => {
      const h = high[sd];
      try {
        c.volume = 0; h.volume = 0;
        if (sd === 1) { void c.seekTo(RACE_AUDIO.secondaryOffset); void h.seekTo(RACE_AUDIO.secondaryOffset); }
        c.play(); h.play();
      } catch { /* ignore */ }
    });
    let raf = 0; let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // Volume / pitch easing needs ~20 updates per second, not 60: fewer native audio calls, same sound.
      if (last && t - last < 48) return;
      const dt = last ? Math.min((t - last) / 1000, 0.15) : 0; last = t;
      const e = 1 - Math.exp(-dt * (1000 / RACE_AUDIO.smoothMs));
      const s = live.current;
      for (const side of [0, 1] as const) {
        const a = s.applied[side];
        a.load += (loadOf(s.cars[side]) - a.load) * e;
        const v = voice(a.load, RACE_AUDIO.master * mixOf(side, s.primarySide) * s.level);
        const cp = cruise[side]; const hp = high[side];
        if (Math.abs(v.vc - a.vc) > 0.004) { a.vc = v.vc; cp.volume = clamp01(v.vc); }
        if (Math.abs(v.vh - a.vh) > 0.004) { a.vh = v.vh; hp.volume = clamp01(v.vh); }
        if (Math.abs(v.rc - a.rc) > 0.004) { a.rc = v.rc; try { cp.setPlaybackRate(v.rc); } catch { /* unsupported */ } }
        if (Math.abs(v.rh - a.rh) > 0.004) { a.rh = v.rh; try { hp.setPlaybackRate(v.rh); } catch { /* unsupported */ } }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { clearTimeout(again); cancelAnimationFrame(raf); stop(); };
  }, [on, stop, cruise, high]);

  return { rev: burst, stop };
}
