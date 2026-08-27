/**
 * User-facing image prices, in whole app credits.
 *
 * GPT Image 2 is token-billed upstream. The Low route is priced from recent
 * live usage observations and rounded up to a small, predictable product
 * tier. We intentionally do not add a speculative aspect-ratio multiplier:
 * the observed 1K/2K/4K requests were 0.18/0.53/0.66 provider credits.
 * Nano Banana 2 is resolution-tiered upstream and follows the same simple
 * 1K/2K/4K presentation here. Keep this table shared by the UI and API route
 * so the displayed estimate and the authoritative debit cannot drift.
 */
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export const IMAGE_MODELS = ['gpt-image-2', 'nano-banana-2'] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];

export const IMAGE_PRICING: Record<
  ImageModel,
  Record<ImageResolution, number>
> = {
  'gpt-image-2': {
    // Recent provider Low usage × ~5, rounded up.
    '1K': 1,
    '2K': 3,
    '4K': 4,
  },
  'nano-banana-2': {
    '1K': 8,
    '2K': 12,
    '4K': 18,
  },
};

/** Low-mode GPT product price. Ratio is accepted for API compatibility but
 * deliberately does not change the price until we have reliable usage data
 * proving a sustained ratio-specific difference. */
export function getGptLowPrice(
  resolution: ImageResolution,
  _aspectRatio = '1:1'
) {
  return IMAGE_PRICING['gpt-image-2'][resolution];
}

export function getImagePrice(
  model: ImageModel,
  resolution: ImageResolution,
  aspectRatio = '1:1'
) {
  if (model === 'gpt-image-2') return getGptLowPrice(resolution, aspectRatio);
  return IMAGE_PRICING[model][resolution];
}
