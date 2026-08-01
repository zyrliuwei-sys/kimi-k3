import type {
  SeedanceVideoAspectRatio,
  SeedanceVideoQuality,
} from './evolink-video';

export const DEFAULT_SEEDANCE_VIDEO_RATES: Record<
  SeedanceVideoQuality,
  number
> = {
  '480p': 1,
  '720p': 2,
  '1080p': 4,
  '4k': 8,
};

export const DEFAULT_SEEDANCE_VIDEO_DURATION = 6;
/** Hard ceiling the provider accepts; clamped by the submit handler so
 *  the request never goes over the provider's actual max. Mirrored on
 *  the client (VIDEO_DURATIONS) so the popover only lists values the
 *  backend will accept. */
export const MAX_SEEDANCE_VIDEO_DURATION = 15;
export const DEFAULT_SEEDANCE_VIDEO_QUALITY: SeedanceVideoQuality = '480p';
export const DEFAULT_SEEDANCE_VIDEO_ASPECT: SeedanceVideoAspectRatio = '16:9';
export const DEFAULT_SEEDANCE_VIDEO_AUDIO = true;
export const DEFAULT_SEEDANCE_VIDEO_MAX_CONCURRENT = 1;

export function getSeedanceVideoRate(
  configs: Record<string, any>,
  quality: SeedanceVideoQuality
): number {
  const configured = Number(
    configs[`seedance_video_credits_${quality}_per_second`]
  );
  const rate =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_SEEDANCE_VIDEO_RATES[quality];
  return rate;
}

export function getSeedanceVideoCost(
  configs: Record<string, any>,
  options: { duration: number; quality: SeedanceVideoQuality }
): number {
  return Math.ceil(
    getSeedanceVideoRate(configs, options.quality) * options.duration
  );
}

export function getSeedanceVideoMaxConcurrent(configs: Record<string, any>) {
  const configured = Number(configs.seedance_video_max_concurrent);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(10, Math.floor(configured));
  }
  return DEFAULT_SEEDANCE_VIDEO_MAX_CONCURRENT;
}

export function validateSeedancePrompt(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return 'prompt is required';
  if (Array.from(trimmed).length > 12_000) {
    return 'prompt is too long';
  }

  // Seedance documents a 500-character Chinese limit and a 1000-word English
  // limit. For mixed Chinese/English prompts use the stricter character rule.
  if (/[㐀-鿿]/u.test(trimmed)) {
    if (Array.from(trimmed).length > 500) {
      return 'Chinese prompts must be 500 characters or fewer';
    }
    return null;
  }

  const words = trimmed.split(/\s+/u).filter(Boolean);
  if (words.length > 1000) {
    return 'English prompts must be 1000 words or fewer';
  }
  return null;
}

export function isSeedanceVideoQuality(
  value: unknown
): value is SeedanceVideoQuality {
  return (
    value === '480p' || value === '720p' || value === '1080p' || value === '4k'
  );
}

export function isSeedanceVideoAspectRatio(
  value: unknown
): value is SeedanceVideoAspectRatio {
  return (
    value === '16:9' ||
    value === '9:16' ||
    value === '1:1' ||
    value === '4:3' ||
    value === '3:4' ||
    value === '21:9' ||
    value === 'adaptive'
  );
}
