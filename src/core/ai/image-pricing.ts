/**
 * User-facing image prices, in whole app credits.
 *
 * GPT Image 2 is token-billed upstream. Its cost is only authoritative after
 * EvoLink returns the completed task's usage object, so it must never use a
 * fixed quality × resolution customer price. We reserve a documented maximum
 * before submission, then settle the customer charge from actual usage.
 * Nano Banana 2 is resolution-tiered upstream and follows the same simple
 * 1K/2K/4K presentation here. Keep this table shared by the UI and API route
 * so the displayed estimate and the authoritative debit cannot drift.
 */
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export const GPT_IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type GptImageQuality = (typeof GPT_IMAGE_QUALITIES)[number];

/** Charge the user seven times EvoLink's final, reported credit usage. */
export const GPT_IMAGE_PLATFORM_CREDIT_MULTIPLIER = 7;

/**
 * EvoLink's current public maximum for one GPT Image 2 image request: the
 * calculator range covers every quality/resolution/ratio combination with up
 * to 16 references. It is an authorization hold only — never the final user
 * price. The completion usage object settles the actual charge and releases
 * the difference.
 */
export const GPT_IMAGE_2_MAX_PLATFORM_CREDITS = 55.5805;
export const GPT_IMAGE_2_RESERVATION_CREDITS = Math.ceil(
  GPT_IMAGE_2_MAX_PLATFORM_CREDITS * GPT_IMAGE_PLATFORM_CREDIT_MULTIPLIER
);

export const IMAGE_MODELS = ['gpt-image-2', 'nano-banana-2'] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];

export type FixedPriceImageModel = Exclude<ImageModel, 'gpt-image-2'>;

/** Fixed-price models only. GPT Image 2 is intentionally absent. */
export const IMAGE_PRICING: Record<
  FixedPriceImageModel,
  Record<ImageResolution, number>
> = {
  'nano-banana-2': {
    '1K': 8,
    '2K': 12,
    '4K': 18,
  },
};

export function getGptImageReservationCredits() {
  return GPT_IMAGE_2_RESERVATION_CREDITS;
}

/** Final customer charge. Platform usage is decimal; app credits are whole. */
export function getGptImageFinalCredits(platformCredits: number) {
  if (!Number.isFinite(platformCredits) || platformCredits < 0) {
    throw new Error('Invalid GPT Image 2 platform credit usage.');
  }
  return Math.ceil(platformCredits * GPT_IMAGE_PLATFORM_CREDIT_MULTIPLIER);
}
