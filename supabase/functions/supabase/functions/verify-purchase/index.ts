import { createClient } from 'npm:@supabase/supabase-js@2';
const P = 'app_9e1318caf6_';
type Mode = 'off' | 'sandbox' | 'live';
type Json = Record<string, unknown>;
const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const modeOf = (k: string): Mode => {
  const v = env(k).toLowerCase();
  return v === 'live' || v === 'sandbox' ? v : 'off';
};
const envFirst = (...keys: string[]) => keys.map(env).find(Boolean) ?? '';
function envScan(byName: (k: string) => boolean, byValue?: (v: string) => boolean) {
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (v && v.trim() && (byName(k.toUpperCase()) || (byValue ? byValue(v.trim()) : false))) return v.trim();
  }
  return '';
}
const CHAPA_KEY_KEYS = ['CHAPA_SECRET_KEY', 'CHAPA_TEST_SECRET_KEY', 'CHAPA_LIVE_SECRET_KEY', 'CHAPA_SECRET'];
const CHAPA_HASH_KEYS = ['CHAPA_WEBHOOK_SECRET', 'CHAPA_WEBHOOK_HASH', 'CHAPA_SECRET_HASH', 'CHAPA_WEBHOOK_KEY'];
const chapaKey = () => envFirst(...CHAPA_KEY_KEYS)
  || envScan((k) => /CHAPA/.test(k) && /SECRET/.test(k) && !/WEBHOOK|HASH|ENCRYPT|ENC_|PUBLIC/.test(k), (v) => /^CHASECK/i.test(v));
const chapaHash = () => envFirst(...CHAPA_HASH_KEYS)
  || envScan((k) => /CHAPA/.test(k) && /WEBHOOK|HASH|SIGN/.test(k) && !/ENCRYPT|PUBLIC/.test(k));
function chapaMode(): Mode {
  const m = modeOf('PAYMENTS_CHAPA_MODE');
  if (m !== 'off') return m;
  const k = chapaKey();
  return k ? (/_TEST/i.test(k) ? 'sandbox' : 'live') : 'off';
}
function usdtMode(): Mode {
  const m = modeOf('PAYMENTS_USDT_MODE');
  if (m !== 'off') return m;
  return envFirst('NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_KEY', 'NOWPAYMENTS_TOKEN') ? 'live' : 'off';
}
export const SECRETS = {
  google_play: { flag: 'PAYMENTS_GOOGLE_PLAY_MODE', required: ['GOOGLE_PLAY_SERVICE_ACCOUNT'], optional: ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_RTDN_SECRET'] },
  chapa: { flag: 'PAYMENTS_CHAPA_MODE', required: ['CHAPA_SECRET_KEY'], optional: ['CHAPA_WEBHOOK_SECRET', 'CHAPA_CALLBACK_URL', 'PAYMENTS_CRON_SECRET'] as string[] },
  usdt_bep20: { flag: 'PAYMENTS_USDT_MODE', required: ['NOWPAYMENTS_API_KEY'], optional: ['NOWPAYMENTS_IPN_SECRET', 'NOWPAYMENTS_PAY_CURRENCY', 'NOWPAYMENTS_IPN_URL'] },
  payout: {
    flag: 'PAYOUT_MODE',
    perMethod: {
      telebirr: ['TELEBIRR_PAYOUT_URL', 'TELEBIRR_PAYOUT_KEY'],
      cbe: ['CBE_PAYOUT_URL', 'CBE_PAYOUT_KEY'],
      boa: ['BOA_PAYOUT_URL', 'BOA_PAYOUT_KEY'],
      usdt_bep20: ['USDT_PAYOUT_URL', 'USDT_PAYOUT_KEY'],
    } as Record<string, string[]>,
    webhook: 'PAYOUT_WEBHOOK_SECRET',
  },
} as const;
type ProviderId = 'google_play' | 'chapa' | 'usdt_bep20';
function readiness(id: ProviderId) {
  const s = SECRETS[id] as { flag: string; required: readonly string[] };
  const mode = id === 'chapa' ? chapaMode() : id === 'usdt_bep20' ? usdtMode() : modeOf(s.flag);
  const missing: string[] = id === 'chapa'
    ? (chapaKey() ? [] : ['CHAPA_SECRET_KEY'])
    : id === 'usdt_bep20'
      ? (usdtMode() === 'off' ? ['NOWPAYMENTS_API_KEY'] : [])
      : s.required.filter((k) => !env(k));
  if (mode === 'off') missing.unshift(s.flag);
  return { mode, ready: mode !== 'off' && missing.length === 0, missing };
}
const notConfigured = (id: ProviderId) => {
  const r = readiness(id);
  return { status: 'not_configured', message: `${id} payments are not configured yet`, missing: r.missing };
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-platform, chapa-signature, x-chapa-signature, x-payout-signature, x-nowpayments-sig',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const reply = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
async function currentUser(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin().auth.getUser(token);
  return data.user ?? null;
}
type Order = { id: string; user_id: string; provider: ProviderId; product_id: string; coins: number; amount: number; currency: string; status: string; created_at: string; raw?: Json | null };
async function loadOrder(orderId: string, userId?: string): Promise<Order | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId ?? '')) return null;
  const { data } = await admin().from(`${P}purchase_orders`).select('*').eq('id', orderId).maybeSingle();
  if (!data || (userId && data.user_id !== userId)) return null;
  return data as Order;
}
async function settle(order: Order, externalId: string, payload: Json) {
  const { data, error } = await admin().rpc(`${P}purchase_settle`, { p_order: order.id, p_external_id: externalId, p_payload: payload });
  if (error) return { status: 'failed', message: error.message };
  return { status: 'paid', coins: Number((data as Json)?.coins ?? order.coins), duplicate: !!(data as Json)?.duplicate };
}
async function fail(order: Order, reason: string) {
  await admin().rpc(`${P}purchase_fail`, { p_order: order.id, p_reason: reason });
  return { status: 'failed', message: reason };
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s: string) => new TextEncoder().encode(s);
async function hmacHex(secret: string, body: string, hash: 'SHA-256' | 'SHA-512' = 'SHA-256') {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function googleAccessToken(): Promise<string> {
  const sa = JSON.parse(env('GOOGLE_PLAY_SERVICE_ACCOUNT')) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(utf8(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${head}.${claims}`)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(sig)}` }),
  });
  const j = await res.json() as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`Google auth failed: ${j.error_description ?? res.status}`);
  return j.access_token;
}
const GP_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const gpPackage = () => env('GOOGLE_PLAY_PACKAGE_NAME') || 'com.beetook.app';
let gpTokenCache: { token: string; exp: number } | null = null;
async function gpToken() {
  if (!gpTokenCache || gpTokenCache.exp < Date.now() + 60_000) gpTokenCache = { token: await googleAccessToken(), exp: Date.now() + 3_000_000 };
  return gpTokenCache.token;
}
const gpFetch = async (path: string, init: RequestInit = {}) =>
  fetch(`${GP_API}/${gpPackage()}/${path}`, { ...init, headers: { Authorization: `Bearer ${await gpToken()}` } });
type GpProduct = {
  purchaseState?: number; purchaseType?: number; quantity?: number; obfuscatedExternalProfileId?: string; orderId?: string;
};
async function gpProduct(sku: string, token: string): Promise<{ ok: true; p: GpProduct } | { ok: false; status: number }> {
  const res = await gpFetch(`purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(token)}`);
  return res.ok ? { ok: true, p: await res.json() as GpProduct } : { ok: false, status: res.status };
}
async function gpConsume(sku: string, token: string) {
  await gpFetch(`purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(token)}:consume`, { method: 'POST' }).catch(() => undefined);
}
async function gpCheckAndSettle(order: Order, token: string, mode: Mode) {
  const res = await gpProduct(order.product_id, token);
  if (!res.ok) return { status: 'failed', message: `Google Play rejected the purchase (${res.status})` };
  const p = res.p;
  if (p.obfuscatedExternalProfileId && p.obfuscatedExternalProfileId !== order.id) return { status: 'failed', message: 'Purchase belongs to another order' };
  if (p.purchaseState === 2) return { status: 'pending', message: 'Payment is still pending in Google Play' };
  if (p.purchaseState !== 0) return fail(order, 'Google Play purchase was cancelled');
  if (p.purchaseType === 0 && mode === 'live') return { status: 'failed', message: 'Test purchases are not accepted in live mode' };
  if ((p.quantity ?? 1) !== 1) return { status: 'failed', message: 'Only single-quantity purchases are supported' };
  const out = await settle(order, token, { orderId: p.orderId, purchaseType: p.purchaseType ?? null });
  if (out.status === 'paid') await gpConsume(order.product_id, token);
  return out;
}
async function googlePlayVerify(userId: string, body: Json) {
  const r = readiness('google_play');
  if (!r.ready) return notConfigured('google_play');
  const order = await loadOrder(String(body.orderId), userId);
  if (!order || order.provider !== 'google_play') return { status: 'failed', message: 'Order not found' };
  const token = String(body.purchaseToken ?? '');
  if (order.status === 'paid') {
    const { data } = await admin().from(`${P}purchase_orders`).select('external_id').eq('id', order.id).maybeSingle();
    if (token && data?.external_id === token) await gpConsume(order.product_id, token);
    return { status: 'paid', coins: order.coins, duplicate: true };
  }
  if (order.status === 'refunded') return { status: 'failed', message: 'This purchase was refunded' };
  if (!token || String(body.productId) !== order.product_id) return { status: 'failed', message: 'Purchase does not match this order' };
  return gpCheckAndSettle(order, token, r.mode);
}
async function orderByToken(token: string): Promise<Order | null> {
  const { data } = await admin().from(`${P}purchase_orders`).select('*').eq('provider', 'google_play').eq('external_id', token).maybeSingle();
  return (data as Order | null) ?? null;
}
async function voidByToken(token: string, reason: string) {
  const order = await orderByToken(token);
  if (!order) return { status: 'ignored' };
  const { data, error } = await admin().rpc(`${P}purchase_void`, { p_order: order.id, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as Json;
}
async function googlePlayRtdn(req: Request) {
  const secret = env('GOOGLE_PLAY_RTDN_SECRET');
  if (!secret || !safeEqual(new URL(req.url).searchParams.get('key') ?? '', secret)) return reply({ status: 'failed', message: 'Unauthorized' }, 401);
  const r = readiness('google_play');
  if (!r.ready) return reply(notConfigured('google_play'), 503);
  const envelope = await req.json().catch(() => ({})) as { message?: { data?: string } };
  const note = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(envelope.message?.data ?? ''), (c) => c.charCodeAt(0))) || '{}') as {
    packageName?: string;
    oneTimeProductNotification?: { notificationType?: number; purchaseToken?: string; sku?: string };
    voidedPurchaseNotification?: { purchaseToken?: string; productType?: number };
  };
  if (note.packageName && note.packageName !== gpPackage()) return reply({ status: 'ignored' });
  const voided = note.voidedPurchaseNotification;
  if (voided?.purchaseToken) {
    return reply(voided.productType === 2 || voided.productType === undefined ? await voidByToken(voided.purchaseToken, 'Voided by Google Play') : { status: 'ignored' });
  }
  const one = note.oneTimeProductNotification;
  if (!one?.purchaseToken || !one.sku) return reply({ status: 'ignored' });
  const res = await gpProduct(one.sku, one.purchaseToken);
  if (!res.ok) return reply({ status: 'ignored', message: `lookup ${res.status}` });
  const order = await loadOrder(res.p.obfuscatedExternalProfileId ?? '');
  if (!order || order.provider !== 'google_play') return reply({ status: 'ignored' });
  if (one.notificationType === 2) return reply(await fail(order, 'Google Play pending purchase was cancelled'));
  if (one.notificationType === 1) return reply(await gpCheckAndSettle(order, one.purchaseToken, r.mode));
  return reply({ status: 'ignored' });
}
async function googlePlaySyncVoided(req: Request) {
  const secret = env('GOOGLE_PLAY_RTDN_SECRET');
  const user = await currentUser(req);
  const byCron = !!secret && safeEqual(req.headers.get('x-cron-secret') ?? '', secret);
  if (!byCron && !(user && await isAdmin(user.id))) return { status: 'failed', message: 'Admins only' };
  if (!readiness('google_play').ready) return notConfigured('google_play');
  const res = await gpFetch('purchases/voidedpurchases?type=0&maxResults=100');
  if (!res.ok) return { status: 'failed', message: `Google Play ${res.status}` };
  const j = await res.json() as { voidedPurchases?: { purchaseToken: string }[] };
  const results: Json[] = [];
  for (const v of j.voidedPurchases ?? []) results.push(await voidByToken(v.purchaseToken, 'Voided by Google Play (sync)'));
  return { status: 'ok', checked: results.length, refunded: results.filter((x) => x.status === 'refunded' && !x.duplicate).length };
}
const CHAPA = 'https://api.chapa.co/v1';
function chapaKeyProblem(mode: Mode) {
  const test = /_TEST/i.test(chapaKey());
  if (mode === 'live' && test) return 'CHAPA_SECRET_KEY is a test key but PAYMENTS_CHAPA_MODE=live';
  if (mode === 'sandbox' && !test) return 'PAYMENTS_CHAPA_MODE=sandbox needs a Chapa test key (CHASECK_TEST-…)';
  return null;
}
type ChapaTx = { status?: string; amount?: string | number; currency?: string; reference?: string; tx_ref?: string; mode?: string; method?: string; checkout_url?: string };
type ChapaBody = { status?: string; message?: unknown; data?: ChapaTx | null };
async function chapaCall(path: string, init: RequestInit = {}): Promise<{ httpStatus: number; body: ChapaBody }> {
  const attempts = (init.method ?? 'GET') === 'GET' ? 2 : 1;
  let last: { httpStatus: number; body: ChapaBody } = { httpStatus: 0, body: {} };
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${CHAPA}/${path}`, {
        ...init,
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${chapaKey()}`, 'Content-Type': 'application/json' },
      });
      last = { httpStatus: res.status, body: await res.json().catch(() => ({})) as ChapaBody };
      if (res.status < 500) return last;
    } catch {
      last = { httpStatus: 0, body: {} };
    }
  }
  return last;
}
function chapaMsg(b: ChapaBody, fallback: string): string {
  const m = b.message;
  if (typeof m === 'string' && m) return m;
  if (m && typeof m === 'object') return (Object.values(m as Record<string, unknown>) as unknown[]).flat().join(' ');
  return fallback;
}
const ageMin = (o: Order) => (Date.now() - new Date(o.created_at).getTime()) / 60_000;
const RETURN_URL_OK = /^https?:\/\/\S+$/i;
const emailOk = (e?: string) => !!e && e.length <= 50 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
async function chapaInit(userId: string, email: string | undefined, body: Json, platform = '') {
  if (platform === 'android') return { status: 'failed', message: 'Chapa is not available in the Android app. Please pay with Google Play.' };
  const r = readiness('chapa');
  if (!r.ready) return notConfigured('chapa');
  const problem = chapaKeyProblem(r.mode);
  if (problem) return { status: 'not_configured', message: problem, missing: [] };
  const order = await loadOrder(String(body.orderId), userId);
  if (!order || order.provider !== 'chapa') return { status: 'failed', message: 'Order not found' };
  if (order.status === 'paid') return { status: 'paid', coins: order.coins, duplicate: true };
  if (order.status !== 'pending' || order.currency !== 'ETB') return { status: 'failed', message: 'This payment has ended. Start a new payment.' };
  const saved = (order.raw as Json | null | undefined)?.chapa_checkout_url;
  const savedAt = Date.parse(String((order.raw as Json | null | undefined)?.chapa_init_at ?? '')) || 0;
  const fresh = savedAt ? (Date.now() - savedAt) / 60_000 : ageMin(order);
  if (typeof saved === 'string' && fresh < 20) return { status: 'checkout', checkout_url: saved };
  if (typeof saved === 'string') return { status: 'failed', message: 'This payment link expired. Cancel it and start a new payment.' };
  const returnUrl = typeof body.returnUrl === 'string' && RETURN_URL_OK.test(body.returnUrl) ? body.returnUrl : undefined;
  const { httpStatus, body: j } = await chapaCall('transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      amount: String(Number(order.amount)), currency: 'ETB', tx_ref: order.id,
      email: emailOk(email) ? email : undefined,
      callback_url: env('CHAPA_CALLBACK_URL') || `${env('SUPABASE_URL')}/functions/v1/verify-purchase?fn=chapa-webhook`,
      return_url: returnUrl,
      customization: { title: 'Bee Took Coins', description: `${order.coins} coins` },
    }),
  });
  const url = j.data?.checkout_url;
  if (j.status !== 'success' || !url) {
    const msg = chapaMsg(j, `HTTP ${httpStatus}`);
    return { status: 'failed', message: /already|used before|duplicate/i.test(msg) ? 'This payment reference was already used. Start a new payment.' : `Chapa: ${msg}` };
  }
  await admin().from(`${P}purchase_orders`)
    .update({ raw: { ...(order.raw ?? {}), chapa_checkout_url: url, chapa_init_at: new Date().toISOString() } }).eq('id', order.id);
  return { status: 'checkout', checkout_url: url };
}
async function chapaVerifyOrder(order: Order) {
  const r = readiness('chapa');
  if (!r.ready) return notConfigured('chapa');
  if (order.status === 'paid') return { status: 'paid', coins: order.coins, duplicate: true };
  if (order.status === 'refunded') return { status: 'failed', message: 'This purchase was refunded' };
  const { httpStatus, body } = await chapaCall(`transaction/verify/${encodeURIComponent(order.id)}`);
  if (httpStatus === 0 || httpStatus >= 500) return { status: 'pending', message: 'Chapa is not responding. Try again in a moment.' };
  const d = body.data;
  const waited = ageMin(order);
  const expired = waited > 24 * 60;
  if (!d) return expired ? fail(order, 'Payment expired') : { status: 'pending', message: 'Payment not found yet in Chapa' };
  const st = String(d.status ?? '').toLowerCase();
  if (st === 'success') {
    const mode = String(d.mode ?? '').toLowerCase();
    if (d.tx_ref && String(d.tx_ref) !== order.id) return fail(order, 'Payment reference does not match the order');
    if (mode && (r.mode === 'live') !== (mode === 'live')) return fail(order, `Chapa ${mode} payment received in ${r.mode} mode`);
    const amt = typeof d.amount === 'string' ? parseFloat(d.amount) : Number(d.amount);
    if (String(d.currency).toUpperCase() !== 'ETB' || !Number.isFinite(amt) || amt + 1e-9 < Number(order.amount)) return fail(order, 'Paid amount does not match the order');
    return settle(order, d.reference || order.id, { chapa: d });
  }
  if (st === 'failed' || st === 'cancelled') {
    return waited > 60 ? fail(order, `Chapa payment ${st}`) : { status: 'pending', message: 'Payment was not completed. You can retry on the Chapa page or cancel it.' };
  }
  return expired ? fail(order, 'Payment expired') : { status: 'pending', message: 'Payment not completed yet' };
}
async function chapaVoid(order: Order, reason: string) {
  if (order.status !== 'paid') return { status: 'ignored' };
  const { httpStatus, body } = await chapaCall(`transaction/verify/${encodeURIComponent(order.id)}`);
  if (httpStatus === 0 || httpStatus >= 500) throw new Error('Chapa is not reachable');
  const st = String(body.data?.status ?? '').toLowerCase();
  if (st !== 'refunded' && st !== 'reversed') return { status: 'ignored', message: `Chapa status: ${st || 'unknown'}` };
  const { data, error } = await admin().rpc(`${P}purchase_void`, { p_order: order.id, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as Json;
}
async function chapaCancel(order: Order) {
  if (order.status === 'paid') return { status: 'paid', coins: order.coins, duplicate: true };
  if (order.status !== 'pending') return { status: 'cancelled' };
  const checked = await chapaVerifyOrder(order);
  if (checked.status === 'paid' || checked.status === 'not_configured') return checked;
  let paidSeen = false;
  try {
    const { data: seen } = await admin().from(`${P}purchase_events`).select('id').eq('order_id', order.id).eq('event', 'charge.success').limit(1);
    paidSeen = !!seen?.length;
  } catch { paidSeen = false; }
  if (paidSeen) return { status: 'pending', message: 'Chapa reported this payment as paid. Tap "Check payment" again in a moment.' };
  await chapaCall(`transaction/cancel/${encodeURIComponent(order.id)}`, { method: 'PUT' });
  await fail(order, 'Cancelled by user');
  return { status: 'cancelled' };
}
async function chapaSync(userId?: string) {
  let q = admin().from(`${P}purchase_orders`).select('*').eq('provider', 'chapa').eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(userId ? 10 : 100);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  const orders = (data ?? []) as Order[];
  let paid = 0; let coins = 0;
  for (const o of orders) {
    const out = await chapaVerifyOrder(o) as Json;
    if (out.status === 'not_configured') return out;
    if (out.status === 'paid' && !out.duplicate) { paid++; coins += Number(out.coins ?? 0); }
  }
  return { status: 'ok', checked: orders.length, paid, coins };
}
async function chapaSignatureOk(raw: string, h: Headers) {
  const secrets = [chapaHash(), chapaKey()].filter(Boolean);
  const got = ['x-chapa-signature', 'chapa-signature'].map((k) => (h.get(k) ?? '').toLowerCase()).filter(Boolean);
  if (!got.length) return false;
  let canonical = raw;
  try { canonical = JSON.stringify(JSON.parse(raw)); } catch { }
  for (const s of secrets) {
    for (const text of new Set([raw, canonical, s])) {
      const expected = await hmacHex(s, text);
      if (got.some((g) => safeEqual(g, expected))) return true;
    }
  }
  return false;
}
async function logChapaEvent(orderId: string, event: string, p: Json, provider = 'chapa') {
  try {
    const slim = { event, status: p.status ?? p.payment_status, tx_ref: p.tx_ref ?? p.trx_ref, reference: p.reference ?? p.ref_id ?? p.payment_id, amount: p.amount ?? p.price_amount, currency: p.currency ?? p.price_currency, method: p.payment_method ?? p.method ?? p.pay_currency };
    await admin().from(`${P}purchase_events`).insert({ provider, order_id: orderId, event, status: String(p.status ?? p.payment_status ?? ''), payload: slim });
  } catch { }
}
async function chapaWebhook(req: Request) {
  if (!readiness('chapa').ready) return reply(notConfigured('chapa'), 503);
  let payload: Json = {};
  let event = 'callback';
  if (req.method === 'GET') {
    payload = Object.fromEntries(new URL(req.url).searchParams.entries());
  } else {
    const raw = await req.text();
    if (chapaHash() && !(await chapaSignatureOk(raw, req.headers))) return reply({ status: 'failed', message: 'Invalid signature' }, 401);
    try { payload = JSON.parse(raw || '{}') as Json; } catch { return reply({ status: 'failed', message: 'Bad payload' }, 400); }
    event = String(payload.event ?? 'webhook');
    if (payload.type === 'Payout' || event.startsWith('payout')) return reply({ status: 'ignored' });
  }
  const order = await loadOrder(String(payload.tx_ref ?? payload.trx_ref ?? ''));
  if (!order || order.provider !== 'chapa') return reply({ status: 'ignored' });
  await logChapaEvent(order.id, event, payload);
  if (/refund|revers/i.test(event)) return reply(await chapaVoid(order, `Chapa ${event}`));
  return reply(await chapaVerifyOrder(order));
}
async function isCronOrAdmin(req: Request) {
  const cron = env('PAYMENTS_CRON_SECRET') || env('GOOGLE_PLAY_RTDN_SECRET');
  if (cron && safeEqual(req.headers.get('x-cron-secret') ?? '', cron)) return true;
  const user = await currentUser(req);
  return !!user && await isAdmin(user.id);
}
const nowKey = () => envFirst('NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_KEY', 'NOWPAYMENTS_TOKEN');
const nowIpnSecret = () => envFirst('NOWPAYMENTS_IPN_SECRET', 'NOWPAYMENTS_IPN_KEY');
const nowPayCurrency = () => (env('NOWPAYMENTS_PAY_CURRENCY') || 'usdtbsc').toLowerCase();
const nowBase = () => (usdtMode() === 'sandbox' ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1');
type NowPayment = {
  payment_id?: number | string; payment_status?: string; pay_address?: string; pay_amount?: number | string; actually_paid?: number | string;
  price_amount?: number | string; price_currency?: string; pay_currency?: string; order_id?: string; network?: string;
  message?: string; code?: string;
};
async function nowCall(path: string, init: RequestInit = {}): Promise<{ httpStatus: number; body: NowPayment }> {
  const attempts = (init.method ?? 'GET') === 'GET' ? 2 : 1;
  let last: { httpStatus: number; body: NowPayment } = { httpStatus: 0, body: {} };
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${nowBase()}/${path}`, {
        ...init,
        signal: AbortSignal.timeout(15_000),
        headers: { 'x-api-key': nowKey(), 'Content-Type': 'application/json' },
      });
      last = { httpStatus: res.status, body: await res.json().catch(() => ({})) as NowPayment };
      if (res.status < 500) return last;
    } catch {
      last = { httpStatus: 0, body: {} };
    }
  }
  return last;
}
const nowSaved = (o: Order) => ((o.raw as Json | null | undefined)?.nowpayments ?? null) as NowPayment | null;
const nowInstructions = (p: NowPayment) => ({
  status: 'ready', address: String(p.pay_address), amount: String(p.pay_amount),
  network: 'USDT · BEP20 (BNB Smart Chain)', currency: 'USDT', payment_id: String(p.payment_id),
});
async function usdtPrepare(userId: string, body: Json) {
  if (!readiness('usdt_bep20').ready) return notConfigured('usdt_bep20');
  const order = await loadOrder(String(body.orderId), userId);
  if (!order || order.provider !== 'usdt_bep20') return { status: 'failed', message: 'Order not found' };
  if (order.status === 'paid') return { status: 'paid', coins: order.coins, duplicate: true };
  if (order.status !== 'pending') return { status: 'failed', message: 'This payment has ended. Start a new payment.' };
  const saved = nowSaved(order);
  if (saved?.payment_id && saved.pay_address) return nowInstructions(saved);
  const { httpStatus, body: j } = await nowCall('payment', {
    method: 'POST',
    body: JSON.stringify({
      price_amount: Number(order.amount), price_currency: 'usd', pay_currency: nowPayCurrency(),
      order_id: order.id, order_description: `${order.coins} coins`,
      ipn_callback_url: env('NOWPAYMENTS_IPN_URL') || `${env('SUPABASE_URL')}/functions/v1/verify-purchase?fn=usdt-webhook`,
    }),
  });
  if (!j.payment_id || !j.pay_address) return { status: 'failed', message: `NOWPayments: ${j.message ?? `HTTP ${httpStatus}`}` };
  const keep: NowPayment = { payment_id: j.payment_id, pay_address: j.pay_address, pay_amount: j.pay_amount, pay_currency: j.pay_currency, price_amount: j.price_amount };
  await admin().from(`${P}purchase_orders`).update({ raw: { ...(order.raw ?? {}), nowpayments: keep } }).eq('id', order.id);
  return nowInstructions(keep);
}
async function usdtCheck(order: Order, voidIfRefunded = false) {
  if (!readiness('usdt_bep20').ready) return notConfigured('usdt_bep20');
  const saved = nowSaved(order);
  if (order.status === 'refunded') return { status: 'failed', message: 'This purchase was refunded' };
  if (!saved?.payment_id) return order.status === 'paid' ? { status: 'paid', coins: order.coins, duplicate: true } : { status: 'pending', message: 'No payment started yet. Open the payment details first.' };
  const { httpStatus, body: p } = await nowCall(`payment/${encodeURIComponent(String(saved.payment_id))}`);
  if (httpStatus === 0 || httpStatus >= 500) return { status: 'pending', message: 'NOWPayments is not responding. Try again in a moment.' };
  const st = String(p.payment_status ?? '').toLowerCase();
  if (order.status === 'paid') {
    if (voidIfRefunded && st === 'refunded') {
      const { data, error } = await admin().rpc(`${P}purchase_void`, { p_order: order.id, p_reason: 'NOWPayments refund' });
      if (error) throw new Error(error.message);
      return data as Json;
    }
    return { status: 'paid', coins: order.coins, duplicate: true };
  }
  if (!st) return { status: 'pending', message: p.message ?? 'Payment not found yet' };
  if (String(p.order_id ?? order.id) !== order.id) return fail(order, 'Payment reference does not match the order');
  if (st === 'finished') {
    if (String(p.pay_currency ?? '').toLowerCase() !== nowPayCurrency()) return fail(order, 'Payment currency does not match the order');
    if (!(Number(p.price_amount) + 1e-9 >= Number(order.amount)) || !(Number(p.actually_paid) > 0)) return fail(order, 'Paid amount does not match the order');
    return settle(order, `nowpayments:${saved.payment_id}`, { nowpayments: p });
  }
  if (st === 'failed' || st === 'expired' || st === 'refunded') return fail(order, `NOWPayments payment ${st}`);
  if (st === 'partially_paid') return { status: 'pending', message: `Only part of the amount arrived (${p.actually_paid} of ${p.pay_amount} USDT). Send the rest to the same address.` };
  if (st === 'confirming' || st === 'confirmed' || st === 'sending') return { status: 'pending', message: 'Payment received. Waiting for the network to finish confirming…' };
  return { status: 'pending', message: 'Waiting for your USDT transfer…' };
}
async function usdtVerify(userId: string, body: Json) {
  const order = await loadOrder(String(body.orderId), userId);
  if (!order || order.provider !== 'usdt_bep20') return { status: 'failed', message: 'Order not found' };
  return usdtCheck(order);
}
const sortKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Json).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v;
async function usdtWebhook(req: Request) {
  if (!readiness('usdt_bep20').ready) return reply(notConfigured('usdt_bep20'), 503);
  let payload: Json = {};
  try { payload = JSON.parse(await req.text() || '{}') as Json; } catch { return reply({ status: 'failed', message: 'Bad payload' }, 400); }
  const secret = nowIpnSecret();
  if (secret) {
    const got = (req.headers.get('x-nowpayments-sig') ?? '').toLowerCase();
    if (!safeEqual(got, await hmacHex(secret, JSON.stringify(sortKeys(payload)), 'SHA-512'))) return reply({ status: 'failed', message: 'Invalid signature' }, 401);
  }
  const order = await loadOrder(String(payload.order_id ?? ''));
  if (!order || order.provider !== 'usdt_bep20') return reply({ status: 'ignored' });
  await logChapaEvent(order.id, `nowpayments.${String(payload.payment_status ?? 'event')}`, payload, 'usdt_bep20');
  return reply(await usdtCheck(order, true));
}
async function usdtSync(userId?: string) {
  let q = admin().from(`${P}purchase_orders`).select('*').eq('provider', 'usdt_bep20').eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(userId ? 10 : 100);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  const orders = ((data ?? []) as Order[]).filter((o) => nowSaved(o)?.payment_id);
  let paid = 0; let coins = 0;
  for (const o of orders) {
    const out = await usdtCheck(o) as Json;
    if (out.status === 'not_configured') break;
    if (out.status === 'paid' && !out.duplicate) { paid++; coins += Number(out.coins ?? 0); }
  }
  return { checked: orders.length, paid, coins };
}
async function paymentsSync(userId?: string) {
  const c = await chapaSync(userId) as Json;
  const n = await usdtSync(userId);
  return {
    status: 'ok', checked: Number(c.checked ?? 0) + n.checked, paid: Number(c.paid ?? 0) + n.paid, coins: Number(c.coins ?? 0) + n.coins,
  };
}
type Redeem = { id: string; user_id: string; method: string; fields: Json; coins: number; net_amount: number; currency: string; status: string };
function payoutReadiness(method: string) {
  const mode = env(SECRETS.payout.flag).toLowerCase() || 'off';
  const keys = SECRETS.payout.perMethod[method] ?? [];
  const missing = mode === 'live' ? keys.filter((k) => !env(k)) : [];
  return { mode, ready: mode === 'manual' || (mode === 'live' && missing.length === 0), missing: mode === 'off' ? [SECRETS.payout.flag] : missing };
}
async function setRedeemStatus(id: string, status: string, note?: string, ref?: string) {
  const { data, error } = await admin().rpc(`${P}redeem_set_status`, { p_id: id, p_status: status, p_note: note ?? null, p_provider_ref: ref ?? null });
  if (error) return { status: 'failed', message: error.message };
  return data as Json;
}
async function sendPayout(r: Redeem) {
  const [urlKey, keyKey] = SECRETS.payout.perMethod[r.method];
  const res = await fetch(env(urlKey), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env(keyKey)}`, 'Content-Type': 'application/json', 'Idempotency-Key': r.id },
    body: JSON.stringify({ request_id: r.id, method: r.method, amount: r.net_amount, currency: r.currency, recipient: r.fields }),
  });
  const j = await res.json().catch(() => ({})) as { reference?: string; status?: string; message?: string };
  if (!res.ok) return { ok: false, message: j.message ?? `Gateway error ${res.status}` };
  return { ok: true, reference: j.reference ?? '', paid: j.status === 'paid' };
}
async function isAdmin(userId: string) {
  const { data } = await admin().from(`${P}profiles`).select('is_admin').eq('id', userId).maybeSingle();
  return !!data?.is_admin;
}
async function payout(req: Request, body: Json) {
  if (body.action === 'callback') {
    const raw = JSON.stringify(body.payload ?? {});
    const secret = env(SECRETS.payout.webhook);
    if (!secret) return reply({ status: 'not_configured', missing: [SECRETS.payout.webhook] }, 503);
    if (!safeEqual((req.headers.get('x-payout-signature') ?? '').toLowerCase(), await hmacHex(secret, raw))) return reply({ status: 'failed', message: 'Invalid signature' }, 401);
    const p = body.payload as { request_id?: string; status?: string; reference?: string; reason?: string };
    if (!p?.request_id || !['paid', 'failed', 'rejected'].includes(String(p.status))) return reply({ status: 'failed', message: 'Bad payload' }, 400);
    return reply(await setRedeemStatus(p.request_id, String(p.status), p.reason, p.reference));
  }
  const user = await currentUser(req);
  if (!user) return reply({ status: 'failed', message: 'Please sign in' }, 401);
  if (!(await isAdmin(user.id))) return reply({ status: 'failed', message: 'Admins only' }, 403);
  if (body.action === 'status') {
    return reply({ status: 'ok', methods: Object.fromEntries(Object.keys(SECRETS.payout.perMethod).map((m) => [m, payoutReadiness(m)])) });
  }
  if (body.action === 'list') {
    const { data } = await admin().from(`${P}redeem_requests`).select('*').in('status', ['pending', 'processing']).order('created_at').limit(100);
    return reply({ status: 'ok', requests: data ?? [] });
  }
  const { data: r } = await admin().from(`${P}redeem_requests`).select('*').eq('id', String(body.requestId)).maybeSingle();
  if (!r) return reply({ status: 'failed', message: 'Request not found' }, 404);
  const req0 = r as Redeem;
  if (body.action === 'reject') return reply(await setRedeemStatus(req0.id, 'rejected', String(body.note ?? 'Rejected by admin')));
  if (body.action === 'mark_paid') {
    if (payoutReadiness(req0.method).mode !== 'manual') return reply({ status: 'failed', message: 'mark_paid is only allowed with PAYOUT_MODE=manual' }, 400);
    return reply(await setRedeemStatus(req0.id, 'paid', String(body.note ?? 'Paid manually'), String(body.reference ?? '')));
  }
  if (body.action === 'process') {
    const ready = payoutReadiness(req0.method);
    if (ready.mode !== 'live' || !ready.ready) return reply({ status: 'not_configured', message: `Automatic ${req0.method} payouts are not configured`, missing: ready.missing });
    if (req0.status !== 'pending') return reply({ status: 'failed', message: `Request is ${req0.status}` }, 400);
    await setRedeemStatus(req0.id, 'processing', 'Sent to payout gateway');
    const out = await sendPayout(req0).catch((e: Error) => ({ ok: false as const, message: e.message }));
    if (!out.ok) return reply(await setRedeemStatus(req0.id, 'failed', out.message));
    if ('paid' in out && out.paid) return reply(await setRedeemStatus(req0.id, 'paid', 'Paid by gateway', out.reference));
    return reply({ status: 'processing', reference: 'reference' in out ? out.reference : '' });
  }
  return reply({ status: 'failed', message: 'Unknown action' }, 400);
}
type Route = 'verify-purchase' | 'chapa-webhook' | 'usdt-verify' | 'usdt-webhook' | 'payout' | 'google-play-rtdn';
const ROUTES: Route[] = ['chapa-webhook', 'usdt-verify', 'usdt-webhook', 'payout', 'google-play-rtdn'];
export async function handle(slug: Route, req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const fn = url.searchParams.get('fn') ?? url.pathname.split('/').filter(Boolean).pop() ?? '';
  const route: Route = (ROUTES as string[]).includes(fn) ? fn as Route : slug;
  if (req.method !== 'POST' && !(req.method === 'GET' && route === 'chapa-webhook')) return reply({ status: 'failed', message: 'POST only' }, 405);
  try {
    if (route === 'chapa-webhook') return await chapaWebhook(req);
    if (route === 'usdt-webhook') return await usdtWebhook(req);
    if (route === 'google-play-rtdn') return await googlePlayRtdn(req);
    const body = await req.json().catch(() => ({})) as Json;
    if (route === 'payout') return await payout(req, body);
    if (body.action === 'google_play_sync_voided') return reply(await googlePlaySyncVoided(req));
    if (body.action === 'chapa_reconcile') {
      return (await isCronOrAdmin(req)) ? reply(await paymentsSync()) : reply({ status: 'failed', message: 'Admins only' }, 403);
    }
    const user = await currentUser(req);
    if (!user) return reply({ status: 'failed', message: 'Please sign in' }, 401);
    if (route === 'usdt-verify' || body.action === 'usdt_prepare' || body.action === 'usdt_verify') {
      return reply(body.action === 'prepare' || body.action === 'usdt_prepare' ? await usdtPrepare(user.id, body) : await usdtVerify(user.id, body));
    }
    switch (body.action) {
      case 'status':
        return reply({ status: 'ok', providers: { google_play: readiness('google_play'), chapa: { ...readiness('chapa'), webhook_signature: !!chapaHash() }, usdt_bep20: readiness('usdt_bep20') } });
      case 'google_play_verify': return reply(await googlePlayVerify(user.id, body));
      case 'chapa_init': return reply(await chapaInit(user.id, user.email, body, (req.headers.get('x-client-platform') ?? '').toLowerCase()));
      case 'chapa_verify': {
        const order = await loadOrder(String(body.orderId), user.id);
        if (!order || order.provider !== 'chapa') return reply({ status: 'failed', message: 'Order not found' });
        return reply(await chapaVerifyOrder(order));
      }
      case 'chapa_cancel': {
        const order = await loadOrder(String(body.orderId), user.id);
        if (!order || order.provider !== 'chapa') return reply({ status: 'failed', message: 'Order not found' });
        return reply(await chapaCancel(order));
      }
      case 'chapa_sync': return reply(await paymentsSync(user.id));
      default: return reply({ status: 'failed', message: 'Unknown action' }, 400);
    }
  } catch (e) {
    return reply({ status: 'failed', message: e instanceof Error ? e.message : String(e) }, 500);
  }
}
Deno.serve((req) => handle('verify-purchase', req));