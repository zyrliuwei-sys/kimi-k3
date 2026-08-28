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

/** The only models a browser may select for product chat. Keep this list
 * server-side: the client is allowed to request a model, never to name an
 * arbitrary EvoLink route. */
export const CHAT_MODEL_IDS = [
  'kimi-k3',
  'gpt-5.6-sol',
  'claude-opus-4-8',
] as const;

export type ChatModelId = (typeof CHAT_MODEL_IDS)[number];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = 'kimi-k3';

/**
 * EvoLink bills all of these premium routes in the same credit unit used by
 * this app (68 credits = $1). These are the verified, base-context rates at a
 * fixed 7× retail multiplier, expressed as app credits per 1K tokens.
 *
 * The GPT route moves to a higher band above 272K prompt tokens. We keep a
 * deliberately lower hard cap in `getChatModelInputBudgetError` so a request
 * cannot accidentally cross into that multiplier while we quote base rates.
 */
const PREMIUM_CHAT_MODEL_RATES: Record<
  Exclude<ChatModelId, 'kimi-k3'>,
  Omit<ChatTokenRates, 'minCost'>
> = {
  'gpt-5.6-sol': {
    inputRate: 2.142, // 306 EvoLink cr / 1M × 7
    outputRate: 12.852, // 1,836 EvoLink cr / 1M × 7
    cacheWriteRate: 2.6775, // 382.5 EvoLink cr / 1M × 7
    cacheReadRate: 0.2142, // 30.6 EvoLink cr / 1M × 7
  },
  'claude-opus-4-8': {
    inputRate: 2.142, // 306 EvoLink cr / 1M × 7
    outputRate: 10.71, // 1,530 EvoLink cr / 1M × 7
    cacheWriteRate: 2.6775, // 382.5 EvoLink cr / 1M × 7
    cacheReadRate: 0.2142, // 30.6 EvoLink cr / 1M × 7
  },
};

/** Hard output budget for paid premium turns. It is sent upstream and fully
 * reserved before generation, then unused credits are returned at settlement. */
export const PREMIUM_CHAT_MAX_OUTPUT_TOKENS = 4096;

/** A 200K estimated prompt cap leaves margin below GPT-5.6 Sol's 272K
 * long-context pricing threshold, including token-estimation variance. */
export const GPT_56_SOL_MAX_PROMPT_TOKENS = 200_000;

export interface ChatTokenRates {
  /** Credits per 1k input/prompt tokens. */
  inputRate: number;
  /** Credits per 1k output/completion tokens. */
  outputRate: number;
  /** Credits per 1k cache-write tokens. Defaults to ordinary input billing. */
  cacheWriteRate: number;
  /** Credits per 1k cache-read tokens. Defaults to ordinary input billing. */
  cacheReadRate: number;
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

export function isChatModelId(value: unknown): value is ChatModelId {
  return (
    typeof value === 'string' &&
    (CHAT_MODEL_IDS as readonly string[]).includes(value)
  );
}

export function isPremiumChatModel(model: string): boolean {
  return model !== DEFAULT_CHAT_MODEL_ID && isChatModelId(model);
}

/** Resolve an untrusted requested model against the server-owned allowlist. */
export function getChatModelId(value: unknown): ChatModelId | null {
  return isChatModelId(value) ? value : null;
}

/** Read the admin-configured per-token rates (with safe defaults). */
export async function getChatTokenRates(
  model: ChatModelId = DEFAULT_CHAT_MODEL_ID
): Promise<ChatTokenRates> {
  if (model !== DEFAULT_CHAT_MODEL_ID) {
    return { ...PREMIUM_CHAT_MODEL_RATES[model], minCost: DEFAULT_MIN_COST };
  }

  const [inRaw, outRaw, minRaw] = await Promise.all([
    getConfig('chat_credit_per_1k_input_tokens'),
    getConfig('chat_credit_per_1k_output_tokens'),
    getConfig('chat_credit_min_per_call'),
  ]);
  const inputRate = parseRate(inRaw, DEFAULT_INPUT_RATE);
  return {
    inputRate,
    outputRate: parseRate(outRaw, DEFAULT_OUTPUT_RATE),
    // Keep Kimi's current billing behavior intact if an upstream response
    // starts reporting cache details: cache tokens continue to bill as input.
    cacheWriteRate: inputRate,
    cacheReadRate: inputRate,
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

export interface ChatUsageForBilling {
  prompt_tokens: number;
  completion_tokens: number;
  /** Cache-hit tokens included in prompt_tokens. */
  cached_tokens?: number;
  /** Cache-write tokens included in prompt_tokens. */
  cache_write_tokens?: number;
}

/**
 * Settle a real usage frame without double-counting cached prompt tokens.
 * EvoLink reports these as portions of `prompt_tokens`; any unavailable cache
 * field safely falls back to ordinary input billing.
 */
export function computeUsageTokenCost(
  usage: ChatUsageForBilling,
  rates: ChatTokenRates
): number {
  const prompt = Math.max(0, usage.prompt_tokens | 0);
  const completion = Math.max(0, usage.completion_tokens | 0);
  const cacheRead = Math.min(prompt, Math.max(0, usage.cached_tokens || 0));
  const cacheWrite = Math.min(
    prompt - cacheRead,
    Math.max(0, usage.cache_write_tokens || 0)
  );
  const uncached = Math.max(0, prompt - cacheRead - cacheWrite);
  const raw =
    (uncached / 1000) * rates.inputRate +
    (cacheRead / 1000) * rates.cacheReadRate +
    (cacheWrite / 1000) * rates.cacheWriteRate +
    (completion / 1000) * rates.outputRate;
  return Math.max(rates.minCost, Math.ceil(raw));
}

/**
 * Premium calls reserve the worst allowed prompt role (cache write) plus the
 * complete output budget. This makes an insufficient balance fail before the
 * upstream call; settlement refunds every unused credit after the usage frame.
 */
export function computeChatReservationCost(params: {
  model: ChatModelId;
  estimatedInputTokens: number;
  rates: ChatTokenRates;
}): number {
  const { model, estimatedInputTokens, rates } = params;
  if (!isPremiumChatModel(model)) {
    return computeTokenCost(estimatedInputTokens, 0, rates);
  }
  // A 25% buffer covers the deliberately lightweight token estimator before
  // an authoritative usage frame can reconcile the reservation.
  const inputWithSafetyMargin = Math.ceil(estimatedInputTokens * 1.25);
  return computeTokenCost(
    inputWithSafetyMargin,
    PREMIUM_CHAT_MAX_OUTPUT_TOKENS,
    {
      ...rates,
      inputRate: Math.max(rates.inputRate, rates.cacheWriteRate),
    }
  );
}

export function getChatModelMaxOutputTokens(
  model: ChatModelId
): number | undefined {
  return isPremiumChatModel(model) ? PREMIUM_CHAT_MAX_OUTPUT_TOKENS : undefined;
}

/** Returns a user-safe validation message when a model's quoted rate would no
 * longer apply. */
export function getChatModelInputBudgetError(params: {
  model: ChatModelId;
  estimatedInputTokens: number;
}): string | null {
  const { model, estimatedInputTokens } = params;
  if (
    model === 'gpt-5.6-sol' &&
    estimatedInputTokens > GPT_56_SOL_MAX_PROMPT_TOKENS
  ) {
    return 'GPT-5.6 Sol supports up to 200K prompt tokens per chat turn.';
  }
  return null;
}
