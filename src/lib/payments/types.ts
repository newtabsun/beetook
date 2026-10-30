// Shared contracts for coin purchases (PaymentProvider) and redeem payouts (server-side PayoutProvider).
export type PaymentProviderId = 'google_play' | 'chapa' | 'usdt_bep20';

export type PurchaseOutcome =
  | { status: 'paid'; coins: number; duplicate?: boolean }
  | { status: 'pending'; message: string }
  | { status: 'not_configured'; message: string; missing?: string[] }
  | { status: 'unavailable'; message: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/** Sends one Google Play purchase to the server for verification; the server credits the coins. */
export type GooglePlayVerify = (a: { productId: string; purchaseToken: string; orderId: string }) => Promise<PurchaseOutcome>;

export type ProviderReadiness = { mode: 'off' | 'sandbox' | 'live'; ready: boolean; missing: string[] };
export type PaymentStatusMap = Record<PaymentProviderId, ProviderReadiness>;

export type PurchaseOrder = {
  id: string; provider: PaymentProviderId; product_id: string; coins: number; amount: number;
  currency: 'ETB' | 'USD'; status: 'pending' | 'paid' | 'failed' | 'refunded'; created_at: string;
};

export type UsdtInstructions = { address: string; network: string; amount: string; currency: string };
