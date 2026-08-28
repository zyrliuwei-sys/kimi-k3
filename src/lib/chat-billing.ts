/**
 * Shared per-token billing rates + cost math.
 *
 * Used by every token-consuming surface — playground chat, persistent chat,
 * and doc-library `ask` — so they all charge identically and a rate change
 * in the admin panel applies everywhere at once.
 *
 * Rates default to 7× the EvoLink wholesale cost for Kimi K3
 * (input 0.204 cr/1k, output 1.02 cr/1k → 1.428 / 7.14). Output is billed at
 * a higher rate because the provider charges ~5× more for generated tokens.
 *
 * Server-only — reads admin config via `getConfig`.
 */

import { getConfig } from '@/modules/config/service';

/** The only models a browser may select for product chat. Keep this list
 * server-side: the client is allowed to request a model, never to name an
 * arbitrary EvoLink route. Ids are the exact EvoLink API model ids — casing
 * matters (`MiniMax-M3`). */
export const CHAT_MODEL_IDS = [
  'kimi-k3',
  'glm-5.3-flash',
  'deepseek-v4-flash',
  'MiniMax-M3',
  'glm-5.3',
  'gemini-3.5-flash',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-5',
  'gpt-5.6-sol',
  'claude-fable-5',
] as const;

export type ChatModelId = (typeof CHAT_MODEL_IDS)[number];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = 'kimi-k3';

/**
 * Free-tier models: billed to nobody, limited to a per-day message quota
 * (see `@/modules/free-chat-quota`). They still carry 7× rates above so a
 * future policy change (or a non-quota surface) never meets missing rates.
 */
export const FREE_CHAT_MODEL_IDS = [
  'glm-5.3-flash',
  'deepseek-v4-flash',
] as const;

export type FreeChatModelId = (typeof FREE_CHAT_MODEL_IDS)[number];

export function isFreeChatModel(model: string): boolean {
  return (FREE_CHAT_MODEL_IDS as readonly string[]).includes(model);
}

/**
 * EvoLink bills all of these routes in the same credit unit used by this app
 * (68 credits = $1). Rates are the verified detail-page prices at a fixed 7×
 * retail multiplier, expressed as app credits per 1K tokens.
 *
 * Promo notes (recheck quarterly — a promo ending silently drops the margin):
 *   - claude-sonnet-5 is priced at the STABLE member rate (10% below the $3 /
 *     $15 official list). The -40% launch promo ended Aug 31, 2026; pricing at
 *     it would have meant a +50% correction three days after launch.
 *   - MiniMax-M3 uses the ≤524.3K tier (its >524.3K tier doubles). Guarded in
 *     `getChatModelInputBudgetError` like the GPT long-context band.
 *   - claude-opus-5 / claude-fable-5 discounts (-5% / -10%) are EvoLink's
 *     standing policy, not launch promos.
 */
const PREMIUM_CHAT_MODEL_RATES: Record<
  Exclude<ChatModelId, 'kimi-k3'>,
  Omit<ChatTokenRates, 'minCost'>
> = {
  // ── Free tier (rates kept for accounting / future policy changes) ──
  'glm-5.3-flash': {
    inputRate: 0.0714, // 10.2 EvoLink cr / 1M × 7
    outputRate: 0.238, // 34 EvoLink cr / 1M × 7
    cacheWriteRate: 0.0714, // no write surcharge — billed as input
    cacheReadRate: 0.0147, // 2.1 EvoLink cr / 1M × 7
  },
  'deepseek-v4-flash': {
    inputRate: 0.21, // 30 EvoLink cr / 1M × 7
    outputRate: 0.63, // 90 EvoLink cr / 1M × 7
    cacheWriteRate: 0.21, // no write surcharge — billed as input
    cacheReadRate: 0.007, // 1 EvoLink cr / 1M × 7
  },
  // ── Paid 7× tier ──
  'MiniMax-M3': {
    inputRate: 0.2352, // 33.6 EvoLink cr / 1M × 7
    outputRate: 0.9408, // 134.4 EvoLink cr / 1M × 7
    cacheWriteRate: 0.294, // 42 EvoLink cr / 1M × 7
    cacheReadRate: 0.0469, // 6.7 EvoLink cr / 1M × 7
  },
  'glm-5.3': {
    inputRate: 0.6664, // 95.2 EvoLink cr / 1M × 7
    outputRate: 2.0944, // 299.2 EvoLink cr / 1M × 7
    cacheWriteRate: 0.6664, // no write surcharge — billed as input
    cacheReadRate: 0.1239, // 17.7 EvoLink cr / 1M × 7
  },
  'gemini-3.5-flash': {
    inputRate: 0.6426, // 91.8 EvoLink cr / 1M × 7
    outputRate: 3.8556, // 550.8 EvoLink cr / 1M × 7
    cacheWriteRate: 0.6426, // implicit caching — no write surcharge
    cacheReadRate: 0.0644, // 9.2 EvoLink cr / 1M × 7
  },
  'claude-sonnet-5': {
    inputRate: 1.2852, // 183.6 EvoLink cr / 1M × 7 (stable member rate)
    outputRate: 6.426, // 918 EvoLink cr / 1M × 7
    cacheWriteRate: 1.6065, // 229.5 EvoLink cr / 1M × 7
    cacheReadRate: 0.12852, // 18.36 EvoLink cr / 1M × 7
  },
  'claude-opus-4-8': {
    inputRate: 2.142, // 306 EvoLink cr / 1M × 7
    outputRate: 10.71, // 1,530 EvoLink cr / 1M × 7
    cacheWriteRate: 2.6775, // 382.5 EvoLink cr / 1M × 7
    cacheReadRate: 0.2142, // 30.6 EvoLink cr / 1M × 7
  },
  'claude-opus-5': {
    inputRate: 2.261, // 323 EvoLink cr / 1M × 7
    outputRate: 11.305, // 1,615 EvoLink cr / 1M × 7
    cacheWriteRate: 2.8266, // 403.8 EvoLink cr / 1M × 7
    cacheReadRate: 0.2261, // 32.3 EvoLink cr / 1M × 7
  },
  'gpt-5.6-sol': {
    inputRate: 2.142, // 306 EvoLink cr / 1M × 7
    outputRate: 12.852, // 1,836 EvoLink cr / 1M × 7
    cacheWriteRate: 2.6775, // 382.5 EvoLink cr / 1M × 7
    cacheReadRate: 0.2142, // 30.6 EvoLink cr / 1M × 7
  },
  'claude-fable-5': {
    inputRate: 4.284, // 612 EvoLink cr / 1M × 7
    outputRate: 21.42, // 3,060 EvoLink cr / 1M × 7
    cacheWriteRate: 5.355, // 765 EvoLink cr / 1M × 7
    cacheReadRate: 0.4284, // 61.2 EvoLink cr / 1M × 7
  },
};

/** Hard output budget for paid premium turns. It is sent upstream and fully
 * reserved before generation, then unused credits are returned at settlement. */
export const PREMIUM_CHAT_MAX_OUTPUT_TOKENS = 4096;

/** Free-tier turns are not billed per token, so the only cost ceiling is this
 * upstream cap — DeepSeek V4 Flash alone allows 384K output tokens, and a
 * runaway generation on an unbilled route would be pure cost. */
export const FREE_CHAT_MAX_OUTPUT_TOKENS = 2048;

/** A 200K estimated prompt cap leaves margin below GPT-5.6 Sol's 272K
 * long-context pricing threshold, including token-estimation variance. */
export const GPT_56_SOL_MAX_PROMPT_TOKENS = 200_000;

/** MiniMax-M3 doubles its token rate above 524.3K prompt tokens. This cap
 * keeps a quoted base-rate request safely inside the cheap tier. */
export const MINIMAX_M3_MAX_PROMPT_TOKENS = 450_000;

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

const DEFAULT_INPUT_RATE = 1.428; // 204 EvoLink cr / 1M × 7
const DEFAULT_OUTPUT_RATE = 7.14; // 1,020 EvoLink cr / 1M × 7
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
  return (
    model !== DEFAULT_CHAT_MODEL_ID &&
    !isFreeChatModel(model) &&
    isChatModelId(model)
  );
}

/** Resolve an untrusted requested model against the server-owned allowlist. */
export function getChatModelId(value: unknown): ChatModelId | null {
  return isChatModelId(value) ? value : null;
}

/** User-facing identity for a known product-chat model. Never interpolate an
 * arbitrary configured provider ID into a system prompt. */
export function getChatModelDisplayName(model: string): string {
  switch (model) {
    case 'gpt-5.6-sol':
      return 'GPT-5.6';
    case 'claude-opus-4-8':
      return 'Claude Opus 4.8';
    case 'claude-opus-5':
      return 'Claude Opus 5';
    case 'claude-sonnet-5':
      return 'Claude Sonnet 5';
    case 'claude-fable-5':
      return 'Claude Fable 5';
    case 'gemini-3.5-flash':
      return 'Gemini 3.5 Flash';
    case 'glm-5.3':
      return 'GLM-5.3';
    case 'glm-5.3-flash':
      return 'GLM-5.3 Flash';
    case 'deepseek-v4-flash':
      return 'DeepSeek V4 Flash';
    case 'MiniMax-M3':
      return 'MiniMax-M3';
    case 'kimi-k3':
      return 'Kimi K3';
    default:
      return 'the configured AI model';
  }
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
    getChatModelMaxOutputTokens(model) ?? PREMIUM_CHAT_MAX_OUTPUT_TOKENS,
    {
      ...rates,
      inputRate: Math.max(rates.inputRate, rates.cacheWriteRate),
    }
  );
}

export function getChatModelMaxOutputTokens(
  model: ChatModelId
): number | undefined {
  if (isPremiumChatModel(model)) return PREMIUM_CHAT_MAX_OUTPUT_TOKENS;
  if (isFreeChatModel(model)) return FREE_CHAT_MAX_OUTPUT_TOKENS;
  return undefined; // Kimi keeps its uncapped default behavior
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
  if (
    model === 'MiniMax-M3' &&
    estimatedInputTokens > MINIMAX_M3_MAX_PROMPT_TOKENS
  ) {
    return 'MiniMax-M3 supports up to 450K prompt tokens per chat turn.';
  }
  return null;
}
