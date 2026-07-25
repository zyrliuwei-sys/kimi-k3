/**
 * Refund helper for over-charged chat consumes.
 *
 * The chat endpoints pre-charge an ESTIMATE based on a server-side token
 * estimator (see `estimateMessagesTokens` in core/ai/token-estimate.ts).
 * Once the upstream model returns its real `usage.total_tokens`, the
 * caller may discover the estimate was high and refund the difference.
 *
 * Strategy: revoke the original CONSUME record (restores the underlying
 * grant rows) and then issue a fresh consume for the actual amount. This
 * keeps the FIFO consumption order intact — refunded tokens go back to
 * the oldest-expiring grants first, then a new consume re-pulls from the
 * top of the stack — and gives the user a transparent audit trail
 * (original → DELETED, new → ACTIVE).
 *
 * Failure modes (DB hiccup, etc.) are swallowed and logged: the user was
 * already charged the estimate, the ±15% estimator band means a failed
 * refund is at worst a small over-charge.
 */

import { consume as consumeCredits, revoke } from '@/modules/credits/service';

export interface RefundConsumeParams {
  /** Original consume record ID — returned by `consumeMessage` when
   *  `via === 'credits'`. Ignored when `keepAmount` >= `originalCost`. */
  consumeId: string;
  /** User the original consume belongs to. Needed for the re-consume. */
  userId: string;
  /** What was originally charged (the pre-flight estimate). */
  originalCost: number;
  /** What the user should end up being charged (based on actual usage).
   *  Must be <= originalCost — we never surcharge post-flight. */
  keepAmount: number;
}

export interface RefundConsumeResult {
  /** Credits returned to the user. 0 when no refund was owed or refund
   *  failed (logged internally in the failure case). */
  refunded: number;
}

/**
 * Revoke the original consume and re-consume the smaller actual amount.
 * No-op when `keepAmount >= originalCost` — we never surcharge post-flight
 * even if the model returned higher usage than we estimated.
 */
export async function refundConsume(
  params: RefundConsumeParams
): Promise<RefundConsumeResult> {
  const { consumeId, userId, originalCost, keepAmount } = params;

  if (keepAmount < 0) {
    throw new Error('keepAmount must be non-negative');
  }
  if (keepAmount > originalCost) {
    // Defensive: caller passed a higher keepAmount than we charged.
    // Refunding would over-credit, so just leave the original alone.
    return { refunded: 0 };
  }

  const refundAmount = originalCost - keepAmount;
  if (refundAmount <= 0) return { refunded: 0 };

  try {
    // Step 1: revoke the original — restores the originalCost credits to
    // the source grant rows (FIFO oldest-first).
    await revoke(consumeId);

    // Step 2: re-consume the actual cost, if any. keepAmount === 0 means
    // "model produced nothing useful" — revoke alone is enough.
    if (keepAmount > 0) {
      await consumeCredits({
        userId,
        credits: keepAmount,
        scene: 'chat_refund_adjustment',
        description: `Actual-usage adjustment (kept ${keepAmount}, refunded ${refundAmount})`,
      });
    }

    return { refunded: refundAmount };
  } catch (e) {
    // Don't fail the caller — the user's already paid. Log so ops can
    // spot recurring failures.
    console.error('[refundConsume] failed:', e);
    return { refunded: 0 };
  }
}
