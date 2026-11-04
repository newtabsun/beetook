import { handleOf } from '../../lib/username';
import { friendlyError } from '../../lib/errors';
import { VipAvatar, VipBadge, VipTag, useIsVip } from '../../components/Vip';
import { AppModal } from '../../components/AppModal';
import { notify } from '../../lib/notify';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ShareSheet, OwnerSheet } from './VideoSheets';
import { ActivityIndicator, Dimensions, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStableHeight } from './useStableHeight';
import { isPostDeleted, onPostDeleted, fetchPostById, addComment, deleteComment, fetchCommentCount, fetchComments, fetchFeed, fetchForYou, formatNum, recordView, recordWatch, setFollow, subscribeTables, soundOf, toggleReaction, nameHtmlOf, type Comment, type Post } from '../../lib/api';
import { supabase, T } from '../../lib/supabase';
import { BoostSheet, GiftSheet, ReportSheet } from '../social/Sheets';
import { loadFollowing, useFollowingIds, useIsFollowing } from '../../lib/follows';
import { FeedCaption } from '../../components/FeedCaption';
import { RichTextInput, RichTextView, richToPlain } from '../../components/RichText';
import { colors } from '../../theme';
import { PostMedia, VideoPreloader } from '../editor/PostMedia';
import { useEffectiveDataSaver, useNetwork } from '../../lib/network';
import { isLowMemoryDevice } from '../../lib/device';
import { Image as ExpoImage } from 'expo-image';
import { isPlayed, setDownloadedOnly, useDownloadedOnly } from '../../lib/offline';
import { Icon } from '../../components/Icons';
import { PartnerJoinScreen } from '../partner/PartnerJoin';
import { MarketScreen } from '../social/MarketScreen';
import { SearchScreen } from '../search/SearchScreen';
import { FullscreenPlayer } from './FullscreenPlayer';
import { dedupe, hydrate, isInvalidated, needsRefresh, peek, persist, PERSIST_LIMIT, put, STALE_MS, touch } from '../../lib/swr';
import { isAppActive, onAppActiveChange } from '../../lib/appActive';
import { requireSignIn } from '../../lib/guest';
import { FEED_KEY, type FeedCache } from '../../lib/feedWarm';

function CommentVip({ id }: { id: string }) { return useIsVip(id) ? <VipBadge /> : null; }

function CommentRow({ c, reply, locked, mine, onReply, onDelete }: { c: Comment; reply?: boolean; locked?: boolean; mine: boolean; onReply: () => void; onDelete: () => void }) {
  const size = reply ? 24 : 32;
  return (
    <View style={[s.cRow, { flexDirection: 'row', gap: 10, marginLeft: reply ? 42 : 0 }]}>
      <VipAvatar userId={c.user_id} uri={c.author?.avatar_url} name={c.author?.username} size={size} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><RichTextView html={nameHtmlOf(c.author)} style={s.cUser} numberOfLines={1} /><CommentVip id={c.user_id} /></View>
        <RichTextView html={c.body_html || c.body.replace(/&/g, '&').replace(/</g, '<')} style={s.cText} />
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 3 }}>
          <Text style={s.cUser}>{new Date(c.created_at).toLocaleDateString()}</Text>
          {!locked && <Pressable onPress={onReply} accessibilityLabel="Reply"><Text style={[s.cUser, { fontWeight: '800' }]}>Reply</Text></Pressable>}
          {mine && <Pressable onPress={onDelete} accessibilityLabel="Delete comment"><Text style={[s.cUser, { fontWeight: '800' }]}>Delete</Text></Pressable>}
        </View>
      </View>
    </View>
  );
}

function Comments({ post, onClose, onCount }: { post: Post; onClose: () => void; onCount: (n: number) => void }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [err, setErr] = useState('');
  const [html, setHtml] = useState('');
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(post.comment_count);
  const [me, setMe] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { void supabase.auth.getUser().then((r) => setMe(r.data.user?.id ?? null)); }, []);
  const load = useCallback(async () => {
    try {
      const rows = await fetchComments(post.id); setList(rows);
      const n = await fetchCommentCount(post.id).catch(() => rows.length); setCount(n); onCount(n);
    } catch (e) { setErr(friendlyError(e)); }
  }, [post.id, onCount]);
  useEffect(() => { void load(); }, [load]);
  const [off, setOff] = useState(post.allow_comments === false);
  useEffect(() => subscribeTables(`pc-${post.id}`, [{ table: T.posts, filter: `id=eq.${post.id}` }], (r) => {
    if ('allow_comments' in r) { setOff(r.allow_comments === false); if (r.allow_comments === false) setReplyTo(null); }
  }), [post.id]);
  const tops = (list ?? []).filter((c) => !c.parent_id).reverse();
  const repliesOf = (id: string) => (list ?? []).filter((c) => c.parent_id === id);
  const startReply = (c: Comment) => {
    const root = c.parent_id ?? c.id;
    setReplyTo(c); setOpen((o) => ({ ...o, [root]: true }));
    setHtml(`<span style="color: #3FA9FF; font-weight: bold;">${(c.author?.display_name || c.author?.username || 'user').replace(/[<>&]/g, '')}</span> `); setKey((k) => k + 1);
  };
  const send = async () => {
    const plainText = richToPlain(html);
    if (!plainText) return;
    setBusy(true);
    try {
      await addComment(post.id, plainText, { html, parentId: replyTo ? (replyTo.parent_id ?? replyTo.id) : undefined, replyTo: replyTo?.user_id });
      setHtml(''); setKey((k) => k + 1); setReplyTo(null); await load();
    } catch (e) { notify('Error', friendlyError(e)); }
    setBusy(false);
  };
  const remove = async (c: Comment) => {
    try { await deleteComment(c.id); await load(); } catch (e) { notify('Error', friendlyError(e)); }
  };
  return (
    <AppModal onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <Text style={s.sheetT} testID="comments-title">{formatNum(count)} Comments</Text>
        {!list && !err && <ActivityIndicator color={colors.primary} />}
        {!!err && <Text style={s.err}>{err}</Text>}
        <FlatList showsVerticalScrollIndicator={false} data={tops} keyExtractor={(c) => c.id} style={{ maxHeight: 340 }}
          ListEmptyComponent={list ? <Text style={s.cUser}>No comments yet</Text> : null}
          renderItem={({ item: c }) => {
            const reps = repliesOf(c.id); const shown = open[c.id];
            return (
              <View>
                <CommentRow c={c} locked={off} mine={c.user_id === me} onReply={() => startReply(c)} onDelete={() => void remove(c)} />
                {shown && reps.map((r) => <CommentRow key={r.id} c={r} reply locked={off} mine={r.user_id === me} onReply={() => startReply(r)} onDelete={() => void remove(r)} />)}
                {reps.length > 0 && (
                  <Pressable onPress={() => setOpen((o) => ({ ...o, [c.id]: !shown }))} style={{ marginLeft: 42, paddingVertical: 4 }}>
                    <Text style={[s.cUser, { fontWeight: '800' }]}>{shown ? 'Hide' : `View ${reps.length} ${reps.length === 1 ? 'reply' : 'replies'}`}</Text>
                  </Pressable>
                )}
              </View>
            );
          }} />
        {off ? (
          <View style={[s.cInputRow, { justifyContent: 'center' }]} testID="comments-off">
            <Text style={[s.cUser, { textAlign: 'center', flex: 1 }]}>Comments are turned off for this video</Text>
          </View>
        ) : <>
        {replyTo && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 }}>
            <Text style={s.cUser}>Replying to {replyTo.author?.display_name || replyTo.author?.username || 'user'}</Text>
            <Pressable onPress={() => { setReplyTo(null); setHtml(''); setKey((k) => k + 1); }}><Text style={[s.cUser, { fontWeight: '800' }]}>Cancel</Text></Pressable>
          </View>
        )}
        <View style={[s.cInputRow, { alignItems: 'flex-end' }]}>
          <View style={{ flex: 1 }}><RichTextInput key={key} value={html} onChange={setHtml} placeholder={replyTo ? 'Add a reply…' : 'Add a comment…'} onSend={() => void send()} sending={busy} /></View>
        </View>
        </>}
      </View>
    </AppModal>
  );
}

function Rail({ children, label, onPress, a11y, testID }: { children: ReactNode; label: string; onPress: () => void; a11y: string; testID?: string }) {
  return <Pressable testID={testID} accessibilityLabel={a11y} onPress={onPress} style={s.act}>{children}{!!label && <Text style={s.actN}>{label}</Text>}</Pressable>;
}

const TABS = ['Following', 'For You', 'Market'] as const;
type FeedTab = typeof TABS[number];

export const Card = memo(function Card({ p: initial, height, onUser, onSound, me, onDuet, onRemoved, active = true }: { p: Post; height: number; onUser: (id: string) => void; onSound: (p: Post) => void; me?: string; onDuet?: (p: Post) => void; onRemoved?: (id: string) => void; active?: boolean }) {
  const [orig, setOrig] = useState<Post | null>(null);
  const [p, setP] = useState(initial);
  const [opts, setOpts] = useState(false);
  const [owner, setOwner] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [boost, setBoost] = useState(false);
  const [shares, setShares] = useState(p.share_count ?? 0);
  const [gone, setGone] = useState(() => isPostDeleted(initial.id));
  useEffect(() => onPostDeleted((id) => { if (id === initial.id) setGone(true); }), [initial.id]);
    const [giftOpen, setGiftOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  useEffect(() => { recordView(p.id).catch(() => undefined); }, [p.id]);
  const mine = p.user_id === me;
  const [liked, setLiked] = useState(!!p.liked);
  const [saved, setSaved] = useState(!!p.saved);
  const [likes, setLikes] = useState(p.like_count);
  const [saves, setSaves] = useState(p.save_count);
  const [comments, setComments] = useState(p.comment_count);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(Dimensions.get('window').width);

  const react = async (kind: 'like' | 'save') => {
    if (!requireSignIn()) return;
    const on = kind === 'like' ? !liked : !saved;
    const setOn = kind === 'like' ? setLiked : setSaved;
    const setN = kind === 'like' ? setLikes : setSaves;
    setOn(on); setN((n) => n + (on ? 1 : -1));
    try { await toggleReaction(kind, p.id, on); } catch (e) {
      setOn(!on); setN((n) => n + (on ? -1 : 1)); notify('Error', friendlyError(e));
    }
  };
  const [gifts, setGifts] = useState(Number(p.gift_count ?? 0) || 0);
  const [followedLocal, setFollowed] = useState(false);
  const followed = useIsFollowing(p.user_id) || followedLocal;
  const follow = async () => {
    if (!requireSignIn()) return;
    setFollowed(true);
    try { await setFollow(p.user_id, true); } catch (e) { setFollowed(false); notify('Error', friendlyError(e)); }
  };
  const name = p.author?.display_name || p.author?.username || 'user';
  if (gone) return <View style={{ height, alignItems: 'center', justifyContent: 'center' }}><Text style={s.endT}>Video deleted</Text></View>;
  return (
    <View style={{ height, overflow: 'hidden', backgroundColor: '#000' }} onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w && Math.abs(w - width) > 1) setWidth(w); }}>
      <WatchTracker id={p.id} active={active} />
      {<PostMedia kind={p.kind} sources={p.media_urls} edit={p.edit ?? undefined} width={width} height={height} poster={p.thumbnail_url} active={active && !open && !shareOpen && !giftOpen && !partnerOpen && !orig} />}
      <View style={s.shade} pointerEvents="none" />
      <View style={s.rail}>
        <View style={{ marginBottom: 8 }}>
          <Pressable accessibilityLabel="Open profile" onPress={() => onUser(p.user_id)}><VipAvatar userId={p.user_id} uri={p.author?.avatar_url} name={name} size={48} color={colors.primary} /></Pressable>
          {!!me && p.user_id !== me && !followed && (
            <Pressable accessibilityLabel="Follow" style={s.follow} onPress={() => void follow()}><Icon name="plus" size={14} color="#000" strokeWidth={3} /></Pressable>
          )}
        </View>
        <Rail label={formatNum(likes)} a11y="Like" onPress={() => void react('like')}><Icon name="heart" size={28} color={liked ? '#FF2D55' : '#fff'} fill={liked ? '#FF2D55' : 'none'} /></Rail>
        <Rail label={formatNum(gifts)} a11y="Gift" testID="gift-rail" onPress={() => { if (!requireSignIn()) return; if (mine) notify("You can't send a gift to yourself"); else setGiftOpen(true); }}><Icon name="giftRound" size={28} color="#FF2D55" fill="rgba(255,45,85,0.18)" /></Rail>
        <Rail label={formatNum(comments)} a11y="Comments" onPress={() => { if (requireSignIn()) setOpen(true); }}><Icon name="comment" size={28} fill="rgba(255,255,255,0.1)" /></Rail>
        <Rail label={formatNum(saves)} a11y="Save" onPress={() => void react('save')}><Icon name="bookmark" size={28} color={saved ? colors.primary : '#fff'} fill={saved ? colors.primary : 'none'} /></Rail>
        <Rail label={formatNum(shares)} a11y="Share" onPress={() => { if (requireSignIn()) setShareOpen(true); }}><Icon name="share" size={28} strokeWidth={2.5} flip /></Rail>
        {mine && <Pressable accessibilityLabel="Video options" testID="owner-options" onPress={() => setOwner(true)} style={s.moreBtn}><Icon name="more" size={20} /></Pressable>}
        <Pressable accessibilityLabel="Open sound" onPress={() => onSound(p)} style={s.disc}><Icon name="music" size={16} color={colors.primary} /></Pressable>
      </View>
      <View style={s.meta}>
        {!mine && p.partner_enabled !== false && (
          <Pressable accessibilityLabel="Partner" testID="partner-label" onPress={() => { if (requireSignIn()) setPartnerOpen(true); }} style={s.partnerPill}>
            <Icon name="users" size={13} color="#000" />
            <Text style={s.partnerT}>Partner</Text>
          </Pressable>
        )}
        {p.edit?.duet && (
          <Text testID="duet-link" style={s.duetT} onPress={() => void fetchPostById(p.edit!.duet!.postId).then((o) => (o ? setOrig(o) : notify('The original video is no longer available'))).catch((e: Error) => notify('Error', friendlyError(e)))}>
            Duet with {handleOf(p.edit.duet.username)}
          </Text>
        )}
        <FeedCaption html={p.caption_html || p.caption} />
      </View>
      {partnerOpen && <PartnerJoinScreen inviterId={p.user_id} postId={p.id} onClose={() => setPartnerOpen(false)} />}
      {open && <Comments post={p} onClose={() => setOpen(false)} onCount={setComments} />}
      {opts && <ReportSheet post={p} onClose={() => setOpts(false)} />}
      {giftOpen && <GiftSheet recipient={p.user_id} recipientName={name} postId={p.id} onSent={(_l, q) => setGifts((x) => x + q)} onClose={() => setGiftOpen(false)} />}
      {boost && <BoostSheet post={p} onClose={() => setBoost(false)} />}
      {shareOpen && <ShareSheet post={p} onClose={() => setShareOpen(false)} onShared={(n) => setShares((x) => x + n)} isOwner={mine} onBoost={() => setBoost(true)} onDuet={onDuet && p.kind === 'video' ? () => onDuet(p) : undefined} onReport={mine ? undefined : () => setOpts(true)} />}
      {orig && <FullscreenPlayer posts={[orig]} index={0} onClose={() => setOrig(null)} onUser={(id) => { setOrig(null); onUser(id); }} />}
      {owner && <OwnerSheet post={p} onClose={() => setOwner(false)} onChange={setP} onDeleted={() => { setGone(true); onRemoved?.(p.id); }} />}
    </View>
  );
});

/** Logs watch time to view_events when a post stops being the active one. */
function WatchTracker({ id, active }: { id: string; active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    return () => { void recordWatch(id, Date.now() - t0).catch(() => undefined); };
  }, [id, active]);
  return null;
}

const VIEWABILITY = { itemVisiblePercentThreshold: 80, minimumViewTime: 120 };


export function FeedScreen({ onUser, onSound, onDuet, visible = true }: { onUser: (id: string) => void; onSound: (p: Post) => void; onDuet?: (p: Post) => void; visible?: boolean }) {
  // Last session's list, position and paging state: shown instantly when the user comes back to Home.
  const cached = useRef(peek<FeedCache>(FEED_KEY)).current;
  const restoreId = useRef(cached?.activeId ?? null).current;
  const [activeId, setActiveId] = useState<string | null>(cached?.activeId ?? null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: Post }[] }) => { if (viewableItems[0]) setActiveId(viewableItems[0].item.id); }).current;
  const [me, setMe] = useState<string>();
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id)); }, []);
  const { h, onLayout: onFeedLayout } = useStableHeight();
  const [items, setItems] = useState<Post[]>(cached?.items ?? []);
  const [loading, setLoading] = useState(!cached?.items.length);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(cached?.more ?? true);
  const [incoming, setIncoming] = useState<Post[]>([]);
  const listRef = useRef<FlatList<Post>>(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const incomingRef = useRef(incoming); incomingRef.current = incoming;
  const [err, setErr] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [playPost, setPlayPost] = useState<Post | null>(null);
  const [tab, setTab] = useState<FeedTab>('For You');
  const following = useFollowingIds();
  const net = useNetwork();
  const saver = useEffectiveDataSaver();
  const downloadedOnly = useDownloadedOnly();
  const base0 = tab === 'Following' ? items.filter((x) => following.has(x.user_id)) : items;
  const [, bumpDel] = useState(0);
  useEffect(() => onPostDeleted(() => { setItems((l) => l.filter((x) => !isPostDeleted(x.id))); setIncoming((l) => l.filter((x) => !isPostDeleted(x.id))); bumpDel((n) => n + 1); }), []);
  const base = base0.filter((x) => !isPostDeleted(x.id));
  const shown = downloadedOnly ? base.filter((x) => x.kind === 'video' && isPlayed(x.media_urls[0])) : base;
  // Back online → leave "downloaded only" mode automatically.
  useEffect(() => { if (downloadedOnly && net.online && !net.slow) setDownloadedOnly(false); }, [downloadedOnly, net.online, net.slow]);
  const cur = Math.max(0, shown.findIndex((x) => x.id === activeId));
  // Prefetch covers of the next 2 posts so a poster is shown instantly (no black screen).
  useEffect(() => {
    shown.slice(cur, cur + 6).forEach((x) => {
      if (x.thumbnail_url) void ExpoImage.prefetch(x.thumbnail_url, 'memory-disk').catch(() => undefined);
      if (x.author?.avatar_url) void ExpoImage.prefetch(x.author.avatar_url, 'memory-disk').catch(() => undefined);
    });
  }, [cur, shown]);
  // Fetch the next page while the user still has several videos left, so fast scrolling never hits the end.
  useEffect(() => { if (more && !refreshing && !loading && shown.length > 0 && cur >= shown.length - 4) void load(false); }, [cur, shown.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Warm up the first seconds of the next 2 videos (skipped offline, on slow networks and with Data Saver).
  // Low-RAM phones and mobile data warm up only the next video (fewer decoders, less data).
  const ahead = isLowMemoryDevice ? 1 : net.cellular ? 2 : 3;
  const preload = net.online && !net.slow && !saver && visible && tab !== 'Market'
    ? shown.slice(cur + 1, cur + 1 + ahead).filter((x) => x.kind === 'video' && x.media_urls[0]).map((x) => (x.edit?.lowUrl && net.slow ? x.edit.lowUrl : x.media_urls[0]))
    : [];

  const load = useCallback((reset: boolean) => dedupe(`feed:load:${reset ? 'reset' : 'more'}`, async () => {
    try {
      const prev = itemsRef.current;
      const before = reset ? undefined : prev[prev.length - 1]?.publish_at;
      const page = tab === 'For You' ? await fetchForYou(reset ? 0 : prev.length, before) : await fetchFeed(before);
      const next = reset ? page : [...prev, ...page.filter((x) => !prev.some((y) => y.id === x.id))];
      setItems(next); setMore(page.length > 0); setErr('');
      if (reset) {
        setIncoming([]);
        put<FeedCache>(FEED_KEY, { items: next, more: page.length > 0, activeId: null });
        void persist<FeedCache>(FEED_KEY, { items: next.slice(0, PERSIST_LIMIT.feed), more: true, activeId: null });
      }
    } catch (e) { setErr(friendlyError(e)); }
  }), [tab]);

  /** Quiet revalidate: asks only for posts newer than the newest one already known, never the full list. */
  const checkNew = useCallback(() => dedupe('feed:new', async () => {
    const newest = incomingRef.current[0]?.publish_at ?? itemsRef.current[0]?.publish_at;
    if (!newest) return;
    try {
      const page = await fetchFeed(undefined, newest);
      const known = new Set([...itemsRef.current, ...incomingRef.current].map((x) => x.id));
      const add = page.filter((x) => !known.has(x.id));
      if (add.length) setIncoming((prev) => [...add, ...prev]);
      touch(FEED_KEY);
    } catch { /* keep showing cached posts */ }
  }), []);

  const revalidate = useCallback(async () => {
    if (isInvalidated(FEED_KEY)) await load(true);
    else if (needsRefresh(FEED_KEY, STALE_MS.feed)) await checkNew();
  }, [load, checkNew]);

  // Mount: memory cache → persisted cache → network. Cached data is shown first; the network is only asked
  // when the cache is missing, invalidated by the app itself, or older than STALE_MS.feed.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = cached ?? await hydrate<FeedCache>(FEED_KEY);
      if (!alive) return;
      if (!c?.items.length) { await load(true); if (alive) setLoading(false); return; }
      if (!cached) { setItems(c.items); setMore(c.more); setLoading(false); }
      if (isAppActive()) await revalidate();
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from background: one light revalidate, only if stale. Nothing runs while in the background.
  useEffect(() => onAppActiveChange((a) => { if (a && net.online) void revalidate(); }), [revalidate, net.online]);

  // Keep list + position in memory (without resetting its age) so returning to Home restores them.
  useEffect(() => { if (items.length) put<FeedCache>(FEED_KEY, { items, more, activeId }, false); }, [items, more, activeId]);

  const showIncoming = () => {
    const add = incomingRef.current;
    if (!add.length) return;
    const ids = new Set(add.map((x) => x.id));
    const next = [...add, ...itemsRef.current.filter((x) => !ids.has(x.id))];
    setItems(next); setIncoming([]); setActiveId(add[0].id);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    void persist<FeedCache>(FEED_KEY, { items: next.slice(0, PERSIST_LIMIT.feed), more: true, activeId: null });
  };

  // Pull-to-refresh is always a full reload.
  const refresh = async () => { setRefreshing(true); await Promise.all([load(true), loadFollowing(true)]); setRefreshing(false); };

  return (
    <View style={{ flex: 1 }} onLayout={onFeedLayout}>
      {loading ? <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
        : err && !items.length ? (
          <View style={s.center}><Text style={s.err}>{err}</Text><Pressable style={s.retry} onPress={() => { setLoading(true); void load(true).finally(() => setLoading(false)); }}><Text style={s.retryT}>Try again</Text></Pressable></View>
        ) : h > 0 && (
          <FlatList ref={listRef} data={shown} keyExtractor={(v) => v.id} pagingEnabled showsVerticalScrollIndicator={false}
            initialScrollIndex={restoreId ? Math.max(0, shown.findIndex((x) => x.id === restoreId)) : 0}
            renderItem={({ item, index }) => <Card p={item} height={h} onUser={onUser} onSound={onSound} me={me} onDuet={onDuet} active={visible && tab !== 'Market' && (activeId ? activeId === item.id : index === 0)} />}
            extraData={`${activeId}-${visible}-${tab}`} onViewableItemsChanged={onViewable} viewabilityConfig={VIEWABILITY}
            getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })}
            windowSize={3} initialNumToRender={2} maxToRenderPerBatch={2} removeClippedSubviews
            onEndReachedThreshold={1.5} onEndReached={() => { if (more && !refreshing) void load(false); }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
          />
        )}
      {!loading && !err && h > 0 && shown.length === 0 && tab !== 'Market' && (
        <View style={s.empty} pointerEvents="none" accessibilityLabel="Empty feed">
          <View style={s.emptyIc}><Icon name="video" size={28} color={colors.primary} /></View>
          <Text style={s.endT}>{tab === 'Following' ? 'No posts from people you follow yet' : 'No posts yet'}</Text>
          <Text style={s.endS}>{tab === 'Following' ? 'Follow creators to see their reels here.' : 'Be the first to post a Bee Took reel.'}</Text>
        </View>
      )}
      {preload.map((u) => <VideoPreloader key={u} uri={u} />)}
      {incoming.length > 0 && tab !== 'Market' && !downloadedOnly && (
        <Pressable testID="new-posts" accessibilityLabel="Show new posts" onPress={showIncoming} style={s.newPill}>
          <Icon name="video" size={14} color="#000" />
          <Text style={s.newT}>{incoming.length} new {incoming.length === 1 ? 'post' : 'posts'}</Text>
        </Pressable>
      )}
      {downloadedOnly && (
        <Pressable testID="downloaded-only" onPress={() => setDownloadedOnly(false)} style={s.dlBar}>
          <Text style={s.dlT}>Showing videos saved on this phone ({shown.length}) · Tap to show all</Text>
        </Pressable>
      )}
      {tab === 'Market' && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', paddingTop: 56 }]}><MarketScreen embedded onBack={() => setTab('For You')} /></View>}
      <View style={s.header}>
        <View style={s.brand}>
          <Image source={require('../../../assets/logo-b.png')} style={s.logo} resizeMode="contain" accessibilityLabel="Bee Took logo" />
          <Text numberOfLines={1} style={s.brandT}>Bee <Text style={{ color: '#FFA500' }}>Took</Text></Text>
        </View>
        <View style={s.tabs} pointerEvents="box-none">
          {TABS.map((x) => (
            <Pressable key={x} accessibilityRole="tab" accessibilityState={{ selected: tab === x }} onPress={() => { if (x === 'Following' && !requireSignIn()) return; setTab(x); }} style={[s.tab, tab === x && s.tabOn]}>
              <Text numberOfLines={1} style={tab === x ? s.tabTOn : s.tabT}>{x}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityLabel="Search" style={s.search} onPress={() => setSearchOpen(true)}><Icon name="search" size={20} /></Pressable>
      </View>
      {searchOpen && <SearchScreen onClose={() => setSearchOpen(false)} onUser={onUser} onPlay={setPlayPost} />}
      {playPost && <FullscreenPlayer posts={[playPost]} index={0} onClose={() => setPlayPost(null)} onUser={onUser} onSound={onSound} />}
    </View>
  );
}

const s = StyleSheet.create({
  newPill: { position: 'absolute', top: 64, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFA500', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 7, zIndex: 41 },
  newT: { color: '#000', fontWeight: '900', fontSize: 12 },
  dlBar: { position: 'absolute', top: 104, left: 12, right: 12, backgroundColor: 'rgba(63,169,255,0.92)', borderRadius: 12, padding: 8, zIndex: 40 },
  dlT: { color: '#fff', fontWeight: '800', fontSize: 12, textAlign: 'center' },
  duetT: { color: '#E9D5FF', fontWeight: '800', fontSize: 13, marginBottom: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  err: { color: '#E53935', textAlign: 'center' },
  retry: { backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 18, paddingVertical: 10 },
  retryT: { color: '#000', fontWeight: '900' },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  logo: { width: 28, height: 28 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brandT: { color: '#fff', fontSize: 14, fontWeight: '900' },
  tabs: { position: 'absolute', left: 124, right: 48, top: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', padding: 4 },
  tab: { flexShrink: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  tabOn: { backgroundColor: '#FFA500' },
  tabT: { color: '#fff', fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
  tabTOn: { color: '#000', fontSize: 11.5, lineHeight: 16, fontWeight: '800' },
  search: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  follow: { position: 'absolute', bottom: -10, alignSelf: 'center', width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#111', borderWidth: 6, borderColor: '#222', alignItems: 'center', justifyContent: 'center' },
  partnerPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFA500', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 2 },
  partnerT: { color: '#000', fontWeight: '900', fontSize: 12 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soundT: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  empty: { position: 'absolute', left: 24, right: 24, top: 96, bottom: 110, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIc: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,165,0,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  endT: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  endS: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  rail: { position: 'absolute', right: 10, bottom: 96, alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarT: { color: '#000', fontWeight: '900', fontSize: 18 },
  act: { alignItems: 'center', gap: 2 },
  moreBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  actI: { fontSize: 28 },
  actN: { color: '#fff', fontSize: 12, fontWeight: '700' },
  meta: { position: 'absolute', left: 12, right: 80, bottom: 18, gap: 4 },
  user: { color: '#fff', fontWeight: '900', fontSize: 15 },
  cap: { color: '#fff', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: '#161616', padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8 },
  sheetT: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  cRow: { paddingVertical: 8 },
  cUser: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  cText: { color: '#fff' },
  cInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cInput: { flex: 1, backgroundColor: '#222', color: '#fff', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  send: { color: colors.primary, fontWeight: '900' },
});
