import { CrashNotice } from './modules/gpupixel-camera/CrashNotice';
import { setStage } from './src/components/CrashGuard';
import { DialogHost } from './src/components/DialogHost';
import { Splash } from './src/components/Splash';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { setInboxNavigator } from './src/lib/inboxNav';
import { startUnread } from './src/lib/unread';
import { setLiveNavigator, startPresence } from './src/lib/presence';
import { LiveRoomView } from './src/features/live/LiveRoom';
import { IncomingGameInvites } from './src/features/games/LiveGame';
import type { LiveRoom } from './src/lib/api';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { FeedScreen } from './src/features/feed/FeedScreen';
import { LiveScreen } from './src/features/live/LiveScreen';
import { NotesScreen } from './src/features/notes/NotesScreen';
import { PostFlowScreen } from './src/features/post/PostFlowScreen';
import { usePosts } from './src/features/post/usePosts';
import { ProfileScreen } from './src/features/profile/ProfileScreen';
import { colors } from './src/theme';
import { InboxScreen } from './src/features/inbox/InboxScreen';
import { WalletScreen } from './src/features/wallet/WalletScreen';
import { PartnerScreen } from './src/features/partner/PartnerScreen';
import { ProfileMenuPage, type MenuSheet } from './src/features/profile/ProfileMenuSheets';
import { GroupsScreen } from './src/features/social/GroupsScreen';
import { MarketScreen } from './src/features/social/MarketScreen';
import { UserProfileScreen } from './src/features/profile/UserProfileScreen';
import { AuthScreen, useSession } from './src/features/auth/AuthScreen';
import { GUEST_PROMPT, requireSignIn, setGuest, setSignInPrompt, useIsGuest, wantSignUp } from './src/lib/guest';
import { showConfirm } from './src/components/DialogHost';
import { usernameFromUrl } from './src/lib/username';
import { findUser } from './src/lib/api';
import { SoundScreen, stopSoundPreview, type PickedSound } from './src/features/sound/SoundScreen';
import type { Post } from './src/lib/api';
import { DownloadOverlay } from './src/lib/download';
import { GiftFxHost } from './src/features/gifts/GiftFxHost';
import { initMediaCache } from './src/lib/offline';
import { invalidate } from './src/lib/swr';

// Cache limit must be applied before the first video player exists.
initMediaCache();
import { BottomNav, type Tab } from './src/components/BottomNav';
import { useKeyboardHeight } from './src/components/KeyboardInset';
import { Icon, type IconName } from './src/components/Icons';
import type { PostMode } from './src/features/post/PostFlowScreen';
import { CreateCamera, type CapturedMedia } from './src/features/post/CreateCamera';
import type { DuetSource } from './src/features/duet/DuetLayer';

function Toast({ label, onDone }: { label: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, [onDone]);
  return <View style={s.progress}><Text style={s.progressT}>{label}</Text></View>;
}

function Main({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('home');
  const [notesOpen, setNotesOpen] = useState(false);
  const [sub, setSub] = useState<null | 'wallet' | 'groups' | 'market' | 'auth' | MenuSheet>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [feedKey, setFeedKey] = useState(0);
  const [viewUser, setViewUser] = useState<string | null>(null);
  const [chatPeer, setChatPeer] = useState<{ id: string; username: string | null; display_name: string | null } | null>(null);
  const [sound, setSound] = useState<Post | null>(null);
  const [useSound, setUseSound] = useState<PickedSound | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [duetSrc, setDuetSrc] = useState<DuetSource | null>(null);
  const startDuet = (p: Post) => {
    if (p.kind !== 'video' || !p.media_urls[0]) return;
    stopSoundPreview(); setSound(null); setUseSound(null);
    setDuetSrc({ postId: p.id, url: p.media_urls[0], username: p.author?.username ?? 'user', soundId: p.sound_id ?? p.edit?.soundId ?? null });
    setCreateOpen(true);
  };
  const [postMode, setPostMode] = useState<PostMode>('upload');
  const [captured, setCaptured] = useState<CapturedMedia | null>(null);
  const [postKey, setPostKey] = useState(0);
  const [liveCreate, setLiveCreate] = useState(0);
  const [liveFull, setLiveFull] = useState(false);
  const [chatDraft, setChatDraft] = useState<string | undefined>(undefined);
  const [chatReturn, setChatReturn] = useState<{ tab: Tab; sub: typeof sub } | null>(null);
  const kbOpen = useKeyboardHeight() > 0;
  const posts = usePosts();
  const session = useSession();
  const [liveRoom, setLiveRoom] = useState<LiveRoom | null>(null);
  // Chapa sends the buyer back to /?wallet=chapa: open the Wallet so the payment is verified and the balance refreshed.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('wallet') === 'chapa') setSub('wallet');
  }, []);
  useEffect(() => startPresence(userId), [userId]);
  useEffect(() => startUnread(userId), [userId]);
  // https://beetook.com/abebe (or /@abebe) opens that profile.
  useEffect(() => {
    const open = (url: string | null) => {
      const name = usernameFromUrl(url);
      if (name) findUser(name).then((p) => { if (p) { setSub(null); setSound(null); setViewUser(p.id); } }).catch(() => undefined);
    };
    void Linking.getInitialURL().then(open);
    const l = Linking.addEventListener('url', (e) => open(e.url));
    return () => l.remove();
  }, []);
  useEffect(() => setLiveNavigator(setLiveRoom), []);
  useEffect(() => setInboxNavigator((peer, draft) => {
    setChatReturn({ tab, sub }); setViewUser(null); setSound(null); setSub(null); setNotesOpen(false);
    setChatDraft(draft); setChatPeer(peer); setTab('inbox');
  }), [tab, sub]);
  const closeChat = () => {
    setChatPeer(null); setChatDraft(undefined);
    if (chatReturn) { setTab(chatReturn.tab); setSub(chatReturn.sub); setChatReturn(null); }
  };

  let body;
  const back = () => setSub(null);
  if (liveRoom) body = <LiveRoomView room={liveRoom} onClose={() => setLiveRoom(null)} />;
  else if (sound) body = <SoundScreen post={sound} onBack={() => setSound(null)} onUser={(id) => { setSound(null); setViewUser(id); }} onUse={(x) => { setUseSound(x); setSound(null); setCreateOpen(true); }} onDuet={startDuet} />;
  else if (viewUser) body = <UserProfileScreen userId={viewUser} onBack={() => setViewUser(null)} onUser={setViewUser} onMessage={(peer) => { setViewUser(null); setSound(null); setSub(null); setChatPeer(peer); setTab('inbox'); }} />;
  else if (sub === 'wallet') body = <WalletScreen onBack={back} />;
  else if (sub === 'groups') body = <GroupsScreen onBack={back} />;
  else if (sub === 'market') body = <MarketScreen onBack={back} />;
  else if (sub === 'auth') body = <AuthScreen onBack={back} session={session} />;
  else if (sub === 'partners') body = <PartnerScreen onBack={back} onUser={(id) => { setSub(null); setViewUser(id); }} />;
  else if (sub) body = <ProfileMenuPage kind={sub} onBack={back} onNavigate={setSub} />;
  else if (notesOpen) body = <NotesScreen onBack={() => setNotesOpen(false)} />;
  else if (tab === 'home') body = <FeedScreen key={feedKey} visible={!createOpen} onUser={setViewUser} onSound={setSound} onDuet={startDuet} />;
  else if (tab === 'live') body = <LiveScreen key={liveCreate} autoCreate={liveCreate > 0} onFull={setLiveFull} />;
  else if (tab === 'post') body = (
    <PostFlowScreen key={`${postMode}-${postKey}`} mode={postMode} initial={captured ?? undefined} drafts={posts.drafts} onPost={posts.publish} onDraft={posts.saveDraft} onDeleteDraft={posts.deleteDraft}
      onRetake={() => { setCaptured(null); setTab('home'); setCreateOpen(true); }}
      onClose={(msg) => { setCaptured(null); setTab('home'); if (msg) { invalidate('feed:'); setToast(msg); setFeedKey((k) => k + 1); } }} />
  );
  else if (tab === 'inbox') body = <InboxScreen key={chatPeer?.id ?? 'inbox'} onUser={setViewUser} initialPeer={chatPeer} initialDraft={chatDraft} onPeerClosed={closeChat} />;
  else body = <ProfileScreen key={userId} onOpenNotes={() => setNotesOpen(true)} onOpen={setSub} />;

  return (
    <>
      <View style={s.body}>
        {body}
        {toast && <Toast label={toast} onDone={() => setToast(null)} />}
        <DownloadOverlay />
        <IncomingGameInvites userId={userId || null} />
        <GiftFxHost />
      </View>
      {!kbOpen && !liveRoom && !notesOpen && !sub && !viewUser && !sound && !(tab === 'live' && liveFull) && (
        <BottomNav tab={tab} onTab={(t) => { if (t === 'post') { setDuetSrc(null); setCaptured(null); return setCreateOpen(true); } if (t === 'live') setLiveCreate(0); setCaptured(null); setChatReturn(null); setTab(t); }} />
      )}
      {createOpen && (
        <CreateCamera key={duetSrc?.postId ?? 'cam'} sound={useSound} onClearSound={() => setUseSound(null)} duet={duetSrc} onClearDuet={() => setDuetSrc(null)}
          onClose={() => { setCreateOpen(false); setUseSound(null); setDuetSrc(null); }}
          onLive={() => { setCreateOpen(false); setLiveCreate((k) => k + 1); setTab('live'); }}
          onMedia={(m) => { setCreateOpen(false); setUseSound(null); setDuetSrc(null); setCaptured(m); setPostMode(m.kind === 'photos' ? 'photo' : 'upload'); setPostKey((k) => k + 1); setTab('post'); }} />
      )}
    </>
  );
}

/** Guest: local browsing only (no session, no database rows). Feed, live covers, group list and market list. */
function GuestMain() {
  const [tab, setTab] = useState<Tab>('home');
  const lock = () => { requireSignIn('action'); };
  const body = tab === 'live' ? <LiveScreen /> : tab === 'inbox' ? <InboxScreen /> : <FeedScreen visible onUser={lock} onSound={lock} onDuet={lock} />;
  return (
    <>
      <View style={s.body}>{body}</View>
      <BottomNav tab={tab} onTab={(t) => { if (t === 'post' || t === 'profile') { requireSignIn('tab'); return; } setTab(t); }} />
    </>
  );
}

export default function App() {
  const [splash, setSplash] = useState(true);
  const session = useSession();
  const guest = useIsGuest();
  const done = useCallback(() => setSplash(false), []);
  useEffect(() => { if (session.session) setGuest(false); }, [session.session]);
  useEffect(() => {
    let asking = false;
    setSignInPrompt(() => {
      if (asking) return;
      asking = true;
      void showConfirm({ title: GUEST_PROMPT.title, message: GUEST_PROMPT.message, ok: GUEST_PROMPT.confirm, cancel: GUEST_PROMPT.cancel })
        .then((ok) => { if (ok) { wantSignUp(); setGuest(false); } })
        .finally(() => { asking = false; });
    });
    return () => setSignInPrompt(null);
  }, []);
  useEffect(() => { setStage(splash ? 'splash' : session.loading ? 'getSession…' : 'ready'); }, [splash, session.loading]);

  if (splash) return <View style={s.full}><StatusBar style="light" /><Splash onDone={done} /></View>;
  if (session.loading) {
    return (
      <View style={[s.root, s.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: '#fff', marginTop: 12 }}>Loading session…</Text>
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {session.session ? <Main key={session.session.user.id} userId={session.session.user.id} /> : guest ? <GuestMain /> : <AuthScreen session={session} onGuest={() => setGuest(true)} />}
        </KeyboardAvoidingView>
        <DialogHost />
        <CrashNotice />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  full: { flex: 1, width: '100%', backgroundColor: '#000' },
  root: { flex: 1, backgroundColor: colors.background, width: '100%', maxWidth: 430, alignSelf: 'center' },
  body: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  brand: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border },
  sheetBg: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#0A0A0B', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 24, paddingBottom: 40, gap: 12 },
  grab: { position: 'absolute', top: 12, alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  sheetH: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 8 },
  sheetS: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16 },
  sheetIc: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFA500', alignItems: 'center', justifyContent: 'center' },
  sheetT: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sheetD: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { color: colors.mutedForeground, fontWeight: '700' },
  plus: { fontSize: 20, color: '#fff' },
  progress: { position: 'absolute', top: 50, right: 12, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  progressT: { color: '#fff', fontWeight: '800', fontSize: 12 },
});
