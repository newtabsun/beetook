// Imported first in index.ts: LiveKit's React Native globals (WebRTC, URL, streams, crypto shims) must be registered at
// app start, before livekit-client is evaluated anywhere (LiveKit RN setup requirement).
// The RTCPeerConnection calls that are SYNCHRONOUS native calls on Android (init, addTransceiver, addTrack,
// createDataChannel) are traced into the native freeze watchdog: if one never returns, its name is in the report.
import { Platform } from 'react-native';
import { initLiveKit } from './livekit';
import { jsMark } from '../../modules/gpupixel-camera';

initLiveKit();

type AnyFn = (...a: unknown[]) => unknown;
const G = globalThis as unknown as { RTCPeerConnection?: { new (cfg?: unknown): object; prototype: Record<string, unknown>; __bee?: boolean } };
const Base = G.RTCPeerConnection;
if (Platform.OS !== 'web' && Base && !Base.__bee) {
  class Traced extends (Base as unknown as new (cfg?: unknown) => object) {
    constructor(cfg?: unknown) { jsMark('pc.init start'); super(cfg); jsMark('pc.init ok'); }
  }
  const proto = Traced.prototype as unknown as Record<string, unknown>;
  ['addTransceiver', 'addTrack', 'removeTrack', 'createDataChannel', 'createOffer', 'createAnswer', 'setLocalDescription', 'setRemoteDescription', 'close']
    .forEach((m) => {
      const orig = Base.prototype[m] as AnyFn | undefined;
      if (typeof orig !== 'function') return;
      proto[m] = function traced(this: unknown, ...a: unknown[]) {
        jsMark(`pc.${m} start`);
        const r = orig.apply(this, a);
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          (r as Promise<unknown>).then(() => jsMark(`pc.${m} ok`), (e) => jsMark(`pc.${m} error ${e instanceof Error ? e.message : String(e)}`));
        } else jsMark(`pc.${m} ok`);
        return r;
      };
    });
  (Traced as unknown as { __bee: boolean }).__bee = true;
  G.RTCPeerConnection = Traced as unknown as typeof Base;
}
