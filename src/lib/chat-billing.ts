/**
 * Shared per-token billing rates + cost math.
 *
 * Used by every token-consuming surface — playground chat, persistent chat,
 * and doc-library `ask` — so they all charge identically and a rate change
 * in the admin panel applies everywhere at once.
 *
 * Rates default to 6× the EvoLink wholesale cost for Kimi K3
 * (input 0.204 cr/1k, output 1.02 cr/1k → 1.2 / 6). Output is billed at a
 * higher rate because the provider charges ~5× more for generated tokens.
 *
 * Server-only — reads admin config via `getConfig`.
 */

import { getConfig } from '@/modules/config/service';

export interface ChatTokenRates {
  /** Credits per 1k input/prompt tokens. */
  inputRate: number;
  /** Credits per 1k output/completion tokens. */
  outputRate: number;
  /** Minimum credits per call (floor applied after the per-token math). */
  minCost: number;
}

const DEFAULT_INPUT_RATE = 1.2;
const DEFAULT_OUTPUT_RATE = 6;
const DEFAULT_MIN_COST = 1;

function parseRate(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw || '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read the admin-configured per-token rates (with safe defaults). */
export async function getChatTokenRates(): Promise<ChatTokenRates> {
  const [inRaw, outRaw, minRaw] = await Promise.all([
    getConfig('chat_credit_per_1k_input_tokens'),
    getConfig('chat_credit_per_1k_output_tokens'),
    getConfig('chat_credit_min_per_call'),
  ]);
  return {
    inputRate: parseRate(inRaw, DEFAULT_INPUT_RATE),
    outputRate: parseRate(outRaw, DEFAULT_OUTPUT_RATE),
    minCost: parseRate(minRaw, DEFAULT_MIN_COST),
  };
}

/**
 * Credits to charge for a given token mix, floored at `rates.minCost`.
 *
 *   cost = max(minCost, ceil(promptTokens/1000 × inputRate
 *                            + completionTokens/1000 × outputRate))
 */
export function computeTokenCost(
  promptTokens: number,
  completionTokens: number,
  rates: ChatTokenRates
): number {
  const prompt = Math.max(0, promptTokens | 0);
  const completion = Math.max(0, completionTokens | 0);
  const raw =
    (prompt / 1000) * rates.inputRate + (completion / 1000) * rates.outputRate;
  return Math.max(rates.minCost, Math.ceil(raw));
}
