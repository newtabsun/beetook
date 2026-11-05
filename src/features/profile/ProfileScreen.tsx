import { friendlyError } from '../../lib/errors';
import { VipAvatar, VipBadge, refreshVip, useIsVip } from '../../components/Vip';
import { notify } from '../../lib/notify';
// Profile — mirrors app/frontend/src/pages/Profile.tsx, backed by Supabase profile/posts data.
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from '../../components/CachedImage';
import { SocialIcon } from '../../components/SocialIcon';
import { Icon, type IconName } from '../../components/Icons';
import { onPostDeleted, PHOTO_MAX, fetchMyTab, fetchMyProfile, fetchReactedPosts, formatNum, setUsername as saveUsername, subscribeTables, updateProfile, uploadMedia, type Post, type Profile } from '../../lib/api';
import { handleHtml, normalizeUsername, usernameError, usernameErrorFromServer } from '../../lib/username';
import { colors } from '../../theme';
import { getWallet } from '../../lib/api';
import { supabase, T } from '../../lib/supabase';
import { needsRefresh, peek, put } from '../../lib/swr';
import { activeBoosts, fetchMyBoosts, type BoostProgress } from '../../lib/boost';

const PROFILE_KEY = 'me:profile';
const TAB_KEY = 'me:tab:';
/** Counts also arrive through Realtime; this only bounds how old a silently dropped update can get. */
const PROFILE_TTL = 5 * 60_000;
const POSTS_TTL = 5 * 60_000;
import { APP_VERSION, type MenuSheet } from './ProfileMenuSheets';
import { NoticeCard } from './NoticeCard';
import { SlideScreen } from '../../components/SlideScreen';
import { MarqueeRich, RichTextInput, RichTextView, richToPlain } from '../../components/RichText';
import { PublicId } from '../../components/PublicId';
import { PartnerBadge } from '../partner/PartnerBadge';
import { partnerOverview } from '../../lib/partner';
import { VideoGrid, useGridPaging } from '../../components/VideoGrid';
import { FullscreenPlayer } from '../feed/FullscreenPlayer';
import { linkHref, readStyle, telHref, writeStyle, type ActionButton, type ProfileStyle } from '../../lib/profileStyle';

export function ActionButtons({ buttons, onEmpty }: { buttons: ActionButton[]; onEmpty?: () => void }) {
  return (
    <View style={s.actions}>
      {buttons.map((b) => {
        const phone = b.type === 'phone';
        const has = !!b.value.trim();
        return (
          <Pressable key={b.id} accessibilityLabel={richToPlain(b.title) || (phone ? 'Phone' : 'Link')} style={[s.action, !has && { opacity: 0.5 }]}
            onPress={() => (has ? void Linking.openURL(phone ? telHref(b.value) : linkHref(b.value)).catch(() => notify('Could not open link')) : onEmpty?.())}>
            <Icon name={phone ? 'phone' as IconName : 'link'} size={16} color={O} />
            {richToPlain(b.title) ? <RichTextView html={b.title} style={s.actionT} numberOfLines={1} /> : <Text style={s.actionT}>{phone ? 'Phone' : 'Link'}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProfileBio({ st }: { st: ProfileStyle }) {
  if (!richToPlain(st.bioHtml)) return null;
  return st.bioMarquee
    ? <View style={{ marginTop: 16 }}><MarqueeRich html={st.bioHtml} style={s.bioM} /></View>
    : <RichTextView html={st.bioHtml} style={s.bio} />;
}

type PTab = 'videos' | 'private' | 'saved' | 'liked';
type Dest = 'wallet' | 'groups' | 'market' | 'auth' | MenuSheet;
const O = '#FFA500';
const PTABS: [PTab, string, IconName][] = [['videos', 'Videos', 'grid'], ['private', 'Private', 'lock'], ['saved', 'Saved', 'bookmark'], ['liked', 'Liked', 'heart']];
const EMPTY: Record<PTab, [string, string]> = {
  videos: ['No videos yet', 'Videos you post appear here.'],
  private: ['Private videos', 'Only you can see videos you mark as private.'],
  saved: ['Saved videos', 'Videos you save from the feed appear here — private to you.'],
  liked: ['Liked videos', 'Videos you like appear here — private to you.'],
};
const SOCIALS = [
  { id: 'telegram', label: 'Telegram' }, { id: 'tiktok', label: 'TikTok' }, { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' }, { id: 'instagram', label: 'Instagram' }, { id: 'x', label: 'X' },
] as const;

const initials = (n: string) => {
  const parts = n.split(/[\s_.-]+/).filter(Boolean);
  if (!parts.length) return 'BT';
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[1][0]).toUpperCase();
};

export function ProfileScreen({ onOpenNotes, onOpen }: { onOpenNotes: () => void; onOpen: (id: Dest) => void }) {
  const [p, setP] = useState<Profile | null>(() => peek<Profile>(PROFILE_KEY) ?? null);
  const vip = useIsVip(p?.id);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [plevel, setPlevel] = useState<number | null>(null);
  useEffect(() => { partnerOverview().then((o) => setPlevel(o.level)).catch(() => undefined); }, []);
  const [coins, setCoins] = useState<number | null>(null);
  useEffect(() => { if (menu) getWallet().then(setCoins).catch(() => setCoins(null)); }, [menu]);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [ds, setDs] = useState<ProfileStyle | null>(null);
  const [busy, setBusy] = useState(false);
  const [usernameErr, setUsernameErr] = useState('');
  const [tab, setTab] = useState<PTab>('videos');
  const [posts, setPosts] = useState<Post[] | null>(() => peek<Post[]>(`${TAB_KEY}videos`) ?? null);
  useEffect(() => onPostDeleted((id) => setPosts((l) => (l ? l.filter((x) => x.id !== id) : l))), []);
  const [playAt, setPlayAt] = useState<number | null>(null);
  const [tabErr, setTabErr] = useState('');
  const [reload, setReload] = useState(0);
  const paging = useGridPaging(posts?.length ?? 0);
  // Running boosts of this account: the grid overlays progress until a goal is reached (server decides when).
  const [boosts, setBoosts] = useState<Record<string, BoostProgress>>({});
  useEffect(() => {
    if (!p?.id) return undefined;
    let alive = true;
    const load = () => { void fetchMyBoosts().then((r) => { if (alive) setBoosts(activeBoosts(r)); }); };
    load();
    // Realtime pushes campaign changes of this owner only (RLS); a short debounce merges bursts of viewers.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeTables(`boost-${p.id}`, [{ table: T.boostCampaigns, filter: `owner_id=eq.${p.id}` }], () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 800);
    });
    const poll = setInterval(load, 60_000); // safety net if a realtime message is dropped
    return () => { alive = false; off(); clearInterval(poll); if (timer) clearTimeout(timer); };
  }, [p?.id, reload]);

  // Returning to the tab shows the cached profile/grid at once; the server is asked again only when the
  // data is old, was changed by this app, or (profile counts) Realtime pushed a change.
  useEffect(() => {
    if (!needsRefresh(PROFILE_KEY, PROFILE_TTL)) return;
    fetchMyProfile().then((x) => { setP(x); if (x) put(PROFILE_KEY, x); })
      .catch((e: Error) => { if (!peek(PROFILE_KEY)) setErr(friendlyError(e)); });
  }, []);
  useEffect(() => (p?.id ? subscribeTables(`me-${p.id}`, [{ table: T.profiles, filter: `id=eq.${p.id}` }], (row) => {
    setP((x) => { if (!x) return x; const n = { ...x, ...(row as Partial<Profile>) }; put(PROFILE_KEY, n); return n; });
  }) : undefined), [p?.id]);
  const lastReload = useRef(reload);
  useEffect(() => {
    const key = `${TAB_KEY}${tab}`;
    const cached = peek<Post[]>(key);
    const forced = lastReload.current !== reload;
    lastReload.current = reload;
    setTabErr('');
    setPosts(cached ?? null);
    if (cached && !forced && !needsRefresh(key, POSTS_TTL)) return;
    let alive = true;
    const q = tab === 'videos' || tab === 'private' ? fetchMyTab(tab) : fetchReactedPosts(tab === 'liked' ? 'like' : 'save');
    q.then((r) => { if (alive) { setPosts(r); put(key, r); } })
      .catch((e: Error) => { if (alive && !cached) { setTabErr(friendlyError(e)); setPosts([]); } });
    return () => { alive = false; };
  }, [tab, reload]);
  useEffect(() => { refreshVip(p?.id); }, [p?.id]);

  const pickAvatar = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (r.canceled) return;
    setBusy(true);
    try { const url = await uploadMedia(r.assets[0].uri, 'photo', PHOTO_MAX.avatar); setDraft((d) => d && { ...d, avatar_url: url }); }
    catch (e) { notify('Error', friendlyError(e)); }
    setBusy(false);
  };
  const save = async () => {
    if (!draft || !ds) return;
    // The handle is normalised (leading `@`, case, spaces) then validated here and again on the server.
    const username = normalizeUsername(richToPlain(ds.usernameHtml));
    const problem = usernameError(username);
    if (problem) { setUsernameErr(problem); return; }
    setUsernameErr('');
    const displayName = richToPlain(ds.nameHtml);
    const st: ProfileStyle = {
      ...ds,
      nameHtml: displayName ? ds.nameHtml : '',
      usernameHtml: handleHtml(ds.usernameHtml, username),
      actionButtons: ds.actionButtons.map((b) => ({ ...b, title: richToPlain(b.title) ? b.title : '', value: b.value.trim() })),
    };
    setBusy(true);
    try {
      const patch = { display_name: displayName || null, bio: richToPlain(ds.bioHtml).slice(0, 300), links: writeStyle(draft.links ?? {}, st), avatar_url: draft.avatar_url };
      const saved = username !== (draft.username ?? '') ? await saveUsername(username) : (draft.username ?? username);
      await updateProfile(patch);
      const merged = { ...draft, ...patch, username: saved };
      setP(merged); put(PROFILE_KEY, merged); setDs({ ...st, usernameHtml: handleHtml(st.usernameHtml, saved) }); setEditing(false);
    } catch (e) {
      // USERNAME_* answers get the tailored copy; anything else (offline, storage, …) is not a username problem.
      const raw = (e as Error).message ?? '';
      setUsernameErr(/USERNAME_/.test(raw) ? usernameErrorFromServer(raw) : friendlyError(e));
    }
    setBusy(false);
  };
  const openEdit = () => { if (p) { setDraft({ ...p, links: { ...(p.links ?? {}) } }); setDs(readStyle(p)); setEditing(true); } };
  const st = p ? readStyle(p) : null;
  const upBtn = (i: number, patch: Partial<ActionButton>) => setDs((d) => d && { ...d, actionButtons: d.actionButtons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const go = (fn: () => void) => { setMenu(false); fn(); };

  const name = p ? p.display_name || p.username || '' : '';
  const stats = p ? [['Following', p.following_count], ['Followers', p.followers_count], ['Likes', p.likes_count], ['Views', p.views_count]] as const : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={s.content} onScroll={paging.onScroll} scrollEventThrottle={200}>
        <View style={s.bar}>
          <Pressable accessibilityLabel="Edit profile" style={s.hBtn} onPress={openEdit}><Icon name="pencil" size={16} color={O} /></Pressable>
          {st ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}><RichTextView html={st.nameHtml || name} style={s.barT} numberOfLines={1} />{vip && <VipBadge />}</View> : <Text style={s.barT}>Profile</Text>}
          <Pressable accessibilityLabel="Menu" style={s.hBtn} onPress={() => setMenu(true)}><Icon name="menu" size={16} color={O} /></Pressable>
        </View>
        {!p && !err && <ActivityIndicator color={O} />}
        <NoticeCard />
        {!!err && <Text style={{ color: '#E53935', textAlign: 'center' }}>{err}</Text>}
        {p && st && (
          <>
            <View style={{ alignItems: 'center' }}>
              <VipAvatar userId={p.id} uri={p.avatar_url} name={initials(name)} size={96} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={s.name}>@<RichTextView html={st.usernameHtml} style={s.name} /></Text></View>
              <PublicId p={p} />
              {plevel !== null && <View style={{ marginTop: 6 }}><PartnerBadge level={plevel} scale={1.1} /></View>}
              <View style={s.stats}>
                {stats.map(([l, n], i) => (
                  <View key={l} style={[s.stat, i > 0 && s.statDiv]}><Text style={s.statN}>{formatNum(n ?? 0)}</Text><Text style={s.statL}>{l}</Text></View>
                ))}
              </View>
            </View>
            <ActionButtons buttons={st.actionButtons} onEmpty={openEdit} />
            <ProfileBio st={st} />
            <View style={s.tabs}>
              {PTABS.map(([id, l, ic]) => {
                const on = tab === id;
                return (
                  <Pressable key={id} accessibilityLabel={l} onPress={() => (id === tab ? setReload((n) => n + 1) : setTab(id))} style={s.tab}>
                    <Icon name={ic} size={20} color={on ? O : 'rgba(255,255,255,0.4)'} />
                    <Text style={[s.tabT, on && { color: O }]}>{l}</Text>
                    {on && <View style={s.tabLine} />}
                  </Pressable>
                );
              })}
            </View>
            {posts === null ? <ActivityIndicator color={O} style={{ marginTop: 24 }} /> : posts.length === 0 ? (
              <View style={s.empty}>
                <View style={s.emptyI}><Icon name={PTABS.find((t) => t[0] === tab)![2]} size={28} color="rgba(255,255,255,0.4)" /></View>
                <Text style={s.emptyH}>{EMPTY[tab][0]}</Text>
                <Text style={s.emptyS}>{tabErr || EMPTY[tab][1]}</Text>
                {!!tabErr && <Pressable onPress={() => setReload((n) => n + 1)}><Text style={{ color: O, fontWeight: '700' }}>Retry</Text></Pressable>}
              </View>
            ) : (
              <VideoGrid posts={posts} onOpen={setPlayAt} showPinned limit={paging.limit} boosts={boosts} />
            )}
          </>
        )}
      </ScrollView>
      {playAt !== null && posts && posts.length > 0 && (
        <FullscreenPlayer posts={posts} index={playAt} onClose={() => setPlayAt(null)}
          onRemoved={(id) => setPosts((l) => { const n = l && l.filter((x) => x.id !== id); if (n) put(`${TAB_KEY}${tab}`, n); return n; })} />
      )}

      {menu && (
        <SlideScreen>
          <View style={{ flex: 1, paddingTop: 40, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Pressable accessibilityLabel="Close menu" hitSlop={10} onPress={() => setMenu(false)}><Icon name="back" size={24} color="#fff" /></Pressable>
              <Text style={[s.rowT, { fontSize: 18, fontWeight: '800' }]}>Menu</Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 40 }}>
            {([
              ['wallet', 'Wallet', coins === null ? 'Coins & history' : `${formatNum(coins)} coins`, () => onOpen('wallet')],
              ['trending', 'Analytics', 'Views, followers & top videos', () => onOpen('analytics')],
              ['users', 'My partners', 'Invite by ID & earn commission', () => onOpen('partners')],
              ['store', 'Marketplace', 'Sell and buy safely with escrow', () => onOpen('market')],
              ['crown', 'VIP', '12,500 coins / month', () => onOpen('vip')],
              ['settings', 'Settings & privacy', '', () => onOpen('settings')],
              ['shield', 'Help & support', '', () => onOpen('help')],
              ['sparkles', 'About Bee Took', `v${APP_VERSION}`, () => onOpen('about')],
              ['share', 'Share profile', 'QR code & link', () => onOpen('share')],
              ['trophy', 'Rank', 'Top users leaderboard', () => onOpen('rank')],
              ['note', 'Your note', 'Write and save personal notes', onOpenNotes],
              ['globe', 'Follow us', 'Our social media', () => onOpen('follow')],
              ['logout', 'Log out', '', () => void supabase.auth.signOut()],
] as [IconName, string, string, () => void][]).map(([ic, l, h, fn]) => (
              <Pressable key={l} accessibilityLabel={l} style={[s.row, l === 'Log out' && s.danger]} onPress={() => go(fn)}>
                <Icon name={ic} size={20} color={l === 'Log out' ? '#FF3B30' : O} />
                <View style={{ flex: 1 }}><Text style={[s.rowT, l === 'Log out' && { color: '#FF3B30' }]}>{l}</Text>{!!h && <Text style={s.rowH}>{h}</Text>}</View>
              </Pressable>
            ))}
            </ScrollView>
          </View>
        </SlideScreen>
      )}

      {editing && draft && ds && (
        <View style={s.sheetBg}>
          <View style={[s.sheet, { maxHeight: '88%' }]}>
            <View style={s.grab} />
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              <Text style={[s.rowT, { fontSize: 15, fontWeight: '800' }]}>Edit profile</Text>
              <Text style={s.help}>Update your photo, name and username, then customize the 3 buttons on your profile.</Text>
              <Section t="1 · Profile photo" />
              <View style={[s.box, { alignItems: 'center', gap: 8 }]}>
                <View style={[s.avatar, { width: 112, height: 112, borderRadius: 56 }]}>{draft.avatar_url ? <Image source={{ uri: draft.avatar_url }} style={StyleSheet.absoluteFill} /> : <Text style={s.avT}>{initials(richToPlain(ds.nameHtml) || draft.username || '')}</Text>}</View>
                <Text style={s.rowH}>Live preview</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                  <Pressable style={[s.primary, { flex: 1 }]} disabled={busy} onPress={() => void pickAvatar()}><Icon name="camera" size={16} color="#000" /><Text style={s.primaryT}>{busy ? 'Loading…' : 'Choose from gallery'}</Text></Pressable>
                  {!!draft.avatar_url && <Pressable accessibilityLabel="Remove photo" style={s.outline} onPress={() => setDraft({ ...draft, avatar_url: null })}><Icon name={'trash' as IconName} size={16} color="rgba(255,255,255,0.7)" /></Pressable>}
                </View>
              </View>
              <Section t="2 · Name and username" />
              <Text style={s.lbl}>Name</Text>
              <RichTextInput label="Name" value={ds.nameHtml} onChange={(h) => setDs({ ...ds, nameHtml: h })} placeholder="Your display name" />
              <Text style={s.lbl}>Username (@)</Text>
              <RichTextInput label="Username" value={ds.usernameHtml} onChange={(h) => { setUsernameErr(''); setDs({ ...ds, usernameHtml: h.replace(/^\s*@+/, '') }); }} placeholder="abebe" />
              <Text style={s.help}>እንግሊዝኛ ፊደል (a–z)፣ ቁጥር፣ _ እና . ብቻ · 3–24 ፊደል · @ በራስ-ሰር ይጨመራል</Text>
              {!!usernameErr && <Text style={{ color: '#F87171', fontSize: 12 }}>{usernameErr}</Text>}
              <Text style={s.lbl}>Bio</Text>
              <RichTextInput label="Bio" multiline value={ds.bioHtml} onChange={(h) => setDs({ ...ds, bioHtml: h })} placeholder="Tell people about yourself" />
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: ds.bioMarquee }} style={[s.box, { flexDirection: 'row', alignItems: 'center' }]} onPress={() => setDs({ ...ds, bioMarquee: !ds.bioMarquee })}>
                <View style={{ flex: 1 }}><Text style={[s.rowT, { fontSize: 12 }]}>Scrolling bio</Text><Text style={s.rowH}>Bio moves right → left for everyone</Text></View>
                <View style={[s.sw, ds.bioMarquee && { backgroundColor: O }]}><View style={[s.knob, ds.bioMarquee && { transform: [{ translateX: 20 }] }]} /></View>
              </Pressable>
              <Section t="3 · Action buttons" />
              <Text style={s.help}>Phone buttons open the dialer, link buttons open the web page.</Text>
              {ds.actionButtons.map((b, i) => (
                <View key={b.id} style={[s.box, { gap: 6 }]}>
                  <Text style={s.lbl}>{`Button ${i + 1} title`}</Text>
                  <RichTextInput label={`Button ${i + 1} title`} value={b.title} onChange={(h) => upBtn(i, { title: h })} placeholder={i === 0 ? 'Phone' : 'Link'} />
                  <Text style={s.lbl}>{b.type === 'phone' ? `Button ${i + 1} phone number` : `Button ${i + 1} web link`}</Text>
                  <TextInput style={s.input} value={b.value} autoCapitalize="none" keyboardType={b.type === 'phone' ? 'phone-pad' : 'url'}
                    placeholder={b.type === 'phone' ? '0911223344' : 'https://t.me/yourname'} placeholderTextColor="rgba(255,255,255,0.35)" onChangeText={(v) => upBtn(i, { value: v })} />
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable style={[s.outline, { flex: 1 }]} onPress={() => setEditing(false)}><Text style={s.actionT}>Cancel</Text></Pressable>
              <Pressable style={[s.primary, { flex: 1 }]} disabled={busy} onPress={() => void save()}>{busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryT}>Save changes</Text>}</Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function Section({ t }: { t: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}><Text style={{ color: O, fontSize: 13, fontWeight: '800' }}>{t}</Text><View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} /></View>;
}

const s = StyleSheet.create({
  help: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 18 },
  lbl: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  box: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)', padding: 12 },
  sw: { width: 44, height: 24, borderRadius: 12, padding: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  bioM: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 20 },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  barT: { color: '#fff', fontWeight: '800', fontSize: 18 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#0A0A0B', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avT: { color: O, fontSize: 30, fontWeight: '800' },
  name: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  handle: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  stats: { flexDirection: 'row', marginTop: 16, width: '100%', maxWidth: 384 },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statDiv: { borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  statN: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statL: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 20 },
  action: { flex: 1, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,165,0,0.7)' },
  actionT: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bio: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 16 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginTop: 24 },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10 },
  tabT: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700' },
  tabLine: { position: 'absolute', bottom: 0, width: 40, height: 2, borderRadius: 1, backgroundColor: O },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 64 },
  emptyI: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  emptyH: { color: '#fff', fontSize: 14, fontWeight: '700' },
  emptyS: { color: 'rgba(255,255,255,0.45)', fontSize: 12, maxWidth: 240, textAlign: 'center' },
  pgrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  cell: { width: '32.4%', aspectRatio: 3 / 4, borderRadius: 8, backgroundColor: '#0D0D0F', justifyContent: 'flex-end', overflow: 'hidden' },
  cellV: { flexDirection: 'row', alignItems: 'center', gap: 3, margin: 6 },
  cellT: { color: '#fff', fontSize: 10, fontWeight: '700' },
  sheetBg: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#0A0A0B', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 20, paddingBottom: 32, gap: 8 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 8 },
  danger: { borderColor: 'rgba(255,59,48,0.3)', backgroundColor: 'rgba(255,59,48,0.1)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' },
  rowT: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rowH: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', borderRadius: 12, padding: 12 },
  primary: { flexDirection: 'row', gap: 6, backgroundColor: O, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryT: { color: '#000', fontWeight: '800' },
  outline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 12, alignItems: 'center' },
});
