/**
 * Settlement helper for chat/doc per-token billing.
 *
 * Chat endpoints pre-charge an ESTIMATE (server-side token estimator — see
 * `estimateMessagesTokens` in core/ai/token-estimate.ts) so a drained balance
 * is rejected BEFORE the upstream model is called. Once the model returns its
 * real `usage` (prompt_tokens / completion_tokens), the caller settles to the
 * ACTUAL cost — which may be higher (long reply → surcharge) or lower (short
 * reply → refund) than the estimate.
 *
 * `settleConsume` is two-way:
 *  - finalAmount < originalCost (used less): revoke the original CONSUME
 *    record (restores the grant rows, FIFO oldest-first) and re-consume the
 *    smaller actual amount. Keeps FIFO order + a transparent audit trail.
 *  - finalAmount > originalCost (used more): consume just the DELTA as a new
 *    record. We do NOT revoke first — revoking would hand back the original
 *    credits and then risk failing to re-consume the larger amount, netting
 *    zero. If the user can't cover the delta (drained by another tab), we log
 *    and move on; exposure is bounded to one response's output overage.
 *
 * Failures (DB hiccup, etc.) are swallowed and logged: the user already paid
 * the estimate, the ±15% estimator band means a failed settle is at worst a
 * small mis-charge.
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
 * Refund-only convenience wrapper around `settleConsume` for callers that
 * only ever reduce the charge (legacy contract: never surcharge).
 */
export async function refundConsume(
  params: RefundConsumeParams
): Promise<RefundConsumeResult> {
  const { consumeId, userId, originalCost, keepAmount } = params;

  if (keepAmount < 0) {
    throw new Error('keepAmount must be non-negative');
  }
  // Defensive: if the caller passed a higher keepAmount than we charged,
  // treat it as "no change" rather than over-crediting.
  const clamped = Math.min(keepAmount, originalCost);

  const result = await settleConsume({
    consumeId,
    userId,
    originalCost,
    finalAmount: clamped,
  });
  // result.delta is <= 0 here; refunded = -delta.
  return { refunded: result.delta < 0 ? -result.delta : 0 };
}

export interface SettleConsumeParams {
  /** Original consume record ID — returned by `consumeMessage` when
   *  `via === 'credits'`. */
  consumeId: string;
  /** User the original consume belongs to. */
  userId: string;
  /** What was originally charged (the pre-flight estimate). */
  originalCost: number;
  /** What the user should end up being charged, based on actual usage. */
  finalAmount: number;
}

export interface SettleConsumeResult {
  /** Signed credit adjustment applied to the user.
   *  Positive = surcharged (charged extra), negative = refunded, 0 = no
   *  change or the settle failed (logged internally). */
  delta: number;
}

/**
 * Settle a pre-flight consume to the actual cost. Two-way: refunds when
 * `finalAmount < originalCost`, surcharges when `finalAmount > originalCost`.
 * No-op when equal.
 */
export async function settleConsume(
  params: SettleConsumeParams
): Promise<SettleConsumeResult> {
  const { consumeId, userId, originalCost, finalAmount } = params;

  if (finalAmount < 0) {
    throw new Error('finalAmount must be non-negative');
  }
  if (finalAmount === originalCost) return { delta: 0 };

  // ── Refund path: actual < reserved ───────────────────────────────
  if (finalAmount < originalCost) {
    const refundAmount = originalCost - finalAmount;
    try {
      // Step 1: revoke the original — restores originalCost credits to the
      // source grant rows (FIFO oldest-first).
      await revoke(consumeId);

      // Step 2: re-consume the actual cost, if any. finalAmount === 0 means
      // "model produced nothing useful" — revoke alone is enough.
      if (finalAmount > 0) {
        await consumeCredits({
          userId,
          credits: finalAmount,
          scene: 'chat_settle_adjustment',
          description: `Settle to actual (kept ${finalAmount}, refunded ${refundAmount})`,
        });
      }
      return { delta: -refundAmount };
    } catch (e) {
      console.error('[settleConsume] refund failed:', e);
      return { delta: 0 };
    }
  }

  // ── Surcharge path: actual > reserved (long output) ──────────────
  // Consume only the delta. Do NOT revoke first — see file header.
  const surcharge = finalAmount - originalCost;
  try {
    const result = await consumeCredits({
      userId,
      credits: surcharge,
      scene: 'chat_settle_adjustment',
      description: `Settle to actual (surcharged ${surcharge}: ${originalCost} → ${finalAmount})`,
    });
    if (!result.success) {
      // User couldn't cover the overage. Log and move on — they got the
      // response; we eat this one delta. Their balance is now likely ~0 so
      // the next request is gated at pre-flight.
      console.warn(
        '[settleConsume] surcharge skipped (insufficient balance):',
        { userId, originalCost, finalAmount, surcharge }
      );
      return { delta: 0 };
    }
    return { delta: surcharge };
  } catch (e) {
    console.error('[settleConsume] surcharge failed:', e);
    return { delta: 0 };
  }
}
