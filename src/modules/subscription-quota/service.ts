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
 */

import { and, eq, gt, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import { subscription } from '@/config/db/schema';
import {
  consume as consumeCredits,
  type ConsumeResult,
} from '@/modules/credits/service';
import { getCurrentSubscription } from '@/modules/subscriptions/service';

export type QuotaConsumeResult =
  | { via: 'quota'; success: true; remaining: number }
  | { via: 'credits'; result: ConsumeResult }
  | {
      via: 'none';
      success: false;
      reason: 'no_subscription' | 'quota_exhausted' | 'credit_exhausted';
    };

/** Consume 1 message slot. Tries subscription quota first, then credit balance. */
export async function consumeMessage(
  userId: string
): Promise<QuotaConsumeResult> {
  const sub = await getCurrentSubscription(userId);

  // 1. Subscription quota path
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

  // 2. Credit balance fallback
  const result = await consumeCredits({
    userId,
    credits: 1,
    scene: 'hero_chat',
    description: 'Hero chat · Kimi K3',
  });

  if (result.success) {
    return { via: 'credits', result };
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
