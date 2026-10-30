// Android: Google Play Billing via expo-iap. Coins are credited only after the server verifies the
// purchase token (edge function verify-purchase). The purchase is consumed only after that succeeds, so a
// purchase that was paid but not yet credited (app killed, network lost) is restored on the next Wallet open.
import {
  fetchProducts, finishTransaction, getAvailablePurchases, initConnection, purchaseErrorListener, purchaseUpdatedListener, requestPurchase,
} from 'expo-iap';
import type { GooglePlayVerify, PurchaseOutcome } from './types';

export const googlePlaySupported = true;

type IapPurchase = Parameters<Parameters<typeof purchaseUpdatedListener>[0]>[0];
const COIN_SKU = /^coins_\d+$/;

let connection: Promise<boolean> | null = null;
const connect = () => {
  connection ??= Promise.resolve(initConnection()).then(Boolean).catch(() => { connection = null; return false; });
  return connection;
};

/** The order id travels with the purchase as Google's obfuscated profile id. */
const orderOf = (p: IapPurchase, fallback = '') => ('obfuscatedProfileIdAndroid' in p && p.obfuscatedProfileIdAndroid) || fallback;

async function verifyAndFinish(p: IapPurchase, orderId: string, verify: GooglePlayVerify): Promise<PurchaseOutcome> {
  const out = await verify({ productId: p.productId, purchaseToken: p.purchaseToken ?? '', orderId });
  if (out.status === 'paid') await Promise.resolve(finishTransaction({ purchase: p, isConsumable: true })).catch(() => undefined);
  return out;
}

/** Verifies purchases that Google still lists as owned (paid but never credited/consumed). Returns the newly credited coins. */
export async function restoreGooglePlayPurchases(verify: GooglePlayVerify): Promise<number> {
  if (!(await connect())) return 0;
  const owned = await Promise.resolve(getAvailablePurchases()).catch(() => []);
  let credited = 0;
  for (const p of owned ?? []) {
    const orderId = orderOf(p);
    if (!COIN_SKU.test(p.productId) || p.purchaseState === 'pending' || !p.purchaseToken || !orderId) continue;
    const out = await verifyAndFinish(p, orderId, verify).catch(() => null);
    if (out?.status === 'paid' && !out.duplicate) credited += out.coins;
  }
  return credited;
}

export async function buyWithGooglePlay(productId: string, orderId: string, verify: GooglePlayVerify): Promise<PurchaseOutcome> {
  if (!(await connect())) return { status: 'failed', message: 'Google Play is not available on this device' };
  return new Promise<PurchaseOutcome>((resolve) => {
    let done = false;
    const finish = (o: PurchaseOutcome) => {
      if (done) return;
      done = true; updated.remove(); failed.remove(); resolve(o);
    };
    const updated = purchaseUpdatedListener((p) => {
      if (p.productId !== productId) return;
      if (p.purchaseState === 'pending') {
        finish({ status: 'pending', message: 'Payment is pending in Google Play. Coins are added automatically when it completes.' });
        return;
      }
      void verifyAndFinish(p, orderOf(p, orderId), verify)
        .then(finish)
        .catch((e: unknown) => finish({ status: 'failed', message: e instanceof Error ? e.message : String(e) }));
    });
    const failed = purchaseErrorListener((e) => {
      const code = String(e.code);
      if (code === 'user-cancelled') return finish({ status: 'cancelled' });
      if (code === 'already-owned') {
        // An earlier payment of this pack was never credited: restore it now instead of blocking the user.
        void restoreGooglePlayPurchases(verify).then((coins) => finish(coins > 0
          ? { status: 'paid', coins }
          : { status: 'failed', message: 'Google Play still has an unfinished purchase of this pack. Reopen the Wallet in a minute to restore it.' }));
        return;
      }
      finish({ status: 'failed', message: e.message });
    });
    void Promise.resolve(fetchProducts({ skus: [productId], type: 'in-app' }))
      .then((list) => {
        if (!list || list.length === 0) {
          finish({ status: 'not_configured', message: `Product "${productId}" is not set up in Google Play Console yet` });
          return undefined;
        }
        return requestPurchase({ request: { google: { skus: [productId], obfuscatedProfileId: orderId } }, type: 'in-app' });
      })
      .catch((e: unknown) => finish({ status: 'failed', message: e instanceof Error ? e.message : String(e) }));
  });
}
