import { requireSignIn, useIsGuest } from '../../lib/guest';
import { friendlyError } from '../../lib/errors';
// Marketplace mirroring the web reference; listings, market balance and escrow orders are all backed by Supabase RPCs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from '../../components/CachedImage';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useActiveInterval } from '../../lib/appActive';

/** Listings/orders arrive through Realtime; this slow poll only repairs a dropped subscription. */
const MARKET_FALLBACK_MS = 120_000;
import { Icon } from '../../components/Icons';
import {
  amIAdmin, createMarketItem, deleteMarketItem, fetchMarket, fetchOrders, getMarketBalance, marketInquiry, marketTransfer, myIdOrNull, orderAction,
  requestPurchase, runMarketTimers, sellerRating, subscribeTables, type MarketItem, type Order, type OrderAction, type OrderStatus,
} from '../../lib/api';
import { T } from '../../lib/supabase';
import { openInbox } from '../../lib/inboxNav';
import { RichTextInput, RichTextView, richToPlain } from '../../components/RichText';
import { colors } from '../../theme';

type Tab = 'browse' | 'purchases' | 'listings';
const A = '#FFA500';
const COINS_PER_ETB = 10;
const COINS_PER_USDT = 1600;
const fmt = (n: number, d = 2) => (Number.isFinite(n) ? String(+n.toFixed(d)) : '');
const coins = (etb: number) => (etb * COINS_PER_ETB).toLocaleString('en-US');
const validPhone = (p: string) => /^\+2519\d{8}$/.test(p.replace(/[\s-]/g, '').replace(/^09/, '+2519'));
const normPhone = (p: string) => p.replace(/[\s-]/g, '').replace(/^09/, '+2519');
const PH = 'rgba(255,255,255,0.4)';

function DeliveryBadge({ on }: { on: boolean }) {
  return on ? (
    <View style={[s.badge, { backgroundColor: 'rgba(16,185,129,0.15)' }]}><Icon name="car" size={11} color="#6EE7B7" /><Text style={[s.badgeT, { color: '#6EE7B7' }]}>Delivery</Text></View>
  ) : (
    <View style={[s.badge, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={[s.badgeT, { color: 'rgba(255,255,255,0.5)' }]}>No delivery</Text></View>
  );
}

function PhotoSlider({ photos }: { photos: string[] }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width, 430);
  const [i, setI] = useState(0);
  const ref = useRef<ScrollView>(null);
  const hold = useRef(0);
  useEffect(() => {
    if (photos.length < 2) return;
    const t = setInterval(() => {
      if (Date.now() < hold.current) return;
      setI((c) => { const n = (c + 1) % photos.length; ref.current?.scrollTo({ x: n * w, animated: true }); return n; });
    }, 3500);
    return () => clearInterval(t);
  }, [photos.length, w]);
  if (!photos.length) return <View style={{ width: w, height: w, backgroundColor: 'rgba(255,255,255,0.05)' }} />;
  return (
    <View>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => { hold.current = Date.now() + 6000; }}
        onMomentumScrollEnd={(e) => { hold.current = Date.now() + 6000; setI(Math.round(e.nativeEvent.contentOffset.x / w)); }}
        onScroll={(e) => { const n = Math.round(e.nativeEvent.contentOffset.x / w); if (n !== i) setI(n); }} scrollEventThrottle={64}>
        {photos.map((p) => <Image key={p} source={{ uri: p }} style={{ width: w, height: w }} resizeMode="cover" />)}
      </ScrollView>
      {photos.length > 1 && (
        <View style={s.dots}>{photos.map((p, k) => <View key={p} style={[s.dot, k === i && s.dotOn]} />)}</View>
      )}
    </View>
  );
}

function PriceTriple({ etb, setEtb }: { etb: string; setEtb: (v: string) => void }) {
  const [focus, setFocus] = useState<'c' | 'e' | 'u' | null>(null);
  const [raw, setRaw] = useState('');
  const e = Number(etb);
  const val = (k: 'c' | 'e' | 'u') => (focus === k ? raw : !etb ? '' : k === 'e' ? etb : k === 'c' ? String(Math.round(e * COINS_PER_ETB)) : fmt((e * COINS_PER_ETB) / COINS_PER_USDT, 4));
  const change = (k: 'c' | 'e' | 'u', v: string) => {
    setRaw(v);
    if (!v) return setEtb('');
    const n = Number(v);
    setEtb(fmt(k === 'e' ? n : k === 'c' ? n / COINS_PER_ETB : (n * COINS_PER_USDT) / COINS_PER_ETB));
  };
  const field = (k: 'c' | 'e' | 'u', label: string) => (
    <View style={{ flex: 1 }}>
      <Text style={s.lbl}>{label}</Text>
      <TextInput value={val(k)} keyboardType="numeric" onFocus={() => { setFocus(k); setRaw(val(k)); }} onBlur={() => setFocus(null)}
        onChangeText={(v) => change(k, v)} style={[s.input, { height: 40, paddingVertical: 0, marginTop: 4 }]} accessibilityLabel={`Price in ${label}`} />
    </View>
  );
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8 }}>{field('c', 'Coin')}{field('e', 'ETB')}{field('u', 'USDT')}</View>
      <Text style={s.hint}>1 ETB = {COINS_PER_ETB} coins · 1 USDT = {COINS_PER_USDT.toLocaleString('en-US')} coins</Text>
    </View>
  );
}

function NewListing({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [etb, setEtb] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [delivery, setDelivery] = useState(false);
  const [autoOn, setAutoOn] = useState(true);
  const [autoText, setAutoText] = useState('Hello {name}! Thanks for your interest. I will confirm and reply shortly, or call me now.');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3 - photos.length, quality: 0.8 });
    if (!r.canceled) setPhotos((p) => [...p, ...r.assets.map((a) => a.uri)].slice(0, 3));
  };
  const submit = async () => {
    if (!richToPlain(title).trim() || !photos.length || !(Number(etb) > 0)) return setErr('Title, at least 1 photo and price are required');
    if (!validPhone(phone)) return setErr('Enter a valid phone number (+2519XXXXXXXX)');
    if (!address.trim()) return setErr('Enter an address');
    setBusy(true); setErr('');
    try {
      await createMarketItem({ title, description: desc, photos, priceEtb: Number(etb), phone: normPhone(phone), address: address.trim(), delivery, autoReplyOn: autoOn, autoReply: autoText.trim() });
      onDone();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={s.pGrid}>
        {photos.map((p, k) => (
          <View key={p} style={s.pCell}>
            <Image source={{ uri: p }} style={StyleSheet.absoluteFill} />
            <Pressable accessibilityLabel="Remove photo" style={s.pX} onPress={() => setPhotos(photos.filter((_, j) => j !== k))}><Icon name="x" size={12} /></Pressable>
          </View>
        ))}
        {photos.length < 3 && (
          <Pressable accessibilityLabel="Add photos" style={[s.pCell, s.pAdd]} onPress={pick}>
            <Icon name="image" size={24} color="rgba(255,255,255,0.6)" /><Text style={s.pAddT}>{photos.length}/3 photos</Text>
          </Pressable>
        )}
      </View>
      <RichTextInput label="Product name" value={title} onChange={setTitle} placeholder="Product name" />
      <RichTextInput label="Description" multiline value={desc} onChange={setDesc} placeholder="Description (condition, size…)" />
      <PriceTriple etb={etb} setEtb={setEtb} />
      <View style={s.iconIn}><Icon name="phone" size={16} color={PH} /><TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+251 9XX XXX XXX" placeholderTextColor={PH} style={s.iconInT} /></View>
      <View style={s.iconIn}><Icon name="mapPin" size={16} color={PH} /><TextInput value={address} onChangeText={setAddress} placeholder="Address (city, area)" placeholderTextColor={PH} style={s.iconInT} /></View>
      <View style={s.rowBox}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="car" size={16} color={A} /><Text style={s.rowT}>Delivery</Text></View>
        <View style={s.yn}>
          {([true, false] as const).map((v) => (
            <Pressable key={String(v)} onPress={() => setDelivery(v)} style={[s.ynI, delivery === v && { backgroundColor: A }]}><Text style={[s.ynT, delivery === v && { color: '#000' }]}>{v ? 'Yes' : 'No'}</Text></Pressable>
          ))}
        </View>
      </View>
      <View style={[s.rowBox, { flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.rowT}>Auto-reply to inquiries</Text>
          <Pressable accessibilityLabel="Toggle auto-reply" onPress={() => setAutoOn(!autoOn)} style={[s.tog, { backgroundColor: autoOn ? A : 'rgba(255,255,255,0.2)' }]}>
            <View style={[s.togK, autoOn && { transform: [{ translateX: 20 }] }]} />
          </Pressable>
        </View>
        {autoOn && (
          <>
            <TextInput value={autoText} onChangeText={setAutoText} multiline placeholder="Your auto-reply message" placeholderTextColor={PH} style={[s.input, { minHeight: 90, backgroundColor: 'rgba(0,0,0,0.4)', textAlignVertical: 'top' }]} />
            <Text style={s.hint}>Line breaks are kept · use {'{name}'} for the buyer's name</Text>
          </>
        )}
      </View>
      {!!err && <Text style={s.err}>{err}</Text>}
      <Pressable style={[s.cta, busy && { opacity: 0.5 }]} disabled={busy} onPress={submit}>{busy ? <ActivityIndicator color="#000" /> : <Text style={s.ctaT}>List for sale</Text>}</Pressable>
    </View>
  );
}

type BuyFilter = 'pending' | 'completed' | 'cancelled';
const isCancelled = (o: Order) => o.status === 'cancelled' || o.history[o.history.length - 1]?.status === 'cancelled';
const buyGroup = (o: Order): BuyFilter => (isCancelled(o) ? 'cancelled' : o.status === 'completed' ? 'completed' : 'pending');

const STATUS_LABEL: Record<OrderStatus, string> = {
  requested: 'Waiting for seller', accepted: 'Accepted', shipped: 'Shipped', completed: 'Completed',
  cancelled: 'Cancelled', disputed: 'Disputed', admin_review: 'Admin review',
};

function BalanceCard({ bal, onChange }: { bal: { balance: number; locked: number } | null; onChange: () => void }) {
  const [dir, setDir] = useState<'in' | 'out' | null>(null);
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try { await marketTransfer(dir as 'in' | 'out', Number(amount)); setDir(null); setAmount(''); onChange(); }
    catch (e) { const m = (e as Error).message; setErr(/insufficient/i.test(m) ? 'Insufficient balance' : friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <View style={s.balWrap}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="store" size={12} color={A} /><Text style={s.balL}>Market balance</Text></View>
          <Text style={s.balV}>{bal === null ? '—' : `${bal.balance.toLocaleString('en-US')} coins`}</Text>
          {!!bal && bal.locked > 0 && <Text style={s.hint}>🔒 {bal.locked.toLocaleString('en-US')} held in escrow · {(bal.balance - bal.locked).toLocaleString('en-US')} free</Text>}
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable accessibilityLabel="Add to market balance" style={s.balBtn} onPress={() => setDir(dir === 'in' ? null : 'in')}><Icon name="plus" size={16} color="#000" /></Pressable>
          <Pressable accessibilityLabel="Move to main balance" style={[s.balBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]} onPress={() => setDir(dir === 'out' ? null : 'out')}><Icon name="minus" size={16} /></Pressable>
        </View>
      </View>
      {dir && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder={dir === 'in' ? 'Coins: Main → Market' : 'Coins: Market → Main'} placeholderTextColor={PH} style={[s.input, { flex: 1, height: 38, paddingVertical: 0 }]} />
          <Pressable disabled={busy} onPress={() => void submit()} style={[s.smallBtn, { backgroundColor: A }]}><Text style={s.ctaT}>{dir === 'in' ? 'Move to Market' : 'Move to Main'}</Text></Pressable>
        </View>
      )}
      {dir === 'out' && (
        <Text style={s.hint}>
          5% fee when moving to Purchased{Number(amount) > 0 ? ` · you receive ${(Number(amount) - Math.ceil(Number(amount) * 0.05)).toLocaleString('en-US')} coins` : ''}
        </Text>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}
      <Text style={s.hint}>For marketplace purchases only · sellers get 100%</Text>
    </View>
  );
}

function OrderCard({ o, role, admin, onDone }: { o: Order; role: 'buyer' | 'seller'; admin: boolean; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [disputing, setDisputing] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const mineChoice = role === 'buyer' ? o.dispute?.buyer : o.dispute?.seller;
  const act = async (a: OrderAction, arg?: string, ph?: string) => {
    setBusy(true); setErr('');
    try { await orderAction(o.id, a, arg, ph); setDisputing(false); onDone(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const B = ({ label, onPress, tone = 'main' }: { label: string; onPress: () => void; tone?: 'main' | 'ghost' | 'ok' | 'bad' | 'on' }) => (
    <Pressable disabled={busy} onPress={onPress} style={[s.smallBtn, tone === 'main' || tone === 'on' ? { backgroundColor: A } : tone === 'ok' ? { backgroundColor: '#10B981' } : tone === 'bad' ? { backgroundColor: '#EF4444' } : { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }, busy && { opacity: 0.5 }]}>
      <Text style={[s.smallT, { color: tone === 'ghost' ? '#fff' : '#000' }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={s.order}>
      {!!o.notice && role === 'buyer' && (
        <View style={s.notice}><Text style={{ color: '#FECACA', fontSize: 11, flex: 1 }}>{o.notice}</Text><Pressable accessibilityLabel="Dismiss" onPress={() => void act('dismiss')}><Icon name="x" size={12} color="#FECACA" /></Pressable></View>
      )}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {o.item_photo ? <Image source={{ uri: o.item_photo }} style={s.mineImg} /> : <View style={s.mineImg} />}
        <View style={{ flex: 1 }}>
          <RichTextView html={o.item_title} style={s.cardT} numberOfLines={1} />
          <Text style={s.seller}>{o.price.toLocaleString('en-US')} coins · {role === 'seller' ? `Buyer: ${o.buyerName}` : `Seller: ${o.sellerName}`}</Text>
          {isCancelled(o)
            ? <Text style={[s.status, { color: '#FCA5A5', backgroundColor: 'rgba(239,68,68,0.15)' }]}>Cancelled · ግብይቱ ሙሉ በሙሉ ተቋርጧል</Text>
            : <Text style={[s.status, o.status === 'completed' && { color: '#6EE7B7', backgroundColor: 'rgba(16,185,129,0.15)' }]}>{STATUS_LABEL[o.status]}</Text>}
        </View>
      </View>
      {role === 'seller' && !!o.message && <View style={s.msgBox}><Text style={{ color: '#fff', fontSize: 12 }}><Text style={{ color: A, fontWeight: '800' }}>Buyer message: </Text>{o.message}</Text></View>}
      <View style={s.timeline}>
        {o.history.map((h, k) => <Text key={k} style={s.tl}><Text style={{ color: '#fff', fontWeight: '800' }}>{STATUS_LABEL[h.status]}</Text> · {new Date(h.at).toLocaleString()}{h.note ? ` — ${h.note}` : ''}</Text>)}
      </View>
      <View style={s.actions}>
        {role === 'buyer' && o.status === 'requested' && !isCancelled(o) && <B tone="ghost" label="Cancel request" onPress={() => void act('cancel')} />}
        {role === 'seller' && o.status === 'requested' && <><B label="Accept" onPress={() => void act('accept')} /><B tone="ghost" label="Decline" onPress={() => void act('decline')} /></>}
        {role === 'seller' && o.status === 'accepted' && <B label="Shipped" onPress={() => void act('ship')} />}
        {role === 'buyer' && o.status === 'shipped' && <><B tone="ok" label="Received" onPress={() => void act('confirm')} /><B tone="ghost" label="Report issue" onPress={() => setDisputing(!disputing)} /></>}
        {o.status === 'disputed' && <><B tone={mineChoice === 'refund' ? 'on' : 'ghost'} label="Refund" onPress={() => void act('propose', 'refund')} /><B tone={mineChoice === 'release' ? 'on' : 'ghost'} label="Release to seller" onPress={() => void act('propose', 'release')} /></>}
        {o.status === 'admin_review' && (admin
          ? <><B tone="ghost" label="Admin: refund" onPress={() => void act('admin', 'refund')} /><B tone="ghost" label="Admin: release" onPress={() => void act('admin', 'release')} /></>
          : <Text style={s.hint}>An admin will decide this dispute.</Text>)}
      </View>
      {o.status === 'disputed' && !!o.dispute?.reason && <Text style={s.tl}>Reason: {o.dispute.reason}{mineChoice ? ' · Your choice is recorded, waiting for the other party' : ''}</Text>}
      {!!o.dispute?.photo && <Image source={{ uri: o.dispute.photo }} style={{ width: 120, height: 80, borderRadius: 8, marginTop: 8 }} />}
      {disputing && (
        <View style={{ gap: 8, marginTop: 8 }}>
          <TextInput value={reason} onChangeText={setReason} placeholder="Reason" placeholderTextColor={PH} style={s.input} />
          <Pressable style={s.chip} onPress={async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 }); if (!r.canceled) setPhoto(r.assets[0].uri); }}>
            <Text style={s.smallT2}>{photo ? 'Photo attached ✓' : 'Attach photo'}</Text>
          </Pressable>
          <B tone="bad" label="Open dispute" onPress={() => (reason.trim() ? void act('dispute', reason.trim(), photo) : setErr('Enter a reason'))} />
        </View>
      )}
      {role === 'buyer' && o.status === 'completed' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <Text style={s.tl}>Rate the seller:</Text>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} accessibilityLabel={`${n} stars`} disabled={!!o.rating || busy} onPress={() => void act('rate', String(n))}>
              <Icon name="star" size={16} color={(o.rating ?? 0) >= n ? A : 'rgba(255,255,255,0.3)'} />
            </Pressable>
          ))}
        </View>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}
    </View>
  );
}

function Detail({ l, mine, bal, onBalance, onBought }: { l: MarketItem; mine: boolean; bal: { balance: number; locked: number } | null; onBalance: () => void; onBought: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [topUp, setTopUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);
  const name = l.seller ?? 'seller';
  const item = richToPlain(l.title).trim();
  const inquiry = `Hello, ${name} I am interested in buying the '${item}' for ${coins(l.price_etb)} coins. Is it still available?\nሰላም፣ ${name} '${item}' በ (${coins(l.price_etb)} ሳንቲሞች) የመግዛት ፍላጎት አለኝ። አሁንም አለ?`;
  useEffect(() => { sellerRating(l.user_id).then(setRating).catch(() => undefined); }, [l.user_id]);
  const buy = async () => {
    setBusy(true); setErr('');
    try { await requestPurchase(l.id, note); setConfirm(false); setNote(''); onBought(); }
    catch (e) {
      const m = (e as Error).message;
      if (m.includes('INSUFFICIENT')) { setTopUp(true); setConfirm(false); setErr('Market balance too low — top up with +'); } else setErr(friendlyError(e));
    } finally { setBusy(false); }
  };
  return (
    <View>
      <PhotoSlider photos={l.photos} />
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={s.bigPrice}>{coins(l.price_etb)} coins</Text>
        <Text style={s.sub}>≈ {fmt(l.price_etb)} ETB · {fmt((l.price_etb * COINS_PER_ETB) / COINS_PER_USDT, 4)} USDT</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <DeliveryBadge on={l.delivery} />
          {!!l.address && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="mapPin" size={14} color={A} /><Text style={s.addr}>{l.address}</Text></View>}
        </View>
        <RichTextView html={l.title} style={[s.bigPrice, { fontSize: 18 }]} />
        {!!richToPlain(l.description ?? '') && <RichTextView html={l.description} style={s.desc} />}
        {!mine && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!!l.phone && (
              <Pressable accessibilityLabel="Call seller" style={[s.call, { flex: 1 }]} onPress={() => void Linking.openURL(`tel:${l.phone}`)}>
                <Icon name="phone" size={16} color={A} /><Text style={s.callT}>Call</Text>
              </Pressable>
            )}
            <Pressable accessibilityLabel="Message seller in Inbox" style={[s.call, { flex: 1 }]} onPress={() => { if (requireSignIn()) { void marketInquiry(l.id); openInbox({ id: l.user_id, username: null, display_name: l.seller ?? null }, inquiry); } }}>
              <Icon name="send" size={16} color={A} /><Text style={s.callT}>Inbox</Text>
            </Pressable>
          </View>
        )}
        <Text style={s.sub}>Seller: {l.seller}{rating && rating.count > 0 ? `  ★ ${Number(rating.avg).toFixed(1)} (${rating.count})` : ''}</Text>
        <View style={s.escrow}>
          <Icon name="shield" size={16} color="#A7F3D0" />
          <Text style={s.escrowT}>Escrow: only the price is held. Funds go to the seller only when you tap "Received". If the seller does not respond or ship within 24 h the request is cancelled and funds are released; after shipping it auto-confirms in 24 h unless you report an issue.</Text>
        </View>
        {topUp && <BalanceCard bal={bal} onChange={onBalance} />}
        {!!err && <Text style={s.err}>{err}</Text>}
        {!mine && !confirm && (
          <Pressable style={[s.cta, l.status !== 'active' && { opacity: 0.45 }]} disabled={l.status !== 'active'} onPress={() => { if (requireSignIn()) setConfirm(true); }}>
            <Text style={s.ctaT}>{l.status === 'active' ? 'Buy' : l.status === 'reserved' ? 'Reserved' : 'Sold'}</Text>
          </Pressable>
        )}
        {!mine && confirm && (
          <View style={s.sheet}>
            <Text style={[s.cardT, { fontSize: 16 }]}>Confirm purchase</Text>
            <Text style={s.price}>{coins(l.price_etb)} coins</Text>
            <Text style={s.lbl}>Message to seller (optional)</Text>
            <TextInput value={note} onChangeText={(v) => setNote(v.slice(0, 300))} multiline placeholder="Pickup place, time, phone…" placeholderTextColor={PH} style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} />
            <Text style={[s.hint, { textAlign: 'right' }]}>{note.length}/300</Text>
            <Text style={s.escrowT}>You are only charged when you tap "Received"; until then it is held in escrow.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={[s.cta, { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)' }]} onPress={() => setConfirm(false)}><Text style={[s.ctaT, { color: '#fff' }]}>Cancel</Text></Pressable>
              <Pressable style={[s.cta, { flex: 1 }, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void buy()}>{busy ? <ActivityIndicator color="#000" /> : <Text style={s.ctaT}>Confirm</Text>}</Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

export function MarketScreen({ onBack, embedded }: { onBack?: () => void; embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('browse');
  const [items, setItems] = useState<MarketItem[] | null>(null);
  const [me, setMe] = useState('');
  const [bal, setBal] = useState<{ balance: number; locked: number } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [admin, setAdmin] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [bf, setBf] = useState<BuyFilter>('pending');
  const guest = useIsGuest();

  const load = useCallback(async () => {
    try {
      await runMarketTimers().catch(() => undefined);
      const [i, id, b, o, a] = await Promise.all([fetchMarket('All'), myIdOrNull(), getMarketBalance().catch(() => null), fetchOrders().catch(() => []), amIAdmin().catch(() => false)]);
      setItems(i); setMe(id); setBal(b); setOrders(o); setAdmin(a); setError('');
    } catch (e) { setError(friendlyError(e)); setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeTables('market', [{ table: T.marketOrders }, { table: T.market }, { table: T.marketBalances }], () => void load()), [load]);
  useActiveInterval(() => void load(), MARKET_FALLBACK_MS);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (items ?? []).filter((l) => l.status !== 'sold' && (!q || l.title.toLowerCase().includes(q) || (l.seller ?? '').toLowerCase().includes(q) || (l.address ?? '').toLowerCase().includes(q))), [items, q]);
  const mine = useMemo(() => (items ?? []).filter((l) => l.user_id === me), [items, me]);
  const listing = items?.find((l) => l.id === open);
  const buys = useMemo(() => orders.filter((o) => o.buyer_id === me), [orders, me]);
  const sales = useMemo(() => orders.filter((o) => o.seller_id === me), [orders, me]);

  const remove = async (id: string) => {
    try { await deleteMarketItem(id); await load(); } catch (e) { setError(friendlyError(e)); }
  };

  return (
    <View style={s.root}>
      <View style={s.head}>
        {(creating || listing || !embedded) && (
          <Pressable accessibilityLabel="Back" style={s.round} onPress={() => (creating ? setCreating(false) : listing ? setOpen(null) : onBack?.())}><Icon name="back" size={20} /></Pressable>
        )}
        <Text numberOfLines={1} style={s.title}>{creating ? 'New product' : listing ? richToPlain(listing.title) : 'Marketplace'}</Text>
        {!creating && !listing && (
          <Pressable accessibilityLabel="Sell" style={s.sell} onPress={() => { if (requireSignIn()) setCreating(true); }}>
            <Icon name="plus" size={16} color="#000" strokeWidth={2.6} /><Text style={s.sellT}>Sell</Text>
          </Pressable>
        )}
      </View>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} stickyHeaderIndices={creating || listing ? undefined : [0]}
        contentContainerStyle={{ paddingBottom: embedded ? 110 : 40 }} keyboardShouldPersistTaps="handled">
        {creating ? (
          <View style={{ padding: 16 }}><NewListing onDone={() => { setCreating(false); setTab('listings'); void load(); }} /></View>
        ) : listing ? (
          <Detail l={listing} mine={listing.user_id === me} bal={bal} onBalance={() => void load()} onBought={() => { setOpen(null); setTab('purchases'); void load(); }} />
        ) : [
          <View key="search" style={s.stick}>
            <View style={s.search}>
              <Icon name="search" size={16} color={PH} />
              <TextInput value={query} onChangeText={(v) => { setQuery(v); setTab('browse'); }} placeholder="Search products, sellers or location" placeholderTextColor={PH} style={s.searchIn} />
              {!!query && <Pressable accessibilityLabel="Clear search" onPress={() => setQuery('')}><Icon name="x" size={16} color="rgba(255,255,255,0.5)" /></Pressable>}
            </View>
          </View>,
          <View key="body" style={{ paddingHorizontal: 16, gap: 12 }}>
            {!guest && <BalanceCard bal={bal} onChange={() => void load()} />}
            <View style={s.seg}>
              {([['browse', 'All'], ['purchases', 'My purchases'], ['listings', 'My products']] as const).map(([k, l]) => (
                <Pressable key={k} onPress={() => { if (k !== 'browse' && !requireSignIn('tab')) return; setTab(k); }} style={[s.segI, tab === k && s.segOn]}><Text style={[s.segT, tab === k && { color: '#000' }]}>{l}</Text></Pressable>
              ))}
            </View>
            {!!error && <Text style={s.err}>{error}</Text>}
            {items === null && <ActivityIndicator color={colors.primary} />}
            {items !== null && tab === 'browse' && (
              <View style={s.grid}>
                {filtered.length === 0 && <Text style={s.empty}>{q ? `No results for "${query}"` : 'No products yet'}</Text>}
                {filtered.map((l) => (
                  <Pressable key={l.id} style={s.card} onPress={() => { if (requireSignIn()) setOpen(l.id); }} accessibilityLabel={`Open ${richToPlain(l.title)}`}>
                    <View style={s.thumb}>
                      {l.photos[0] ? <Image source={{ uri: l.photos[0] }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Icon name="store" size={34} color="rgba(255,165,0,0.6)" />}
                      {l.status === 'reserved' && <Text style={s.resv}>Reserved</Text>}
                    </View>
                    <View style={{ padding: 8, gap: 2 }}>
                      <RichTextView html={l.title} style={s.cardT} numberOfLines={1} />
                      <Text style={s.price}>{coins(l.price_etb)} coins</Text>
                      {!!l.address && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="mapPin" size={11} color="rgba(255,255,255,0.55)" /><Text numberOfLines={1} style={s.seller}>{l.address}</Text></View>}
                      <View style={{ marginTop: 4, flexDirection: 'row' }}><DeliveryBadge on={l.delivery} /></View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
            {items !== null && tab === 'purchases' && (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([['pending', 'Pending'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] as const).map(([k, lb]) => {
                    const n = buys.filter((o) => buyGroup(o) === k).length;
                    return (
                      <Pressable key={k} accessibilityLabel={`${lb} purchases`} onPress={() => setBf(k)} style={[s.chipF, bf === k && s.chipFOn]}>
                        <Text style={[s.chipFT, bf === k && { color: '#000' }]}>{lb}</Text>
                        <View style={[s.cnt, bf === k && { backgroundColor: 'rgba(0,0,0,0.2)' }]}><Text style={[s.cntT, bf === k && { color: '#000' }]}>{n}</Text></View>
                      </Pressable>
                    );
                  })}
                </View>
                {buys.filter((o) => buyGroup(o) === bf).length === 0
                  ? <Text style={s.empty}>No {bf} purchases</Text>
                  : buys.filter((o) => buyGroup(o) === bf).map((o) => <OrderCard key={o.id} o={o} role="buyer" admin={admin} onDone={() => void load()} />)}
              </View>
            )}
            {items !== null && tab === 'listings' && (mine.length === 0 && sales.length === 0 ? <Text style={s.empty}>Nothing yet</Text> : [...mine.map((l) => (
              <View key={l.id} style={{ gap: 8 }}>
              <View style={s.mineRow}>
                {l.photos[0] ? <Image source={{ uri: l.photos[0] }} style={s.mineImg} /> : <View style={s.mineImg} />}
                <Pressable style={{ flex: 1 }} onPress={() => setOpen(l.id)}>
                  <RichTextView html={l.title} style={s.cardT} numberOfLines={1} />
                  <Text style={s.seller}>{coins(l.price_etb)} coins · {l.status}</Text>
                </Pressable>
                <Pressable accessibilityLabel="Delete listing" hitSlop={8} onPress={() => void remove(l.id)}><Icon name="trash" size={16} color="rgba(255,255,255,0.5)" /></Pressable>
              </View>
              {sales.filter((o) => o.item_id === l.id).map((o) => <OrderCard key={o.id} o={o} role="seller" admin={admin} onDone={() => void load()} />)}
              </View>
            )), ...sales.filter((o) => !mine.some((l) => l.id === o.item_id)).map((o) => <OrderCard key={o.id} o={o} role="seller" admin={admin} onDone={() => void load()} />)])}
          </View>,
        ]}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0B' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  round: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '900' },
  sell: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: A, borderRadius: 6, paddingHorizontal: 12, height: 32 },
  sellT: { color: '#000', fontWeight: '800', fontSize: 12 },
  stick: { backgroundColor: '#0A0A0B', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, borderRadius: 99, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  searchIn: { flex: 1, color: '#fff', fontSize: 14 },
  bal: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 12, paddingVertical: 8, marginTop: 4 },
  balL: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
  balV: { color: '#fff', fontSize: 14, fontWeight: '900' },
  balBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: A, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', gap: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.05)', padding: 4 },
  segI: { flex: 1, borderRadius: 99, paddingVertical: 6, alignItems: 'center' },
  segOn: { backgroundColor: A },
  segT: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { width: '48.3%', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)' },
  thumb: { aspectRatio: 1, backgroundColor: '#17171a', alignItems: 'center', justifyContent: 'center' },
  resv: { position: 'absolute', left: 8, top: 8, color: '#fff', fontSize: 10, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  cardT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  price: { color: A, fontSize: 12, fontWeight: '800' },
  seller: { color: 'rgba(255,255,255,0.55)', fontSize: 10, flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  badgeT: { fontSize: 10, fontWeight: '800' },
  empty: { width: '100%', color: 'rgba(255,255,255,0.4)', textAlign: 'center', paddingVertical: 40, fontSize: 14 },
  err: { color: '#E53935' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 4 },
  lbl: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
  input: { backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  iconIn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, paddingHorizontal: 12, height: 42 },
  iconInT: { flex: 1, color: '#fff', fontSize: 14 },
  rowBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 8 },
  rowT: { color: '#fff', fontSize: 14, fontWeight: '700' },
  yn: { flexDirection: 'row', gap: 4, borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.4)', padding: 4 },
  ynI: { minWidth: 52, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  ynT: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800' },
  tog: { width: 44, height: 24, borderRadius: 12, padding: 2 },
  togK: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  pGrid: { flexDirection: 'row', gap: 8 },
  pCell: { width: '31.5%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  pAdd: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', gap: 2 },
  pAddT: { color: 'rgba(255,255,255,0.6)', fontSize: 10 },
  pX: { position: 'absolute', right: 4, top: 4, borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.6)', padding: 4 },
  cta: { backgroundColor: A, borderRadius: 8, height: 44, alignItems: 'center', justifyContent: 'center' },
  ctaT: { color: '#000', fontWeight: '900' },
  dots: { position: 'absolute', bottom: 8, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotOn: { width: 16, backgroundColor: A },
  bigPrice: { color: '#fff', fontSize: 24, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  addr: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  desc: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  call: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  callT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  escrow: { flexDirection: 'row', gap: 8, borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.1)', padding: 12 },
  escrowT: { flex: 1, color: '#A7F3D0', fontSize: 11 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 12 },
  mineImg: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#17171a' },
  balWrap: { borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 12, paddingVertical: 8, marginTop: 4 },
  smallBtn: { height: 32, borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  smallT: { fontSize: 12, fontWeight: '800' },
  smallT2: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chip: { alignSelf: 'flex-start', borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6 },
  order: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', padding: 12 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.15)', paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8 },
  status: { alignSelf: 'flex-start', marginTop: 4, color: A, backgroundColor: 'rgba(255,165,0,0.15)', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, fontWeight: '800', overflow: 'hidden' },
  msgBox: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,165,0,0.4)', backgroundColor: 'rgba(255,165,0,0.1)', padding: 8 },
  timeline: { marginTop: 8, borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingLeft: 12, gap: 2 },
  tl: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chipF: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.04)' },
  chipFOn: { backgroundColor: A, borderColor: A },
  chipFT: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '800' },
  cnt: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cntT: { color: '#fff', fontSize: 10, fontWeight: '800' },
  sheet: { gap: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', padding: 12 },
});
