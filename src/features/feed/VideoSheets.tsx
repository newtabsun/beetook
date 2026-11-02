import { handleOf } from '../../lib/username';
import { friendlyError } from '../../lib/errors';
// Port of web VideoCard share sheet + owner-only "Video options" sheet, wired to Supabase.
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { deletePost, fetchFriends, recordShare, sendMessage, setPinned, updatePostFields, type MiniProfile, type Post } from '../../lib/api';
import { notify } from '../../lib/notify';
import { downloadPost } from '../../lib/download';
import { Icon, type IconName } from '../../components/Icons';
import { Sheet } from '../social/Sheets';

const O = '#FFA500';
export const shareUrlOf = (p: Pick<Post, 'id'>) => `https://beetook.app/v/${p.id}`;

const SOCIAL: { name: string; bg: string; icon: IconName; href: (u: string) => string }[] = [
  { name: 'Telegram', bg: '#229ED9', icon: 'send', href: (u) => `https://t.me/share/url?url=${encodeURIComponent(u)}` },
  { name: 'WhatsApp', bg: '#25D366', icon: 'comment', href: (u) => `https://wa.me/?text=${encodeURIComponent(u)}` },
  { name: 'Facebook', bg: '#1877F2', icon: 'globe', href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  { name: 'X', bg: '#000000', icon: 'x', href: (u) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}` },
  { name: 'Instagram', bg: '#DD2A7B', icon: 'camera', href: () => 'https://www.instagram.com/' },
  { name: 'Groups', bg: '#229ED9', icon: 'users', href: (u) => `https://t.me/share/url?url=${encodeURIComponent(u)}` },
];
const COLORS = ['#FFA500', '#FF6B6B', '#4ECDC4', '#A78BFA', '#F59E0B', '#60A5FA', '#F472B6', '#34D399'];

export function ShareSheet({ post, onClose, onShared, onBoost, onDuet, onReport }: {
  post: Post; onClose: () => void; onShared: (n: number) => void; onBoost?: () => void; onDuet?: () => void; onReport?: () => void;
}) {
  const url = shareUrlOf(post);
  const [friends, setFriends] = useState<MiniProfile[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => { fetchFriends().then(setFriends).catch(() => setFriends([])); }, []);
  const count = async (n = 1) => { onShared(n); await recordShare(post.id).catch(() => undefined); };

  const copy = async () => { await Clipboard.setStringAsync(url); await count(); notify('Link copied to clipboard'); };
  const download = () => { onClose(); void downloadPost(post); };
  const duet = () => {
    if (post.allow_duet === false) return notify('The creator turned off Duet for this video');
    onClose(); onDuet?.();
  };
  const send = async () => {
    setSending(true);
    try {
      await Promise.all(picked.map((id) => sendMessage(id, `🎬 ${post.caption ? `${post.caption.slice(0, 80)}\n` : ''}${url}`)));
      await count(picked.length);
      notify(`Video sent to ${picked.length} friend${picked.length > 1 ? 's' : ''}`);
      setPicked([]); onClose();
    } catch (e) { notify('Error', friendlyError(e)); }
    setSending(false);
  };
  const actions: { label: string; icon: IconName; bg: string; fg: string; on: () => void }[] = [
    { label: 'Copy link', icon: 'link', bg: '#1D9BF0', fg: '#fff', on: () => void copy() },
    ...(onBoost ? [{ label: 'Boost video', icon: 'rocket' as IconName, bg: O, fg: '#000', on: () => { onClose(); onBoost(); } }] : []),
    { label: 'Download', icon: 'download', bg: '#22C55E', fg: '#fff', on: () => void download() },
    ...(onDuet && post.kind === 'video' ? [{ label: 'Duet', icon: 'columns' as IconName, bg: '#A855F7', fg: '#fff', on: duet }] : []),
    ...(onReport ? [{ label: 'Report', icon: 'flag' as IconName, bg: '#E53935', fg: '#fff', on: () => { onClose(); onReport(); } }] : []),
  ];

  return (
    <Sheet title="Share this video" onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
        <View style={s.actRow}>
          {actions.map((a) => (
            <Pressable key={a.label} accessibilityLabel={a.label} onPress={a.on} style={s.act}>
              <View style={[s.circle, { backgroundColor: a.bg }]}><Icon name={a.icon} size={20} color={a.fg} /></View>
              <Text style={s.actT} numberOfLines={1}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.head}>
          <Text style={s.label}>Send to friends · tap to pick several</Text>
          {picked.length > 0 && (
            <Pressable accessibilityLabel="Send to friends" disabled={sending} onPress={() => void send()} style={s.sendBtn}>
              {sending ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.sendT}>Send ({picked.length})</Text>}
            </Pressable>
          )}
        </View>
        {friends === null ? <ActivityIndicator color={O} /> : friends.length === 0 ? (
          <Text style={s.muted}>Follow people to send them videos in Inbox.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {friends.map((f, i) => {
              const on = picked.includes(f.id);
              const h = f.username || f.display_name || 'user';
              return (
                <Pressable key={f.id} accessibilityLabel={`Pick @${h}`} accessibilityState={{ selected: on }} style={s.friend}
                  onPress={() => setPicked((p) => (on ? p.filter((x) => x !== f.id) : [...p, f.id]))}>
                  <View style={[s.fAv, { backgroundColor: COLORS[i % COLORS.length] }, on && s.fOn]}>
                    <Text style={s.fAvT}>{h[0]?.toUpperCase()}</Text>
                    {on && <View style={s.tick}><Icon name="check" size={10} color="#000" strokeWidth={3} /></View>}
                  </View>
                  <Text style={s.fT} numberOfLines={1}>{handleOf(h)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <Text style={[s.label, { marginTop: 18, marginBottom: 10 }]}>Share to other apps</Text>
        <View style={s.grid}>
          {SOCIAL.map((x) => (
            <Pressable key={x.name} accessibilityLabel={`Share to ${x.name}`} style={s.soc}
              onPress={() => { void count(); Linking.openURL(x.href(url)).catch(() => notify(`Could not open ${x.name}`)); }}>
              <View style={[s.sCircle, { backgroundColor: x.bg }]}><Icon name={x.icon} size={18} color="#fff" /></View>
              <Text style={s.socT}>{x.name}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const PRIVACY: [NonNullable<Post['privacy']>, string][] = [['everyone', 'Everyone'], ['friends', 'Friends'], ['only_me', 'Only me']];

export function OwnerSheet({ post, onClose, onChange, onDeleted }: {
  post: Post; onClose: () => void; onChange: (p: Post) => void; onDeleted: () => void;
}) {
  const [cur, setCur] = useState(post);
  const [caption, setCaption] = useState(post.caption);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const apply = async (patch: Partial<Post>, msg: string, run: () => Promise<void>) => {
    setBusy(true);
    try { await run(); const next = { ...cur, ...patch }; setCur(next); onChange(next); notify(msg); }
    catch (e) { notify('Error', friendlyError(e)); }
    setBusy(false);
  };
  const toggle = (k: 'allow_comments' | 'allow_download' | 'allow_duet', label: string) => {
    const v = !(cur[k] ?? true);
    void apply({ [k]: v }, `${label} ${v ? 'turned on' : 'turned off'}`, () => updatePostFields(cur.id, { [k]: v }));
  };
  const rows: ['allow_comments' | 'allow_download' | 'allow_duet', string][] = [['allow_comments', 'Allow comments'], ['allow_download', 'Allow downloads'], ['allow_duet', 'Allow Duet/Share']];

  return (
    <Sheet title="Video options" onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
        <View>
          <Text style={s.label}>Caption</Text>
          <TextInput value={caption} onChangeText={setCaption} multiline maxLength={2200} style={s.input} placeholder="Write a caption…" placeholderTextColor="#777" />
          {caption !== cur.caption && (
            <Pressable style={[s.sendBtn, { alignSelf: 'flex-end', marginTop: 8 }]} disabled={busy}
              onPress={() => void apply({ caption: caption.trim(), caption_html: caption.trim() }, 'Caption updated', () => updatePostFields(cur.id, { caption: caption.trim(), caption_html: caption.trim() }))}>
              <Text style={s.sendT}>Save caption</Text>
            </Pressable>
          )}
        </View>
        <View>
          <Text style={[s.label, { marginBottom: 8 }]}>Who can watch this video</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PRIVACY.map(([k, l]) => {
              const on = (cur.privacy ?? 'everyone') === k;
              return (
                <Pressable key={k} accessibilityLabel={`Privacy ${l}`} disabled={busy} style={[s.pChip, on && s.pOn]}
                  onPress={() => void apply({ privacy: k }, `Privacy set to ${l}`, () => updatePostFields(cur.id, { privacy: k }))}>
                  <Text style={on ? s.pTOn : s.pT}>{l}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {rows.map(([k, l]) => {
          const on = cur[k] ?? true;
          return (
            <Pressable key={k} accessibilityRole="switch" accessibilityLabel={l} accessibilityState={{ checked: on }} disabled={busy} style={s.row} onPress={() => toggle(k, l.replace('Allow ', '').replace(/^./, (c) => c.toUpperCase()))}>
              <Text style={s.rowT}>{l}</Text>
              <View style={[s.sw, on && { backgroundColor: O }]}><View style={[s.knob, on && { transform: [{ translateX: 20 }] }]} /></View>
            </Pressable>
          );
        })}
        {(() => {
          const on = cur.partner_enabled !== false;
          return (
            <Pressable accessibilityRole="switch" accessibilityLabel="Partner" accessibilityState={{ checked: on }} disabled={busy} style={s.row}
              onPress={() => void apply({ partner_enabled: !on }, `Partner ${!on ? 'turned on' : 'turned off'}`, () => updatePostFields(cur.id, { partner_enabled: !on }))}>
              <Text style={s.rowT}>Partner</Text>
              <View style={[s.sw, on && { backgroundColor: O }]}><View style={[s.knob, on && { transform: [{ translateX: 20 }] }]} /></View>
            </Pressable>
          );
        })()}
        <Pressable style={s.row} disabled={busy} accessibilityLabel="Pin to profile"
          onPress={() => void apply({ pinned: !cur.pinned }, cur.pinned ? 'Unpinned from your profile' : 'Pinned to your profile', () => setPinned(cur.id, !cur.pinned))}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Icon name="pin" size={16} color={O} /><Text style={s.rowT}>{cur.pinned ? 'Unpin from profile' : 'Pin to profile'}</Text></View>
        </Pressable>
        {confirm ? (
          <View style={s.danger}>
            <Text style={[s.rowT, { marginBottom: 12 }]}>Delete this video? This can’t be undone.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={s.cancel} onPress={() => setConfirm(false)}><Text style={s.rowT}>Cancel</Text></Pressable>
              <Pressable style={s.del} disabled={busy} accessibilityLabel="Confirm delete"
                onPress={async () => { setBusy(true); try { await deletePost(cur.id); notify('Video deleted'); onClose(); onDeleted(); } catch (e) { notify('Error', friendlyError(e)); } setBusy(false); }}>
                <Text style={[s.rowT, { fontWeight: '900' }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={s.row} accessibilityLabel="Delete video" onPress={() => setConfirm(true)}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Icon name="trash" size={16} color="#FF3B30" /><Text style={[s.rowT, { color: '#FF3B30' }]}>Delete video</Text></View>
          </Pressable>
        )}
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  actRow: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 8 },
  act: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 10 },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actT: { color: '#fff', fontSize: 11, fontWeight: '700' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 10 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700' },
  muted: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  sendBtn: { backgroundColor: O, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5, minWidth: 70, alignItems: 'center' },
  sendT: { color: '#000', fontSize: 11, fontWeight: '900' },
  friend: { width: 64, alignItems: 'center', gap: 6 },
  fAv: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  fOn: { borderWidth: 2, borderColor: O },
  fAvT: { color: '#000', fontWeight: '900', fontSize: 16 },
  tick: { position: 'absolute', right: -2, bottom: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  fT: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '600', width: '100%', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  soc: { width: '22.5%', alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', paddingVertical: 12 },
  sCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  socT: { color: '#fff', fontSize: 10, fontWeight: '700' },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', borderRadius: 12, padding: 12, marginTop: 8, minHeight: 60, textAlignVertical: 'top' },
  pChip: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)', paddingVertical: 10, alignItems: 'center' },
  pOn: { backgroundColor: O, borderColor: O },
  pT: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pTOn: { color: '#000', fontSize: 12, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 16, paddingVertical: 12 },
  rowT: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sw: { width: 44, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', padding: 2 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  danger: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)', backgroundColor: 'rgba(255,59,48,0.1)', padding: 16 },
  cancel: { flex: 1, height: 40, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  del: { flex: 1, height: 40, borderRadius: 20, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' },
});
