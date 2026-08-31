/**
 * User-facing image prices, in whole app credits.
 *
 * GPT Image 2 is token-billed upstream. The product charges seven times the
 * EvoLink output-credit estimate, rounded up to an integer. These base prices
 * are for one 1:1 image without a reference; they keep the user-visible
 * estimate and the authoritative server debit in one shared table.
 * Nano Banana 2 is resolution-tiered upstream and follows the same simple
 * 1K/2K/4K presentation here. Keep this table shared by the UI and API route
 * so the displayed estimate and the authoritative debit cannot drift.
 */
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export const GPT_IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type GptImageQuality = (typeof GPT_IMAGE_QUALITIES)[number];

/** Seven-times markup over the EvoLink platform-credit estimate. */
export const GPT_IMAGE_PLATFORM_CREDIT_MULTIPLIER = 7;

export const IMAGE_MODELS = ['gpt-image-2', 'nano-banana-2'] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];

export const IMAGE_PRICING: Record<
  ImageModel,
  Record<ImageResolution, number>
> = {
  'gpt-image-2': {
    // Compatibility view of the GPT Image 2 Low-quality tier below.
    '1K': 3,
    '2K': 11,
    '4K': 21,
  },
  'nano-banana-2': {
    '1K': 8,
    '2K': 12,
    '4K': 18,
  },
};

/**
 * EvoLink output-credit estimates for a 1:1, prompt-only image. Low 1K,
 * Medium 1K, and High 2K are published examples. The adjacent clarity tiers
 * follow the documented 1K → 2K (~4× pixels) → 4K (~2× pixels) budgets.
 */
export const GPT_IMAGE_2_PLATFORM_CREDITS: Record<
  GptImageQuality,
  Record<ImageResolution, number>
> = {
  low: {
    '1K': 0.3599,
    '2K': 1.4396,
    '4K': 2.8792,
  },
  medium: {
    '1K': 3.2241,
    '2K': 12.8964,
    '4K': 25.7928,
  },
  high: {
    '1K': 6.55085,
    '2K': 26.2034,
    '4K': 52.4068,
  },
};

/**
 * User credits deducted for GPT Image 2: `ceil(platform estimate × 7)`.
 */
export const GPT_IMAGE_2_PRICING: Record<
  GptImageQuality,
  Record<ImageResolution, number>
> = {
  low: {
    '1K': 3,
    '2K': 11,
    '4K': 21,
  },
  medium: {
    '1K': 23,
    '2K': 91,
    '4K': 181,
  },
  high: {
    '1K': 46,
    '2K': 184,
    '4K': 367,
  },
};

/** Low-mode GPT product price. Ratio is accepted for API compatibility but
 * deliberately does not change the price until we have reliable usage data
 * proving a sustained ratio-specific difference. */
export function getGptLowPrice(
  resolution: ImageResolution,
  _aspectRatio = '1:1'
) {
  return GPT_IMAGE_2_PRICING.low[resolution];
}

export function getGptPlatformCreditEstimate(
  resolution: ImageResolution,
  quality: GptImageQuality = 'low',
  _aspectRatio = '1:1'
) {
  return GPT_IMAGE_2_PLATFORM_CREDITS[quality][resolution];
}

export function getGptImagePrice(
  resolution: ImageResolution,
  quality: GptImageQuality = 'low',
  _aspectRatio = '1:1'
) {
  return GPT_IMAGE_2_PRICING[quality][resolution];
}

export function getImagePrice(
  model: ImageModel,
  resolution: ImageResolution,
  aspectRatio = '1:1',
  quality: GptImageQuality = 'low'
) {
  if (model === 'gpt-image-2') {
    return getGptImagePrice(resolution, quality, aspectRatio);
  }
  return IMAGE_PRICING[model][resolution];
}
