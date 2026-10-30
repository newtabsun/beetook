// Web / non-Android build: Google Play Billing only exists inside the Android app.
// The Android implementation lives in googlePlay.android.ts (Metro picks it by platform extension).
import type { GooglePlayVerify, PurchaseOutcome } from './types';

export const googlePlaySupported = false;

export async function buyWithGooglePlay(_productId: string, _orderId: string, _verify: GooglePlayVerify): Promise<PurchaseOutcome> {
  return { status: 'unavailable', message: 'Google Play Billing works in the Bee Took Android app. On the web, pay with Chapa or USDT (BEP20).' };
}

export async function restoreGooglePlayPurchases(_verify: GooglePlayVerify): Promise<number> {
  return 0;
}
