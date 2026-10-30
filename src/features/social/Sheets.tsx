import { friendlyError } from '../../lib/errors';
import { formatCoins, useGiftCatalog } from '../../lib/gifts';
import { GiftPicker } from '../gifts/GiftPicker';
import { playGift } from '../../lib/giftFx';
import { AppModal } from '../../components/AppModal';
import { notify } from '../../lib/notify';
// Gift / Boost / Post-options sheets. Coin changes happen only in server RPCs.
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View , Platform } from 'react-native';
import { BOOST_TYPES, basePriceFor, boostVideo, customLimits, discountFor, priceFor, type BoostKind } from '../../lib/boost';
import { formatNum, getWallet, reportPost, sendGift, type Post } from '../../lib/api';
import { colors } from '../../theme';
import { Icon, type IconName } from '../../components/Icons';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <AppModal onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 24 }]}><Text style={s.title}>{title}</Text>{children}</View>
    </AppModal>
  );
}

function useCoins() {
  const [coins, setCoins] = useState<number | null>(null);
  useEffect(() => { getWallet().then(setCoins).catch(() => setCoins(null)); }, []);
  return [coins, setCoins] as const;
}

export function GiftSheet({ recipient, recipientName, roomId, postId, onClose, onSent, onRecharge }: {
  recipient: string; recipientName?: string; roomId?: string; postId?: string; onClose: () => void; onSent?: (label: string, qty: number) => void; onRecharge?: () => void;
}) {
  const [coins, setCoins] = useCoins();
  const [giftId, setGiftId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const { gifts } = useGiftCatalog();
  const g = gifts.find((x) => x.id === giftId);
  const total = g ? g.coins * qty : 0;
  const short = !!g && coins !== null && total > coins;
  const send = async () => {
    if (!g) return notify('Pick a gift first');
    setBusy(true);
    try {
      const r = await sendGift(recipient, g.id, qty, roomId, postId);
      setCoins(Number(r.coins)); const label = `${g.emoji} ${g.name} ×${qty}`;
      onSent?.(label, qty); notify('Gift sent', `${label} — 🪙 ${formatCoins(Number(r.spent))}`);
      setSent(label); setGiftId(null); setQty(1);
      playGift({ gift: g, qty, from: 'You', to: recipientName });
      onClose();
    } catch (e) { notify('Error', friendlyError(e)); }
    setBusy(false);
  };
  const W = { alignSelf: 'stretch' as const, minHeight: 48, marginHorizontal: 4, marginTop: 4, paddingHorizontal: 16, borderRadius: 24, backgroundColor: '#FFA500', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <Sheet title={`Send a gift to ${recipientName ?? 'user'}`} onClose={onClose}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={s.muted}>Balance</Text><Text style={[s.text, { fontWeight: '800' }]}>🪙 {coins === null ? '…' : formatCoins(coins)}</Text>
      </View>
      <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        <GiftPicker selectedId={giftId} onPick={(id) => { setGiftId(id); setSent(null); }} />
      </ScrollView>
      <View style={[s.row, { alignItems: 'center', justifyContent: 'center' }]}>
        <Pressable style={s.step} onPress={() => setQty((q) => Math.max(1, q - 1))}><Icon name="minus" size={16} color="#000" /></Pressable>
        <Text style={s.text}>{qty}</Text>
        <Pressable style={s.step} onPress={() => setQty((q) => Math.min(999, q + 1))}><Icon name="plus" size={16} color="#000" /></Pressable>
      </View>
      {short && <Text style={{ color: '#F87171', fontSize: 12, textAlign: 'center' }}>Not enough coins — you need 🪙 {formatCoins(total - (coins ?? 0))} more.</Text>}
      {short ? (
        <Pressable style={W} onPress={() => { onClose(); onRecharge ? onRecharge() : notify('Recharge', 'Open Wallet to recharge coins'); }}><Text style={s.btnT}>Recharge</Text></Pressable>
      ) : (
        <Pressable disabled={busy || !g} style={[W, { opacity: g && !busy ? 1 : 0.4 }]} onPress={() => void send()}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={s.btnT}>{sent ? `✓ Sent ${sent}` : g ? `Send ${g.name} ×${qty} · 🪙 ${formatCoins(total)}` : 'Select a gift'}</Text>}
        </Pressable>
      )}
    </Sheet>
  );
}

const REASONS = ['Spam', 'Harassment', 'Nudity', 'Violence', 'False information'];
const CUSTOM = -1;
export function BoostSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const [coins, setCoins] = useCoins();
  const [kind, setKind] = useState<BoostKind>('views');
  const [amount, setAmount] = useState(BOOST_TYPES[0].amounts[0]);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const type = BOOST_TYPES.find((t) => t.kind === kind)!;
  const limits = customLimits(type);
  const isCustom = amount === CUSTOM;
  const customN = Math.floor(Number(custom) || 0);
  const customValid = customN >= limits.min && customN <= limits.max;
  const qty = isCustom ? customN : amount;
  const valid = !isCustom || customValid;
  const price = valid ? priceFor(type, qty) : 0;
  const balance = coins ?? 0;
  const short = coins !== null && valid && price > balance;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const pick = (k: BoostKind) => { setKind(k); setAmount(BOOST_TYPES.find((t) => t.kind === k)!.amounts[0]); setCustom(''); };
  const go = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const r = await boostVideo(post.id, kind, qty); setCoins(r.coins);
      const target = r.for_other ? `@${post.author?.username ?? 'this user'}'s video` : 'your video';
      notify(kind === 'liveViewers'
        ? `Boost started — ${formatNum(qty)} live viewers will be counted whenever people join ${r.for_other ? 'their live' : 'your live'}`
        : `Boost started — ${target} is shown first to everyone until it reaches ${formatNum(qty)} ${type.unit}`);
      onClose();
    } catch (e) { notify('Error', friendlyError(e)); }
    setBusy(false);
  };
  return (
    <AppModal onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={b.sheet} testID="boost-sheet">
        <View style={b.head}><Text style={b.title}>Boost</Text><Pressable accessibilityLabel="Close" onPress={onClose} style={b.x}><Icon name="x" size={16} color="rgba(255,255,255,0.7)" /></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={b.tabs}>
          {BOOST_TYPES.map((t) => (
            <Pressable key={t.kind} onPress={() => pick(t.kind)} style={[b.tab, t.kind === kind && b.tabOn]}><Text style={[b.tabT, t.kind === kind && b.tabTOn]}>{t.tab}</Text></Pressable>
          ))}
        </ScrollView>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}>
          <Text style={b.hint}>{`${type.example[1]} coins = ${fmt(type.example[0])} ${type.unit}`}{kind === 'liveViewers' ? ' · added to your next live' : ''}</Text>
          <View style={b.grid}>
            {type.amounts.map((a) => {
              const d = discountFor(type, a); const sel = amount === a;
              return (
                <Pressable key={a} testID={`boost-pkg-${a}`} onPress={() => setAmount(a)} style={[b.card, sel && b.cardOn]}>
                  {d > 0 && <Text style={b.off}>-{d}%</Text>}
                  <Text style={b.qty}>{formatNum(a)}</Text>
                  <Text style={b.unit} numberOfLines={1}>{type.unit}</Text>
                  {d > 0 && <Text style={b.strike}>{formatNum(basePriceFor(type, a))}</Text>}
                  <Text style={b.price}>🪙 {formatNum(priceFor(type, a))}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => setAmount(CUSTOM)} style={[b.custom, isCustom && b.cardOn]}>
            <Text style={b.customT}>Custom</Text>
            {isCustom && (<>
              <TextInput autoFocus keyboardType="number-pad" value={custom} onChangeText={(v) => setCustom(v.replace(/\D/g, '').slice(0, 9))}
                placeholder={`${fmt(limits.min)} – ${fmt(limits.max)} ${type.unit}`} placeholderTextColor="rgba(255,255,255,0.4)" style={b.input} />
              <Text style={[b.hint, { marginTop: 4 }, custom && !customValid ? { color: '#FF3B30' } : null]}>
                {custom && !customValid ? `Enter between ${fmt(limits.min)} and ${fmt(limits.max)}`
                  : customValid ? `🪙 ${fmt(price)} coins${discountFor(type, customN) ? ` (-${discountFor(type, customN)}%)` : ''}` : 'Price updates as you type'}
              </Text>
            </>)}
          </Pressable>
        </ScrollView>
        <View style={b.foot}>
          <Text style={[b.hint, { textAlign: 'center' }]}>Balance: 🪙 {coins === null ? '…' : fmt(balance)}</Text>
          {short
            ? <View style={b.btn}><Text style={b.btnT}>Recharge — need 🪙 {fmt(price - balance)} more</Text></View>
            : <Pressable disabled={!valid || busy} style={[b.btn, (!valid || busy) && { opacity: 0.4 }]} onPress={() => void go()}>
                {busy ? <ActivityIndicator color="#000" /> : <Text style={b.btnT}>{valid ? `Boost for ${fmt(price)} coins` : 'Enter an amount'}</Text>}
              </Pressable>}
        </View>
      </View>
    </AppModal>
  );
}

const O = '#FFA500';
const b = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', alignSelf: 'center', width: '100%', maxWidth: 448, backgroundColor: '#0A0A0B', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  head: { paddingVertical: 16, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
  title: { color: '#fff', fontSize: 14, fontWeight: '700' },
  x: { position: 'absolute', right: 16, top: 12, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  tabs: { gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  tab: { borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 6 },
  tabOn: { backgroundColor: O },
  tabT: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  tabTOn: { color: '#000', fontWeight: '800' },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '31.5%', borderRadius: 12, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' },
  cardOn: { borderWidth: 2, borderColor: O, backgroundColor: 'rgba(255,165,0,0.1)' },
  off: { position: 'absolute', top: -6, right: 4, backgroundColor: '#FF3B30', color: '#fff', fontSize: 9, fontWeight: '800', borderRadius: 999, paddingHorizontal: 6, overflow: 'hidden' },
  qty: { color: '#fff', fontSize: 16, fontWeight: '800' },
  unit: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' },
  strike: { color: 'rgba(255,255,255,0.4)', fontSize: 9, textDecorationLine: 'line-through' },
  price: { color: O, fontSize: 11, fontWeight: '700' },
  custom: { marginTop: 8, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' },
  customT: { color: '#fff', fontSize: 12, fontWeight: '800' },
  input: { marginTop: 8, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, color: '#fff', fontSize: 14 },
  foot: { borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  btn: { height: 44, borderRadius: 999, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#000', fontSize: 14, fontWeight: '800' },
});

export function ReportSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const [other, setOther] = useState('');
  const report = async (reason: string) => {
    if (!reason.trim()) return;
    try { await reportPost(post.id, reason.trim().slice(0, 200)); notify('Report sent'); onClose(); } catch (e) { notify('Error', friendlyError(e)); }
  };
  return (
    <Sheet title="Report video" onClose={onClose}>
      <View style={{ gap: 8 }}>
        {REASONS.map((r) => <Pressable key={r} style={s.item} onPress={() => void report(r)}><Text style={s.text}>{r}</Text></Pressable>)}
        <TextInput value={other} onChangeText={setOther} placeholder="Other reason…" placeholderTextColor="#777" style={s.input} maxLength={200} />
        <Pressable style={s.btn} onPress={() => void report(other)}><Text style={s.btnT}>Send</Text></Pressable>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#161616', padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 12 },
  title: { color: '#fff', fontWeight: '900', fontSize: 16, textAlign: 'center' },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  small: { color: '#fff', fontSize: 11, fontWeight: '700' },
  text: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
  on: { backgroundColor: colors.primary },
  step: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: colors.primary, borderRadius: 99, padding: 13, alignItems: 'center' },
  btnT: { color: '#000', fontWeight: '900' },
  irow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  item: { padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  input: { backgroundColor: '#222', color: '#fff', borderRadius: 12, padding: 12 },
});
