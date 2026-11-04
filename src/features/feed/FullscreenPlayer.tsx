// Full-screen vertical player for a profile's video list (swipe + full action rail).
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';
import { AppModal } from '../../components/AppModal';
import { Icon } from '../../components/Icons';
import { attachPostAuthors, fetchPostsByIds, isPartialPost, onPostDeleted, type Post } from '../../lib/api';

/** Grid rows carry no caption/edit: fill safe defaults if the full rows cannot be loaded (offline). */
const withDefaults = (p: Post): Post => ({
  ...p, caption: p.caption ?? '', edit: p.edit ?? null, like_count: p.like_count ?? 0, comment_count: p.comment_count ?? 0, save_count: p.save_count ?? 0,
});
import { supabase } from '../../lib/supabase';
import { Card } from './FeedScreen';

export function FullscreenPlayer({ posts, index, onClose, onRemoved, onUser, onSound, onDuet }: {
  posts: Post[]; index: number; onClose: () => void; onRemoved?: (id: string) => void; onUser?: (id: string) => void; onSound?: (p: Post) => void; onDuet?: (p: Post) => void;
}) {
  const [h, setH] = useState(0);
  const [me, setMe] = useState<string>();
  const [list, setList] = useState(posts);
  useEffect(() => onPostDeleted((id) => { setList((l) => l.filter((x) => x.id !== id)); onRemoved?.(id); }), [onRemoved]);
  const [activeId, setActiveId] = useState<string | null>(posts[index]?.id ?? null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: Post }[] }) => { if (viewableItems[0]) setActiveId(viewableItems[0].item.id); }).current;
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id)); }, []);
  const partial = posts.some(isPartialPost);
  const [ready, setReady] = useState(!partial);
  useEffect(() => {
    let alive = true;
    const load = partial ? fetchPostsByIds(posts.map((p) => p.id)) : attachPostAuthors(posts);
    load.then((l) => { if (alive) { setList(l.length ? l : posts.map(withDefaults)); setReady(true); } })
      .catch(() => { if (alive) { setList(posts.map(withDefaults)); setReady(true); } });
    return () => { alive = false; };
  }, [posts, partial]);
  return (
    <AppModal onRequestClose={onClose}>
      <View style={s.root} onLayout={(e) => setH(e.nativeEvent.layout.height)} testID="fullscreen-player">
        {!ready && <ActivityIndicator color={colors.primary} style={StyleSheet.absoluteFill} />}
        {h > 0 && ready && (
          <FlatList data={list} keyExtractor={(p) => p.id} pagingEnabled showsVerticalScrollIndicator={false}
            initialScrollIndex={Math.min(index, list.length - 1)} getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })}
            windowSize={3} initialNumToRender={1}
            extraData={activeId} onViewableItemsChanged={onViewable} viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            renderItem={({ item }) => (
              <Card p={item} height={h} me={me} active={item.id === activeId}
                onUser={(id) => { onClose(); onUser?.(id); }} onSound={(x) => { onClose(); onSound?.(x); }}
                onDuet={onDuet ? (x) => { onClose(); onDuet(x); } : undefined} onRemoved={onRemoved} />
            )} />
        )}
        <Pressable accessibilityLabel="Close player" onPress={onClose} style={s.close}><Icon name="back" size={24} /></Pressable>
      </View>
    </AppModal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  close: { position: 'absolute', top: 14, left: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
});
