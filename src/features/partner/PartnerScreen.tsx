// "My partners": level & progress, income report, inviter card (or how to join), shared message, partner list.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PublicId } from '../../components/PublicId';
import { RichTextInput, RichTextView, richToPlain } from '../../components/RichText';
import { VipAvatar } from '../../components/Vip';
import { friendlyError } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { formatNum, fetchMyProfile, type Profile } from '../../lib/api';
import { levelInfo, partnerList, partnerOverview, partnerSetMessage, PARTNER_LEVELS, type PartnerOverview, type PartnerRow } from '../../lib/partner';
import { Btn, Field, O, Page, u } from '../profile/menuUi';
import { PartnerBadge } from './PartnerBadge';

const initials = (n: string) => (n.trim().slice(0, 2) || 'BT').toUpperCase();
const nameOf = (p: { display_name: string | null; username: string | null }) => p.display_name || p.username || 'user';

export function PartnerScreen({ onBack, onUser }: { onBack: () => void; onUser: (id: string) => void }) {
  const [ov, setOv] = useState<PartnerOverview | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [rows, setRows] = useState<PartnerRow[] | null>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    partnerOverview().then((o) => { setOv(o); setMsg(o.message_html); }).catch((e: Error) => setErr(friendlyError(e)));
    fetchMyProfile().then(setMe).catch(() => undefined);
  }, []);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { partnerList(q).then((r) => { if (alive) setRows(r); }).catch((e: Error) => { if (alive) { setRows([]); setErr(friendlyError(e)); } }); }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const save = async () => {
    setSaving(true);
    try { await partnerSetMessage(msg); notify('Message saved'); } catch (e) { notify('Error', friendlyError(e)); }
    setSaving(false);
  };

  const info = ov ? levelInfo(ov.level) : null;
  const pct = ov ? Math.min(1, ov.month_income / ov.goal) : 0;
  const cards: [string, number][] = ov ? [['Today', ov.income.today], ['This week', ov.income.week], ['This month', ov.income.month], ['Total', ov.income.total]] : [];

  return (
    <Page title="My partners" onBack={onBack}>
      {!ov && !err && <ActivityIndicator color={O} />}
      {!!err && !ov && <Text style={s.err}>{err}</Text>}
      {ov && info && (
        <>
          <View style={[s.hero, { borderColor: `${info.color}66` }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <PartnerBadge level={ov.level} scale={1.5} />
              <View style={{ flex: 1 }}>
                <Text style={s.big}>{ov.pct}% commission</Text>
                <Text style={u.hint}>{formatNum(ov.partner_count)} partner{ov.partner_count === 1 ? '' : 's'}</Text>
              </View>
              {me && <PublicId p={me} style={{ marginTop: 0 }} />}
            </View>
            <View style={s.bar}><View style={[s.fill, { width: `${Math.max(2, pct * 100)}%`, backgroundColor: info.color }]} /></View>
            <Text style={u.hint}>
              This month {formatNum(ov.month_income)} / {formatNum(ov.goal)} coins{ov.level < 5 ? ` to reach L${ov.level + 1}` : ' (top level)'}
            </Text>
            {ov.level > 1 && <Text style={u.hint}>Earn at least {formatNum(ov.keep_min)} coins this month to stay at L{ov.level}.</Text>}
            <View style={s.levels}>
              {PARTNER_LEVELS.map((l) => (
                <View key={l.level} style={{ alignItems: 'center', gap: 2, opacity: l.level === ov.level ? 1 : 0.55 }}>
                  <PartnerBadge level={l.level} scale={0.85} />
                  <Text style={s.lvPct}>{l.pct}%</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={[u.rowT, s.sec]}>Income from partners</Text>
          <View style={s.cards}>
            {cards.map(([l, v]) => (
              <View key={l} style={s.card}><Text style={s.cardV}>🪙 {formatNum(v)}</Text><Text style={u.hint}>{l}</Text></View>
            ))}
          </View>
          <Text style={[u.hint, { marginTop: 6 }]}>This is a report only. Every commission is paid straight into your Earnings balance.</Text>

          {ov.inviter ? (
            <>
              <Text style={[u.rowT, s.sec]}>You joined through</Text>
              <Pressable accessibilityLabel="Open inviter profile" onPress={() => onUser(ov.inviter!.id)} style={s.row}>
                <VipAvatar userId={ov.inviter.id} uri={ov.inviter.avatar_url} name={initials(nameOf(ov.inviter))} size={44} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={u.rowT} numberOfLines={1}>{nameOf(ov.inviter)}</Text>
                  {!!richToPlain(ov.inviter.message_html) && <RichTextView html={ov.inviter.message_html} style={s.inviterMsg} numberOfLines={3} />}
                </View>
                <PartnerBadge level={ov.inviter.level} />
              </Pressable>
              <Text style={[u.hint, { marginTop: 4 }]}>Shown for transparency only.</Text>
            </>
          ) : (
            <View style={s.notice}>
              <Text style={s.noticeH}>You haven't joined a partner yet</Text>
              <Text style={s.noticeT}>Open a video or a live from the person who invited you and tap <Text style={{ color: O, fontWeight: '900' }}>Partner</Text> (on a live: ⋯ → Partner). Their ID is filled in for you — just confirm. You can join only once, forever.</Text>
            </View>
          )}

          <Text style={[u.rowT, s.sec]}>Message for all partners</Text>
          <Text style={[u.hint, { marginBottom: 8 }]}>Everyone who joins you, and everyone who is about to join, sees this text.</Text>
          <RichTextInput key="partner-msg" label="Partner message" multiline value={ov.message_html} onChange={setMsg} placeholder="Write a welcome message for your partners" />
          <Btn label={saving ? 'Saving…' : 'Save message'} busy={saving} onPress={() => void save()} />

          <Text style={[u.rowT, s.sec]}>My partners</Text>
          <Field value={q} onChangeText={setQ} placeholder="Search by name or ID" autoCapitalize="none" />
          <View style={{ marginTop: 10, gap: 8 }}>
            {!rows ? <ActivityIndicator color={O} /> : rows.length === 0 ? (
              <Text style={[u.sub, { textAlign: 'center', paddingVertical: 14 }]}>{q ? 'No partner found.' : 'No partners yet. Share your ID and ask people to join you.'}</Text>
            ) : rows.map((r) => (
              <Pressable key={r.id} accessibilityLabel={`Open ${nameOf(r)}`} onPress={() => onUser(r.id)} style={s.row}>
                <VipAvatar userId={r.id} uri={r.avatar_url} name={initials(nameOf(r))} size={44} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={u.rowT} numberOfLines={1}>{nameOf(r)}</Text>
                  <PartnerBadge level={r.level} scale={0.85} />
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.coin}>🪙 {formatNum(r.coins)}</Text>
                  <Text style={u.hint}>earned from</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Page>
  );
}

const s = StyleSheet.create({
  err: { color: '#F87171', textAlign: 'center' },
  hero: { gap: 10, padding: 16, borderRadius: 20, borderWidth: 1.5, backgroundColor: '#0D0D0F' },
  big: { color: '#fff', fontSize: 20, fontWeight: '900' },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  levels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  lvPct: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '800' },
  sec: { marginTop: 22, marginBottom: 8 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '48%', gap: 4, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F' },
  cardV: { color: '#fff', fontSize: 17, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F' },
  inviterMsg: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  coin: { color: O, fontWeight: '900', fontSize: 14 },
  notice: { marginTop: 22, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,165,0,0.45)', backgroundColor: 'rgba(255,165,0,0.08)', gap: 6 },
  noticeH: { color: '#fff', fontWeight: '900', fontSize: 15 },
  noticeT: { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 19 },
});
