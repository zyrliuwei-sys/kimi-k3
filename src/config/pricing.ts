/**
 * Authoritative pricing catalog.
 *
 * The checkout API uses this as the SOURCE OF TRUTH for price/credits/duration.
 * Any price, credits, or plan info sent by the client is IGNORED — only the
 * product_id is honored, and everything else is looked up here.
 *
 * To change pricing, edit this file and redeploy. Admin UI cannot alter prices.
 *
 * Pricing model (统一单价 $0.085/积分 ≈ API 底价 $0.015 的 5.67 倍):
 *   - 订阅(月付):Lite $19/224cr, Plus $39/460cr, Pro $79/930cr
 *   - 订阅(年付):Lite $190/2688cr, Plus $390/5520cr, Pro $790/11160cr
 *     UI 按月单价展示,结账收年总价(省 17%)
 *   - 一次性:    Starter $10/118cr, Standard $15/176cr, Boost $20/235cr
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
    description: 'Lite 月度订阅 · 224 积分/月',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 1900, // $19
    currency: USD,
    credits: 224,
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
    description: 'Plus 月度订阅 · 460 积分/月',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 3900, // $39
    currency: USD,
    credits: 460,
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
    description: 'Pro 月度订阅 · 930 积分/月',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 7900, // $79
    currency: USD,
    credits: 930,
    plan: {
      name: 'Pro',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
};

// 年度订阅 — UI 显示月单价,实际按年扣款(等于月费 × 10,省 17%)
const yearlyProducts: Record<string, PricingProduct> = {
  lite_yearly: {
    productId: 'lite_yearly',
    productName: 'Lite',
    planName: 'Lite',
    description: 'Lite 年度订阅 · 2,688 积分/年',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 19000, // $190 (按年一次性扣)
    currency: USD,
    credits: 2688, // 224 × 12
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
    priceInCents: 39000, // $390
    currency: USD,
    credits: 5520, // 460 × 12
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
    description: 'Pro 年度订阅 · 11,160 积分/年',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 79000, // $790
    currency: USD,
    credits: 11160, // 930 × 12
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
    description: 'Starter 小包 · 118 积分(约 128 次 Chat)',
    type: PaymentType.ONE_TIME,
    priceInCents: 1000, // $10
    currency: USD,
    credits: 118,
  },
  standard_once: {
    productId: 'standard_once',
    productName: 'Standard Pack',
    planName: 'Standard Pack',
    description: 'Standard 标配 · 176 积分(约 191 次 Chat)',
    type: PaymentType.ONE_TIME,
    priceInCents: 1500, // $15
    currency: USD,
    credits: 176,
  },
  boost_once: {
    productId: 'boost_once',
    productName: 'Boost Pack',
    planName: 'Boost Pack',
    description: 'Boost 加量包 · 235 积分(约 256 次 Chat)',
    type: PaymentType.ONE_TIME,
    priceInCents: 2000, // $20
    currency: USD,
    credits: 235,
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
