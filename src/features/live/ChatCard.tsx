// One chat card: avatar + name chip + rich text. Viewer comments and in-game action notices use the
// exact same card, so a notice never looks like a different kind of UI.
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VipAvatar, VipTag } from '../../components/Vip';
import { RichTextView } from '../../components/RichText';
import type { MiniProfile } from '../../lib/api';

/** Notices are plain text, so they are escaped into the same rich-text renderer as comments. */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const displayName = (p?: MiniProfile | null) => p?.display_name || p?.username || 'User';

export const ChatCard = memo(function ChatCard({ userId, p, html, mine }: {
  userId?: string; p?: MiniProfile; html: string; mine: boolean;
}) {
  const id = userId ?? p?.id;
  return (
    <View style={s.row}>
      <VipAvatar userId={id} uri={p?.avatar_url} name={displayName(p)} size={24} />
      <View style={[s.name, mine && s.nameMine]}><Text style={[s.nameT, mine && { color: '#000' }]}>{mine ? 'you' : p?.username ?? 'user'}</Text></View>
      <VipTag id={id} />
      <View style={{ flex: 1 }}><RichTextView html={html} style={s.text} /></View>
    </View>
  );
});

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 4 },
  name: { borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 8, paddingVertical: 2 },
  nameMine: { backgroundColor: '#FFA500' },
  nameT: { color: '#fff', fontSize: 10, fontWeight: '800' },
  text: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
});
