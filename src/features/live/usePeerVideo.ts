// Car racing duel: the two competitors stream from two different LiveKit rooms, so a viewer of one room never receives the
// other competitor's camera. While a game runs, this hook adds a second, video-only (no audio, no publishing) connection to
// the OTHER room so the competitor cards can show the real live video of both players.
import { useCallback, useEffect, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrackPublication, type VideoTrack } from 'livekit-client';
import { fetchPeerToken, initLiveKit } from '../../lib/livekit';

export function usePeerVideo(roomId: string, enabled: boolean) {
  const [room, setRoom] = useState<Room | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    initLiveKit();
    let dead = false;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    const bump = () => setRev((n) => n + 1);
    const want = (pub: RemoteTrackPublication) => { if (pub.kind === Track.Kind.Video) pub.setSubscribed(true); };
    r.on(RoomEvent.TrackPublished, (pub) => { want(pub); bump(); })
      .on(RoomEvent.ParticipantConnected, (p) => { p.trackPublications.forEach(want); bump(); })
      .on(RoomEvent.TrackSubscribed, bump).on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump).on(RoomEvent.TrackUnmuted, bump).on(RoomEvent.ParticipantDisconnected, bump);
    void (async () => {
      try {
        const t = await fetchPeerToken(roomId);
        if (dead) return;
        await r.connect(t.url, t.token, { autoSubscribe: false }); // audio is never pulled from the other room
        if (dead) { void r.disconnect(); return; }
        r.remoteParticipants.forEach((p) => p.trackPublications.forEach(want));
        setRoom(r);
      } catch { /* best effort: the card keeps showing the avatar */ }
    })();
    return () => { dead = true; setRoom(null); void r.disconnect().catch(() => undefined); };
  }, [roomId, enabled]);

  const videoOf = useCallback((uid: string): VideoTrack | undefined => {
    if (!room) return undefined;
    const pub = room.getParticipantByIdentity(uid)?.getTrackPublication(Track.Source.Camera);
    return pub && !pub.isMuted ? (pub.videoTrack as VideoTrack | undefined) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, rev]);

  return { videoOf };
}
