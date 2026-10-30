// Slideshow stage for Android, iOS and web, WITHOUT Skia (Skia force-closed Android in vC12/vC14).
// Renders the selected native theme: per-photo in/out transition + beat-synced hold motion, on the shared clock.
import { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { nativeThemeFor, slideFrame } from '../motion';

type StageProps = {
  sources: string[]; themeId: number; seconds: number; width: number; playing?: boolean; clock?: { current: number };
};

export function Theme105Stage({ sources, themeId, seconds, width, playing = true, clock }: StageProps) {
  const height = (width * 1280) / 720;
  const per = Math.max(0.3, seconds || 2);
  const [t, setT] = useState(0);
  const local = useRef(0);
  useEffect(() => {
    if (!playing || sources.length === 0) return undefined;
    let raf = 0;
    let last = Date.now();
    const loop = () => {
      const now = Date.now();
      local.current += (now - last) / 1000;
      last = now;
      setT(clock ? clock.current : local.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, sources.length, clock]);
  const theme = nativeThemeFor(themeId);
  const { idx, fx, bars } = slideFrame(t, per, sources.length, width, height, theme);
  const uri = sources[idx] ?? sources[0];
  return (
    <View style={{ width, height, backgroundColor: '#000', overflow: 'hidden' }}>
      {uri ? (
        <View style={{ width, height, opacity: fx.opacity ?? 1, transform: fx.transform as never, ...(fx.filter ? { filter: fx.filter } : {}) } as never}>
          <Image source={{ uri }} style={{ width, height }} resizeMode="cover" fadeDuration={0} />
        </View>
      ) : null}
      {fx.overlay ? <View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, fx.overlay]} /> : null}
      {bars ? <><View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: height * 0.12, backgroundColor: '#000' }} /><View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.12, backgroundColor: '#000' }} /></> : null}
    </View>
  );
}
