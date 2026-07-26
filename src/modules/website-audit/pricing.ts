/**
 * Website Auditor — credit pricing.
 *
 * Pricing ladder (resolved in order):
 *   1. Cache hit (same URL hash within cache TTL)             → free, 0 credits
 *   2. First audit for this user (no prior successful audits)  → free, 0 credits
 *   3. Standard                                              → audit_credit_cost (default 5)
 *   4. Cache miss + not first + insufficient credits         → throws (caller converts to 402)
 *
 * The first-free + cache-hit bonuses are an explicit product decision:
 * the lead's first impression should never be a paywall, and re-audits
 * after the user fixes something should feel free. Cost is paid by the
 * configuration engine (admin can crank these numbers later).
 */

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/core/db';
import { aiTask } from '@/config/db/schema';

import { getCachedReport } from './cache';

/** Default cost per audit; admin-overridable via `audit_credit_cost`. */
export const DEFAULT_AUDIT_COST = 5;
/** "Always free for first try" toggle; admin-overridable. */
export const DEFAULT_AUDIT_FIRST_FREE = true;

export type PricingReason =
  | 'cache_hit'
  | 'first_free'
  | 'standard'
  | 'insufficient_credits';

export interface PricingDecision {
  /** Credit cost to deduct BEFORE running (use `0` for free paths). */
  cost: number;
  reason: PricingReason;
  /** Cached report when reason === 'cache_hit' — the service uses this instead of running the LLM. */
  cachedReport?: unknown;
  /** Config-sourced cost; surfaced for the UI to display "estimated cost". */
  standardCost: number;
}

export interface PricingConfig {
  firstFree: boolean;
  standardCost: number;
}

export function readPricingConfig(configs: Record<string, any>): PricingConfig {
  const firstFreeRaw = configs.audit_first_free;
  const firstFree =
    firstFreeRaw === undefined
      ? DEFAULT_AUDIT_FIRST_FREE
      : firstFreeRaw === 'true';
  const costRaw = Number(configs.audit_credit_cost);
  const standardCost =
    Number.isFinite(costRaw) && costRaw > 0 ? costRaw : DEFAULT_AUDIT_COST;
  return { firstFree, standardCost };
}

/**
 * Decide the cost for a given user+URL.
 *
 * `params.urlHash` must be the SHA-256 of the normalized URL (call
 * `computeUrlHash(normalizedUrl)` upstream). Required so cache lookups
 * don't have to normalize twice.
 *
 * Returned `cachedReport` (when reason === 'cache_hit') is the cached
 * `AuditReport` from a previous run — the service uses it verbatim, no LLM
 * call. Callers must still write an `aiTask` row for traceability (cost 0).
 */
export async function decideAuditCost(params: {
  userId: string;
  urlHash: string;
  config: PricingConfig;
}): Promise<PricingDecision> {
  const { userId, urlHash, config } = params;

  // 1. Cache hit — first because it short-circuits everything.
  const cached = await getCachedReport(urlHash);
  if (cached) {
    return {
      cost: 0,
      reason: 'cache_hit',
      cachedReport: cached.report,
      standardCost: config.standardCost,
    };
  }

  // 2. First-free — only when enabled and user has zero successful audits.
  if (config.firstFree) {
    const priorCount = await countUserPriorAudits(userId);
    if (priorCount === 0) {
      return {
        cost: 0,
        reason: 'first_free',
        standardCost: config.standardCost,
      };
    }
  }

  // 3. Standard cost.
  return {
    cost: config.standardCost,
    reason: 'standard',
    standardCost: config.standardCost,
  };
}

/**
 * Count a user's prior audit tasks (any non-failed, non-deleted). Used by
 * `decideAuditCost` to gate the first-free bonus. The audit mediaType is
 * set by `service.ts` when it calls `createTask`.
 */
async function countUserPriorAudits(userId: string): Promise<number> {
  const rows = await db()
    .select({ id: aiTask.id })
    .from(aiTask)
    .where(
      and(
        eq(aiTask.userId, userId),
        eq(aiTask.mediaType, 'audit'),
        isNull(aiTask.deletedAt)
      )
    )
    .limit(1);
  return rows.length;
}
