// Web engine sound with the Web Audio API (same layers and mix rules as native, raceAudioConfig.ts).
// Why not <audio> elements: on phones their volume is capped at 1.0 (and ignored on iOS), and once the
// page opens a microphone the browser lowers media output. Here every voice goes through
//   source (loop) → voice gain → master make-up gain (webBoost) → limiter → speakers,
// so the engine stays loud and never clips. The context resumes on the first touch (autoplay rules).
import { useCallback, useEffect, useRef } from 'react';
import { Asset } from 'expo-asset';
import { useAppActive } from '../../lib/appActive';
import { LAYERS, RACE_AUDIO, loadOf, mixOf, revOf, voice, type CarTone } from './raceAudioConfig';

export type { CarTone } from './raceAudioConfig';

type Bufs = { cruise: AudioBuffer; high: AudioBuffer; rev: AudioBuffer };
interface Car { cs: AudioBufferSourceNode; hs: AudioBufferSourceNode; cg: GainNode; hg: GainNode; load: number }
interface Graph { ctx: AudioContext; bufs: Bufs; master: GainNode; cars: Car[] }

let ctxSingleton: AudioContext | null = null;
let bufsPromise: Promise<Bufs> | null = null;

function getCtx(): AudioContext {
  if (!ctxSingleton) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctxSingleton = new AC({ latencyHint: 'interactive' });
  }
  return ctxSingleton;
}

async function decode(ctx: AudioContext, mod: number): Promise<AudioBuffer> {
  const asset = Asset.fromModule(mod);
  const res = await fetch(asset.uri);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

function loadBufs(ctx: AudioContext): Promise<Bufs> {
  bufsPromise ??= Promise.all([decode(ctx, LAYERS.cruise), decode(ctx, LAYERS.high), decode(ctx, LAYERS.rev)])
    .then(([cruise, high, rev]) => ({ cruise, high, rev }))
    .catch((e) => { bufsPromise = null; throw e; });
  return bufsPromise;
}

function build(ctx: AudioContext, bufs: Bufs): Graph {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 12;
  limiter.attack.value = 0.003; limiter.release.value = 0.25;
  const master = ctx.createGain();
  master.gain.value = RACE_AUDIO.webBoost;
  master.connect(limiter).connect(ctx.destination);
  const loop = (buf: AudioBuffer, gain: GainNode, offset: number) => {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.connect(gain);
    s.start(0, offset % buf.duration);
    return s;
  };
  const cars = [0, 1].map((side) => {
    const cg = ctx.createGain(); const hg = ctx.createGain();
    cg.gain.value = 0; hg.gain.value = 0;
    cg.connect(master); hg.connect(master);
    const off = side === 1 ? RACE_AUDIO.secondaryOffset : 0;
    return { cs: loop(bufs.cruise, cg, off), hs: loop(bufs.high, hg, off), cg, hg, load: 0 };
  });
  return { ctx, bufs, master, cars };
}

function teardown(g: Graph) {
  const t = g.ctx.currentTime;
  g.master.gain.setTargetAtTime(0, t, 0.05);
  setTimeout(() => {
    for (const c of g.cars) { try { c.cs.stop(); c.hs.stop(); } catch { /* already stopped */ } }
    g.master.disconnect();
  }, 300);
}

export function useRaceAudio(cars: { 0: CarTone; 1: CarTone }, playing: boolean, level: number, primarySide: 0 | 1 | null) {
  const live = useRef({ cars, playing, level, primarySide });
  live.current = { cars, playing, level, primarySide };
  const graph = useRef<Graph | null>(null);
  const active = useAppActive();
  const on = playing && level > 0 && active;

  const stop = useCallback(() => { if (graph.current) { teardown(graph.current); graph.current = null; } }, []);

  const burst = useCallback((side: 0 | 1) => {
    const g = graph.current; const s = live.current;
    if (!g || !s.playing || s.level <= 0) return;
    const src = g.ctx.createBufferSource();
    const gain = g.ctx.createGain();
    gain.gain.value = revOf(side, s.primarySide) * s.level;
    src.buffer = g.bufs.rev;
    src.connect(gain).connect(g.master);
    src.start();
  }, []);

  useEffect(() => {
    if (!on || typeof window === 'undefined') { stop(); return undefined; }
    const ctx = getCtx();
    const resume = () => { if (ctx.state !== 'running') void ctx.resume().catch(() => undefined); };
    resume();
    document.addEventListener('pointerdown', resume);
    let dead = false; let raf = 0; let last = 0;
    const loop = (t: number) => {
      const g = graph.current;
      const dt = last ? Math.min((t - last) / 1000, 0.05) : 0; last = t;
      if (g) {
        const e = 1 - Math.exp(-dt * (1000 / RACE_AUDIO.smoothMs));
        const s = live.current; const now = g.ctx.currentTime;
        for (const side of [0, 1] as const) {
          const c = g.cars[side];
          c.load += (loadOf(s.cars[side]) - c.load) * e;
          const v = voice(c.load, RACE_AUDIO.master * mixOf(side, s.primarySide) * s.level);
          // short audio-rate ramps on top of the JS easing: no zipper noise
          c.cg.gain.setTargetAtTime(v.vc, now, 0.03);
          c.hg.gain.setTargetAtTime(v.vh, now, 0.03);
          c.cs.playbackRate.setTargetAtTime(v.rc, now, 0.05);
          c.hs.playbackRate.setTargetAtTime(v.rh, now, 0.05);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    void loadBufs(ctx).then((bufs) => {
      if (dead) return;
      graph.current = build(ctx, bufs);
      raf = requestAnimationFrame(loop);
    }).catch(() => undefined);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', resume);
      stop();
    };
  }, [on, stop]);

  return { rev: burst, stop };
}
