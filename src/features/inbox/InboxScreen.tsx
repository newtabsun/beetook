import { isGuest, requireSignIn } from '../../lib/guest';
import { handleOf } from '../../lib/username';
import { friendlyError } from '../../lib/errors';
// Inbox: Messages + Activity tabs backed by Supabase (messages, notifications).
import { VipAvatar, VipTag } from '../../components/Vip';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  NOTES_PAGE, attachNoteActor, deleteMessageForEveryone, deleteMessageForMe, fetchConversations, fetchLiveRoomById, fetchNotificationsPage, fetchPostById, fetchThread,
  groupExists, markAllRead, mergeNotifications, myId, sendMessage, subscribeTables, whoName, whoNameHtml,
  type Conversation, type LiveRoom, type Message, type Notification, type Post,
} from '../../lib/api';
import { T } from '../../lib/supabase';
import { colors } from '../../theme';
import { Icon } from '../../components/Icons';
import { RichTextInput, RichTextView, richToPlain } from '../../components/RichText';
import { GroupsScreen } from '../social/GroupsScreen';
import { useGroupFullscreen } from '../../lib/groupFullscreen';
import { MarketScreen } from '../social/MarketScreen';
import { FullscreenPlayer } from '../feed/FullscreenPlayer';
import { useActiveInterval } from '../../lib/appActive';

import { invalidate, needsRefresh, peek, put } from '../../lib/swr';
import { Badge } from '../../components/Badge';
import { notify } from '../../lib/notify';
import {
  adjustUnread, getUnread, markLocalWrite, onNotificationInserted, queueNotificationRead, refreshUnreadSoon, setUnread, useUnread,
} from '../../lib/unread';

/** New messages arrive through Realtime; this slow poll only repairs a silently dropped subscription. */
const THREAD_FALLBACK_MS = 120_000;
/** How old cached lists may be before returning to Inbox refreshes them quietly. */
const INBOX_TTL = 120_000;
const ALERTS_TTL = 60_000;
import { LiveRoomView } from '../live/LiveRoom';

type Peer = Conversation['peer'];
type Tab = 'messages' | 'groups' | 'activity' | 'market';
type Shared = { kind: 'video' | 'live' | 'group'; id: string };
const TABS: [Tab, string][] = [['messages', 'Messages'], ['groups', 'Groups'], ['activity', 'Alerts'], ['market', 'Market']];
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const LINK = /https?:\/\/(?:www\.)?beetook\.app\/(v|live|group)\/([\w-]+)/i;
function sharedOf(body: string): Shared | null {
  const m = LINK.exec(body ?? '');
  if (!m) return null;
  return { kind: m[1].toLowerCase() === 'v' ? 'video' : (m[1].toLowerCase() as 'live' | 'group'), id: m[2] };
}
const LABEL: Record<Shared['kind'], string> = { video: 'Open video', live: 'Open live room', group: 'Open group' };
const ICON = { video: 'video', live: 'radio', group: 'users' } as const;

function Avatar({ p, size = 40 }: { p?: Peer | null; size?: number }) {
  return <VipAvatar userId={p?.id} uri={p?.avatar_url ?? null} name={whoName(p)} size={size} color={colors.primary} />;
}
function Name({ p, lines = 1 }: { p?: Peer | null; lines?: number }) {
  return <RichTextView html={whoNameHtml(p)} style={s.name} numberOfLines={lines} />;
}
function State({ loading, error, empty }: { loading: boolean; error: string; empty: string | false }) {
  if (loading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />;
  if (error) return <Text style={[s.center, { color: '#FF6B6B' }]}>{error}</Text>;
  return empty ? <Text style={s.center}>{empty}</Text> : null;
}

/** Opens shared content in its original place, or explains why it can't. */
function SharedView({ item, onClose, onUser }: { item: Shared; onClose: () => void; onUser?: (id: string) => void }) {
  const [post, setPost] = useState<Post | null>(null);
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [group, setGroup] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        if (item.kind === 'video') { const p = await fetchPostById(item.id); if (p) setPost(p); else setMsg('This video is no longer available.'); }
        else if (item.kind === 'live') { const r = await fetchLiveRoomById(item.id); if (r && r.is_live !== false) setRoom(r); else setMsg(r ? 'This live has ended.' : 'This live room no longer exists.'); }
        else if (await groupExists(item.id)) setGroup(true); else setMsg('This group no longer exists.');
      } catch (e) { setMsg(friendlyError(e)); }
    })();
  }, [item]);
  if (post) return <FullscreenPlayer posts={[post]} index={0} onClose={onClose} onRemoved={onClose} onUser={onUser} />;
  if (room) return <LiveRoomView room={room} onClose={onClose} />;
  if (group) return <GroupsScreen onBack={onClose} initialGroupId={item.id} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={s.head}><Pressable accessibilityLabel="Back" onPress={onClose} hitSlop={10}><Icon name="back" size={22} /></Pressable></View>
      {msg ? <Text style={s.center}>{msg}</Text> : <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />}
    </View>
  );
}

function Bubble({ m, mine, onOpen, onLong }: { m: Message; mine: boolean; onOpen: (x: Shared) => void; onLong: () => void }) {
  const link = sharedOf(m.body);
  const fg = mine ? '#000' : '#fff';
  return (
    <Pressable onLongPress={onLong} delayLongPress={350} onPress={link ? () => onOpen(link) : undefined} style={[s.bubble, mine ? s.me : s.them]}>
      <RichTextView html={/<[a-z][^>]*>/i.test(m.body) ? m.body : m.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')} style={{ color: fg }} />
      {link && (
        <View style={[s.card, { borderColor: mine ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.2)' }]}>
          <Icon name={ICON[link.kind]} size={16} color={fg} />
          <Text style={{ color: fg, fontWeight: '800' }}>{LABEL[link.kind]}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Thread({ peer, onBack, onUser, draft }: { peer: Peer; onBack: () => void; onUser?: (id: string) => void; draft?: string }) {
  const [msgs, setMsgs] = useState<Message[] | null>(() => peek<Message[]>(`thread:${peer.id}`) ?? null);
  const [me, setMe] = useState(() => peek<string>('me:id') ?? '');
  const [text, setText] = useState(draft ?? '');
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<Message | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  const load = useCallback(async () => {
    try { const [m, id] = await Promise.all([fetchThread(peer.id), myId()]); setMsgs(m); setMe(id); put(`thread:${peer.id}`, m); put('me:id', id); setError(''); refreshUnreadSoon(1200); }
    catch (e) { setError(friendlyError(e)); setMsgs((x) => x ?? []); }
  }, [peer.id]);
  useEffect(() => { void load(); }, [load]);
  useActiveInterval(() => void load(), THREAD_FALLBACK_MS);
  useEffect(() => subscribeTables(`dm-${peer.id}`, [{ table: T.messages }, { table: T.messageHides }], (row) => {
    const id = row?.id ?? row?.message_id;
    if (id) setMsgs((xs) => xs?.filter((x) => String(x.id) !== String(id)) ?? xs);
    void load();
  }), [peer.id, load]);
  const send = async () => {
    const body = text.trim(); if (!richToPlain(body)) return;
    setText('');
    try { await sendMessage(peer.id, body); await load(); } catch (e) { setError(friendlyError(e)); setText(body); }
  };
  const remove = async (everyone: boolean) => {
    const m = menu; setMenu(null); if (!m) return;
    const prev = msgs;
    setMsgs((xs) => xs?.filter((x) => x.id !== m.id) ?? xs);
    try { await (everyone ? deleteMessageForEveryone(m.id) : deleteMessageForMe(m.id)); }
    catch (e) { setMsgs(prev); setError(/message_hides|relation|schema cache/i.test(friendlyError(e)) ? 'Deleting needs database update 013.' : friendlyError(e)); }
  };
  if (shared) return <SharedView item={shared} onClose={() => setShared(null)} onUser={onUser} />;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={undefined}>
      <View style={s.head}>
        <Pressable accessibilityLabel="Back" onPress={onBack} hitSlop={10}><Icon name="back" size={22} /></Pressable>
        <Pressable onPress={() => onUser?.(peer.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <Avatar p={peer} />
          <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Name p={peer} /><VipTag id={peer.id} /></View>{!!peer.username && <Text style={s.muted}>{handleOf(peer.username)}</Text>}</View>
        </Pressable>
      </View>
      <State loading={msgs === null} error={error} empty={msgs?.length === 0 && 'Send a message to start the conversation.'} />
      <FlatList showsVerticalScrollIndicator={false} data={msgs ?? []} keyExtractor={(m) => String(m.id)} contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => <Bubble m={item} mine={item.sender_id === me} onOpen={setShared} onLong={() => setMenu(item)} />} />
      <View style={s.composer}>
        <View style={{ flex: 1 }}><RichTextInput label="Message" value={text} onChange={setText} placeholder="Message…" onSend={() => void send()} /></View>
      </View>
      {menu && (
        <Pressable style={s.sheetBg} onPress={() => setMenu(null)}>
          <View style={s.sheet}>
            <Pressable testID="delete-for-me" style={s.opt} onPress={() => void remove(false)}><Text style={s.optT}>Delete for me</Text></Pressable>
            {menu.sender_id === me && <Pressable testID="delete-for-everyone" style={s.opt} onPress={() => void remove(true)}><Text style={[s.optT, { color: '#FF4D5E' }]}>Delete for everyone</Text></Pressable>}
            <Pressable style={s.opt} onPress={() => setMenu(null)}><Text style={[s.optT, { color: 'rgba(255,255,255,0.6)' }]}>Cancel</Text></Pressable>
          </View>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const preview = (raw: string) => {
  const body = /<[a-z][^>]*>/i.test(raw) ? richToPlain(raw) : raw;
  const l = sharedOf(body);
  const txt = body.replace(LINK, '').trim();
  return l ? `${txt ? `${txt} · ` : ''}${l.kind === 'video' ? '🎬 Video' : l.kind === 'live' ? '🔴 Live' : '👥 Group'}` : body;
};

export function InboxScreen({ onUser, initialPeer, initialDraft, onPeerClosed }: { onUser?: (id: string) => void; initialPeer?: Peer | null; initialDraft?: string; onPeerClosed?: () => void } = {}) {
  const [tab, setTab] = useState<Tab>(() => (isGuest() ? 'groups' : 'messages'));
  const [convos, setConvos] = useState<Conversation[] | null>(() => peek<Conversation[]>('inbox:messages') ?? null);
  const [notes, setNotes] = useState<Notification[] | null>(() => peek<Notification[]>('inbox:activity') ?? null);
  const [hasMore, setHasMore] = useState(true);
  const [shared, setShared] = useState<Shared | null>(null);
  const unread = useUnread();
  const moreBusy = useRef(false);
  /** Alerts live in the swr cache (single source); state only mirrors it for rendering. `false` keeps the cache age. */
  const commitNotes = useCallback((fn: (p: Notification[]) => Notification[]) => {
    const next = fn(peek<Notification[]>('inbox:activity') ?? []);
    put('inbox:activity', next, false);
    setNotes(next);
  }, []);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Peer | null>(initialPeer ?? null);

  // Coming back to Inbox shows the cached list at once. A quiet refresh runs only when it is old
  // (messages also update through Realtime, which forces a refresh) — no spinner over known data.
  const load = useCallback(async (force = true) => {
    const key = `inbox:${tab}`;
    if (isGuest()) return;
    if (!force && !needsRefresh(key, tab === 'messages' ? INBOX_TTL : ALERTS_TTL)) return;
    try {
      if (tab === 'messages') { const c = await fetchConversations(); setConvos(c); put(key, c); }
      else {
        // First page only (25, newest first). Older pages load on scroll; rows already shown are merged by id.
        const page = await fetchNotificationsPage();
        setHasMore(page.length >= NOTES_PAGE);
        const m = mergeNotifications(peek<Notification[]>(key) ?? [], page);
        setNotes(m); put(key, m);
      }
      setError('');
    } catch (e) {
      if (!peek(key)) setError(friendlyError(e));
      if (tab === 'messages') setConvos((c) => c ?? []); else setNotes((n) => n ?? []);
    }
  }, [tab]);
  useEffect(() => { if (!open) void load(false); }, [load, open]);
  useEffect(() => (open || tab !== 'messages' ? undefined : subscribeTables('inbox', [{ table: T.messages }, { table: T.messageHides }, { table: T.profiles }], () => void load())), [open, tab, load]);
  // A new alert (from the single per-user realtime channel in lib/unread) is put at the top of the list, deduped by id.
  useEffect(() => onNotificationInserted((row) => {
    if (!peek<Notification[]>('inbox:activity')) return;
    void attachNoteActor(row).then((n) => commitNotes((p) => mergeNotifications(p, [n]))).catch(() => undefined);
  }), [commitNotes]);
  const loadMore = useCallback(async () => {
    if (moreBusy.current || !hasMore) return;
    const last = peek<Notification[]>('inbox:activity')?.at(-1);
    if (!last) return;
    moreBusy.current = true;
    try {
      const page = await fetchNotificationsPage({ created_at: last.created_at, id: last.id });
      setHasMore(page.length >= NOTES_PAGE);
      commitNotes((p) => mergeNotifications(p, page));
    } catch (e) { setError(friendlyError(e)); } finally { moreBusy.current = false; }
  }, [hasMore, commitNotes]);

  if (open) return <Thread peer={open} onBack={() => { invalidate('inbox:messages'); setOpen(null); onPeerClosed?.(); }} onUser={onUser} draft={open.id === initialPeer?.id ? initialDraft : undefined} />;
  if (shared) return <SharedView item={shared} onClose={() => setShared(null)} onUser={onUser} />;

  /** Marks one alert read at once (badge drops), batches the database write, and undoes the UI if it fails. */
  const readNote = (n: Notification) => {
    if (n.read) return;
    const counted = n.kind !== 'message'; // message alerts are not part of the alerts badge
    commitNotes((p) => p.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    if (counted) adjustUnread('alerts', -1);
    queueNotificationRead(n.id, () => {
      commitNotes((p) => p.map((x) => (x.id === n.id ? { ...x, read: false } : x)));
      if (counted) adjustUnread('alerts', 1);
    });
  };
  /** Row tap → the thing the alert is about; avatar/name tap → the person's profile. */
  const openNote = (n: Notification, via: 'row' | 'actor') => {
    readNote(n);
    const rt = (n.ref_type ?? '').toLowerCase();
    const rid = n.ref_id ?? '';
    if (via === 'row' && rid) {
      if (rt === 'post' || rt === 'video') { setShared({ kind: 'video', id: rid }); return; }
      if (rt === 'live') { setShared({ kind: 'live', id: rid }); return; }
      if (rt === 'group') { setShared({ kind: 'group', id: rid }); return; }
      if ((rt === 'user' || rt === 'profile') && onUser) { onUser(rid); return; }
    }
    if (via === 'row' && /message|dm|chat/i.test(n.kind) && n.actor) { setOpen(n.actor); return; }
    if (n.actor_id && onUser) { onUser(n.actor_id); return; }
    notify('Not available', 'This item was removed or is no longer available.');
  };
  const markAll = async () => {
    const prevNotes = peek<Notification[]>('inbox:activity');
    const prevConvos = convos;
    const prevCounts = getUnread();
    if (prevNotes) commitNotes((p) => p.map((x) => (x.read ? x : { ...x, read: true })));
    setConvos((c) => { const x = c?.map((y) => (y.unread ? { ...y, unread: 0 } : y)) ?? c; if (x) put('inbox:messages', x, false); return x; });
    setUnread({ alerts: 0, messages: 0 });
    markLocalWrite();
    try { await markAllRead(); }
    catch (e) {
      if (prevNotes) { put('inbox:activity', prevNotes, false); setNotes(prevNotes); }
      setConvos(prevConvos); setUnread(prevCounts);
      notify('Could not mark all as read', friendlyError(e));
    }
  };
  const groupFull = useGroupFullscreen();
  return (
    <View style={{ flex: 1, paddingTop: groupFull ? 0 : 12 }}>
      {!groupFull && <View style={s.top}>
        <Text style={s.h2}>In<Text style={{ color: colors.primary }}>box</Text></Text>
        <Pressable testID="mark-all-read" onPress={() => { if (requireSignIn()) void markAll(); }}><Text style={s.mark}>Mark all read</Text></Pressable>
      </View>}
      {!groupFull && <View style={s.pills}>
        {TABS.map(([t, label]) => (
          <Pressable key={t} onPress={() => { if ((t === 'messages' || t === 'activity') && !requireSignIn('tab')) return; setTab(t); }} style={[s.pill, tab === t && { backgroundColor: colors.primary }]}>
            <Text style={[s.pillT, tab === t && { color: '#000', fontWeight: '900' }]}>{label}</Text>
            {t === 'messages' && <Badge count={unread.messages} style={s.pillBadge} />}
            {t === 'activity' && <Badge count={unread.alerts} style={s.pillBadge} />}
          </Pressable>
        ))}
      </View>}
      {tab === 'groups' ? <GroupsScreen onBack={() => setTab('messages')} /> : tab === 'market' ? <MarketScreen embedded onBack={() => setTab('messages')} /> : tab === 'messages' ? (
        <>
          <State loading={convos === null} error={error} empty={convos?.length === 0 && 'No messages yet.'} />
          <FlatList showsVerticalScrollIndicator={false} data={convos ?? []} keyExtractor={(c) => c.peer.id} renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => {
              if (!requireSignIn()) return;
              if (item.unread > 0) {
                adjustUnread('messages', -item.unread); markLocalWrite();
                setConvos((c) => c?.map((y) => (y.peer.id === item.peer.id ? { ...y, unread: 0 } : y)) ?? c);
              }
              setOpen(item.peer);
            }}>
              <Avatar p={item.peer} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Name p={item.peer} /><VipTag id={item.peer.id} /></View>
                <Text style={s.muted} numberOfLines={1}>{item.last.recipient_id === item.peer.id ? 'You: ' : ''}<RichTextView html={preview(item.last.body)} style={s.muted} numberOfLines={1} /></Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={s.muted}>{ago(item.last.created_at)}</Text>
                <Badge count={item.unread} />
              </View>
            </Pressable>
          )} />
        </>
      ) : (
        <>
          <State loading={notes === null} error={error} empty={notes?.length === 0 && 'No activity yet.'} />
          <FlatList showsVerticalScrollIndicator={false} data={notes ?? []} keyExtractor={(n) => n.id}
            onEndReached={() => void loadMore()} onEndReachedThreshold={0.4} initialNumToRender={15} windowSize={7}
            ListFooterComponent={notes && notes.length > 0 && hasMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null}
            renderItem={({ item }) => (
                <Pressable accessibilityLabel={item.read ? 'Alert' : 'Unread alert'} onPress={() => openNote(item, 'row')} style={[s.row, !item.read && s.unreadRow]}>
                {item.kind === 'admin' ? (
                  <>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 15 }}>{item.text.split('\n')[0]}</Text>
                      {!!item.text.split('\n').slice(1).join('\n').trim() && <Text style={{ color: '#fff', marginTop: 4 }}>{item.text.split('\n').slice(1).join('\n')}</Text>}
                      <Text style={[s.muted, { marginTop: 4 }]}>System message</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}><Text style={s.muted}>{ago(item.created_at)}</Text>{!item.read && <View style={s.dot} />}</View>
                  </>
                ) : (<>
                <Pressable accessibilityLabel="Open profile" hitSlop={6} onPress={() => openNote(item, 'actor')}><Avatar p={item.actor} /></Pressable>
                <Text style={{ flex: 1, color: '#fff' }}>
                  {item.kind === 'boost_done' && !item.actor
                    ? <Text style={{ fontWeight: '800', color: colors.primary }}>🚀 </Text>
                    : <Text onPress={() => openNote(item, 'actor')}><RichTextView html={whoNameHtml(item.actor)} style={{ fontWeight: '800', color: '#fff' }} /></Text>}{item.kind === 'boost_done' && !item.actor ? '' : ' '}{item.text}</Text>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={s.muted}>{ago(item.created_at)}</Text>
                  {!item.read && <View style={s.dot} />}
                </View>
                </>)}
              </Pressable>
            )} />
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 16 },
  h2: { color: '#fff', fontSize: 24, fontWeight: '900' },
  mark: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  pills: { flexDirection: 'row', gap: 4, padding: 4, marginHorizontal: 16, marginBottom: 16, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)' },
  pill: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, paddingVertical: 8, borderRadius: 99 },
  pillBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4 },
  unreadRow: { backgroundColor: 'rgba(255,165,0,0.09)' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF3B30' },
  pillT: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  name: { color: '#fff', fontWeight: '800', flexShrink: 1 },
  muted: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  center: { color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 24, paddingHorizontal: 20 },
  badge: { backgroundColor: colors.primary, color: '#000', fontWeight: '900', fontSize: 11, paddingHorizontal: 6, borderRadius: 99 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  bubble: { maxWidth: '78%', padding: 10, borderRadius: 16, gap: 6 },
  me: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  them: { alignSelf: 'flex-start', backgroundColor: '#222' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10 },
  input: { flex: 1, backgroundColor: '#1c1c1c', color: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 11, minHeight: 44, maxHeight: 140, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sheetBg: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#0A0A0B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32, gap: 8 },
  opt: { paddingVertical: 14, alignItems: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  optT: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
