/**
 * Subscription quota (message count) service.
 *
 * Subscription plans charge by "times" (messages) per billing period, not by
 * credit balance. Each message decrements the active subscription's
 * `messages_used` counter. When the period resets (new month), the counter
 * resets to 0 automatically — the `current_period_end` column already tracks
 * the billing window.
 *
 * Priority: active subscription quota → credit balance fallback
 *
 * Cost model (post Stage 1):
 *   - Subscription path: per-message (1 quota slot per call, regardless of
 *     token tier). Subscribers get effectively-unlimited usage.
 *   - Credit path: per-token-tier, scaled by `TIER_CREDIT_MULTIPLIER`
 *     (short=1, medium=3, long=15) OR an explicit override (`cost`).
 *     Doc-library uses an explicit cost (30 cr flat) because its real cost
 *     varies wildly with input size — a flat rate is simpler and acts as a
 *     loss-leader to drive conversion.
 */

import { and, eq, sql } from 'drizzle-orm';

import {
  TIER_CREDIT_MULTIPLIER,
  type ContextTier,
} from '@/core/ai/tier-pricing';
import { db } from '@/core/db';
import { subscription } from '@/config/db/schema';
import {
  consume as consumeCredits,
  type ConsumeResult,
} from '@/modules/credits/service';
import { getCurrentSubscription } from '@/modules/subscriptions/service';

export type QuotaConsumeResult =
  | { via: 'quota'; success: true; remaining: number }
  | { via: 'credits'; success: true; result: ConsumeResult; cost: number }
  | {
      via: 'none';
      success: false;
      reason: 'no_subscription' | 'quota_exhausted' | 'credit_exhausted';
    };

export interface ConsumeMessageOptions {
  /**
   * Explicit credit cost override. Use this for doc-library's flat 30 cr
   * charge, or any feature that doesn't fit the tier multiplier. Wins
   * over `tier` if both are set.
   */
  cost?: number;
  /**
   * Token tier. The credit cost = TIER_CREDIT_MULTIPLIER[tier]. Defaults
   * to 'short' (1 credit) when neither `cost` nor `tier` is provided —
   * preserves the pre-Stage-1 behavior so existing callers don't break.
   */
  tier?: ContextTier;
  /** Scene label written to the credit.consume record. */
  scene?: string;
  /** Description written to the credit.consume record. */
  description?: string;
}

/** Consume a message slot. Tries subscription quota first, then credit balance. */
export async function consumeMessage(
  userId: string,
  options: ConsumeMessageOptions = {}
): Promise<QuotaConsumeResult> {
  const sub = await getCurrentSubscription(userId);

  // 1. Subscription quota path — 1 quota slot per call regardless of cost.
  //    This is intentional: subscribers get the "all-you-can-eat" feel.
  if (sub && sub.messagesQuota && sub.messagesQuota > 0) {
    const used = sub.messagesUsed ?? 0;
    const remaining = sub.messagesQuota - used;

    if (remaining > 0) {
      await db()
        .update(subscription)
        .set({ messagesUsed: used + 1 })
        .where(eq(subscription.id, sub.id));

      return { via: 'quota', success: true, remaining: remaining - 1 };
    }

    // Quota exhausted — fall through to credit fallback
  }

  // 2. Credit balance fallback — cost depends on tier / override.
  //    Resolution order: explicit cost > tier multiplier > default 1.
  const cost =
    options.cost ?? (options.tier ? TIER_CREDIT_MULTIPLIER[options.tier] : 1);

  const result = await consumeCredits({
    userId,
    credits: cost,
    scene: options.scene || 'hero_chat',
    description: options.description || 'Hero chat · Kimi K3',
  });

  if (result.success) {
    return { via: 'credits', success: true, result, cost };
  }

  // 3. Both exhausted
  if (sub && sub.messagesQuota && sub.messagesQuota > 0) {
    return { via: 'none', success: false, reason: 'quota_exhausted' };
  }
  return { via: 'none', success: false, reason: 'credit_exhausted' };
}

/** Get remaining message quota for the active subscription period. */
export async function getRemainingQuota(userId: string): Promise<{
  subscription: boolean;
  remaining: number;
  total: number;
  used: number;
}> {
  const sub = await getCurrentSubscription(userId);

  if (!sub || !sub.messagesQuota || sub.messagesQuota <= 0) {
    return { subscription: false, remaining: 0, total: 0, used: 0 };
  }

  const used = sub.messagesUsed ?? 0;
  const total = sub.messagesQuota;
  return {
    subscription: true,
    remaining: Math.max(0, total - used),
    total,
    used,
  };
}

/** Consume a subscription's messagesQuota / messagesUsed fields when a
 * subscription is created or renewed. Called from payment success handlers.
 */
export async function initSubscriptionQuota(params: {
  subscriptionId: string;
  messagesQuota: number;
}) {
  await db()
    .update(subscription)
    .set({ messagesQuota: params.messagesQuota, messagesUsed: 0 })
    .where(eq(subscription.id, params.subscriptionId));
}
