// Global search opened from the feed header: people (by name / @username) and
// videos (by caption, sound name or sound title). Tapping a person opens the main profile.
import { friendlyError } from '../../lib/errors';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppModal } from '../../components/AppModal';
import { Icon } from '../../components/Icons';
import { VipAvatar } from '../../components/Vip';
import { richToPlain } from '../../components/RichText';
import { colors } from '../../theme';
import { formatNum, searchAll, type Post, type SearchResults } from '../../lib/api';

export function SearchScreen({ onClose, onUser, onPlay }: {
  onClose: () => void; onUser: (id: string) => void; onPlay: (p: Post) => void;
}) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [res, setRes] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Debounce so typing does not fire a query per character.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!term) { setRes(null); setErr(''); return; }
    let alive = true;
    setBusy(true);
    searchAll(term)
      .then((r) => { if (alive) { setRes(r); setErr(''); } })
      .catch((e) => { if (alive) setErr(friendlyError(e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [term]);

  const empty = !!res && !res.profiles.length && !res.posts.length;
  return (
    <AppModal animationType="fade" onRequestClose={onClose}>
      <View style={ss.wrap}>
        <View style={ss.head}>
          <Pressable accessibilityLabel="Back" onPress={onClose} hitSlop={8}><Icon name="back" size={22} /></Pressable>
          <View style={ss.box}>
            <Icon name="search" size={16} color="rgba(255,255,255,0.4)" />
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Search people, videos, sounds" placeholderTextColor="rgba(255,255,255,0.35)" style={ss.input} returnKeyType="search" accessibilityLabel="Search people, videos, sounds" />
            {!!q && <Pressable accessibilityLabel="Clear search" onPress={() => setQ('')}><Icon name="x" size={16} color="rgba(255,255,255,0.5)" /></Pressable>}
          </View>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {busy && !res && <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />}
          {!!err && <Text style={ss.err}>{err}</Text>}
          {res && empty && !busy && <Text style={ss.hint}>No results for "{term}"</Text>}
          {!!res?.profiles.length && (
            <View style={{ gap: 8 }}>
              <Text style={ss.sec}>People</Text>
              {res.profiles.map((p) => (
                <Pressable key={p.id} accessibilityLabel={`Open profile ${p.display_name || p.username || ''}`} style={ss.row} onPress={() => { onClose(); onUser(p.id); }}>
                  <VipAvatar userId={p.id} uri={p.avatar_url} name={p.display_name || p.username || 'user'} size={44} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={ss.name}>{p.display_name || p.username || 'user'}</Text>
                    <Text numberOfLines={1} style={ss.sub}>{p.username ? `@${p.username}` : ''}{p.followers_count ? ` · ${formatNum(p.followers_count)} followers` : ''}</Text>
                  </View>
                  <Icon name="arrow" size={14} />
                </Pressable>
              ))}
            </View>
          )}
          {!!res?.posts.length && (
            <View style={{ gap: 8 }}>
              <Text style={ss.sec}>Videos & sounds</Text>
              <View style={ss.grid}>
                {res.posts.map((p) => (
                  <Pressable key={p.id} accessibilityLabel="Open video" style={ss.cell} onPress={() => { onClose(); onPlay(p); }}>
                    {p.thumbnail_url
                      ? <Image source={{ uri: p.thumbnail_url }} style={ss.thumb} resizeMode="cover" />
                      : <View style={[ss.thumb, ss.thumbEmpty]}><Icon name="video" size={22} color="rgba(255,255,255,0.4)" /></View>}
                    <Text numberOfLines={1} style={ss.cellT}>{richToPlain(p.caption) || p.sound_name || 'Video'}</Text>
                    <Text numberOfLines={1} style={ss.cellS}>{formatNum(p.like_count)} likes{p.author?.username ? ` · @${p.author.username}` : ''}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </AppModal>
  );
}

const ss = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  box: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: 99, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  input: { flex: 1, color: '#fff', fontSize: 15 },
  sec: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  name: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sub: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31%', gap: 4 },
  thumb: { width: '100%', aspectRatio: 0.75, borderRadius: 10, backgroundColor: '#111' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cellT: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cellS: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
  hint: { color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 40 },
  err: { color: '#FF6B6B', textAlign: 'center', marginTop: 20 },
});
