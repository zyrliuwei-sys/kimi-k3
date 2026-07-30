/**
 * Image generation credit billing.
 *
 * Mirrors the chat token-billing pattern (`./chat-billing.ts`): the
 * admin configures wholesale rates (per 1K tokens), a markup multiplier
 * (default 5× for image, 6× for chat), and per-image token counts for
 * the standard 1024×1024 resolution. This module turns (n, size, hasRef)
 * into the final credit cost.
 *
 * **Cost formula:**
 *   outputCost = (outputTokens × wholesaleOutput / 1000)
 *   inputCost  = referenceUrl ? (inputTokens × wholesaleInput / 1000) : 0
 *   cost       = ceil((outputCost + inputCost) × n × markup)  credits
 *
 * Output tokens vary by resolution:
 *   - 1024×1024 (1:1)  → 1050 tokens (≈ 1 OpenAI gpt-image-1 image)
 *   - 1536×1024 / 1024×1536 (3:2 / 2:3) → 1.4× the 1024² count
 *   - 1792×1024 / 1024×1792 (16:9 / 9:16) → 1.8× the 1024² count
 *
 * Image input tokens (img2img / reference image) are charged at the
 * separate `wholesaleInput` rate — typically ~3-4× cheaper than output
 * on EvoLink's pricing tier.
 *
 * The legacy `image_credit_cost` flat config is honored as a fallback
 * when `image_credit_markup` is unset — that's how the older single-price
 * deployments keep working without re-tuning.
 *
 * Server-only — reads admin config via `getConfig`.
 */

import { getConfig } from '@/modules/config/service';

const DEFAULT_MARKUP = 5;
const DEFAULT_WHOLESALE_OUTPUT_PER_1K = 1.728; // cr per 1K Image Output tokens
const DEFAULT_WHOLESALE_INPUT_PER_1K = 0.4608; // cr per 1K Image Input tokens
const DEFAULT_TOKENS_PER_IMAGE_1024 = 1050; // output tokens for a 1024×1024 image

// Resolution multipliers relative to the 1024² baseline. Derived from
// OpenAI's gpt-image-1 token table (medium quality): 1024² = 1050,
// 1536×1024 = ~1500, 1792×1024 = ~1900. Rounded for clarity.
const SIZE_FACTOR = {
  base: 1.0,
  mid: 1.4, // 1536×1024 / 1024×1536
  large: 1.8, // 1792×1024 / 1024×1792
} as const;

export interface ImageCostArgs {
  /** Number of images (1-4). Caller must clamp; this doesn't re-validate. */
  n: number;
  /** Normalized size token ('1024x1024', '1536x1024', etc.) or undefined. */
  size?: string;
  /** Whether a reference image is attached (img2img surcharge). */
  hasReference: boolean;
  /** Raw config record — typically `getAllConfigs()` result. */
  configs: Record<string, string>;
}

function parsePositive(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw || '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Credits to charge for one image submission (n images, in the user's
 * chosen size + reference presence). Returns a whole integer ≥ 1.
 */
export function computeImageCost(args: ImageCostArgs): number {
  const { n, size, hasReference, configs } = args;
  const iN = Math.max(1, Math.floor(n) || 1);

  // ── Legacy fallback ──
  // If the admin hasn't set the markup key, fall back to the old flat
  // `image_credit_cost` (× n) so an old deployment keeps working without
  // re-tuning. Set `image_credit_markup` to flip the deployment into the
  // new wholesale-×-markup mode.
  const markup = parsePositive(configs.image_credit_markup, 0);
  if (!markup) {
    const flat = parsePositive(configs.image_credit_cost, 0) || DEFAULT_MARKUP;
    return flat * iN;
  }

  // ── Wholesale × markup mode ──
  const wholesaleOutput = parsePositive(
    configs.image_credit_wholesale_per_1k_output,
    DEFAULT_WHOLESALE_OUTPUT_PER_1K
  );
  const wholesaleInput = parsePositive(
    configs.image_credit_wholesale_per_1k_input,
    DEFAULT_WHOLESALE_INPUT_PER_1K
  );
  const tokensBase = parsePositive(
    configs.image_credit_tokens_per_image_1024,
    DEFAULT_TOKENS_PER_IMAGE_1024
  );

  // Pick the resolution factor from the normalized size string. Anything
  // we don't recognize falls back to the base (cheapest) estimate —
  // Nano Banana 2 / other models pass the size as-is and we still want
  // a sensible answer.
  let factor = SIZE_FACTOR.base;
  if (size === '1536x1024' || size === '1024x1536') factor = SIZE_FACTOR.mid;
  else if (size === '1792x1024' || size === '1024x1792')
    factor = SIZE_FACTOR.large;

  const outputCost = (tokensBase * factor * wholesaleOutput) / 1000;
  // Reference image input is always billed at the base resolution's
  // token count — nano-banana accepts up to 14 reference URLs but the
  // server only consumes the first, so we charge the first only.
  const inputCost = hasReference ? (tokensBase * wholesaleInput) / 1000 : 0;

  return Math.max(1, Math.ceil((outputCost + inputCost) * iN * markup));
}
