import { friendlyError } from '../../lib/errors';
// Wallet: Purchased + Earnings balances, Buy coins (per platform), Convert (Earnings → Purchased),
// Redeem (Earnings only) and history. Every rule is enforced server-side; checks here are previews.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icons';
import { notify } from '../../lib/notify';
import { giftSubLabel, loadGiftCatalog } from '../../lib/gifts';
import { supabase } from '../../lib/supabase';
import { authMessage, createRedeemSecure, forgotReset, forgotSend, redeemVerify } from '../../lib/authEmail';
import {
  coinsFor, convertEarnings, formatCoins, loadWalletConfig, myRedeems, newIdempotencyKey, packCoins, packPrice, REDEEM_METHODS,
  redeemQuote, supportsCustomAmount, usedToday, useWallet, validateCustom, validateRedeem, visiblePacks, walletHistory,
  type CoinPack, type RedeemFields, type RedeemMethod, type RedeemRequest, type Txn, type WalletConfig,
} from '../../lib/wallet';
import {
  buyGooglePlay, cancelChapa, checkOrder, createOrder, syncChapa, myOrders, paymentStatus, providersForPlatform, restoreGooglePlay, startChapa, usdtInstructions,
  type PaymentProviderId, type PaymentStatusMap, type PurchaseOrder, type PurchaseOutcome, type UsdtInstructions,
} from '../../lib/payments';
import { BottomSheet, Btn, Chip, Field, O, Page, u } from '../profile/menuUi';
import { fetchMyPaidBoosts, type PaidBoost } from '../../lib/boost';

const BOOST_UNIT: Record<string, string> = { views: 'views', likes: 'likes', comments: 'comments', profileViews: 'profile views', liveViewers: 'live viewers' };
const BOOST_STATE = { active: 'In progress', completed: 'Completed', expired: 'Ended' } as const;

type Mode = null | 'buy' | 'convert' | 'redeem';
const FILTERS = [
  ['all', 'All'], ['balance_purchased', 'Purchased'], ['balance_earnings', 'Earnings'], ['purchase', 'Coin purchases'],
  ['gift_sent', 'Gifts sent'], ['gift_received', 'Gifts received'],
  ['live_join_paid', 'Live joining fees paid'], ['live_join_income', 'Live joining income'],
  ['group_join_paid', 'Group joining fees paid'], ['group_join_income', 'Group joining income'],
  ['group_msg_paid', 'Group message fees'], ['group_msg_income', 'Group message income'],
  ['game', 'Games'], ['boost', 'Boosts'], ['vip', 'VIP'], ['market', 'Marketplace'], ['convert', 'Convert'], ['redeem', 'Redeem'],
] as const;
const BAL_LABEL = { purchased: 'Purchased', earnings: 'Earnings', mixed: 'Purchased + Earnings' } as const;
const digits = (v: string) => v.replace(/\D/g, '');
/** Row title including the other person, e.g. "Gift sent → Abebe" / "Gift received · from Sara". */
const txnTitle = (t: Txn) => (t.party ? `${t.title} ${t.kind === 'out' ? '→' : '· from'} ${t.party}` : t.title);

function priceLabel(provider: PaymentProviderId, p: CoinPack) {
  if (provider === 'google_play') return `$${packPrice(provider, p).toFixed(2)}`;
  if (provider === 'usdt_bep20') return `${p.priceUsdt} USDT`;
  return `${(p.priceEtb ?? 0).toLocaleString('en-US')} ETB`;
}
const decimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

export function WalletScreen({ onBack }: { onBack: () => void }) {
  const { balances, refresh } = useWallet();
  const [cfg, setCfg] = useState<WalletConfig | null>(null);
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [redeems, setRedeems] = useState<RedeemRequest[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [boosts, setBoosts] = useState<PaidBoost[]>([]);
  const [ready, setReady] = useState<PaymentStatusMap | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const providers = providersForPlatform();
  const [provider, setProvider] = useState<PaymentProviderId>(providers[0].id);
  const [pack, setPack] = useState<string | null>(null);
  const [usdt, setUsdt] = useState<{ order: PurchaseOrder; info: UsdtInstructions } | null>(null);
  const [convertN, setConvertN] = useState('');
  const [method, setMethod] = useState<RedeemMethod>('telebirr');
  const [rCoins, setRCoins] = useState('');
  const [fields, setFields] = useState<RedeemFields>({});
  const [redeemKey, setRedeemKey] = useState(newIdempotencyKey);
  const [custom, setCustom] = useState('');
  const [step, setStep] = useState(0);
  // Redeem asks for the normal LOGIN password; "Forgot password?" resets it with an emailed code (Resend).
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [fg, setFg] = useState(false);
  const [fgCode, setFgCode] = useState('');
  const [fgPw, setFgPw] = useState('');
  const [fgCool, setFgCool] = useState(0);
  const [accEmail, setAccEmail] = useState('');
  useEffect(() => {
    if (fgCool <= 0) return undefined;
    const t = setTimeout(() => setFgCool((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [fgCool]);

  const loadAll = useCallback(async () => {
    const [h, r, o, bs] = await Promise.allSettled([walletHistory(filter), myRedeems(), myOrders(), fetchMyPaidBoosts()]);
    setTxns(h.status === 'fulfilled' ? h.value : []);
    if (h.status === 'rejected') notify('Could not load transactions', friendlyError(h.reason));
    if (r.status === 'fulfilled') setRedeems(r.value);
    if (o.status === 'fulfilled') setOrders(o.value);
    if (bs.status === 'fulfilled') setBoosts(bs.value);
  }, [filter]);
  useEffect(() => { void loadAll(); }, [loadAll]);
  const [, setCatalogReady] = useState(false);
  useEffect(() => { loadGiftCatalog().then(() => setCatalogReady(true)).catch(() => undefined); }, []);
  useEffect(() => {
    loadWalletConfig().then(setCfg).catch((e) => notify('Could not load wallet settings', friendlyError(e)));
    void paymentStatus().then(setReady);
    // Android: credit any Google Play purchase that was paid but never reached the server (app closed, no network).
    if (Platform.OS === 'android') {
      void restoreGooglePlay().then((coins) => {
        if (coins > 0) { notify(`${formatCoins(coins)} coins from an earlier purchase were added`); void Promise.all([refresh(), loadAll()]); }
      }).catch(() => undefined);
    }
    // Web: after Chapa redirects back (or a webhook was missed) verify pending Chapa orders and refresh the balance.
    let offFocus = () => {};
    if (Platform.OS !== 'android') {
      const back = Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('wallet') === 'chapa';
      if (back) window.history.replaceState({}, '', window.location.pathname);
      const check = (announce: boolean) => void syncChapa().then((coins) => {
        if (coins > 0) notify(`${formatCoins(coins)} coins added to your Purchased balance`);
        else if (announce) notify('Payment pending', 'We are still waiting for Chapa to confirm. Tap "Check payment" in a moment.');
        void Promise.all([refresh(), loadAll()]);
      }).catch(() => undefined);
      check(back);
      // Chapa opens in its own tab: when the user returns to this tab, verify again.
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const onFocus = () => check(false);
        window.addEventListener('focus', onFocus);
        offFocus = () => window.removeEventListener('focus', onFocus);
      }
    }
    return () => offFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => Promise.all([refresh(), loadAll()]);
  const close = () => {
    setMode(null); setPack(null); setUsdt(null); setConvertN(''); setRCoins(''); setFields({}); setCustom(''); setStep(0);
    setPw(''); setShowPw(false); setFg(false); setFgCode(''); setFgPw(''); setFgCool(0);
    setRedeemKey(newIdempotencyKey());
  };
  const report = async (o: PurchaseOutcome) => {
    if (o.status === 'paid') { notify(`${formatCoins(o.coins)} coins added to your Purchased balance`); await sync(); close(); }
    else if (o.status === 'pending') { notify('Payment pending', o.message); await loadAll(); }
    else if (o.status === 'not_configured') notify('Not configured yet', `${o.message}${o.missing?.length ? `\nMissing: ${o.missing.join(', ')}` : ''}`);
    else if (o.status === 'unavailable') notify('Not available here', o.message);
    else if (o.status === 'failed') notify('Payment failed', o.message);
  };
  // Per-button loading for the pending-payment actions: one action at a time, spinner on the pressed button.
  const act = async (key: string, fn: () => Promise<void>) => {
    if (busyKey) return;
    setBusyKey(key);
    try { await fn(); } catch (e) { notify('Error', friendlyError(e)); } finally { setBusyKey(null); }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify('Error', friendlyError(e)); } finally { setBusy(false); }
  };

  // ---------- buy ----------
  const packs = cfg ? visiblePacks(cfg, provider) : [];
  const providerReady = ready?.[provider];
  const customN = Number(custom) || 0;
  const customProblem = cfg && custom ? validateCustom(cfg, provider, customN) : null;
  const limit = cfg?.purchase_limits[provider];
  const buy = () => run(async () => {
    const p = packs.find((x) => x.productId === pack);
    if (!p && !customOk) return notify('Choose a coin pack');
    if (!p && !custom) return notify('Choose a coin pack or enter an amount');
    if (!p && customProblem) return notify(customProblem);
    if (!p && provider === 'google_play') return notify('Choose a coin pack');
    if (providerReady && !providerReady.ready) return report({ status: 'not_configured', message: `${provider} payments are not configured yet`, missing: providerReady.missing });
    const order = p ? await createOrder(provider, p.productId, newIdempotencyKey()) : await createOrder(provider, 'custom', newIdempotencyKey(), customN);
    if (provider === 'google_play') return report(await buyGooglePlay(p!.productId, order.id));
    if (provider === 'chapa') {
      let o = await startChapa(order.id);
      // Chapa allows one checkout per tx_ref. When the saved link expired, the old order was just closed, so open a fresh one.
      if (o.status === 'failed' && /expired/i.test(o.message)) {
        const retry = p ? await createOrder(provider, p.productId, newIdempotencyKey())
          : await createOrder(provider, 'custom', newIdempotencyKey(), customN);
        o = await startChapa(retry.id);
      }
      await loadAll();
      return report(o);
    }
    const info = await usdtInstructions(order.id);
    if ('address' in info) { setUsdt({ order, info }); await loadAll(); } else await report(info);
  });
  const verifyUsdt = () => run(async () => {
    if (!usdt) return;
    await report(await checkOrder(usdt.order));
  });

  // ---------- convert ----------
  const doConvert = () => run(async () => {
    const n = Number(convertN) || 0;
    if (n <= 0) return notify('Enter an amount to convert');
    if (balances && n > balances.earnings) return notify('Not enough Earnings balance');
    await convertEarnings(n); await sync(); close();
    notify(`${formatCoins(n)} coins moved to your Purchased balance`);
  });

  // ---------- redeem ----------
  const rN = Number(rCoins) || 0;
  const tz = cfg?.redeem.timezone ?? 'Africa/Addis_Ababa';
  const used = useMemo(() => usedToday(redeems, tz), [redeems, tz]);
  const quote = cfg ? redeemQuote(cfg, method, rN) : null;
  const redeemProblem = cfg ? validateRedeem(cfg, method, rN, fields, balances?.earnings ?? 0, used) : 'Loading…';
  const doRedeem = () => run(async () => {
    if (redeemProblem) return notify(redeemProblem);
    if (pw.length < 6) return notify('Enter your login password to confirm');
    const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v ?? '').trim()]));
    let token: string;
    try { token = await redeemVerify(pw); } catch (e) { return notify('Error', authMessage(e)); }
    const r = await createRedeemSecure(method, rN, clean, redeemKey, token);
    await sync(); close();
    notify(r.duplicate ? 'This redeem request was already submitted' : 'Redeem requested — coins are held until it is paid');
  });
  const startForgot = () => run(async () => {
    const { data } = await supabase.auth.getUser();
    const em = data.user?.email;
    if (!em) return notify('No email on this account');
    try { await forgotSend(em); setAccEmail(em); setFg(true); setFgCode(''); setFgPw(''); setFgCool(45); notify('Code sent', `Check ${em}`); }
    catch (e) { notify('Error', authMessage(e)); }
  });
  const resendForgot = () => run(async () => {
    if (fgCool > 0) return;
    try { await forgotSend(accEmail); setFgCool(45); notify('A new code was sent'); } catch (e) { notify('Error', authMessage(e)); }
  });
  const finishForgot = () => run(async () => {
    if (!/^\d{6}$/.test(fgCode)) return notify('Enter the 6-digit code');
    if (fgPw.length < 6) return notify('New password must be at least 6 characters');
    try { await forgotReset(accEmail, fgCode, fgPw); setPw(fgPw); setFg(false); notify('Password changed', 'Now confirm your redeem with the new password.'); }
    catch (e) { notify('Error', authMessage(e)); }
  });

  const visible = txns ?? [];
  const pendingOrders = orders.filter((o) => o.status === 'pending' && o.provider !== 'google_play');

  const Choice = ({ label, detail, on, onPress, icon }: { label: string; detail: string; on: boolean; onPress: () => void; icon: IconName }) => (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[s.method, on && s.methodOn]}>
      <View style={s.mIcon}><Icon name={icon} size={16} color={O} /></View>
      <View style={{ flex: 1 }}><Text style={u.rowT}>{label}</Text><Text style={u.hint}>{detail}</Text></View>
      <View style={[s.radio, on && { borderColor: O, backgroundColor: O }]} />
    </Pressable>
  );

  // ---------- step-by-step forms ----------
  const go = (problem: string | null | undefined) => (problem ? notify(problem) : setStep((x) => x + 1));
  const Nav = ({ next, label }: { next: () => void; label: string }) => (
    <View style={s.nav}>
      {step > 0 && (
        <Pressable accessibilityLabel="Back" onPress={() => setStep((x) => Math.max(0, x - 1))} style={s.backBtn}>
          <Text style={s.backT}>Back</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }}><Btn label={label} busy={busy} onPress={next} /></View>
    </View>
  );

  const buySteps = providers.length > 1 ? ['Payment method', 'Amount', 'Review'] : ['Amount', 'Review'];
  const buyTotal = buySteps.length + (provider === 'usdt_bep20' ? 1 : 0);
  const selPack = packs.find((x) => x.productId === pack);
  const selCoins = cfg ? (selPack ? packCoins(cfg, provider, selPack) : custom && !customProblem ? coinsFor(cfg, provider, customN) : 0) : 0;
  const customOk = supportsCustomAmount(provider);
  const selPrice = selPack ? priceLabel(provider, selPack) : `${Number(custom || 0).toLocaleString('en-US')} ${limit?.currency ?? ''}`;
  const amountProblem = !selPack && !custom ? (customOk ? 'Choose a coin pack or enter an amount' : 'Choose a coin pack') : !selPack ? customProblem : null;
  const providerLabel = providers.find((p) => p.id === provider)?.label ?? provider;

  const buySheet = usdt ? (
    <>
      <StepHead title="Buy coins" label="Send USDT" at={buyTotal - 1} total={buyTotal} />
      <View style={s.box}>
        <Text style={u.lbl}>Send exactly</Text>
        <Text selectable style={s.big2}>{usdt.info.amount} {usdt.info.currency}</Text>
        <Text style={u.lbl}>Network</Text><Text style={u.rowT}>{usdt.info.network}</Text>
        <Text style={[u.lbl, { marginTop: 8 }]}>To address</Text><Text selectable style={s.mono}>{usdt.info.address}</Text>
        <Text style={[u.hint, { marginTop: 8 }]}>Other networks will be lost. Coins: {formatCoins(usdt.order.coins)}.</Text>
      </View>
      <Btn label={busy ? 'Checking…' : 'Check payment'} busy={busy} onPress={() => void verifyUsdt()} />
    </>
  ) : (
    <>
      <StepHead title="Buy coins" label={buySteps[step] ?? ''} at={step} total={buyTotal} />
      {buySteps[step] === 'Payment method' && (
        <>
          <View style={{ gap: 8, marginTop: 8 }}>
            {providers.map((p) => {
              const r = ready?.[p.id];
              const detail = !p.supported ? 'Available in the Android app' : r && !r.ready ? `${p.detail} · not configured yet` : p.detail;
              return <Choice key={p.id} label={p.label} detail={detail} icon={p.id === 'usdt_bep20' ? 'coin' : p.id === 'chapa' ? 'phone' : 'store'} on={provider === p.id} onPress={() => { setProvider(p.id); setPack(null); setCustom(''); }} />;
            })}
          </View>
          <Nav label="Next" next={() => go(null)} />
        </>
      )}
      {buySteps[step] === 'Amount' && (
        <>
          {!cfg ? <ActivityIndicator color={O} style={{ marginTop: 16 }} /> : (
            <View style={s.packs} testID="coin-packs">
              {packs.map((p) => (
                <Pressable key={p.productId} accessibilityLabel={`Pack ${p.productId}`} onPress={() => { setPack(p.productId); setCustom(''); }} style={[s.pack, pack === p.productId && s.packOn]}>
                  {p.recommended && <Text numberOfLines={1} style={s.rec}>Recommended</Text>}
                  <Text numberOfLines={1} adjustsFontSizeToFit style={s.packK}>🪙 {formatCoins(packCoins(cfg, provider, p))}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={s.packP}>{priceLabel(provider, p)}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {cfg && limit && customOk && (
            <>
              <Field
                label={`Custom amount (${limit.currency})`} value={custom} keyboardType="decimal-pad" error={!!customProblem}
                placeholder={limit.max ? `${limit.min.toLocaleString('en-US')} – ${limit.max.toLocaleString('en-US')}` : `Min ${limit.min.toLocaleString('en-US')}`}
                onChangeText={(v) => { setCustom(limit.currency === 'USDT' ? decimal(v) : digits(v)); setPack(null); }}
              />
              {!!custom && (customProblem
                ? <Text style={s.err}>{customProblem}</Text>
                : <Text style={s.conv}>= {formatCoins(coinsFor(cfg, provider, customN))} coins</Text>)}
            </>
          )}
          <Nav label="Next" next={() => go(amountProblem)} />
        </>
      )}
      {buySteps[step] === 'Review' && (
        <>
          <View style={s.box}>
            <Row l="Payment method" r={providerLabel} />
            <Row l="Price" r={selPrice} />
            <Row l="You get" r={`${formatCoins(selCoins)} coins`} strong />
          </View>
          <Nav label={busy ? 'Processing…' : 'Pay'} next={() => void buy()} />
        </>
      )}
    </>
  );

  const convertNum = Number(convertN) || 0;
  const convertProblem = convertNum <= 0 ? 'Enter an amount to convert' : balances && convertNum > balances.earnings ? 'Not enough Earnings balance' : null;
  const convertSheet = (
    <>
      <StepHead title="Convert to Purchased" label={step === 0 ? 'Amount' : 'Review'} at={step} total={2} />
      {step === 0 ? (
        <>
          <Text style={[u.hint, { marginTop: 10 }]}>Earnings balance: {formatCoins(balances?.earnings ?? 0)} coins</Text>
          <Field label="Coins to convert" value={convertN} keyboardType="numeric" placeholder="0" error={!!convertN && !!convertProblem} onChangeText={(v) => setConvertN(digits(v))} />
          <Pressable onPress={() => setConvertN(String(balances?.earnings ?? 0))}><Text style={[s.conv, { marginTop: 8 }]}>Use all Earnings</Text></Pressable>
          <Nav label="Next" next={() => go(convertProblem)} />
        </>
      ) : (
        <>
          <View style={s.box}>
            <Row l="From" r="Earnings" />
            <Row l="To" r="Purchased" />
            <Row l="Amount" r={`${formatCoins(convertNum)} coins`} strong />
          </View>
          <Nav label={busy ? 'Converting…' : 'Convert'} next={() => void doConvert()} />
        </>
      )}
    </>
  );

  const set = (k: keyof RedeemFields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));
  const REDEEM_STEPS = ['Payout method', 'Account details', 'Amount', 'Review'];
  // Account-only check: amount rules are neutralised so only field errors remain.
  const fieldProblem = cfg ? validateRedeem(cfg, method, cfg.redeem.min_coins, fields, Number.MAX_SAFE_INTEGER, 0) : 'Loading…';
  const accountSummary = method === 'telebirr' ? `${fields.name ?? ''} · ${fields.phone ?? ''}`
    : method === 'usdt_bep20' ? (fields.address ?? '') : `${fields.full_name ?? ''} · ${fields.account_number ?? ''}`;
  const redeemSheet = cfg && (
    <>
      <StepHead title="Redeem" label={REDEEM_STEPS[step] ?? ''} at={step} total={REDEEM_STEPS.length} />
      {step === 0 && (
        <>
          <Text style={u.sub}>
            From Earnings only · min {formatCoins(cfg.redeem.min_coins)}
          </Text>
          <Text style={[u.hint, { marginTop: 8 }]}>Earnings: {formatCoins(balances?.earnings ?? 0)} coins · used today: {formatCoins(used)}</Text>
          <Text style={[u.lbl, { marginTop: 12 }]}>Payout method</Text>
          <View style={{ gap: 8 }}>
            {REDEEM_METHODS.map((m) => <Choice key={m.id} label={m.label} detail={m.detail} icon={m.id === 'usdt_bep20' ? 'coin' : m.id === 'telebirr' ? 'phone' : 'store'} on={method === m.id} onPress={() => { setMethod(m.id); setFields({}); }} />)}
          </View>
          <Nav label="Next" next={() => go(null)} />
        </>
      )}
      {step === 1 && (
        <>
          {method === 'telebirr' && <>
            <Field label="Name" value={fields.name ?? ''} placeholder="Account holder name" onChangeText={set('name')} />
            <Field label="Phone number" value={fields.phone ?? ''} keyboardType="phone-pad" placeholder="0911223344" onChangeText={set('phone')} />
          </>}
          {(method === 'cbe' || method === 'boa') && <>
            <Field label="Full name" value={fields.full_name ?? ''} placeholder="As on the bank account" onChangeText={set('full_name')} />
            <Field label="Account number" value={fields.account_number ?? ''} keyboardType="numeric" placeholder="1000123456789" onChangeText={(v) => set('account_number')(digits(v))} />
          </>}
          {method === 'usdt_bep20' && (
            <Field label="BEP20 address" value={fields.address ?? ''} autoCapitalize="none" placeholder="0x…" onChangeText={set('address')} />
          )}
          <Nav label="Next" next={() => go(fieldProblem)} />
        </>
      )}
      {step === 2 && (
        <>
          <Text style={[u.hint, { marginTop: 8 }]}>Earnings: {formatCoins(balances?.earnings ?? 0)} coins · used today: {formatCoins(used)}</Text>
          <Field label="Amount (coins)" value={rCoins} keyboardType="numeric" placeholder={String(cfg.redeem.min_coins)} error={rN > 0 && !!redeemProblem} onChangeText={(v) => setRCoins(digits(v))} />
          {quote && rN > 0 && (
            <View style={s.box} testID="redeem-quote">
              <Row l="Amount" r={`${formatCoins(quote.coins)} coins`} />
              <Row l={`Fee (${cfg.redeem.fee_pct}%)`} r={`− ${formatCoins(quote.fee)} coins`} />
              <Row l="You receive" r={`${formatCoins(quote.netCoins)} coins ≈ ${quote.netAmount.toLocaleString('en-US')} ${quote.currency}`} strong />
              {method === 'usdt_bep20' && <Text style={u.hint}>Rate: 1 USDT = {formatCoins(cfg.rates.coins_per_usdt)} coins (same as buying)</Text>}
            </View>
          )}
          {!!redeemProblem && rN > 0 && <Text style={s.err}>{redeemProblem}</Text>}
          <Nav label="Next" next={() => go(redeemProblem)} />
        </>
      )}
      {step === 3 && quote && (
        <>
          <View style={s.box}>
            <Row l="Payout method" r={REDEEM_METHODS.find((m) => m.id === method)?.label ?? method} />
            <Row l="Account" r={accountSummary} />
            <Row l="Amount" r={`${formatCoins(quote.coins)} coins`} />
            <Row l={`Fee (${cfg.redeem.fee_pct}%)`} r={`− ${formatCoins(quote.fee)} coins`} />
            <Row l="You receive" r={`${formatCoins(quote.netCoins)} coins ≈ ${quote.netAmount.toLocaleString('en-US')} ${quote.currency}`} strong />
          </View>
          {!fg ? (
            <>
              <Field label="Confirm with your login password" value={pw} secureTextEntry={!showPw} autoCapitalize="none" placeholder="Password" onChangeText={setPw} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <Pressable onPress={() => setShowPw((v) => !v)}><Text style={s.conv}>{showPw ? 'Hide password' : 'Show password'}</Text></Pressable>
                <Pressable disabled={busy} onPress={() => void startForgot()}><Text style={s.conv}>Forgot password?</Text></Pressable>
              </View>
              <Nav label={busy ? 'Confirming…' : 'Confirm & redeem'} next={() => void doRedeem()} />
            </>
          ) : (
            <>
              <Text style={[u.sub, { marginTop: 12 }]}>We sent a 6-digit code to {accEmail}. Choose a new login password.</Text>
              <Field label="Verification code" value={fgCode} keyboardType="number-pad" placeholder="123456" onChangeText={(v) => setFgCode(digits(v).slice(0, 6))} />
              <Field label="New password" value={fgPw} secureTextEntry={!showPw} autoCapitalize="none" placeholder="At least 6 characters" onChangeText={setFgPw} />
              <Btn label={busy ? 'Saving…' : 'Change password'} busy={busy} onPress={() => void finishForgot()} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
                <Pressable disabled={fgCool > 0 || busy} onPress={() => void resendForgot()}><Text style={[s.conv, fgCool > 0 && { opacity: 0.5 }]}>{fgCool > 0 ? `New code in ${fgCool}s` : 'Send a new code'}</Text></Pressable>
                <Pressable onPress={() => setFg(false)}><Text style={s.conv}>Cancel</Text></Pressable>
              </View>
            </>
          )}
        </>
      )}
    </>
  );

  const sheet = mode && <BottomSheet label={mode} onClose={close}>{mode === 'buy' ? buySheet : mode === 'convert' ? convertSheet : redeemSheet ?? <ActivityIndicator color={O} />}</BottomSheet>;

  return (
    <Page title="Wallet" onBack={onBack} overlay={sheet}>
      <View style={s.card}>
        <Text style={s.cap}>▣ PURCHASED BALANCE</Text>
        <View style={s.balRow}>
          <Icon name="coin" size={24} color={O} />
          <Text testID="wallet-purchased" style={s.big}>{balances ? formatCoins(balances.purchased) : '…'}</Text>
          <Text style={s.unit}>coins</Text>
        </View>
        <View style={s.earn}>
          <Text style={s.cap}>↗ EARNINGS BALANCE</Text>
          <Text testID="wallet-earnings" style={[s.big, { fontSize: 22 }]}>{balances ? formatCoins(balances.earnings) : '…'} <Text style={s.unit}>coins</Text></Text>
        </View>
      </View>
      <View style={s.quick}>
        {([['plus', 'Buy coins', 'buy'], ['arrow', 'Convert', 'convert'], ['wallet', 'Redeem', 'redeem']] as const).map(([ic, l, m], i) => (
          <Pressable key={l} accessibilityLabel={l} onPress={() => setMode(m)} style={[s.qa, i === 0 && { backgroundColor: O, borderColor: O }]}>
            <Icon name={ic} size={20} color={i === 0 ? '#000' : O} />
            <Text style={[s.qaT, i === 0 && { color: '#000' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      {Platform.OS !== 'android' && pendingOrders.length > 0 && (
        <>
          <View style={s.sec}><Text style={u.ght}>Pending payments</Text><View style={s.line} /></View>
          {pendingOrders.map((o) => (
            <View key={o.id} style={s.pend}>
              <View style={s.pendTop}>
                <View style={s.pendIcon}><Icon name="wallet" size={16} color={O} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={u.rowT}>{formatCoins(o.coins)} coins</Text>
                  <Text numberOfLines={1} style={u.hint}>
                    {o.provider === 'chapa' ? 'Chapa' : 'USDT (BEP20)'} · {new Date(o.created_at).toLocaleDateString()} {new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.pendAmt}>{formatCoins(Number(o.amount))} {o.currency === 'USD' ? 'USDT' : 'ETB'}</Text>
                  <Text style={s.pendTag}>Pending</Text>
                </View>
              </View>
              <View style={s.pendActs}>
                <PendBtn label="Check payment" primary loading={busyKey === `${o.id}:check`} disabled={!!busyKey}
                  onPress={() => void act(`${o.id}:check`, async () => {
                    if (o.provider === 'usdt_bep20') {
                      const info = await usdtInstructions(o.id);
                      if ('address' in info) { setProvider('usdt_bep20'); setUsdt({ order: o, info }); setMode('buy'); } else await report(info);
                    } else await report(await checkOrder(o));
                  })} />
                {o.provider === 'chapa' && (
                  <PendBtn label="Open Chapa" loading={busyKey === `${o.id}:open`} disabled={!!busyKey}
                    onPress={() => void act(`${o.id}:open`, async () => { await report(await startChapa(o.id)); })} />
                )}
                {o.provider === 'chapa' && (
                  <PendBtn label="Cancel" loading={busyKey === `${o.id}:cancel`} disabled={!!busyKey}
                    onPress={() => void act(`${o.id}:cancel`, async () => {
                      const out = await cancelChapa(o.id);
                      if (out.status === 'cancelled') { notify('Payment cancelled'); await loadAll(); } else await report(out);
                    })} />
                )}
              </View>
            </View>
          ))}
        </>
      )}
      {boosts.length > 0 && (
        <>
          <View style={s.sec}><Text style={u.ght}>My boosts</Text><View style={s.line} /></View>
          {boosts.map((b) => (
            <View key={b.campaign_id} testID="paid-boost" style={s.txn}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={1} style={u.rowT}>
                  {b.for_other ? `@${b.owner_username ?? 'user'}'s video` : 'Your video'} · {BOOST_UNIT[b.kind] ?? b.kind}
                </Text>
                {!!b.caption && <Text numberOfLines={1} style={u.hint}>{b.caption}</Text>}
                <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: O, width: `${Math.min(100, b.status === 'completed' ? 100 : Math.max(2, b.pct))}%` }} />
                </View>
                <Text style={u.hint}>
                  {formatCoins(b.delivered)} / {formatCoins(b.goal)} {BOOST_UNIT[b.kind] ?? b.kind}
                  {b.status === 'active' ? ` · ${formatCoins(b.remaining)} left` : ''}
                </Text>
              </View>
              <Text style={[s.balTag, { marginTop: 0 }]}>{b.status === 'active' ? `${b.pct}%` : BOOST_STATE[b.status]}</Text>
            </View>
          ))}
        </>
      )}
      <View style={s.sec}><Text style={u.ght}>Transactions</Text><View style={s.line} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {FILTERS.map(([id, l]) => <Chip key={id} label={l} on={filter === id} onPress={() => { if (id !== filter) { setTxns(null); setFilter(id); } }} />)}
      </ScrollView>
      {txns === null ? <ActivityIndicator color={O} /> : visible.length === 0 ? (
        <Text style={[u.hint, { textAlign: 'center', paddingVertical: 40 }]}>No transactions in this filter yet.</Text>
      ) : visible.map((t) => (
        <View key={t.id} testID="wallet-txn" style={s.txn}>
          <View style={[s.tIcon, { backgroundColor: t.kind === 'in' ? 'rgba(34,197,94,0.15)' : 'rgba(255,59,48,0.15)' }]}>
            <Text style={{ color: t.kind === 'in' ? '#22C55E' : '#FF3B30', fontWeight: '900' }}>{t.kind === 'in' ? '↙' : '↗'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={u.rowT}>{txnTitle(t)}</Text>
            <Text numberOfLines={1} style={u.hint}>{giftSubLabel(t.sub)}</Text>
            <Text style={s.balTag}>{t.category === 'convert' ? 'Earnings → Purchased' : t.balance === 'mixed'
              ? `Purchased ${formatCoins(Math.abs(t.purchased_delta))} + Earnings ${formatCoins(Math.abs(t.earnings_delta))}` : BAL_LABEL[t.balance]}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: t.kind === 'in' ? '#22C55E' : '#fff', fontWeight: '800' }}>{t.category === 'convert' ? '⇄' : t.kind === 'in' ? '+' : '−'}{formatCoins(Number(t.amount))}</Text>
            <Text style={s.tTime}>{t.status === 'pending' ? 'Pending' : t.status === 'failed' ? 'Refunded' : new Date(t.created_at).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </Page>
  );
}

/** Small pill button with its own spinner; keeps its width while loading so the row does not jump. */
function PendBtn({ label, onPress, loading, disabled, primary }: { label: string; onPress: () => void; loading: boolean; disabled: boolean; primary?: boolean }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityState={{ busy: loading, disabled }} disabled={disabled} onPress={onPress}
      style={[s.pill, primary ? s.pillOn : s.pillOff, disabled && !loading && { opacity: 0.5 }]}>
      {loading && <ActivityIndicator size="small" color={primary ? '#000' : '#fff'} style={{ transform: [{ scale: 0.7 }] }} />}
      <Text numberOfLines={1} style={[s.smallT, !primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

function StepHead({ title, label, at, total }: { title: string; label: string; at: number; total: number }) {
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={u.h3}>{title}</Text>
      <View style={s.bar}>{Array.from({ length: total }, (_, i) => <View key={i} style={[s.seg, i <= at && { backgroundColor: O }]} />)}</View>
      <Text style={s.stepT}>Step {Math.min(at + 1, total)} of {total} · {label}</Text>
    </View>
  );
}

function Row({ l, r, strong }: { l: string; r: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 2 }}>
      <Text style={u.hint}>{l}</Text><Text style={[u.rowT, strong && { color: O }]}>{r}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,165,0,0.25)', backgroundColor: '#140E06', padding: 20 },
  cap: { color: O, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  balRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 },
  big: { color: '#fff', fontSize: 30, fontWeight: '800' },
  big2: { color: O, fontSize: 22, fontWeight: '900', marginBottom: 6 },
  unit: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', fontSize: 14 },
  earn: { marginTop: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', padding: 12, gap: 4 },
  quick: { flexDirection: 'row', gap: 8, marginTop: 16 },
  qa: { flex: 1, alignItems: 'center', gap: 6, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F' },
  qaT: { color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  sec: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, marginBottom: 8 },
  line: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F', marginBottom: 8 },
  tIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tTime: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700' },
  balTag: { color: O, fontSize: 10, fontWeight: '700', marginTop: 2 },
  packs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6, marginTop: 14 },
  pack: { width: '23.5%', minHeight: 62, paddingHorizontal: 3, paddingTop: 14, paddingBottom: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F', alignItems: 'center', justifyContent: 'center', gap: 2 },
  packOn: { borderColor: O, backgroundColor: 'rgba(255,165,0,0.12)' },
  packP: { color: '#fff', fontSize: 10, fontWeight: '800', maxWidth: '100%' },
  packK: { color: O, fontSize: 11, fontWeight: '900', maxWidth: '100%' },
  rec: { position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center', backgroundColor: O, color: '#000', fontSize: 7, fontWeight: '900', paddingVertical: 1, borderTopLeftRadius: 9, borderTopRightRadius: 9, overflow: 'hidden' },
  conv: { color: O, fontSize: 11, fontWeight: '700', marginTop: 6 },
  err: { color: '#FF6B60', fontSize: 12, fontWeight: '700', marginTop: 8 },
  box: { marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,165,0,0.3)', backgroundColor: 'rgba(255,165,0,0.06)', padding: 12, gap: 2 },
  mono: { color: '#fff', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  method: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F' },
  methodOn: { borderColor: 'rgba(255,165,0,0.6)', backgroundColor: 'rgba(255,165,0,0.08)' },
  mIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  pend: { padding: 12, gap: 10, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,165,0,0.25)', backgroundColor: '#0D0D0F', marginBottom: 8, alignSelf: 'stretch' },
  pendTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pendIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,165,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  pendAmt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  pendTag: { color: O, fontSize: 10, fontWeight: '800', marginTop: 2 },
  pendActs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 32, paddingHorizontal: 14, borderRadius: 99 },
  pillOn: { backgroundColor: O },
  pillOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  small: { backgroundColor: O, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  nav: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  backBtn: { height: 48, paddingHorizontal: 18, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  backT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bar: { flexDirection: 'row', gap: 4, marginTop: 10 },
  seg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  stepT: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', marginTop: 6 },
  smallT: { color: '#000', fontWeight: '900', fontSize: 11 },
});
