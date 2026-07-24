/**
 * Long-context tier guard — revised to NOT block new users.
 *
 * Kimi K3 (and most chat APIs) charge by token. A short prompt and a
 * 280k-token PDF cost two orders of magnitude apart. Earlier we tried
 * gating anything ≥32k behind an active subscription; in practice that
 * blocked the doc-library's core flow the moment a new user uploaded a
 * multi-page PDF, which choked the conversion funnel.
 *
 * New policy (matches ChatGPT / Claude.ai norms):
 *   - short   < 32,000   tokens — anyone with credit balance can use
 *   - medium  < 200,000  tokens — anyone with credit balance can use
 *     (covers ~99% of real PDFs; UI shows a "uses more credits" hint)
 *   - long    ≥ 200,000  tokens — gated behind an active subscription,
 *     OR the user's account is within the FIRST 7 DAYS of registration
 *     (one-time grace window so newcomers can stress-test the product)
 *
 * Rationale:
 *   - The doc-library is the killer feature. New users uploading a
 *     30-page PDF (~60k tokens) MUST be able to use it.
 *   - Real abuse = scripted 280k-token requests in a loop. Subscription
 *     gating at 200k + rate limit still catches that.
 *   - 7-day grace covers the "I'm new, I want to see what this does"
 *     window before we ask for money.
 *
 * All tiers still consume credits normally. The subscription gate exists
 * only to throttle the extreme upper end, not to monetize.
 */

import { eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { credit } from '@/config/db/schema';
import { getCurrentSubscription } from '@/modules/subscriptions/service';

import { estimateMessagesTokens, type ChatTurn } from './token-estimate';

export const LONG_CONTEXT_THRESHOLD = 200_000;
export const MEDIUM_CONTEXT_THRESHOLD = 32_000;

/** A new user's account age (in days) during which long-context is unguarded. */
export const NEW_USER_GRACE_DAYS = 7;

export type ContextTier = 'short' | 'medium' | 'long';

/** Pure function — classify an estimated token count into a tier. */
export function classifyContextTier(estimatedTokens: number): ContextTier {
  if (estimatedTokens >= LONG_CONTEXT_THRESHOLD) return 'long';
  if (estimatedTokens >= MEDIUM_CONTEXT_THRESHOLD) return 'medium';
  return 'short';
}

/** Convenience wrapper that estimates from messages and classifies. */
export function classifyMessagesTier(messages: ChatTurn[]): ContextTier {
  return classifyContextTier(estimateMessagesTokens(messages));
}

export interface LongContextCheckResult {
  allowed: boolean;
  tier: ContextTier;
  estimatedTokens: number;
  /** Set when tier === 'long' AND no subscription AND past grace window. */
  reason?: 'subscription_required';
}

/**
 * Resolve the user's account-creation date in a dialect-portable way.
 * Pulls from the credit table because we don't have a dedicated column on
 * `user` (freeChats exists but is dead code), and the first credit grant is
 * always written on signup — so the earliest `created_at` is a reliable
 * upper bound for "when did this user join".
 */
async function getUserJoinedAt(userId: string): Promise<Date | null> {
  const [row] = await db()
    .select({ createdAt: credit.createdAt })
    .from(credit)
    .where(eq(credit.userId, userId))
    .orderBy(credit.createdAt)
    .limit(1);
  return row?.createdAt ?? null;
}

/**
 * The gate every chat-completion entry point should call before calling the
 * upstream API.
 *
 * Returns `{ allowed: true, tier, estimatedTokens }` in all cases EXCEPT
 * when ALL of the following hold:
 *   - tier === 'long' (≥200k tokens)
 *   - user has no active subscription
 *   - user is past the new-user grace window (account age ≥ NEW_USER_GRACE_DAYS)
 *
 * Anonymous users are short-circuited at the route level (see
 * playground/chat.ts and chat/service.ts), so this assumes a userId.
 */
export async function checkLongContextAllowed(params: {
  userId: string;
  messages: ChatTurn[];
}): Promise<LongContextCheckResult> {
  const estimatedTokens = estimateMessagesTokens(params.messages);
  const tier = classifyContextTier(estimatedTokens);

  if (tier !== 'long') {
    return { allowed: true, tier, estimatedTokens };
  }

  // Tier === 'long': check subscription first.
  const sub = await getCurrentSubscription(params.userId);
  if (sub) {
    return { allowed: true, tier, estimatedTokens };
  }

  // No subscription — fall through to grace-window check.
  const joinedAt = await getUserJoinedAt(params.userId);
  if (joinedAt) {
    const ageMs = Date.now() - joinedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < NEW_USER_GRACE_DAYS) {
      return { allowed: true, tier, estimatedTokens };
    }
  }

  // Past grace AND no subscription: block.
  return {
    allowed: false,
    tier,
    estimatedTokens,
    reason: 'subscription_required',
  };
}

/**
 * Cost-multiplier the credit service can apply based on tier. Short is the
 * baseline; medium and long charge more to reflect actual API cost:
 *   - short  (~1k tokens)    → 1 credit  ($0.007)
 *   - medium (~50k tokens)   → 3 credits ($0.022)
 *   - long   (~200k tokens)  → 15 credits ($0.11)
 *
 * These multipliers are conservative — they DON'T fully recover cost on
 * long-context requests (a 200k-token call really costs ~$0.74), but they
 * make repeated long-context use unattractive without a subscription, which
 * is the point. The subscription gate above catches the truly heavy users.
 */
export const TIER_CREDIT_MULTIPLIER: Record<ContextTier, number> = {
  short: 1,
  medium: 3,
  long: 15,
};

/** Convenience: return the credit cost for a given estimated token count. */
export function getCreditCostForTier(tier: ContextTier): number {
  return TIER_CREDIT_MULTIPLIER[tier];
}
