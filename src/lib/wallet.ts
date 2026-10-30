// Server-owned wallet with two balances. Every rule (spend priority, convert, redeem limits, purchases)
// is enforced by Supabase RPCs; the checks here only give instant feedback before the request is sent.
import { useCallback, useEffect, useState } from 'react';
import { friendlyError } from './errors';
import { supabase } from './supabase';

const P = 'app_9e1318caf6_';

async function rpc<R>(name: string, args?: Record<string, unknown>): Promise<R> {
  const { data, error } = await supabase.rpc(P + name, args);
  if (error) throw new Error(error.message);
  return data as R;
}

export const formatCoins = (n: number) => Math.floor(n).toLocaleString('en-US');

export type Balances = { purchased: number; earnings: number; coins: number };
export type BalanceKind = 'purchased' | 'earnings' | 'mixed';

export type CoinPack = { productId: string; priceEtb?: number; priceUsdt?: number; priceUsd?: number; recommended?: boolean };
export type PurchaseLimit = { currency: 'ETB' | 'USDT' | 'USD'; min: number; max: number; step?: number };
export type RedeemMethod = 'telebirr' | 'cbe' | 'boa' | 'usdt_bep20';
export type WalletConfig = {
  rates: { coins_per_etb: number; coins_per_usdt: number; coins_per_usd: number; usdt_network: string };
  redeem: { min_coins: number; fee_pct: number; daily_max_coins: number; timezone: string; methods: RedeemMethod[] };
  coin_packs: { google_play: CoinPack[]; chapa: CoinPack[]; usdt_bep20: CoinPack[] };
  purchase_limits: { google_play: PurchaseLimit; chapa: PurchaseLimit; usdt_bep20: PurchaseLimit };
  market?: { return_fee_pct: number };
};
type ProviderKey = keyof WalletConfig['coin_packs'];

/** Price of a pack in the provider's own currency (Google Play: USD, USDT: USDT, Chapa: ETB). */
export function packPrice(provider: ProviderKey, p: CoinPack): number {
  return num(provider === 'google_play' ? p.priceUsd : provider === 'usdt_bep20' ? p.priceUsdt : p.priceEtb);
}

/** Packs a provider may sell: Chapa packs below its minimum are never offered. */
export function visiblePacks(cfg: WalletConfig, provider: ProviderKey): CoinPack[] {
  const min = provider === 'chapa' ? cfg.purchase_limits.chapa.min : 0;
  return cfg.coin_packs[provider].filter((p) => packPrice(provider, p) >= min);
}

/** Google Play sells fixed packs only; Chapa and USDT also accept a custom amount. */
export const supportsCustomAmount = (provider: ProviderKey) => provider !== 'google_play';

/** Coins for a price in the provider's currency — the same rate the server uses ($1 = 1,600 coins). */
export function coinsFor(cfg: WalletConfig, provider: ProviderKey, price: number): number {
  const rate = provider === 'usdt_bep20' ? cfg.rates.coins_per_usdt : provider === 'google_play' ? cfg.rates.coins_per_usd : cfg.rates.coins_per_etb;
  return Math.round(price * rate);
}

/** Instant preview of the server-side custom amount checks. */
export function validateCustom(cfg: WalletConfig, provider: ProviderKey, amount: number): string | null {
  const l = cfg.purchase_limits[provider];
  if (!amount || amount <= 0) return 'Enter an amount';
  if (amount < l.min) return `Minimum is ${l.min.toLocaleString('en-US')} ${l.currency}`;
  if (amount > l.max) return `Maximum is ${l.max.toLocaleString('en-US')} ${l.currency}`;
  if (l.currency === 'ETB' && amount % Math.max(1, l.step ?? 1) !== 0) return `Use a multiple of ${l.step} ETB`;
  return null;
}

const num = (v: unknown) => Number(v) || 0;
const toBalances = (r: Partial<Balances> | null | undefined): Balances => {
  const purchased = num(r?.purchased); const earnings = num(r?.earnings);
  return { purchased, earnings, coins: purchased + earnings };
};

export const getBalances = async () => toBalances(await rpc<Balances>('get_wallet'));
export const loadWalletConfig = () => rpc<WalletConfig>('wallet_settings');
/** Earnings → Purchased (free). There is intentionally no API for the opposite direction. */
export const convertEarnings = async (coins: number) => toBalances(await rpc<Balances>('wallet_convert', { p_coins: coins }));

/** Coins a pack is worth: Chapa/USDT packs are derived from the shared rate so purchase and redeem match. */
export function packCoins(cfg: WalletConfig, provider: ProviderKey, p: CoinPack): number {
  return coinsFor(cfg, provider, packPrice(provider, p));
}

// ---------- redeem ----------
export const REDEEM_METHODS: { id: RedeemMethod; label: string; detail: string }[] = [
  { id: 'telebirr', label: 'telebirr', detail: 'Mobile money · ETB' },
  { id: 'cbe', label: 'CBE', detail: 'Commercial Bank of Ethiopia · ETB' },
  { id: 'boa', label: 'BOA', detail: 'Bank of Abyssinia · ETB' },
  { id: 'usdt_bep20', label: 'USDT', detail: 'BEP20 (BNB Smart Chain) only' },
];
export type RedeemFields = { name?: string; phone?: string; full_name?: string; account_number?: string; address?: string };
export const BEP20_RE = /^0x[0-9a-fA-F]{40}$/;
const PHONE_RE = /^\+?[0-9]{9,15}$/;
const ACCOUNT_RE = /^[0-9]{8,20}$/;

export type RedeemQuote = { coins: number; fee: number; netCoins: number; netAmount: number; currency: 'ETB' | 'USDT' };
export function redeemQuote(cfg: WalletConfig, method: RedeemMethod, coins: number): RedeemQuote {
  const fee = Math.floor((coins * cfg.redeem.fee_pct) / 100);
  const netCoins = coins - fee;
  const usdt = method === 'usdt_bep20';
  const perCoin = 1 / Math.max(1, usdt ? cfg.rates.coins_per_usdt : cfg.rates.coins_per_etb);
  return { coins, fee, netCoins, netAmount: Math.round(netCoins * perCoin * 100) / 100, currency: usdt ? 'USDT' : 'ETB' };
}

/** Mirrors redeem_create on the server. Returns the first problem, or null when the request looks valid. */
export function validateRedeem(cfg: WalletConfig, method: RedeemMethod, coins: number, f: RedeemFields, earnings: number, usedToday: number): string | null {
  if (method === 'telebirr') {
    if (!f.name?.trim()) return 'Enter the account holder name';
    if (!PHONE_RE.test((f.phone ?? '').trim())) return 'Enter a valid phone number';
  } else if (method === 'cbe' || method === 'boa') {
    if (!f.full_name?.trim()) return 'Enter your full name';
    if (!ACCOUNT_RE.test((f.account_number ?? '').trim())) return 'Enter a valid account number (8–20 digits)';
  } else if (!BEP20_RE.test((f.address ?? '').trim())) return 'Enter a valid BEP20 address (0x + 40 hex characters)';
  if (!coins) return 'Enter an amount';
  if (coins < cfg.redeem.min_coins) return `Minimum redeem is ${formatCoins(cfg.redeem.min_coins)} coins`;
  if (usedToday + coins > cfg.redeem.daily_max_coins) return `Daily redeem limit is ${formatCoins(cfg.redeem.daily_max_coins)} coins (used ${formatCoins(usedToday)})`;
  if (coins > earnings) return 'Redeem is only available from your Earnings balance';
  return null;
}

export type RedeemStatus = 'pending' | 'processing' | 'paid' | 'rejected' | 'failed';
export type RedeemRequest = {
  id: string; method: RedeemMethod; coins: number; fee: number; net_coins: number; net_amount: number;
  currency: string; status: RedeemStatus; note: string | null; created_at: string;
};
// Redeem requests go through `createRedeemSecure` in ./authEmail (needs the login-password confirmation token).

export async function myRedeems(): Promise<RedeemRequest[]> {
  const { data, error } = await supabase.from(`${P}redeem_requests`)
    .select('id,method,coins,fee,net_coins,net_amount,currency,status,note,created_at')
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as RedeemRequest[];
}

/** Coins already requested today (platform timezone), counting pending, processing and paid requests. */
export function usedToday(list: RedeemRequest[], timezone: string): number {
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: timezone });
  const today = day(new Date());
  return list.filter((r) => r.status !== 'rejected' && r.status !== 'failed' && day(new Date(r.created_at)) === today)
    .reduce((n, r) => n + num(r.coins), 0);
}

export const newIdempotencyKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// ---------- history ----------
export type Txn = {
  id: string; kind: 'in' | 'out'; category: string; title: string; sub: string; amount: number; status: string;
  created_at: string; purchased_delta: number; earnings_delta: number; balance: BalanceKind;
  /** Precise type used by the filters (e.g. gift_sent, live_join_paid, group_join_income, game). */
  tx_kind: string;
  /** Other person in the transaction (gift recipient/sender, live host/viewer, group owner/member). */
  party: string | null;
};
/** History filtered server-side by type; `all` returns every type. Rows are unique by id. */
export async function walletHistory(kind = 'all'): Promise<Txn[]> {
  const rows = await rpc<Txn[]>('wallet_history', { p_kind: kind });
  return [...new Map((rows ?? []).map((t) => [t.id, t])).values()];
}

// ---------- hook ----------
export function useWallet() {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setBalances(await getBalances()); setError(''); } catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  /** Spendable total (Purchased + Earnings): what every "enough coins?" check uses. */
  const coins = balances ? balances.coins : null;
  const setCoins = useCallback((total: number) => setBalances((b) => (b ? { ...b, coins: total } : b)), []);
  return { balances, coins, setCoins, refresh, error };
}
