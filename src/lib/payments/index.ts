// Coin purchase providers. The client only creates a pending order and starts the provider flow;
// coins are credited by edge functions after they verify the payment with Google / Chapa / BSC.
import { Linking, Platform } from 'react-native';
import { supabase } from '../supabase';
import { buyWithGooglePlay, googlePlaySupported, restoreGooglePlayPurchases } from './googlePlay';
import type { GooglePlayVerify, PaymentProviderId, PaymentStatusMap, PurchaseOrder, PurchaseOutcome, UsdtInstructions } from './types';

export type { PaymentProviderId, PaymentStatusMap, PurchaseOrder, PurchaseOutcome, UsdtInstructions } from './types';

const P = 'app_9e1318caf6_';

export interface PaymentProvider {
  id: PaymentProviderId;
  label: string;
  detail: string;
  /** Platform support (Google Play is Android-only). Server readiness is reported separately. */
  supported: boolean;
}

export const PROVIDERS: Record<PaymentProviderId, PaymentProvider> = {
  google_play: { id: 'google_play', label: 'Google Play', detail: 'Secure payment with your Google Play account', supported: googlePlaySupported },
  chapa: { id: 'chapa', label: 'Chapa', detail: 'telebirr, CBE Birr, M-Pesa, cards and more', supported: true },
  usdt_bep20: { id: 'usdt_bep20', label: 'USDT (BEP20)', detail: 'Crypto payment · BNB Smart Chain', supported: true },
};

/** Android app: Google Play Billing only. Web: Google Play (Android app) + Chapa + USDT BEP20. */
export function providersForPlatform(): PaymentProvider[] {
  return Platform.OS === 'android'
    ? [PROVIDERS.google_play]
    : [PROVIDERS.google_play, PROVIDERS.chapa, PROVIDERS.usdt_bep20];
}

type FnResult = { status: string; message?: string; missing?: string[]; coins?: number; checkout_url?: string } & Record<string, unknown>;

const NOT_DEPLOYED: FnResult = {
  status: 'not_configured', message: 'The payment service is not deployed yet', missing: ['edge function verify-purchase'],
};

async function callFn(slug: string, body: Record<string, unknown>): Promise<FnResult> {
  // The platform header lets the backend refuse non-store payment methods inside the Android app.
  const { data, error } = await supabase.functions.invoke(slug, { body, headers: { 'x-client-platform': Platform.OS } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) as FnResult | null : null;
    if (detail?.status) return detail;
    // Function missing (404) or unreachable: report it honestly instead of failing silently.
    if (!ctx || ctx.status === 404) return NOT_DEPLOYED;
    throw new Error(error.message);
  }
  return data as FnResult;
}

function toOutcome(r: FnResult): PurchaseOutcome {
  if (r.status === 'paid') return { status: 'paid', coins: Number(r.coins) || 0 };
  if (r.status === 'pending') return { status: 'pending', message: r.message ?? 'Payment not confirmed yet' };
  if (r.status === 'not_configured') return { status: 'not_configured', message: r.message ?? 'This payment method is not configured yet', missing: r.missing };
  return { status: 'failed', message: r.message ?? 'Payment could not be verified' };
}

const offMap = (missing: string[]): PaymentStatusMap => {
  const r = { mode: 'off' as const, ready: false, missing };
  return { google_play: r, chapa: r, usdt_bep20: r };
};

/** Readiness per provider. When the payment service cannot be reached, every provider reports "not configured". */
export async function paymentStatus(): Promise<PaymentStatusMap> {
  try {
    const r = await callFn('verify-purchase', { action: 'status' });
    return (r.providers as PaymentStatusMap | undefined) ?? offMap(r.missing ?? ['edge function verify-purchase']);
  } catch { return offMap(['edge function verify-purchase']); }
}

/** Pack order (`productId`) or custom order (`productId = 'custom'` + `amount` in ETB / USDT). */
export async function createOrder(provider: PaymentProviderId, productId: string, key: string, amount?: number): Promise<PurchaseOrder> {
  const { data, error } = await supabase.rpc(`${P}purchase_create`, {
    p_provider: provider, p_product_id: productId, p_idempotency: key, p_amount: amount ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PurchaseOrder;
}

export async function myOrders(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase.from(`${P}purchase_orders`)
    .select('id,provider,product_id,coins,amount,currency,status,created_at').order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as PurchaseOrder[];
}

const verifyGooglePlay: GooglePlayVerify = async ({ productId, purchaseToken, orderId }) =>
  toOutcome(await callFn('verify-purchase', { action: 'google_play_verify', orderId, productId, purchaseToken }));

/** Google Play sells fixed packs only (no custom amount). The order is created first, then the store flow runs. */
export function buyGooglePlay(productId: string, orderId: string): Promise<PurchaseOutcome> {
  return buyWithGooglePlay(productId, orderId, verifyGooglePlay);
}

/** Credits purchases that were paid in Google Play but never reached the server (app closed, network lost). Returns coins added. */
export function restoreGooglePlay(): Promise<number> {
  return restoreGooglePlayPurchases(verifyGooglePlay);
}

/** Opens Chapa checkout. Coins arrive via the Chapa webhook or the "Check payment" verification. */
export async function startChapa(orderId: string): Promise<PurchaseOutcome> {
  const returnUrl = Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}/?wallet=chapa&order=${orderId}` : undefined;
  const r = await callFn('verify-purchase', { action: 'chapa_init', orderId, returnUrl });
  // An expired link cannot be re-initialised (Chapa allows one checkout per tx_ref), so close the dead order right away.
  if (r.status === 'failed' && /expired/i.test(r.message ?? '')) {
    await cancelChapa(orderId).catch(() => undefined);
    return { status: 'failed', message: 'This payment link expired. Start a new payment.' };
  }
  if (r.status === 'checkout' && r.checkout_url) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Chapa's checkout needs first-party cookies (CSRF session). Inside an iframe (app preview, embeds) they are blocked and
      // Chapa answers "419 Page Expired", so it must open as a top-level page: a new tab, else the top window, else this tab.
      let framed = false;
      try { framed = window.self !== window.top; } catch { framed = true; }
      if (framed) {
        const tab = window.open(r.checkout_url, '_blank', 'noopener');
        if (tab) return { status: 'pending', message: 'Chapa opened in a new tab. Finish the payment there; your balance updates when you come back.' };
        try { window.top!.location.href = r.checkout_url; return { status: 'pending', message: 'Opening Chapa…' }; } catch { /* top navigation blocked */ }
      }
      window.location.assign(r.checkout_url);
    } else await Linking.openURL(r.checkout_url);
    return { status: 'pending', message: 'Complete the payment in Chapa, then tap "Check payment".' };
  }
  return toOutcome(r);
}

/** Cancels an unpaid Chapa order (re-checks first, so a payment that just arrived is still credited). */
export async function cancelChapa(orderId: string): Promise<PurchaseOutcome> {
  const r = await callFn('verify-purchase', { action: 'chapa_cancel', orderId });
  return r.status === 'cancelled' ? { status: 'cancelled' } : toOutcome(r);
}

/** Re-checks the user's pending Chapa orders (covers a missed webhook / closed tab). Returns coins added. */
export async function syncChapa(): Promise<number> {
  const r = await callFn('verify-purchase', { action: 'chapa_sync' });
  return r.status === 'ok' ? Number(r.coins) || 0 : 0;
}

export async function checkOrder(order: PurchaseOrder): Promise<PurchaseOutcome> {
  if (order.provider === 'chapa') return toOutcome(await callFn('verify-purchase', { action: 'chapa_verify', orderId: order.id }));
  if (order.provider === 'usdt_bep20') return toOutcome(await callFn('verify-purchase', { action: 'usdt_verify', orderId: order.id }));
  return { status: 'pending', message: 'Google Play purchases are confirmed automatically in the Android app.' };
}

export async function usdtInstructions(orderId: string): Promise<UsdtInstructions | PurchaseOutcome> {
  const r = await callFn('verify-purchase', { action: 'usdt_prepare', orderId });
  if (r.status === 'ready') return { address: String(r.address), network: String(r.network), amount: String(r.amount), currency: String(r.currency) };
  return toOutcome(r);
}
