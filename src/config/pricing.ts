/**
 * Authoritative pricing catalog.
 *
 * The checkout API uses this as the SOURCE OF TRUTH for price/credits/duration.
 * Any price, credits, or plan info sent by the client is IGNORED — only the
 * product_id is honored, and everything else is looked up here.
 *
 * To change pricing, edit this file and redeploy. Admin UI cannot alter prices.
 *
 * Pricing model: product credits use the same unit as the upstream API
 * credits. Package amounts follow the provider's roughly 68 credits/USD
 * wholesale unit (the $10 tier is 650 credits).
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

const USD = 'usd';

// 每月订阅 — 三个档位
const monthlyProducts: Record<string, PricingProduct> = {
  lite_monthly: {
    productId: 'lite_monthly',
    productName: 'Lite',
    planName: 'Lite',
    description: 'Lite 月度订阅 · 1,292 积分/月',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 1900, // $19
    currency: USD,
    credits: 1292,
    plan: {
      name: 'Lite',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
  plus_monthly: {
    productId: 'plus_monthly',
    productName: 'Plus',
    planName: 'Plus',
    description: 'Plus 月度订阅 · 2,652 积分/月',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 3900, // $39
    currency: USD,
    credits: 2652,
    plan: {
      name: 'Plus',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
  pro_monthly: {
    productId: 'pro_monthly',
    productName: 'Pro',
    planName: 'Pro',
    description: 'Pro 月度订阅 · 6,732 积分/月',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 9900, // $99
    currency: USD,
    credits: 6732,
    plan: {
      name: 'Pro',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
};

// 年度订阅 — UI 显示月单价,实际按年扣款(= 月单价 × 12)
const yearlyProducts: Record<string, PricingProduct> = {
  lite_yearly: {
    productId: 'lite_yearly',
    productName: 'Lite',
    planName: 'Lite',
    description: 'Lite 年度订阅 · 2,688 积分/年',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 18000, // $180 (= $15/mo × 12)
    currency: USD,
    credits: 15504, // 1292 × 12
    plan: {
      name: 'Lite',
      interval: PaymentInterval.YEAR,
      intervalCount: 1,
    },
  },
  plus_yearly: {
    productId: 'plus_yearly',
    productName: 'Plus',
    planName: 'Plus',
    description: 'Plus 年度订阅 · 5,520 积分/年',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 42000, // $420 (= $35/mo × 12)
    currency: USD,
    credits: 31824, // 2652 × 12
    plan: {
      name: 'Plus',
      interval: PaymentInterval.YEAR,
      intervalCount: 1,
    },
  },
  pro_yearly: {
    productId: 'pro_yearly',
    productName: 'Pro',
    planName: 'Pro',
    description: 'Pro 年度订阅 · 14,160 积分/年',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 94800, // $948 (= $79/mo × 12)
    currency: USD,
    credits: 80784, // 6732 × 12
    plan: {
      name: 'Pro',
      interval: PaymentInterval.YEAR,
      intervalCount: 1,
    },
  },
};

// 一次性买积分 — 三个档位,低门槛试用
const oneTimeProducts: Record<string, PricingProduct> = {
  starter_once: {
    productId: 'starter_once',
    productName: 'Starter Pack',
    planName: 'Starter Pack',
    description: 'Starter 小包 · 612 积分(约 17 次对话,视长度而定)',
    type: PaymentType.ONE_TIME,
    priceInCents: 900, // $9
    currency: USD,
    credits: 612,
  },
  standard_once: {
    productId: 'standard_once',
    productName: 'Standard Pack',
    planName: 'Standard Pack',
    description: 'Standard 标配 · 1,972 积分(约 57 次对话,视长度而定)',
    type: PaymentType.ONE_TIME,
    priceInCents: 2900, // $29
    currency: USD,
    credits: 1972,
  },
  boost_once: {
    productId: 'boost_once',
    productName: 'Boost Pack',
    planName: 'Boost Pack',
    description: 'Boost 加量包 · 5,372 积分(约 155 次对话,视长度而定)',
    type: PaymentType.ONE_TIME,
    priceInCents: 7900, // $79
    currency: USD,
    credits: 5372,
  },
};

export const pricingCatalog: Record<string, PricingProduct> = {
  ...monthlyProducts,
  ...yearlyProducts,
  ...oneTimeProducts,
};

export function getPricingProduct(productId: string): PricingProduct | null {
  if (!productId) return null;
  return pricingCatalog[productId] ?? null;
}

export function listPricingProducts(): PricingProduct[] {
  return Object.values(pricingCatalog);
}

/**
 * Check whether a product id represents a yearly subscription. The pricing
 * block uses this to decide whether to render the monthly-equivalent label
 * (e.g. "$15.83/月") while still charging the yearly total at checkout.
 */
export function isYearlyProduct(productId: string): boolean {
  return productId.endsWith('_yearly');
}
