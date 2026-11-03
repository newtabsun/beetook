import { handleOf } from '../../lib/username';
import { friendlyError } from '../../lib/errors';
// TikTok-style Sound page: header with preview, grid of every video using the sound, sticky "Use this sound".
import { useAudible } from '../../lib/media';
import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { createElement } from 'react';
import { Platform } from 'react-native';
import { videoThumb } from '../../lib/videoThumb';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from '../../components/CachedImage';
import { Icon } from '../../components/Icons';
import { VipAvatar } from '../../components/Vip';
import { fetchSoundPosts, formatNum, soundForPost, type Post, type Sound } from '../../lib/api';
import { colors } from '../../theme';
import { FullscreenPlayer } from '../feed/FullscreenPlayer';

export interface PickedSound { id: string; url: string; title: string }

let previewPlayer: AudioPlayer | null = null;
/** Stops the Sound page preview so it never overlaps the camera's sound. */
export function stopSoundPreview() { try { previewPlayer?.pause(); } catch { /* released */ } previewPlayer = null; }

function Shimmer() {
  const a = useState(() => new Animated.Value(0.35))[0];
  useEffect(() => { const l = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 0.8, duration: 700, useNativeDriver: Platform.OS !== 'web' }), Animated.timing(a, { toValue: 0.35, duration: 700, useNativeDriver: Platform.OS !== 'web' })])); l.start(); return () => l.stop(); }, [a]);
  return <Animated.View style={[s.thumb, { position: 'absolute', backgroundColor: '#3a3a3a', opacity: a }]} />;
}

/** Own thumbnail, else first-second frame; shimmer while loading — never a black tile. */
function Thumb({ post }: { post: Post }) {
  const src = post.media_urls?.[0];
  const [uri, setUri] = useState<string | null>(post.thumbnail_url ?? null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (post.thumbnail_url || !src || post.kind !== 'video') return;
    let on = true;
    void videoThumb(src).then((u) => { if (!on) return; if (u) setUri(u); else setFailed(true); });
    return () => { on = false; };
  }, [post.thumbnail_url, post.kind, src]);
  const photo = post.kind === 'photos' ? src : null;
  const img = uri ?? photo;
  if (!img && failed && Platform.OS === 'web' && src) {
    // CORS blocked canvas capture: let the browser paint the first second directly.
    return createElement('video', { src: `${src}#t=0.5`, muted: true, playsInline: true, preload: 'metadata', style: { width: '100%', height: '100%', objectFit: 'cover', background: '#2a2a2a' } });
  }
  return (
    <>
      {!loaded && <Shimmer />}
      {!!img && <Image source={{ uri: img }} style={s.thumb} resizeMode="cover" onLoad={() => setLoaded(true)} />}
    </>
  );
}

function Preview({ url }: { url: string }) {
  const player = useAudioPlayer(url);
  previewPlayer = player;
  const st = useAudioPlayerStatus(player);
  const [want, setWant] = useState(false);
  const [req, setReq] = useState(0);
  const on = useAudible(want, req);
  useEffect(() => { try { if (on) { if (st.didJustFinish || (st.duration && st.currentTime >= st.duration - 0.1)) void player.seekTo(0); player.loop = true; player.play(); } else player.pause(); } catch { /* released */ } }, [on, req]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { try { player.pause(); } catch { /* released */ } if (previewPlayer === player) previewPlayer = null; }, [player]);
  return (
    <Pressable testID="sound-preview" accessibilityLabel={st.playing ? 'Pause sound' : 'Play sound'} style={s.cover}
      onPress={() => { if (st.playing) { setWant(false); player.pause(); } else { setWant(true); setReq((n) => n + 1); } }}>
      <Icon name={st.playing ? 'volume' : 'play'} size={30} color="#000" />
    </Pressable>
  );
}

export function SoundScreen({ post, onBack, onUser, onUse, onDuet }: { post: Post; onBack: () => void; onUser: (id: string) => void; onUse: (s: PickedSound) => void; onDuet?: (p: Post) => void }) {
  const [sound, setSound] = useState<Sound | null>(null);
  const [items, setItems] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { soundForPost(post).then(setSound).catch((e: Error) => setErr(friendlyError(e))); }, [post]);
  const load = useCallback(async (sd: Sound, pg: number) => {
    setBusy(true);
    try {
      const r = await fetchSoundPosts(sd, pg);
      setItems((prev) => (pg === 0 ? r.posts : [...prev, ...r.posts.filter((x) => !prev.some((y) => y.id === x.id))]));
      if (pg === 0) setTotal(r.total);
      setPage(pg); setMore(r.more);
    } catch (e) {
      // Only a failed first page is worth a message; a failed "load more" just stops paging.
      if (pg === 0) setErr(friendlyError(e)); else setMore(false);
    }
    setBusy(false);
  }, []);
  useEffect(() => { if (sound) void load(sound, 0); }, [sound, load]);

  return (
    <View style={s.root} testID="sound-screen">
      <Pressable accessibilityLabel="Back" onPress={onBack} style={s.back}><Icon name="back" size={22} color={colors.primary} /></Pressable>
      {!sound && !err && <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />}
      {!!err && <Text style={s.err}>{err}</Text>}
      {sound && (
        <FlatList data={items} numColumns={3} keyExtractor={(p) => p.id} columnWrapperStyle={{ gap: 3 }} contentContainerStyle={{ gap: 3, paddingBottom: 90 }}
          showsVerticalScrollIndicator={false} onEndReachedThreshold={0.6} onEndReached={() => { if (more && !busy) void load(sound, page + 1); }}
          ListHeaderComponent={(
            <View style={s.head}>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <Preview url={sound.audio_url} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={s.title} numberOfLines={2}>{sound.title}</Text>
                  {sound.creator_user_id && (
                    <Pressable style={s.row} onPress={() => onUser(sound.creator_user_id!)}>
                      <VipAvatar userId={sound.creator_user_id} uri={sound.creator?.avatar_url} name={sound.creator?.username} size={22} />
                      <Text style={s.muted}>{handleOf(sound.creator?.username ?? 'user')}</Text>
                    </Pressable>
                  )}
                  <Text style={s.muted} testID="sound-count">{formatNum(total)} videos</Text>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={busy ? <ActivityIndicator color={colors.primary} /> : <Text style={[s.muted, { textAlign: 'center' }]}>No videos yet</Text>}
          ListFooterComponent={busy && items.length ? <ActivityIndicator color={colors.primary} style={{ margin: 12 }} /> : null}
          renderItem={({ item, index }) => (
            <Pressable testID="sound-video" style={s.cell} onPress={() => { stopSoundPreview(); setOpen(index); }}>
              <Thumb post={item} />
              {item.id === sound.original_post_id && <View style={s.orig}><Text style={s.origT}>Original</Text></View>}
              <View style={s.views}><Icon name="play" size={11} /><Text style={s.viewsT}>{formatNum(item.view_count ?? 0)}</Text></View>
            </Pressable>
          )} />
      )}
      {sound && (
        <Pressable testID="use-sound" accessibilityLabel="Use this sound" style={s.use} onPress={() => { stopSoundPreview(); onUse({ id: sound.id, url: sound.audio_url, title: sound.title }); }}>
          <Icon name="music" size={18} color="#000" /><Text style={s.useT}>Use this sound</Text>
        </Pressable>
      )}
      {open !== null && <FullscreenPlayer posts={items} index={open} onClose={() => setOpen(null)} onUser={onUser} onDuet={onDuet} />}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  back: { position: 'absolute', top: 10, left: 10, zIndex: 2, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  head: { paddingTop: 56, paddingHorizontal: 14, paddingBottom: 14 },
  cover: { width: 88, height: 88, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '900', fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  err: { color: '#E53935', textAlign: 'center', marginTop: 70, padding: 16 },
  cell: { width: '33%', aspectRatio: 9 / 16, backgroundColor: '#2a2a2a', overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', backgroundColor: '#2a2a2a' },
  orig: { position: 'absolute', top: 4, left: 4, backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  origT: { color: '#000', fontSize: 10, fontWeight: '900' },
  views: { position: 'absolute', left: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewsT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  use: { position: 'absolute', left: 16, right: 16, bottom: 16, height: 50, borderRadius: 99, backgroundColor: '#FFA500', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  useT: { color: '#000', fontWeight: '900', fontSize: 16 },
});
