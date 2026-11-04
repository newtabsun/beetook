import { friendlyError } from '../../lib/errors';
import { VipAvatar, VipBadge, useIsVip } from '../../components/Vip';
import { notify } from '../../lib/notify';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchProfile, fetchUserPosts, formatNum, onPostDeleted, sendMessage, setFollow, subscribeTables, type Post, type Profile } from '../../lib/api';
import { T } from '../../lib/supabase';
import { recordProfileView } from '../../lib/boost';
import { colors, radius } from '../../theme';
import { GiftSheet } from '../social/Sheets';
import { VideoGrid, useGridPaging } from '../../components/VideoGrid';
import { FullscreenPlayer } from '../feed/FullscreenPlayer';
import { Icon } from '../../components/Icons';
import { RichTextView } from '../../components/RichText';
import { readStyle } from '../../lib/profileStyle';
import { PublicId } from '../../components/PublicId';
import { ActionButtons, ProfileBio } from './ProfileScreen';

type Full = Profile & { followed: boolean; isMe: boolean };

export function Stats({ p }: { p: Profile }) {
  const items = [['Followers', p.followers_count], ['Following', p.following_count], ['Likes', p.likes_count], ['Views', p.views_count]] as const;
  return (
    <View style={s.stats}>
      {items.map(([l, n]) => (
        <View key={l} style={s.stat}><Text style={s.statN}>{formatNum(n ?? 0)}</Text><Text style={s.muted}>{l}</Text></View>
      ))}
    </View>
  );
}

import { useIsFollowing } from '../../lib/follows';

export function UserProfileScreen({ userId, onBack, onMessage, onUser }: { userId: string; onBack: () => void; onMessage?: (peer: { id: string; username: string | null; display_name: string | null }) => void; onUser?: (id: string) => void }) {
  const [playAt, setPlayAt] = useState<number | null>(null);
  const [p, setP] = useState<Full | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  useEffect(() => onPostDeleted((id) => setPosts((l) => l.filter((x) => x.id !== id))), []);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [msgOpen, setMsgOpen] = useState(false);
  const [gift, setGift] = useState(false);
  const paging = useGridPaging(posts.length);

  // Opening a profile is what "profile views" boosts count (once per viewer, enforced by the server).
  useEffect(() => { void recordProfileView(userId); }, [userId]);
  useEffect(() => {
    Promise.all([fetchProfile(userId), fetchUserPosts(userId)])
      .then(([a, b]) => { setP(a); setPosts(b); }).catch((e: Error) => setErr(friendlyError(e)));
  }, [userId]);
  useEffect(() => subscribeTables(`prof-${userId}`, [{ table: T.profiles, filter: `id=eq.${userId}` }], (row) => {
    setP((x) => x && { ...x, followers_count: Number(row.followers_count ?? x.followers_count), following_count: Number(row.following_count ?? x.following_count),
      likes_count: Number(row.likes_count ?? x.likes_count), views_count: Number(row.views_count ?? x.views_count) });
  }), [userId]);

  const followedShared = useIsFollowing(userId);
  const toggle = async () => {
    if (!p) return;
    const on = !followedShared;
    const d = on ? 1 : -1;
    setP({ ...p, followed: on, followers_count: (p.followers_count ?? 0) + d });
    try { await setFollow(p.id, on); } catch (e) {
      setP((x) => x && { ...x, followed: !on, followers_count: (x.followers_count ?? 0) - d });
      notify('Error', friendlyError(e));
    }
  };
  const send = async () => {
    if (!msg.trim() || !p) return;
    try { await sendMessage(p.id, msg); setMsg(''); setMsgOpen(false); notify('Message sent'); }
    catch (e) { notify('Error', friendlyError(e)); }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={s.root} contentContainerStyle={{ padding: 16, gap: 12 }} onScroll={paging.onScroll} scrollEventThrottle={200}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={onBack}><Text style={s.back}>Back</Text></Pressable>
        {p ? <View style={{ flex: 1, alignItems: 'center', marginRight: 40 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><RichTextView html={readStyle(p).nameHtml || p.display_name || p.username} style={s.name} numberOfLines={1} /><VipTag id={p.id} /></View></View> : null}
      </View>
      {!p && !err && <ActivityIndicator color={colors.primary} />}
      {!!err && <Text style={{ color: '#E53935' }}>{err}</Text>}
      {p && (
        <View style={s.card}>
          <View style={{ alignSelf: 'center' }}><VipAvatar userId={p.id} uri={p.avatar_url} name={p.display_name || p.username} size={84} color={colors.primary} /></View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}><Text style={[s.name, { textAlign: 'center' }]}>@<RichTextView html={readStyle(p).usernameHtml} style={s.name} /></Text></View>
          <PublicId p={p} />
          <Stats p={p} />
          <ActionButtons buttons={readStyle(p).actionButtons} />
          <ProfileBio st={readStyle(p)} />
          {!p.isMe && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {p.is_private && !followedShared ? (
                <View testID="private-account" style={[s.outline, { flex: 1, opacity: 0.6, flexDirection: 'row', justifyContent: 'center', gap: 6 }]}>
                  <Icon name="lock" size={14} color={colors.foreground} /><Text style={s.text}>Private</Text>
                </View>
              ) : (
                <Pressable style={[followedShared ? s.outline : s.btn, { flex: 1 }]} onPress={() => void toggle()}>
                  <Text style={followedShared ? s.text : s.btnT}>{followedShared ? 'Following' : 'Follow'}</Text>
                </Pressable>
              )}
              <Pressable style={[s.outline, { flex: 1 }]} onPress={() => (p && onMessage ? onMessage({ id: p.id, username: p.username, display_name: p.display_name }) : setMsgOpen((v) => !v))}><Text style={s.text}>Message</Text></Pressable>
              <Pressable style={[s.outline, { flex: 1 }]} onPress={() => setGift(true)}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Icon name="giftRound" size={16} color="#FF2D55" fill="rgba(255,45,85,0.18)" /><Text style={s.text}>Gift</Text></View></Pressable>
            </View>
          )}
          {gift && <GiftSheet recipient={p.id} recipientName={p.display_name || p.username || 'user'} onClose={() => setGift(false)} />}
          {msgOpen && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={s.input} value={msg} onChangeText={setMsg} placeholder="Message…" placeholderTextColor="#777" />
              <Pressable style={s.btn} onPress={() => void send()}><Text style={s.btnT}>Send</Text></Pressable>
            </View>
          )}
        </View>
      )}
      <View>
        <VideoGrid posts={posts} onOpen={setPlayAt} showPinned limit={paging.limit} />
        {p && !posts.length && <Text style={s.muted}>{p.is_private && !followedShared && !p.isMe ? 'This account is private' : 'No posts'}</Text>}
      </View>
      {playAt !== null && <FullscreenPlayer posts={posts} index={playAt} onClose={() => setPlayAt(null)} onUser={onUser} onRemoved={(id) => setPosts((a) => a.filter((x) => x.id !== id))} />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  back: { color: colors.primary, fontWeight: '800' },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 84, height: 84, borderRadius: 42, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  avT: { color: '#000', fontSize: 32, fontWeight: '900' },
  name: { color: colors.foreground, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  muted: { color: colors.mutedForeground, fontSize: 12 },
  text: { color: colors.foreground, fontWeight: '600', textAlign: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statN: { color: colors.foreground, fontWeight: '900', fontSize: 17 },
  btn: { backgroundColor: colors.primary, borderRadius: 99, padding: 12, alignItems: 'center' },
  btnT: { color: '#000', fontWeight: '900' },
  outline: { borderWidth: 1, borderColor: colors.border, borderRadius: 99, padding: 12, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#1c1c1c', color: '#fff', borderRadius: 12, padding: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  thumb: { width: '32%', aspectRatio: 9 / 16, backgroundColor: '#111' },
});

function VipTag({ id }: { id: string }) {
  return useIsVip(id) ? <VipBadge /> : null;
}
