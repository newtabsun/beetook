import { friendlyError } from '../../lib/errors';
import { refreshVip } from '../../components/Vip';
// Profile ☰ menu pages (full screen) — mirror web Profile menu: Analytics, VIP, Settings, Help, About, Share, Rank, Follow us.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'qrcode';
import { SvgXml } from 'react-native-svg';
import { Icon, type IconName } from '../../components/Icons';
import { notify } from '../../lib/notify';
import { setAutoSaverOnCellular, setDataSaver, useAutoSaverOnCellular, useDataSaver, useEffectiveDataSaver } from '../../lib/network';
import { CACHE_LIMIT_BYTES, clearMediaCache, mediaCacheBytes } from '../../lib/offline';
import { fetchMyPosts, fetchMyProfile, formatNum, updateProfile, type Post, type Profile } from '../../lib/api';
import { handleOf, normalizeUsername, profileUrl } from '../../lib/username';
import { supabase } from '../../lib/supabase';
import { authMessage, emailChangeConfirm, emailChangeSend, loadTwoStep, setTwoStep } from '../../lib/authEmail';
import { formatCoins } from '../../lib/wallet';
import {
  deleteAccount, fetchSupport, loadSettings, loadSocials, myBlocks, rankTop, saveSettings, saveSocials, sendSupport, unblock,
  vipActive, vipDays, vipSetAuto, vipStatus, vipSubscribe, type Blocked, type RankRow, type Settings, type Social, type SupportMsg, type Vip,
} from '../../lib/menu';
import { BottomSheet, Btn, Chip, Field, Group, O, Page, Row, Toggle, u } from './menuUi';

export const APP_VERSION = '1.4.0';
const BUILD = '214';
const SUPPORT = 'support@beetook.com';
const TERMS = 'https://beetook.com/terms';
const PRIVACY = 'https://beetook.com/privacy';
const VIP_PRICE = 12500;
const FAQS = [
  ['How do I buy coins?', 'Open Wallet → Buy coins. In the Android app you pay with Google Play; on the web you can also use Chapa (telebirr, CBE Birr, M-Pesa, cards) or USDT on BEP20. Coins go to your Purchased balance.'],
  ['What is the difference between Purchased and Earnings?', 'Purchased coins are bought and used for gifts, VIP, joining fees and game support. Earnings come from gifts, joining fees and game support you receive. Spending uses Purchased first, then Earnings. Only Earnings can be redeemed, and you can convert Earnings to Purchased for free.'],
  ['How does Redeem work?', 'Wallet → Redeem, from your Earnings balance only: minimum 25,000 coins, 10% fee, up to 50,000 coins per day, paid to telebirr, CBE, BOA or USDT (BEP20). If a request is rejected or fails, the coins return to your Earnings.'],
  ['How do I make my account private?', 'Settings → Privacy → turn on Private account. Only approved followers will see your videos.'],
  ['How do I delete my account?', 'Settings → Danger zone → Remove account. Type DELETE to confirm.'],
];

export type MenuSheet = 'analytics' | 'vip' | 'settings' | 'help' | 'about' | 'share' | 'rank' | 'follow';
const open = (url: string) => void Linking.openURL(url).catch(() => notify('Could not open link'));
const err = (e: unknown) => notify('Error', friendlyError(e));

function useMe() {
  const [me, setMe] = useState<Profile | null>(null);
  useEffect(() => { fetchMyProfile().then(setMe).catch(() => undefined); }, []);
  return me;
}

function Analytics({ onBack }: { onBack: () => void }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const me = useMe();
  useEffect(() => { fetchMyPosts('published').then(setPosts).catch(() => setPosts([])); }, []);
  const views = (posts ?? []).reduce((n, x) => n + (x.view_count ?? 0), 0);
  const likes = (posts ?? []).reduce((n, x) => n + (x.like_count ?? 0), 0);
  const top = [...(posts ?? [])].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)).slice(0, 5);
  const cards: [IconName, string, string][] = [
    ['eye', formatNum(views), 'Video views'], ['userPlus', formatNum(me?.followers_count ?? 0), 'Followers'],
    ['heart', formatNum(likes), 'Likes'], ['video', String(posts?.length ?? 0), 'Published posts'],
  ];
  return (
    <Page title="Dashboard" onBack={onBack}>
      {!posts ? <ActivityIndicator color={O} /> : (
        <>
          <View style={s.cards}>{cards.map(([ic, v, l]) => (
            <View key={l} style={s.card}><Icon name={ic} size={16} color={O} /><Text style={s.cardV}>{v}</Text><Text style={u.hint}>{l}</Text></View>
          ))}</View>
          <Text style={[u.rowT, { marginTop: 18, marginBottom: 8 }]}>Top performing reels</Text>
          {top.length === 0 ? <Text style={u.sub}>Post your first reel to see analytics.</Text> : top.map((x, i) => (
            <View key={x.id} style={s.top}>
              <Text style={s.rank}>{i + 1}</Text>
              {x.media_urls[0] ? <Image source={{ uri: x.media_urls[0] }} style={s.thumb} /> : <View style={s.thumb} />}
              <View style={{ flex: 1 }}><Text numberOfLines={1} style={u.rowT}>{x.caption || 'Untitled'}</Text><Text style={u.hint}>{formatNum(x.view_count ?? 0)} views</Text></View>
            </View>
          ))}
        </>
      )}
    </Page>
  );
}

// Marketplace and profile edits are free for everyone, so they are not VIP perks. The list is numbered by index (1…n).
const PERKS: [IconName, string, string][] = [
  ['radio', 'Live access', 'Go Live and host your own stream (free for accounts with 1,000+ followers)'],
  ['users', 'Create groups', 'Open and monetize your own groups'],
  ['palette', 'Colored text', 'Write your posts and messages in color (everyone can read colored text)'],
  ['crown', 'Premium badge', 'Golden crown badge next to your name'],
  ['sparkles', 'Profile ring', 'Glowing gradient ring around your photo'],
];

function VipPage({ onBack }: { onBack: () => void }) {
  const [v, setV] = useState<Vip | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (first = false) => {
    try {
      const r = await vipStatus(); setV(r);
      if (first && r.renew === 'renewed') notify('VIP auto-renewed for 30 days 👑');
      if (first && r.renew === 'failed') notify('Auto-renew failed — not enough coins');
    } catch (e) { err(e); }
  };
  useEffect(() => { void load(true); }, []);
  const active = vipActive(v); const days = vipDays(v);
  const exp = v?.expires_at ? new Date(v.expires_at).toLocaleDateString() : '';
  const toggleAuto = async () => {
    if (!v) return;
    try { const on = await vipSetAuto(!v.auto_renew); setV({ ...v, auto_renew: on }); notify(on ? 'Auto-renew on — coins will be deducted at expiry' : 'Auto-renew off'); } catch (e) { err(e); }
  };
  const buy = async () => {
    setBusy(true);
    try {
      const r = await vipSubscribe();
      if (r.result === 'active') notify(`You are already a member until ${exp}`);
      else if (r.result === 'funds') notify(`Not enough coins — you need ${formatCoins(VIP_PRICE)} coins. Recharge your wallet.`);
      else notify('Welcome to VIP 👑');
      await load();
      refreshVip((await supabase.auth.getSession()).data.session?.user.id);
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <Page title="VIP" onBack={onBack}>
      <View style={s.vipCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={s.vipIco}><Icon name="crown" size={24} color="#000" /></View>
          <View><Text style={s.vipT}>Bee Took VIP</Text><Text style={s.gold}>{active ? `Active · ${days} days left` : 'Unlock all premium features'}</Text></View>
        </View>
        <Text style={s.price}>{formatCoins(VIP_PRICE)} <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>coins / month</Text></Text>
        <Text style={u.hint}>Your balance: {v ? formatCoins(Number(v.coins)) : '…'} coins</Text>
      </View>
      <Text style={[u.ght, { marginTop: 22, marginBottom: 8, color: 'rgba(255,255,255,0.5)' }]}>What you get</Text>
      {PERKS.map(([ic, t, d], i) => (
        <View key={t} style={s.perk}>
          <View style={s.perkI}><Icon name={ic} size={18} color={O} /></View>
          <View style={{ flex: 1 }}><Text style={u.rowT}>{i + 1}. {t}</Text><Text style={u.hint}>{d}</Text></View>
          {active && <Icon name="check" size={18} color="#FFD700" />}
        </View>
      ))}
      <Pressable accessibilityLabel="Auto-renew" accessibilityRole="switch" accessibilityState={{ checked: !!v?.auto_renew }} onPress={() => void toggleAuto()} style={[s.perk, { marginTop: 16 }]}>
        <View style={{ flex: 1 }}><Text style={u.rowT}>Auto-renew</Text><Text style={u.hint}>Deduct {formatCoins(VIP_PRICE)} coins automatically when it expires</Text></View>
        <Toggle on={!!v?.auto_renew} />
      </Pressable>
      {active ? (
        <View testID="vip-member" style={s.member}>
          <Text style={[s.gold, { fontSize: 14, fontWeight: '800' }]}>✓ You are a member</Text>
          <Text style={u.hint}>Expires on {exp} · {days} days left{v?.auto_renew ? ' · renews automatically' : ''}</Text>
        </View>
      ) : <Btn icon="sparkles" busy={busy} label={`Subscribe · ${formatCoins(VIP_PRICE)} coins`} onPress={() => void buy()} />}
    </Page>
  );
}

type SMode = null | 'phone' | 'email' | 'password' | 'blocked' | 'remove' | 'twostep';
/** Data Saver: always low quality, and videos wait for a tap instead of autoplaying. Stored on the device. */
function DataSaverRow() {
  const on = useDataSaver();
  return (
    <Pressable testID="data-saver" accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => { setDataSaver(!on); notify(on ? 'Data Saver off' : 'Data Saver on — lower quality, no autoplay'); }}
      style={[u.card, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }]}>
      <View style={{ flex: 1 }}><Text style={u.rowT}>Data Saver</Text><Text style={u.hint}>Always on, on every connection (Wi-Fi too): lower video quality and videos play only after you tap.</Text></View>
      <View style={{ width: 46, height: 26, borderRadius: 13, padding: 3, backgroundColor: on ? O : 'rgba(255,255,255,0.2)', alignItems: on ? 'flex-end' : 'flex-start' }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }} /></View>
    </Pressable>
  );
}

function Switch({ on }: { on: boolean }) {
  return <View style={{ width: 46, height: 26, borderRadius: 13, padding: 3, backgroundColor: on ? O : 'rgba(255,255,255,0.2)', alignItems: on ? 'flex-end' : 'flex-start' }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }} /></View>;
}

/** Off by default: when on, Data Saver turns on by itself while the phone uses mobile data. */
function AutoSaverRow() {
  const on = useAutoSaverOnCellular();
  const manual = useDataSaver();
  return (
    <Pressable testID="auto-saver" accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => { setAutoSaverOnCellular(!on); notify(on ? 'Auto Data Saver off' : 'Data Saver will turn on with mobile data'); }}
      style={[u.card, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }]}>
      <View style={{ flex: 1 }}><Text style={u.rowT}>Data Saver on mobile data</Text><Text style={u.hint}>{manual ? 'Not needed while Data Saver is on everywhere.' : 'Only while you use mobile data: Data Saver turns on by itself. Wi-Fi keeps full quality.'}</Text></View>
      <Switch on={on} />
    </Pressable>
  );
}

const GB = 1024 * 1024 * 1024;
const size = (b: number) => (b >= GB ? `${(b / GB).toFixed(2).replace(/\.?0+$/, '')} GB` : `${Math.round(b / (1024 * 1024))} MB`);
/** Cached videos + photos share a 1 GB budget (oldest removed first); shows "used / 1 GB" and clears it. */
function CacheRow() {
  const [used, setUsed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const measure = () => mediaCacheBytes().then(setUsed).catch(() => setUsed(0));
  useEffect(() => { void measure(); }, []);
  const clear = async () => {
    setBusy(true);
    await clearMediaCache();
    await measure();
    setBusy(false);
    notify('Cache cleared');
  };
  return (
    <View style={[u.card, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }]}>
      <View style={{ flex: 1 }}>
        <Text style={u.rowT}>Storage</Text>
        <Text testID="cache-usage" style={[u.rowT, { color: O, marginVertical: 2 }]}>{used === null ? '…' : `${size(Math.min(used, CACHE_LIMIT_BYTES))} / ${size(CACHE_LIMIT_BYTES)}`}</Text>
        <Text style={u.hint}>Watched videos and photos are kept up to 1 GB; the oldest are removed first. Clearing frees space; watched videos then need internet again.</Text>
      </View>
      <Pressable testID="clear-cache" accessibilityLabel="Clear cache" disabled={busy} onPress={() => void clear()} style={{ backgroundColor: O, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8, opacity: busy ? 0.5 : 1 }}>
        {busy ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: '800', fontSize: 12 }}>Clear cache</Text>}
      </Pressable>
    </View>
  );
}

function SettingsPage({ onBack, onHelp }: { onBack: () => void; onHelp: () => void }) {
  const me = useMe();
  const saverNow = useEffectiveDataSaver();
  const [st, setSt] = useState<Settings | null>(null);
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<SMode>(null);
  const [draft, setDraft] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [reveal, setReveal] = useState(false);
  const [reason, setReason] = useState('Taking a break');
  const [confirm, setConfirm] = useState('');
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [twoStep, setTwoStepOn] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    loadSettings().then(setSt).catch(err);
    myBlocks().then(setBlocked).catch(() => undefined);
    loadTwoStep().then(setTwoStepOn).catch(() => undefined);
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  useEffect(() => { setPhone((me as { phone?: string } | null)?.phone ?? ''); }, [me]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K], toast?: string) => {
    if (!st) return;
    const next = { ...st, [k]: v }; setSt(next);
    saveSettings(next).then(() => toast && notify(toast)).catch(err);
  };
  const close = () => { setMode(null); setDraft(''); setOldPw(''); setNewPw(''); setConfirm(''); setReveal(false); setEmailCode(''); setCodeSent(false); setCooldown(0); };
  const go = (m: SMode) => { setDraft(m === 'phone' ? phone : m === 'email' ? '' : ''); setMode(m); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); close(); } catch (e) { err(e); } finally { setBusy(false); } };
  const fail = (e: unknown) => notify('Error', authMessage(e));

  const savePhone = () => {
    if (draft.replace(/\D/g, '').length < 9) return notify('Enter a valid phone number');
    void run(async () => { await updateProfile({ phone: draft.trim() } as Partial<Profile>); setPhone(draft.trim()); notify('Phone number updated'); });
  };
  const sendEmailCode = async () => {
    if (!/^\S+@\S+\.\S+$/.test(draft.trim())) return notify('Enter a valid email address');
    if (cooldown > 0) return;
    setBusy(true);
    try { await emailChangeSend(draft.trim()); setCodeSent(true); setEmailCode(''); setCooldown(45); notify('Code sent', `Check ${draft.trim()}`); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const confirmEmail = async () => {
    if (!/^\d{6}$/.test(emailCode)) return notify('Enter the 6-digit code');
    setBusy(true);
    try { const r = await emailChangeConfirm(emailCode); setEmail(r.email); close(); notify('Email updated', `Your email is now ${r.email}`); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const toggleTwoStep = async () => {
    if (!twoStep) {
      setBusy(true);
      try { await setTwoStep(true); setTwoStepOn(true); notify('Two-step verification is on', 'A new device will need an email code at login.'); }
      catch (e) { fail(e); } finally { setBusy(false); }
    } else setMode('twostep');
  };
  const turnOffTwoStep = async () => {
    if (oldPw.length < 6) return notify('Enter your password');
    setBusy(true);
    try { await setTwoStep(false, oldPw); setTwoStepOn(false); close(); notify('Two-step verification is off'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const savePw = () => {
    if (oldPw.length < 6) return notify('Enter your current password');
    if (newPw.length < 6) return notify('New password must be at least 6 characters');
    void run(async () => {
      const a = await supabase.auth.signInWithPassword({ email, password: oldPw }); if (a.error) throw new Error('Current password is incorrect');
      const { error } = await supabase.auth.updateUser({ password: newPw }); if (error) throw error;
      notify('Password changed');
    });
  };
  const remove = () => {
    if (confirm.trim().toUpperCase() !== 'DELETE') return notify('Type DELETE to confirm');
    void run(async () => { await deleteAccount(); await supabase.auth.signOut(); });
  };

  const sheet = mode && (
    <BottomSheet label={mode} onClose={close}>
      {mode === 'phone' && (<>
        <Text style={u.h3}>Change phone number</Text><Text style={u.sub}>Used to log in with your phone.</Text>
        <Field value={draft} onChangeText={setDraft} keyboardType="phone-pad" placeholder="+251 9xx xxx xxx" />
        <Btn busy={busy} label={busy ? 'Saving…' : 'Save number'} onPress={savePhone} />
      </>)}
      {mode === 'email' && (<>
        <Text style={u.h3}>Change email address</Text>
        <Text style={u.sub}>Current: {email || '…'}. We email a 6-digit code to the new address to confirm it.</Text>
        <Field label="New email" value={draft} onChangeText={setDraft} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" editable={!codeSent} />
        {codeSent ? (<>
          <Field label="Verification code" value={emailCode} onChangeText={(v) => setEmailCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="123456" />
          <Btn busy={busy} label={busy ? 'Verifying…' : 'Confirm new email'} onPress={() => void confirmEmail()} />
          <Pressable disabled={cooldown > 0 || busy} onPress={() => void sendEmailCode()}>
            <Text style={[s.link, { marginTop: 12, textAlign: 'center' }, cooldown > 0 && { opacity: 0.5 }]}>{cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}</Text>
          </Pressable>
          <Pressable onPress={() => { setCodeSent(false); setEmailCode(''); }}><Text style={[u.hint, { textAlign: 'center', marginTop: 10, fontWeight: '700' }]}>Use a different email</Text></Pressable>
        </>) : <Btn busy={busy} label={busy ? 'Sending…' : 'Send code'} onPress={() => void sendEmailCode()} />}
      </>)}
      {mode === 'twostep' && (<>
        <Text style={u.h3}>Turn off two-step verification?</Text>
        <Text style={u.sub}>Enter your login password. New devices will no longer need an email code.</Text>
        <Field secureTextEntry={!reveal} value={oldPw} onChangeText={setOldPw} placeholder="Password" />
        <Pressable onPress={() => setReveal(!reveal)}><Text style={[s.link, { marginTop: 12 }]}>{reveal ? 'Hide password' : 'Show password'}</Text></Pressable>
        <Btn danger busy={busy} label={busy ? 'Turning off…' : 'Turn off'} onPress={() => void turnOffTwoStep()} />
        <Pressable onPress={close}><Text style={[u.hint, { textAlign: 'center', marginTop: 12, fontWeight: '700' }]}>Keep it on</Text></Pressable>
      </>)}
      {mode === 'password' && (<>
        <Text style={u.h3}>Change password</Text><Text style={u.sub}>Use at least 6 characters.</Text>
        <Field secureTextEntry={!reveal} value={oldPw} onChangeText={setOldPw} placeholder="Current password" />
        <Field secureTextEntry={!reveal} value={newPw} onChangeText={setNewPw} placeholder="New password" />
        <Pressable onPress={() => setReveal(!reveal)}><Text style={[s.link, { marginTop: 12 }]}>{reveal ? 'Hide passwords' : 'Show passwords'}</Text></Pressable>
        <Btn busy={busy} label={busy ? 'Saving…' : 'Update password'} onPress={savePw} />
      </>)}
      {mode === 'blocked' && (<>
        <Text style={u.h3}>Blocked accounts</Text><Text style={u.sub}>Blocked people cannot message you, follow you or find your profile.</Text>
        {blocked.length === 0 ? <Text style={[u.hint, { textAlign: 'center', paddingVertical: 36 }]}>You have not blocked anyone.</Text> : blocked.map((b) => (
          <View key={b.id} style={[u.card, { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }]}>
            <View style={s.av}><Text style={{ color: O, fontWeight: '800' }}>{(b.display_name || b.username).charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text style={u.rowT}>{b.display_name || b.username}</Text><Text style={u.hint}>{handleOf(b.username)}</Text></View>
            <Pressable accessibilityLabel={`Unblock ${b.username}`} style={s.outline} onPress={() => unblock(b.id).then(() => { setBlocked((l) => l.filter((x) => x.id !== b.id)); notify(`Unblocked ${b.display_name || b.username}`); }).catch(err)}>
              <Text style={{ color: O, fontSize: 11, fontWeight: '800' }}>Unblock</Text>
            </Pressable>
          </View>
        ))}
      </>)}
      {mode === 'remove' && (<>
        <Text style={u.h3}>Remove your account?</Text>
        <Text style={u.sub}>This permanently deletes your videos, drafts, chats and wallet balance. This cannot be undone.</Text>
        <Text style={[u.lbl, { marginTop: 14 }]}>Why are you leaving?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['Taking a break', 'Too much time', 'Privacy concerns', 'Using another app'].map((r) => <Chip key={r} label={r} on={reason === r} onPress={() => setReason(r)} />)}</View>
        <Field label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholder="DELETE" />
        <Btn danger busy={busy} label={busy ? 'Removing…' : 'Permanently remove account'} onPress={remove} />
        <Pressable onPress={close}><Text style={[u.hint, { textAlign: 'center', marginTop: 12, fontWeight: '700' }]}>Cancel — keep my account</Text></Pressable>
      </>)}
    </BottomSheet>
  );

  return (
    <Page title="Settings & privacy" onBack={onBack} overlay={sheet}>
      <View style={[u.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
        <View style={s.av}><Icon name="user" size={20} color={O} /></View>
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={u.rowT}>{handleOf(me?.username) || '…'}</Text><Text style={u.hint}>joined {me ? new Date((me as { created_at?: string }).created_at ?? Date.now()).toLocaleDateString() : ''}</Text></View>
      </View>
      {!st ? <ActivityIndicator color={O} style={{ marginTop: 20 }} /> : (<>
        <Group icon="lock" title="Account">
          <Row icon="phone" label="Phone number" value={phone} onPress={() => go('phone')} />
          <Row icon="send" label="Email address" value={email} onPress={() => go('email')} />
          <Row icon="lock" label="Change password" onPress={() => go('password')} />
          <Row last icon="shield" label="Two-step verification" hint="Email code when logging in on a new device" toggle={twoStep} onPress={() => void toggleTwoStep()} />
        </Group>
        <Group icon="eye" title="Privacy">
          <Row icon="lock" label="Private account" hint="Only approved followers see your videos" toggle={st.privateAccount}
            onPress={() => set('privateAccount', !st.privateAccount, !st.privateAccount ? 'Your account is now private 🔒' : 'Your account is public again')} />
          <Row icon="globe" label="Appear in search" hint="Let people find you by name" toggle={st.showInSearch} onPress={() => set('showInSearch', !st.showInSearch)} />
          <Row icon="eye" label="Show activity status" hint="Friends can see when you were last active" toggle={st.showActivity} onPress={() => set('showActivity', !st.showActivity)} />
          <Row icon="ban" label="Blocked accounts" value={String(blocked.length)} onPress={() => go('blocked')} />
          <View style={{ padding: 14 }}>
            <Text style={[u.rowT, { marginBottom: 8 }]}>Who can comment</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>{(['everyone', 'friends', 'off'] as const).map((f) => (
              <View key={f} style={{ flex: 1 }}><Chip label={f} on={st.commentFilter === f} onPress={() => set('commentFilter', f)} /></View>
            ))}</View>
          </View>
        </Group>
        <Group icon="flame" title="Notifications">
          <Row icon="flame" label="Push notifications" hint="Likes, comments and follows" toggle={st.pushNotifications} onPress={() => set('pushNotifications', !st.pushNotifications)} />
          <Row last icon="heart" label="Live alerts" hint="When creators you follow go live" toggle={st.liveAlerts} onPress={() => set('liveAlerts', !st.liveAlerts)} />
        </Group>
        <Group icon="sliders" title="Content & app">
          <Row icon="type" label="Language" value="English" onPress={() => notify('More languages arrive soon')} />
          <Row icon="star" label="Dark theme" value="Always on" onPress={() => notify('Bee Took ships dark by default 🌙')} />
          <Row last icon="gauge" label="Playback quality" value={saverNow ? 'Data Saver' : 'Auto'} onPress={() => notify('Use Data Saver at the bottom of Settings to lower video quality')} />
        </Group>
        <Group icon="shield" title="Support & about">
          <Row icon="shield" label="Help & support" onPress={onHelp} />
          <Row icon="lock" label="Privacy policy" onPress={() => open(PRIVACY)} />
          <Row icon="check" label="Terms of service" onPress={() => open(TERMS)} />
          <Row last icon="sparkles" label="App version" value={`${APP_VERSION} (${BUILD})`} />
        </Group>
        <View style={{ marginTop: 16 }}>
          <DataSaverRow />
          <AutoSaverRow />
          <CacheRow />
        </View>
        <Group icon="trash" title="Danger zone">
          <Row icon="logout" label="Log out" onPress={() => void supabase.auth.signOut()} />
          <Row last danger icon="trash" label="Remove account" hint="Deletes your videos, chats and wallet balance" onPress={() => go('remove')} />
        </Group>
        <Text style={[u.hint, { textAlign: 'center', marginTop: 16 }]}>Bee Took {APP_VERSION} · settings are saved to your account</Text>
      </>)}
    </Page>
  );
}

function HelpPage({ onBack }: { onBack: () => void }) {
  const [faq, setFaq] = useState(0);
  const [chat, setChat] = useState<SupportMsg[] | null>(null);
  const [text, setText] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const loadChat = () => fetchSupport().then(setChat).catch(err);
  const send = async () => {
    if (!text.trim()) return;
    try { await sendSupport(text); setText(''); await loadChat(); } catch (e) { err(e); }
  };
  const sheet = chatOpen && (
    <BottomSheet label="Support chat" onClose={() => setChatOpen(false)}>
      <Text style={u.h3}>Support chat</Text><Text style={u.sub}>Our team replies here, usually within a few hours.</Text>
      <View style={{ gap: 8, marginTop: 12, minHeight: 120 }}>
        {chat === null ? <ActivityIndicator color={O} /> : chat.length === 0 ? <Text style={[u.hint, { textAlign: 'center', paddingVertical: 30 }]}>Say hi — tell us how we can help.</Text> : chat.map((m) => (
          <View key={m.id} testID="support-msg" style={[s.bubble, m.from_support ? { alignSelf: 'flex-start' } : { alignSelf: 'flex-end', backgroundColor: O }]}>
            <Text style={{ color: m.from_support ? '#fff' : '#000', fontSize: 13 }}>{m.body}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <TextInput accessibilityLabel="Support message" value={text} onChangeText={setText} placeholder="Type a message" placeholderTextColor="rgba(255,255,255,0.35)" style={[u.input, { flex: 1 }]} onSubmitEditing={() => void send()} />
        <Pressable accessibilityLabel="Send" onPress={() => void send()} style={s.send}><Icon name="send" size={18} color="#000" /></Pressable>
      </View>
    </BottomSheet>
  );
  return (
    <Page title="Help & support" onBack={onBack} overlay={sheet}>
      <Text style={u.sub}>Answers to the questions creators ask us most.</Text>
      <View style={{ gap: 8, marginTop: 14 }}>{FAQS.map(([q, a], i) => (
        <Pressable key={q} accessibilityLabel={q} style={s.faq} onPress={() => setFaq(faq === i ? -1 : i)}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={[u.rowT, { flex: 1 }]}>{q}</Text><Text style={{ color: O }}>{faq === i ? '˄' : '˅'}</Text></View>
          {faq === i && <Text style={s.faqA}>{a}</Text>}
        </Pressable>
      ))}</View>
      <Btn icon="comment" label="Open chat" onPress={() => { setChatOpen(true); void loadChat(); }} />
      <Pressable onPress={() => open(`mailto:${SUPPORT}`)}><Text style={[u.hint, { textAlign: 'center', marginTop: 12 }]}>✉ {SUPPORT}</Text></Pressable>
    </Page>
  );
}

function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <Page title="About Bee Took" onBack={onBack}>
      <View style={{ alignItems: 'center' }}>
        <Image source={require('../../../assets/logo.png')} style={{ width: 56, height: 56 }} resizeMode="contain" />
        <Text style={s.brand}>Bee<Text style={{ color: O }}>Took</Text></Text>
        <Text style={[u.sub, { textAlign: 'center' }]}>Short videos, live rooms and creator tools — made in Addis Ababa 🇪🇹</Text>
        <Text style={[u.hint, { marginTop: 8, fontWeight: '700' }]}>Version {APP_VERSION} (build {BUILD})</Text>
      </View>
      <View style={[u.gbox, { marginTop: 16 }]}>
        <Row icon="shield" label="Terms of service" onPress={() => open(TERMS)} />
        <Row icon="shield" label="Privacy policy" onPress={() => open(PRIVACY)} />
        <Row last icon="layers" label="Copy version for support" onPress={() => void Clipboard.setStringAsync(APP_VERSION).then(() => notify('Version copied'))} />
      </View>
    </Page>
  );
}

function SharePage({ onBack }: { onBack: () => void }) {
  const me = useMe();
  const [svg, setSvg] = useState('');
  const handle = normalizeUsername(me?.username);
  const url = profileUrl(handle);
  useEffect(() => { if (handle) void QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#0A0A0B', light: '#FFFFFF' } }).then(setSvg); }, [handle, url]);
  const copy = () => void Clipboard.setStringAsync(url).then(() => notify('Profile link copied 🔗'));
  const share = () => { Share.share({ message: url, url, title: `${handleOf(handle)} on Bee Took` }).catch(copy); };
  return (
    <Page title="Share profile" onBack={onBack}>
      <View style={{ alignItems: 'center' }}>
        <Text style={u.h3}>Share your profile</Text>
        <Text style={u.sub}>Let friends scan or tap the link to find {handleOf(handle)}.</Text>
        <View testID="share-qr" style={s.qr}>{svg ? <SvgXml xml={svg} width={148} height={148} /> : <ActivityIndicator color={O} />}</View>
      </View>
      <View style={[u.card, { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }]}>
        <Icon name="link" size={16} color={O} />
        <Text numberOfLines={1} style={[u.hint, { flex: 1, fontSize: 12 }]}>{url}</Text>
        <Pressable accessibilityLabel="Copy profile link" onPress={copy} style={s.copy}><Icon name="layers" size={16} color="#fff" /></Pressable>
      </View>
      <Btn label="Share profile" onPress={share} />
    </Page>
  );
}

const MEDAL = ['#FFD700', '#C0C0C0', '#CD7F32'];
function RankPage({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [meId, setMeId] = useState('');
  useEffect(() => {
    rankTop().then(setRows).catch((e) => { setRows([]); err(e); });
    void supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? ''));
  }, []);
  return (
    <Page title="Rank" onBack={onBack}>
      <Text style={[u.sub, { marginTop: -8, marginBottom: 12 }]}>🏆 Top users by Earnings balance</Text>
      {!rows ? <ActivityIndicator color={O} /> : rows.map((r) => {
        const mine = r.id === meId;
        const pos = r.rank === null ? -1 : r.rank - 1;
        return (
          <View key={r.id} testID={mine ? 'rank-me' : undefined} style={[s.rankRow, mine && { borderColor: O, backgroundColor: 'rgba(255,165,0,0.1)' }]}>
            <View style={[s.medal, pos >= 0 && pos < 3 && { backgroundColor: MEDAL[pos] }]}><Text style={{ color: pos >= 0 && pos < 3 ? '#000' : O, fontWeight: '800' }}>{r.rank ?? '–'}</Text></View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={u.rowT}>{r.display_name || r.username}{mine ? <Text style={{ color: O, fontSize: 10 }}> (You)</Text> : null}{r.vip ? <Text style={s.vipB}>  👑 VIP</Text> : null}</Text>
              <Text style={u.hint}>{handleOf(r.username)}</Text>
            </View>
            <Text style={{ color: '#FFD700', fontSize: 12, fontWeight: '800' }}>{r.rank === null ? 'Not ranked yet' : `${formatCoins(Number(r.earnings ?? 0))} 🪙`}</Text>
          </View>
        );
      })}
    </Page>
  );
}

function FollowPage({ onBack }: { onBack: () => void }) {
  const me = useMe();
  const [links, setLinks] = useState<Social[] | null>(null);
  const [editing, setEditing] = useState(false);
  const admin = !!(me as (Profile & { is_admin?: boolean }) | null)?.is_admin;
  useEffect(() => { loadSocials().then(setLinks).catch((e) => { setLinks([]); err(e); }); }, []);
  const save = async () => {
    if (!links) return;
    const clean = links.map((l) => ({ ...l, url: l.url.trim() }));
    try { await saveSocials(clean); setLinks(clean); setEditing(false); notify('Social links saved'); } catch (e) { err(e); }
  };
  return (
    <Page title="Follow us" onBack={onBack}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: -8, marginBottom: 12 }}>
        <Text style={[u.sub, { flex: 1, marginTop: 0 }]}>Bee Took on social media</Text>
        {admin && (
          <Pressable accessibilityLabel={editing ? 'Save' : 'Admin edit'} onPress={() => (editing ? void save() : setEditing(true))} style={s.outline}>
            <Text style={{ color: O, fontSize: 12, fontWeight: '800' }}>✎ {editing ? 'Save' : 'Admin edit'}</Text>
          </Pressable>
        )}
      </View>
      {!links ? <ActivityIndicator color={O} /> : links.map((l, i) => editing ? (
        <Field key={l.id} label={l.label} value={l.url} autoCapitalize="none" placeholder="https://" onChangeText={(v) => setLinks(links.map((x, j) => (j === i ? { ...x, url: v } : x)))} />
      ) : l.url ? (
        <Pressable key={l.id} accessibilityLabel={l.label} onPress={() => open(l.url)} style={[u.card, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }]}>
          <View style={s.av}><Text style={{ color: O, fontWeight: '900' }}>{l.label.charAt(0)}</Text></View>
          <View style={{ flex: 1 }}><Text style={u.rowT}>{l.label}</Text><Text numberOfLines={1} style={u.hint}>{l.url}</Text></View>
          <Icon name="link" size={16} color={O} />
        </Pressable>
      ) : null)}
    </Page>
  );
}

export function ProfileMenuPage({ kind, onBack, onNavigate }: { kind: MenuSheet; onBack: () => void; onNavigate: (k: MenuSheet) => void }) {
  const ref = useRef(kind); ref.current = kind;
  switch (kind) {
    case 'analytics': return <Analytics onBack={onBack} />;
    case 'vip': return <VipPage onBack={onBack} />;
    case 'settings': return <SettingsPage onBack={onBack} onHelp={() => onNavigate('help')} />;
    case 'help': return <HelpPage onBack={onBack} />;
    case 'about': return <AboutPage onBack={onBack} />;
    case 'share': return <SharePage onBack={onBack} />;
    case 'rank': return <RankPage onBack={onBack} />;
    case 'follow': return <FollowPage onBack={onBack} />;
  }
}

const s = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '48%', gap: 4, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F' },
  cardV: { color: '#fff', fontSize: 20, fontWeight: '800' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 8 },
  rank: { color: O, fontWeight: '800', width: 18, textAlign: 'center' },
  thumb: { width: 36, height: 48, borderRadius: 6, backgroundColor: '#111' },
  vipCard: { borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)', backgroundColor: '#1E1500', padding: 20 },
  vipIco: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#FFC400', alignItems: 'center', justifyContent: 'center' },
  vipT: { color: '#fff', fontSize: 20, fontWeight: '800' },
  gold: { color: '#FFD700', fontSize: 12, fontWeight: '700' },
  price: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 18 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8 },
  perkI: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,165,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  member: { marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)', backgroundColor: 'rgba(255,215,0,0.1)', padding: 16, alignItems: 'center', gap: 4 },
  av: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,165,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1, borderColor: O, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  link: { color: O, fontSize: 12, fontWeight: '700' },
  faq: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F', gap: 8 },
  faqA: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 18, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingTop: 10 },
  bubble: { maxWidth: '80%', padding: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 },
  qr: { marginTop: 16, backgroundColor: '#fff', padding: 16, borderRadius: 16, minWidth: 180, minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  copy: { padding: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.08)' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8 },
  medal: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  vipB: { color: '#FFD700', fontSize: 10, fontWeight: '800' },
});
