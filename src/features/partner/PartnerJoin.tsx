// Full-screen "Join a partner" page. The inviter's ID is filled in automatically; the user only confirms.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal } from '../../components/AppModal';
import { Icon } from '../../components/Icons';
import { RichTextView, richToPlain } from '../../components/RichText';
import { VipAvatar } from '../../components/Vip';
import { friendlyError } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { partnerJoin, partnerPreview, type PartnerPreview } from '../../lib/partner';
import { PartnerBadge } from './PartnerBadge';

const O = '#FFA500';
const initials = (n: string) => (n.trim().slice(0, 2) || 'BT').toUpperCase();

export function PartnerJoinScreen({ inviterId, postId, onClose, onJoined }: { inviterId: string; postId?: string; onClose: () => void; onJoined?: () => void }) {
  const [pv, setPv] = useState<PartnerPreview | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    partnerPreview(inviterId, postId).then((x) => { if (alive) setPv(x); }).catch((e: Error) => { if (alive) setErr(friendlyError(e)); });
    return () => { alive = false; };
  }, [inviterId, postId]);

  const inv = pv?.inviter;
  const name = inv ? inv.display_name || inv.username || 'user' : '';
  const blocked = !!pv && (pv.has_partner || pv.is_self || !pv.ready || pv.post_off);
  const confirm = async () => {
    if (busy || blocked) return;
    setBusy(true);
    try { await partnerJoin(inviterId, postId); notify('You are now a partner 🎉'); onJoined?.(); onClose(); }
    catch (e) { setErr(friendlyError(e)); setPv((x) => (x && /already/i.test((e as Error).message) ? { ...x, has_partner: true } : x)); }
    setBusy(false);
  };

  return (
    <AppModal onRequestClose={onClose}>
      <View style={s.page}>
        <View style={s.head}>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={s.back}><Icon name="x" size={18} color="#fff" /></Pressable>
          <Text style={s.h}>Partner</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <View style={s.hero}>
            <View style={s.heroIc}><Icon name="users" size={30} color="#000" /></View>
            <Text style={s.welcome}>Welcome! 🎉</Text>
            <Text style={s.lead}>Become a partner of the person who invited you.</Text>
          </View>

          {!pv && !err && <ActivityIndicator color={O} style={{ marginTop: 24 }} />}
          {!!err && !pv && <Text style={s.err}>{err}</Text>}

          {inv && (
            <View style={s.card}>
              <VipAvatar userId={inv.id} uri={inv.avatar_url} name={initials(name)} size={72} />
              <Text style={s.name} numberOfLines={1}>{name}</Text>
              {!!inv.username && <Text style={s.handle}>@{inv.username}</Text>}
              <PartnerBadge level={inv.level} />
              <Text style={s.idT}>Inviter ID: <Text style={{ color: O, fontWeight: '900' }}>{inv.public_id ?? '—'}</Text> (filled in for you)</Text>
              {!!richToPlain(inv.message_html) && (
                <View style={s.msg}><RichTextView html={inv.message_html} style={s.msgT} /></View>
              )}
            </View>
          )}

          <View style={s.info}>
            {[
              'Joining is free and does not change anything you pay or earn.',
              'Your inviter earns a small commission from the gifts you send. It comes from the platform side, never from you or the gift receiver.',
              'You can join only one partner, one time, forever. It cannot be changed or undone.',
            ].map((t) => (
              <View key={t} style={s.li}><Icon name="check" size={14} color={O} /><Text style={s.liT}>{t}</Text></View>
            ))}
          </View>

          {pv?.is_self && <Text style={s.warn}>This is your own ID. You can't join your own partners.</Text>}
          {pv && !pv.ready && !pv.is_self && !pv.has_partner && <Text style={s.warn}>This user has not joined a partner yet, so nobody can join them for now.</Text>}
          {pv?.post_off && pv.ready && !pv.is_self && !pv.has_partner && <Text style={s.warn}>The owner turned Partner off for this video.</Text>}
          {pv?.has_partner && !pv.is_self && <Text style={s.warn}>You have already joined a partner. You can join only once, forever.</Text>}
          {!!err && !!pv && !blocked && <Text style={s.err}>{err}</Text>}

          <Pressable accessibilityLabel="Confirm" accessibilityState={{ disabled: blocked || !pv || busy }} disabled={blocked || !pv || busy} onPress={() => void confirm()}
            style={[s.confirm, (blocked || !pv || busy) && { opacity: 0.35 }]}>
            {busy ? <ActivityIndicator color="#000" /> : <Text style={s.confirmT}>Confirm</Text>}
          </Pressable>
          <Pressable accessibilityLabel="Not now" onPress={onClose} style={s.cancel}><Text style={s.cancelT}>Not now</Text></Pressable>
        </ScrollView>
      </View>
    </AppModal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 0 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  h: { color: '#fff', fontSize: 18, fontWeight: '800' },
  hero: { alignItems: 'center', marginTop: 8, gap: 6 },
  heroIc: { width: 64, height: 64, borderRadius: 20, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  welcome: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 6 },
  lead: { color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center' },
  card: { marginTop: 20, alignItems: 'center', gap: 6, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,165,0,0.35)', backgroundColor: '#14100A' },
  name: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 4 },
  handle: { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  idT: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  msg: { alignSelf: 'stretch', marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  msgT: { color: '#fff', fontSize: 14, lineHeight: 20 },
  info: { marginTop: 18, gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F' },
  li: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  liT: { flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 12.5, lineHeight: 18 },
  warn: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,59,48,0.12)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)', color: '#FF6B61', fontWeight: '700', fontSize: 13, textAlign: 'center', overflow: 'hidden' },
  err: { marginTop: 12, color: '#F87171', textAlign: 'center', fontSize: 13 },
  confirm: { marginTop: 18, height: 52, borderRadius: 14, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  confirmT: { color: '#000', fontWeight: '900', fontSize: 16 },
  cancel: { marginTop: 8, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelT: { color: 'rgba(255,255,255,0.6)', fontWeight: '700' },
});
