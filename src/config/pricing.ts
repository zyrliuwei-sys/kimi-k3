/**
 * Authoritative pricing catalog.
 *
 * The checkout API uses this as the SOURCE OF TRUTH for price/credits/duration.
 * Any price, credits, or plan info sent by the client is IGNORED — only the
 * product_id is honored, and everything else is looked up here.
 *
 * To change pricing, edit this file and redeploy. Admin UI cannot alter prices.
 *
 * Creem note: `productId` is forwarded to Creem as `product_id`. For live
 * purchases, create matching one-time products in the Creem dashboard and set
 * each `productId` below to the real Creem product id (keep it in sync with the
 * prices: $10 / $50 / $100).
 */

import { PaymentInterval, PaymentType } from '@/core/payment/types';

export type PricingPlanInfo = {
  name: string;
  interval: PaymentInterval;
  intervalCount: number;
};

export type PricingProduct = {
  productId: string;
  productName: string;
  planName: string;
  description: string;
  type: PaymentType;
  priceInCents: number;
  currency: string;
  credits: number;
  creditsValidDays?: number;
  plan?: PricingPlanInfo;
};

/**
 * Request packs — one-time API credit top-ups.
 * Keys MUST match what the pricing UI sends as product_id.
 */
export const pricingCatalog: Record<string, PricingProduct> = {
  credits_180: {
    productId: 'credits_180',
    productName: 'Starter Pack',
    planName: 'Starter Pack',
    description: '180 requests',
    type: PaymentType.ONE_TIME,
    priceInCents: 1000, // $10
    currency: 'usd',
    credits: 180,
  },
  credits_950: {
    productId: 'credits_950',
    productName: 'Pro Pack',
    planName: 'Pro Pack',
    description: '950 requests',
    type: PaymentType.ONE_TIME,
    priceInCents: 5000, // $50
    currency: 'usd',
    credits: 950,
  },
  credits_1900: {
    productId: 'credits_1900',
    productName: 'Scale Pack',
    planName: 'Scale Pack',
    description: '1900 requests',
    type: PaymentType.ONE_TIME,
    priceInCents: 10000, // $100
    currency: 'usd',
    credits: 1900,
  },
};

export function getPricingProduct(productId: string): PricingProduct | null {
  if (!productId) return null;
  return pricingCatalog[productId] ?? null;
}

export function listPricingProducts(): PricingProduct[] {
  return Object.values(pricingCatalog);
}
