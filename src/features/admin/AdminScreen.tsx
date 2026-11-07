// Admin panel: 15 real tools, each backed by guarded Supabase RPCs / admin-only RLS tables.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { Btn, Chip, Field, Group, O, Page, Row, reportFail, u } from '../profile/menuUi';
import * as A from '../../lib/admin';
import { loadSocials, saveSocials } from '../../lib/menu';
import * as Clipboard from 'expo-clipboard';
import { notify } from '../../lib/notify';

type Sec = null | 'redeem' | 'live' | 'post' | 'coins' | 'notify' | 'auth' | 'banner' | 'boost' | 'user' | 'social' | 'reg' | 'bgs' | 'notice' | 'groups' | 'support';
const DUR: [string, number | null][] = [['24h', 1], ['3 days', 3], ['7 days', 7], ['1 month', 30], ['Unlimited', null]];
const fmt = (d?: string) => (d ? new Date(d).toLocaleString() : '');
const msg = (e: unknown) => { reportFail(); Alert.alert('Admin', e instanceof Error ? e.message : String(e)); };

/** Finds a user by phone / id / email / username and reports the pick. */
function UserPick({ sel, onSel, optional }: { sel: any; onSel: (x: any | null) => void; optional?: boolean }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState<any[]>([]);
  const go = async () => { try { setRes(await A.searchUsers(q)); } catch (e) { msg(e); } };
  if (sel) return (
    <View style={[u.card, { marginTop: 12 }]}>
      <Text style={u.h3}>{sel.display_name || sel.username} · @{sel.username}</Text>
      <Text style={u.hint}>ID {sel.public_id ?? sel.id} · {sel.phone ?? ''} {sel.email ?? ''}</Text>
      <Btn label="Change user" onPress={() => onSel(null)} />
    </View>
  );
  return (
    <View>
      <Field label={optional ? 'User (empty = all users)' : 'User'} placeholder="Phone, ID, email or username" value={q} onChangeText={setQ} onSubmitEditing={go} autoCapitalize="none" />
      <Btn label="Search" onPress={go} />
      {res.map((r) => (
        <Pressable key={r.id} style={[u.card, { marginTop: 8 }]} onPress={() => { onSel(r); setRes([]); }}>
          <Text style={u.h3}>{r.display_name || r.username} · @{r.username}</Text>
          <Text style={u.hint}>ID {r.public_id ?? r.id} · {r.phone ?? ''} {r.email ?? ''}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Redeems() {
  const [st, setSt] = useState('pending'); const [rows, setRows] = useState<any[]>([]); const [note, setNote] = useState('');
  const load = useCallback(() => A.listRedeems(st).then(setRows).catch(msg), [st]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, okFlag: boolean) => {
    if (!okFlag && !note.trim()) throw new Error('Write a rejection reason first');
    await A.setRedeem(id, okFlag, note.trim()); setNote(''); await load();
  };
  const copy = (t: string) => void Clipboard.setStringAsync(t).then(() => notify('Copied'));
  return (<View>
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>{['pending', 'approved', 'rejected', 'all'].map((x) => <Chip key={x} label={x} on={st === x} onPress={() => setSt(x)} />)}</View>
    {st === 'pending' && <Field label="Reason (required to reject)" value={note} onChangeText={setNote} />}
    {rows.map((r) => (
      <View key={r.id} style={[u.card, { marginTop: 10 }]}>
        <Text style={u.h3}>{r.display_name || r.username} · @{r.username}</Text>
        <Text style={u.hint}>ID {r.public_id ?? ''} · {r.phone ?? ''} · {r.email ?? ''}</Text>
        <Text style={u.rowT}>{r.coins} coins → {r.net_amount} {r.currency} ({r.method}) · {r.status}</Text>
        {Object.entries(r.fields ?? {}).map(([k, v]) => (
          <Pressable key={k} accessibilityLabel={`Copy ${k}`} onPress={() => copy(String(v))} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={[u.hint, { flex: 1 }]} selectable>{k}: {String(v)}</Text><Text style={{ color: O, fontWeight: '800' }}>Copy</Text>
          </Pressable>))}
        <Pressable onPress={() => copy(String(r.net_amount))}><Text style={{ color: O, fontWeight: '800', marginTop: 4 }}>Copy amount ({r.net_amount})</Text></Pressable>
        <Text style={u.hint}>{fmt(r.created_at)} {r.note ? `· ${r.note}` : ''}</Text>
        {(r.status === 'pending' || r.status === 'processing') && (<View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Btn label="Approve" onPress={() => act(r.id, true)} /></View>
          <View style={{ flex: 1 }}><Btn label="Reject" danger onPress={() => act(r.id, false)} /></View></View>)}
      </View>))}
    {!rows.length && <Text style={[u.hint, { marginTop: 12 }]}>No requests.</Text>}
  </View>);
}

function Access({ kind }: { kind: 'live' | 'post' | 'auth' }) {
  const [user, setUser] = useState<any>(null); const [reason, setReason] = useState(''); const [days, setDays] = useState<number | null>(null);
  const [list, setList] = useState<any[]>([]); const [lives, setLives] = useState<any[]>([]); const [why, setWhy] = useState<Record<string, string>>({}); const [confirmRoom, setConfirmRoom] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList((await A.listBlocks()).filter((b) => b.kind === kind)); if (kind === 'live') setLives(await A.adminLiveList()); } catch (e) { msg(e); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);
  const block = async () => { await A.blockAccess(kind, user?.id ?? null, reason, days); setReason(''); await load(); };
  const lift = async (uid: string | null) => { await A.unblockAccess(kind, uid); await load(); };
  return (<View>
    <UserPick sel={user} onSel={setUser} optional />
    <Field label="Reason / note (shown to the user)" value={reason} onChangeText={setReason} />
    {kind === 'live' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{DUR.map(([l, d]) => <Chip key={l} label={l} on={days === d} onPress={() => setDays(d)} />)}</View>}
    <Btn label={user ? 'Block this user' : 'Block ALL users'} danger onPress={block} />
    {kind === 'live' && <Text style={u.hint}>Blocking live access also ends the user's current live at once.</Text>}
    <Text style={[u.h3, { marginTop: 18 }]}>Active blocks</Text>
    {list.map((b) => (<View key={b.id} style={[u.card, { marginTop: 8 }]}>
      <Text style={u.rowT}>{b.user_id ? `@${b.username ?? b.user_id}` : 'ALL users'}</Text>
      <Text style={u.hint}>{b.reason} · until {b.expires_at ? fmt(b.expires_at) : 'unlimited'}</Text>
      <Btn label="Allow again" onPress={() => lift(b.user_id)} /></View>))}
    {!list.length && <Text style={u.hint}>None.</Text>}
    {kind === 'live' && (<>
      <Text style={[u.h3, { marginTop: 18 }]}>Currently live ({lives.length})</Text>
      <Btn label="Refresh" onPress={load} />
      {lives.map((r) => (<View key={r.id} style={[u.card, { marginTop: 8 }]}>
        <Text style={u.rowT}>{r.display_name || r.username} · @{r.username}</Text>
        <Text style={u.hint}>{r.title} · {r.viewers} watching · since {fmt(r.created_at)}{r.pin_coins ? ` · 📌 ${r.pin_coins}` : ''}</Text>
        <Field label="Reason (shown on the host's screen)" value={why[r.id] ?? ''} onChangeText={(v) => setWhy((o) => ({ ...o, [r.id]: v }))} />
        {confirmRoom === r.id ? (<>
          <Btn label="Yes, remove from live" danger onPress={async () => { await A.adminLiveRemove(r.id, why[r.id] ?? '', false); setConfirmRoom(null); await load(); }} />
          <Btn label="Remove and block live access" danger onPress={async () => { await A.adminLiveRemove(r.id, why[r.id] ?? '', true); setConfirmRoom(null); await load(); }} />
          <Btn label="Cancel" onPress={() => setConfirmRoom(null)} />
        </>) : <Btn label="Remove from live" danger onPress={async () => { if (!(why[r.id] ?? '').trim()) throw new Error('Write a reason first'); setConfirmRoom(r.id); }} />}
      </View>))}
      {!lives.length && <Text style={u.hint}>Nobody is live right now.</Text>}
    </>)}
  </View>);
}

function Support() {
  const [threads, setThreads] = useState<any[]>([]); const [open, setOpen] = useState<any>(null); const [msgs, setMsgs] = useState<any[]>([]); const [text, setText] = useState('');
  const loadT = useCallback(() => A.supportThreads().then(setThreads).catch(msg), []);
  useEffect(() => { void loadT(); }, [loadT]);
  const loadM = useCallback((id: string) => A.supportThread(id).then(setMsgs).catch(msg), []);
  if (open) return (<View>
    <Btn label="← Back to conversations" onPress={() => { setOpen(null); void loadT(); }} />
    <Text style={[u.h3, { marginTop: 12 }]}>{open.display_name || open.username} · @{open.username}</Text>
    {msgs.map((m) => (<View key={m.id} style={[u.card, { marginTop: 8, alignSelf: m.from_support ? 'flex-end' : 'flex-start', maxWidth: '88%' }]}>
      <Text style={u.hint}>{m.from_support ? 'Support' : 'User'} · {fmt(m.created_at)}</Text><Text style={u.rowT}>{m.body}</Text></View>))}
    <Field label="Your reply" value={text} onChangeText={setText} multiline style={{ height: 90 }} />
    <Btn label="Send reply" onPress={async () => { await A.supportReply(open.user_id, text); setText(''); await loadM(open.user_id); }} />
  </View>);
  return (<View>
    <Btn label="Refresh" onPress={loadT} />
    {threads.map((t) => (<Pressable key={t.user_id} style={[u.card, { marginTop: 8 }]} onPress={() => { setOpen(t); void loadM(t.user_id); }}>
      <Text style={u.h3}>{t.display_name || t.username} · @{t.username}{t.waiting ? '  ● waiting for reply' : ''}</Text>
      <Text style={u.hint} numberOfLines={2}>{t.last_body} · {fmt(t.last_at)}</Text></Pressable>))}
    {!threads.length && <Text style={[u.hint, { marginTop: 12 }]}>No support messages.</Text>}
  </View>);
}

function Coins() {
  const [user, setUser] = useState<any>(null); const [amt, setAmt] = useState(''); const [note, setNote] = useState('');
  const go = async (sign: 1 | -1) => {
    const n = Math.floor(Number(amt)); if (!user || !n || n < 0) return Alert.alert('Admin', 'Pick a user and enter a positive amount.');
    try { await A.adjustCoins(user.id, sign * n, note); setAmt(''); Alert.alert('Admin', 'Done'); } catch (e) { msg(e); }
  };
  return (<View><UserPick sel={user} onSel={setUser} />
    <Field label="Coins" keyboardType="number-pad" value={amt} onChangeText={setAmt} />
    <Field label="Note" value={note} onChangeText={setNote} />
    <Btn label="Add coins" onPress={() => go(1)} /><Btn label="Subtract coins" danger onPress={() => go(-1)} /></View>);
}

function Notify() {
  const [user, setUser] = useState<any>(null); const [t, setT] = useState(''); const [b, setB] = useState('');
  const send = async () => {
    if (!t.trim()) return Alert.alert('Admin', 'Title required.');
    try { const n = await A.notify(user?.id ?? null, t.trim(), b.trim()); setT(''); setB(''); Alert.alert('Admin', `Sent to ${n} user(s)`); } catch (e) { msg(e); }
  };
  return (<View><UserPick sel={user} onSel={setUser} optional />
    <Field label="Title" value={t} onChangeText={setT} /><Field label="Description" value={b} onChangeText={setB} multiline style={{ height: 90 }} />
    <Btn label={user ? 'Send to this user' : 'Send to ALL users'} onPress={send} /></View>);
}

function Banner() {
  const [rows, setRows] = useState<any[]>([]); const [link, setLink] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => A.listBanners().then(setRows).catch(msg);
  useEffect(() => { void load(); }, []);
  const add = async () => { setBusy(true); try { const url = await A.pickAndUploadImage(); if (url) { await A.addBanner(url, link.trim()); setLink(''); await load(); } } catch (e) { msg(e); } setBusy(false); };
  return (<View>
    <Field label="Link (tap target, never shown)" value={link} onChangeText={setLink} autoCapitalize="none" />
    <Btn label="Upload image & add banner" busy={busy} onPress={add} />
    <Text style={[u.hint, { marginTop: 8 }]}>Only the newest ACTIVE banner is shown at the top of the live list.</Text>
    {rows.map((r) => (<View key={r.id} style={[u.card, { marginTop: 10 }]}>
      <Image source={{ uri: r.image_url }} style={{ width: '100%', aspectRatio: 3, borderRadius: 8 }} resizeMode="contain" />
      <Text style={u.hint}>{r.link}</Text>
      <Row icon="eye" label={r.active ? 'Active' : 'Off'} toggle={r.active} onPress={() => A.updateBanner(r.id, { active: !r.active }).then(load).catch(msg)} />
      <Btn label="Replace image" onPress={async () => { try { const url = await A.pickAndUploadImage(); if (url) { await A.updateBanner(r.id, { image_url: url }); await load(); } } catch (e) { msg(e); } }} />
      <Btn label="Delete" danger onPress={() => A.deleteBanner(r.id).then(load).catch(msg)} /></View>))}
  </View>);
}

function Boost() {
  const [rows, setRows] = useState<any[]>([]); const [kind, setKind] = useState('views'); const [amt, setAmt] = useState(''); const [price, setPrice] = useState('');
  const load = () => A.listPackages().then(setRows).catch(msg);
  useEffect(() => { void load(); }, []);
  const add = async () => { const a = Math.floor(Number(amt)); const p = Number(price); if (!a || !p) return Alert.alert('Admin', 'Amount and price required.'); try { await A.addPackage(kind, a, p); setAmt(''); setPrice(''); await load(); } catch (e) { msg(e); } };
  return (<View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{['views', 'likes', 'comments', 'profileViews'].map((k) => <Chip key={k} label={k} on={kind === k} onPress={() => setKind(k)} />)}</View>
    <Field label="Amount" keyboardType="number-pad" value={amt} onChangeText={setAmt} /><Field label="Price (coins)" keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
    <Btn label="Add package" onPress={add} />
    {rows.filter((r) => r.kind === kind).map((r) => <PkgRow key={r.id} r={r} reload={load} />)}
    {!rows.length && <Text style={[u.hint, { marginTop: 12 }]}>No custom packages yet.</Text>}
  </View>);
}
function PkgRow({ r, reload }: { r: any; reload: () => void }) {
  const [a, setA] = useState(String(r.amount)); const [p, setP] = useState(String(r.price));
  return (<View style={[u.card, { marginTop: 8 }]}>
    <Field label="Amount" keyboardType="number-pad" value={a} onChangeText={setA} /><Field label="Price" keyboardType="decimal-pad" value={p} onChangeText={setP} />
    <Row icon="lock" label={r.locked ? 'Locked' : 'Unlocked'} toggle={r.locked} onPress={() => A.updatePackage(r.id, { locked: !r.locked }).then(reload).catch(msg)} />
    <Btn label="Save" onPress={() => A.updatePackage(r.id, { amount: Math.floor(Number(a)), price: Number(p) }).then(reload).catch(msg)} />
    <Btn label="Remove" danger onPress={() => A.deletePackage(r.id).then(reload).catch(msg)} /></View>);
}

function UserTools() {
  const [user, setUser] = useState<any>(null); const [d, setD] = useState<any>(null); const [warn, setWarn] = useState('');
  const load = useCallback(async (id: string) => { try { setD(await A.getUser(id)); } catch (e) { msg(e); } }, []);
  useEffect(() => { if (user) void load(user.id); else setD(null); }, [user, load]);
  const w = d?.wallet;
  return (<View><UserPick sel={user} onSel={setUser} />
    {d && (<View>
      <Group icon="user" title="Balance">
        <View style={{ padding: 14 }}><Text style={u.rowT}>Coins {w?.coins ?? 0} · Purchased {w?.purchased_balance ?? 0} · Earnings {w?.earnings_balance ?? 0}</Text><Text style={u.hint}>Joined {fmt(d.profile.created_at)} · last seen {fmt(d.profile.last_seen_at)}</Text></View>
      </Group>
      <Group icon="star" title="Analytics"><View style={{ padding: 14 }}>
        {Object.entries(d.stats).map(([k, v]) => <Text key={k} style={u.rowT}>{k}: {String(v)}</Text>)}</View></Group>
      <Group icon="shield" title="Warning"><View style={{ padding: 14 }}>
        {d.warning && <Text style={[u.rowT, { color: '#FF3B30' }]}>Current: {d.warning.text}</Text>}
        <Field label="Warning text" value={warn} onChangeText={setWarn} />
        <Btn label="Send warning (red ring)" danger onPress={() => A.warnUser(user.id, warn.trim()).then(() => { setWarn(''); return load(user.id); }).catch(msg)} />
        {d.warning && <Btn label="Remove warning" onPress={() => A.warnUser(user.id, '').then(() => load(user.id)).catch(msg)} />}</View></Group>
      <Group icon="video" title={`Posts (${d.posts.length})`}>
        {d.posts.map((p: any) => (<View key={p.id} style={[u.row, u.div]}>
          {!!p.thumb && <Image source={{ uri: p.thumb }} style={{ width: 44, height: 56, borderRadius: 6 }} />}
          <View style={{ flex: 1 }}><Text numberOfLines={1} style={u.rowT}>{p.caption || p.kind}</Text><Text style={u.hint}>{p.views} views · {p.likes} likes</Text></View>
          <Pressable onPress={() => Alert.alert('Delete post?', '', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => A.deletePost(p.id).then(() => load(user.id)).catch(msg) }])}><Text style={{ color: '#FF3B30', fontWeight: '800' }}>Delete</Text></Pressable></View>))}
      </Group>
      <Group icon="wallet" title="Transactions">
        {d.txns.map((t: any) => (<View key={t.id} style={[u.row, u.div]}><View style={{ flex: 1 }}><Text style={u.rowT}>{t.title}</Text><Text style={u.hint}>{t.sub} · {fmt(t.created_at)} · {t.status}</Text></View>
          <Text style={[u.rowT, { color: t.kind === 'in' ? '#34C759' : '#FF3B30' }]}>{t.kind === 'in' ? '+' : '-'}{t.amount}</Text></View>))}
      </Group></View>)}</View>);
}

function Social() {
  const [rows, setRows] = useState<{ id: string; label: string; url: string }[]>([]);
  useEffect(() => { loadSocials().then((r: any) => setRows(r ?? [])).catch(msg); }, []);
  const set = (i: number, k: 'label' | 'url', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (<View>
    {rows.map((r, i) => (<View key={r.id ?? i} style={[u.card, { marginTop: 8 }]}>
      <Field label="Title" value={r.label} onChangeText={(v) => set(i, 'label', v)} /><Field label="Link" value={r.url} onChangeText={(v) => set(i, 'url', v)} autoCapitalize="none" />
      <Btn label="Remove" danger onPress={() => setRows((x) => x.filter((_, j) => j !== i))} /></View>))}
    <Btn label="Add link" onPress={() => setRows((r) => [...r, { id: 's' + Date.now(), label: '', url: '' }])} />
    <Btn label="Save" onPress={() => saveSocials(rows as any).then(() => Alert.alert('Admin', 'Saved')).catch(msg)} /></View>);
}

function Reg() {
  const [c, setC] = useState<Record<string, number> | null>(null);
  useEffect(() => { A.regCounts().then(setC).catch(msg); }, []);
  return (<View style={{ marginTop: 12 }}>{c && [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['total', 'Total']].map(([k, l]) => (
    <View key={k} style={[u.card, { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' }]}><Text style={u.rowT}>{l}</Text><Text style={[u.h3, { color: O }]}>{c[k]}</Text></View>))}</View>);
}

function Bgs() {
  const [rows, setRows] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  const load = () => A.listBgs().then(setRows).catch(msg);
  useEffect(() => { void load(); }, []);
  const add = async () => { setBusy(true); try { const url = await A.pickAndUploadImage(); if (url) { await A.addBg(url); await load(); } } catch (e) { msg(e); } setBusy(false); };
  return (<View><Btn label="Add background" busy={busy} onPress={add} />
    <Text style={[u.hint, { marginTop: 8 }]}>Added backgrounds appear in the live background picker for everyone.</Text>
    {rows.map((r) => (<View key={r.id} style={[u.card, { marginTop: 10 }]}>
      <Image source={{ uri: r.image_url }} style={{ width: '100%', height: 160, borderRadius: 8 }} resizeMode="cover" />
      <Btn label="Replace" onPress={async () => { try { const url = await A.pickAndUploadImage(); if (url) { await A.replaceBg(r.id, url); await load(); } } catch (e) { msg(e); } }} />
      <Btn label="Delete" danger onPress={() => A.deleteBg(r.id).then(load).catch(msg)} /></View>))}</View>);
}

function Notice() {
  const [user, setUser] = useState<any>(null); const [link, setLink] = useState(''); const [rows, setRows] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  const load = () => A.listNotices().then(setRows).catch(msg);
  useEffect(() => { void load(); }, []);
  const add = async () => { setBusy(true); try { const url = await A.pickAndUploadImage(); if (url) { await A.addNotice(user?.id ?? null, url, link.trim()); setLink(''); await load(); } } catch (e) { msg(e); } setBusy(false); };
  return (<View><UserPick sel={user} onSel={setUser} optional />
    <Field label="Link (optional)" value={link} onChangeText={setLink} autoCapitalize="none" />
    <Btn label={user ? 'Upload image & send to this user' : 'Upload image & send to ALL'} busy={busy} onPress={add} />
    {rows.map((r) => (<View key={r.id} style={[u.card, { marginTop: 10 }]}><Image source={{ uri: r.image_url }} style={{ width: '100%', aspectRatio: 1.5 }} resizeMode="contain" />
      <Text style={u.hint}>{r.user_id ? 'One user' : 'All users'} · {fmt(r.created_at)}</Text><Btn label="Delete" danger onPress={() => A.deleteNotice(r.id).then(load).catch(msg)} /></View>))}</View>);
}

function AdminGroups() {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState<any>(null); const [msgs, setMsgs] = useState<any[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const load = useCallback(() => A.adminGroups(q).then(setRows).catch(msg), [q]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plain = (h: string) => (h ?? '').replace(/<[^>]*>/g, '');
  const openMsgs = (g: any) => { setOpen(g); A.adminGroupMessages(g.id).then(setMsgs).catch(msg); };
  if (open) return (<View>
    <Btn label="← Back to groups" onPress={() => { setOpen(null); void load(); }} />
    <Text style={[u.h3, { marginTop: 12 }]}>{plain(open.name)} · messages</Text>
    {msgs.map((m) => (<View key={m.id} style={[u.card, { marginTop: 8 }]}>
      <Text style={u.hint}>@{m.username} · {fmt(m.created_at)}{m.reply_to ? ' · reply' : ''}</Text>
      <Text style={u.rowT}>{m.kind === 'text' ? plain(m.body) : `[${m.kind}] ${m.body}`}</Text>
      <Btn label="Delete message" danger onPress={async () => { await A.adminGroupMsgDelete(m.id); setMsgs((l) => l.filter((x) => x.id !== m.id)); }} /></View>))}
    {!msgs.length && <Text style={[u.hint, { marginTop: 12 }]}>No messages.</Text>}
  </View>);
  return (<View>
    <Field label="Search group or owner" value={q} onChangeText={setQ} onSubmitEditing={load} />
    <Btn label="Search" onPress={load} />
    {rows.map((g) => (<View key={g.id} style={[u.card, { marginTop: 10 }]}>
      <Text style={u.h3}>{plain(g.name)}</Text>
      <Text style={u.hint}>Owner @{g.owner_username} · {g.member_count} members · {g.msgs} messages{g.hidden ? ' · HIDDEN' : ''}{g.comments_enabled === false ? ' · MESSAGING OFF' : ''}</Text>
      <Btn label="View / delete messages" onPress={() => openMsgs(g)} />
      <Btn label={g.comments_enabled === false ? 'Turn messaging ON' : 'Turn messaging OFF'} onPress={async () => { await A.adminGroupSet(g.id, null, g.comments_enabled === false); await load(); }} />
      <Btn label={g.hidden ? 'Show in group list' : 'Hide from group list'} onPress={async () => { await A.adminGroupSet(g.id, !g.hidden, null); await load(); }} />
      {confirmId === g.id ? (<>
        <Text style={[u.hint, { color: '#FF3B30' }]}>This permanently deletes the group and all its messages.</Text>
        <Btn label="Yes, delete group" danger onPress={async () => { await A.adminGroupDelete(g.id); setConfirmId(null); setRows((l) => l.filter((x) => x.id !== g.id)); }} />
        <Btn label="Cancel" onPress={() => setConfirmId(null)} />
      </>) : <Btn label="Delete group" danger onPress={() => setConfirmId(g.id)} />}
    </View>))}
    {!rows.length && <Text style={[u.hint, { marginTop: 12 }]}>No groups.</Text>}
  </View>);
}

const SECS: { k: Exclude<Sec, null>; label: string; icon: any }[] = [
  { k: 'groups', label: 'Groups control', icon: 'users' }, { k: 'support', label: 'Help & support chats', icon: 'comment' },
  { k: 'redeem', label: 'Withdrawal requests', icon: 'wallet' }, { k: 'live', label: 'Live access', icon: 'radio' }, { k: 'post', label: 'Post access', icon: 'video' },
  { k: 'coins', label: 'Add / subtract coins', icon: 'coin' }, { k: 'notify', label: 'Send notification', icon: 'send' }, { k: 'auth', label: 'Login & sign-up access', icon: 'lock' },
  { k: 'banner', label: 'Live-list banner ad', icon: 'image' }, { k: 'boost', label: 'Boost packages', icon: 'rocket' }, { k: 'user', label: 'User lookup, analytics & posts', icon: 'user' },
  { k: 'social', label: 'Follow us links', icon: 'link' }, { k: 'reg', label: 'Registered users', icon: 'users' }, { k: 'bgs', label: 'Live backgrounds', icon: 'image' }, { k: 'notice', label: 'Notice card', icon: 'flag' },
];

export default function AdminScreen({ onBack }: { onBack: () => void }) {
  const [sec, setSec] = useState<Sec>(null);
  const cur = SECS.find((x) => x.k === sec);
  const body = { redeem: <Redeems />, live: <Access kind="live" />, post: <Access kind="post" />, auth: <Access kind="auth" />, coins: <Coins />, notify: <Notify />, banner: <Banner />, boost: <Boost />, user: <UserTools />, social: <Social />, reg: <Reg />, bgs: <Bgs />, notice: <Notice />, groups: <AdminGroups />, support: <Support /> };
  return (
    <Page title={cur ? cur.label : 'Admin panel'} onBack={() => (sec ? setSec(null) : onBack())}>
      {sec ? body[sec] : <View style={u.gbox}>{SECS.map((x, i) => <Row key={x.k} icon={x.icon} label={x.label} last={i === SECS.length - 1} onPress={() => setSec(x.k)} />)}</View>}
    </Page>
  );
}
