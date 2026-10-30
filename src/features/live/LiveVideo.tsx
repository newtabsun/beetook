// Renders a LiveKit video track filling its container (same absoluteFill contract as BeautyCamera).
import { createContext, createElement, memo, useContext, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { VideoTrack } from 'livekit-client';

/** Lets deep children (the game VS card) read a participant's LiveKit camera without prop drilling. */
export const VideoOfContext = createContext<(uid: string) => VideoTrack | undefined>(() => undefined);
export const useVideoOf = () => useContext(VideoOfContext);

/** Seat state of a participant (from the room's seat rows) + a way to open the seat sheet: lets the game cards act as seats. */
export interface TileInfo { muted: boolean; camOff: boolean; speaking: boolean }
export interface TileCtl { info: (uid: string) => TileInfo | undefined; press: (uid: string) => void }
export const TileCtlContext = createContext<TileCtl>({ info: () => undefined, press: () => undefined });
export const useTileCtl = () => useContext(TileCtlContext);

function WebVideo({ track, mirror }: { track: VideoTrack; mirror: boolean }) {
  const el = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = el.current;
    if (!v) return undefined;
    track.attach(v);
    return () => { track.detach(v); };
  }, [track]);
  return (
    <View style={StyleSheet.absoluteFill}>
      {createElement('video', {
        ref: el, autoPlay: true, playsInline: true, muted: true,
        style: { width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined },
      })}
    </View>
  );
}

export const LiveVideo = memo(function LiveVideo({ track, mirror = false }: { track?: VideoTrack; mirror?: boolean }) {
  if (!track) return null;
  if (Platform.OS === 'web') return <WebVideo track={track} mirror={mirror} />;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VideoView } = require('@livekit/react-native') as typeof import('@livekit/react-native');
  return <VideoView style={StyleSheet.absoluteFill} videoTrack={track} objectFit="cover" mirror={mirror} />;
});
