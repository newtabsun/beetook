import { useEffect, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { cropOf, cropTransform } from '../features/editor/CropTool';
import { Platform, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { formatNum, type Post } from '../lib/api';
import { Icon } from './Icons';
import type { BoostProgress } from '../lib/boost';

/** First-frame poster when a post has no thumbnail (paused, muted). */
function FirstFrame({ uri }: { uri: string }) {
  const player = useVideoPlayer(Platform.OS === 'web' ? `${uri}#t=0.1` : uri, (p) => { p.muted = true; p.pause(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />;
}
function Poster({ p }: { p: Post }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View style={[StyleSheet.absoluteFill, { transform: cropTransform(cropOf(p.edit), box.w, box.h) }]}><PosterMedia p={p} /></View>
    </View>
  );
}
function PosterMedia({ p }: { p: Post }) {
  const url = p.thumbnail_url || (p.kind === 'photos' ? p.media_urls[0] : null);
  if (url) return <ExpoImage source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={0} recyclingKey={url} />;
  return p.media_urls[0] ? <FirstFrame uri={p.media_urls[0]} /> : null;
}

const GRID_STEP = 24;

/** Grids live inside a ScrollView: render the first cells and add more while the user nears the bottom. */
export function useGridPaging(count: number, step = GRID_STEP) {
  const [limit, setLimit] = useState(step);
  useEffect(() => { if (count === 0) setLimit(step); }, [count, step]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y > contentSize.height - 600) setLimit((l) => (l < count ? l + step : l));
  };
  return { limit, onScroll };
}

/** TikTok-style profile grid: 3 columns, 9:16, ▷ view count bottom-left. */
export function VideoGrid({ posts, onOpen, showPinned, limit, boosts }: {
  posts: Post[]; onOpen: (i: number) => void; showPinned?: boolean; limit?: number;
  /** post id → running boost; drawn as a progress overlay until the goal is reached. */
  boosts?: Record<string, BoostProgress>;
}) {
  const [w, setW] = useState(0);
  const cw = w ? Math.floor((w - 4) / 3) : 0;
  const visible = limit ? posts.slice(0, limit) : posts;
  return (
    <View style={g.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {cw > 0 && visible.map((x, i) => (
        <Pressable key={x.id} style={[g.cell, { width: cw, height: Math.round((cw * 16) / 9) }]} accessibilityLabel="Open video" testID={`grid-${i}`} onPress={() => onOpen(i)}>
          <Poster p={x} />
          {x.privacy === 'only_me' && <View style={[g.pin, { left: undefined, right: 4, backgroundColor: '#333' }]}><Text style={[g.pinT, { color: '#fff' }]}>Private</Text></View>}
          {x.status === 'draft' && <View style={[g.pin, { left: undefined, right: 4, backgroundColor: '#555' }]}><Text style={[g.pinT, { color: '#fff' }]}>Draft</Text></View>}
          {showPinned && x.pinned && <View style={g.pin}><Text style={g.pinT}>Pinned</Text></View>}
          <View style={g.views}><Icon name="play" size={12} color="#fff" fill="#fff" /><Text style={g.viewsT}>{formatNum(Number(x.view_count ?? 0) || 0)}</Text></View>
          {boosts?.[x.id] && <BoostOverlay p={boosts[x.id]} width={cw} />}
        </Pressable>
      ))}
    </View>
  );
}

const KIND_UNIT: Record<string, string> = { views: 'views', likes: 'likes', comments: 'comments', profileViews: 'profile views', liveViewers: 'live viewers' };

/** How much of a paid boost has been delivered and how much is still owed — until it hits 100 %. */
function BoostOverlay({ p, width }: { p: BoostProgress; width: number }) {
  const unit = KIND_UNIT[p.kind] ?? p.kind;
  return (
    <View style={[g.boost, { width }]} pointerEvents="none" testID={`boost-progress-${p.campaign_id}`}
      accessibilityLabel={`Boost ${p.pct}% delivered, ${formatNum(p.remaining)} ${unit} remaining`}>
      <View style={g.boostTop}>
        <View style={g.boostTag}><Icon name="rocket" size={10} color="#000" /><Text style={g.boostTagT}>{p.pct}%</Text></View>
        <Text style={g.boostLeft}>{formatNum(p.remaining)} left</Text>
      </View>
      <View style={g.boostTrack}><View style={[g.boostFill, { width: `${Math.min(100, Math.max(2, p.pct))}%` }]} /></View>
      <Text style={g.boostSub} numberOfLines={1}>{formatNum(p.delivered)}/{formatNum(p.goal)} {unit}</Text>
    </View>
  );
}
const g = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, width: '100%', minHeight: 40 },
  cell: { backgroundColor: '#1A1A1D', overflow: 'hidden' },
  views: { position: 'absolute', left: 6, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewsT: { color: '#fff', fontSize: 12, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  pin: { position: 'absolute', left: 4, top: 4, backgroundColor: '#FFA500', borderRadius: 4, paddingHorizontal: 4 },
  pinT: { color: '#000', fontSize: 10, fontWeight: '800' },
  boost: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,12,14,0.82)', paddingHorizontal: 5, paddingTop: 4, paddingBottom: 5, gap: 3 },
  boostTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  boostTag: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FFA500', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  boostTagT: { color: '#000', fontSize: 9, fontWeight: '900' },
  boostLeft: { color: '#fff', fontSize: 9, fontWeight: '800' },
  boostTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  boostFill: { height: 4, borderRadius: 2, backgroundColor: '#FFA500' },
  boostSub: { color: 'rgba(255,255,255,0.72)', fontSize: 8.5, fontWeight: '700' },
});
