/**
 * Read signup-bonus settings from the public config so marketing copy on
 * the landing / sign-up / pricing pages stays in sync with whatever the
 * admin sets in Admin → Settings → General → Credits.
 *
 * Falls back to sensible defaults (20 cr, 30 days) when the config is
 * still loading or the keys are missing — these mirror the defaults in
 * src/modules/config/settings.ts and src/modules/credits/service.ts.
 *
 * Set `enabled = false` in admin to suppress the bonus across all
 * marketing surfaces in one shot.
 */

import { usePublicConfig } from './use-public-config';

export interface SignupBonus {
  enabled: boolean;
  credits: number;
  validDays: number;
  description: string;
}

const DEFAULT_BONUS: SignupBonus = {
  enabled: true,
  credits: 20,
  validDays: 30,
  description: 'Welcome to kimik3 — 20 free credits to try it out 🎉',
};

export function useSignupBonus(): SignupBonus {
  const { data } = usePublicConfig();
  const configs = data ?? {};

  // Admin can disable signup credits entirely (initial_credits_enabled=false).
  // We treat anything that isn't explicitly 'false' as enabled — a fresh
  // install with no row falls through to the default ON state.
  if (configs.initial_credits_enabled === 'false') {
    return { ...DEFAULT_BONUS, enabled: false };
  }

  const creditsRaw = parseInt(configs.initial_credits_amount);
  const credits = Number.isNaN(creditsRaw) ? DEFAULT_BONUS.credits : creditsRaw;

  const daysRaw = parseInt(configs.initial_credits_valid_days);
  const validDays = Number.isNaN(daysRaw) ? DEFAULT_BONUS.validDays : daysRaw;

  const description =
    configs.initial_credits_description || DEFAULT_BONUS.description;

  return {
    enabled: credits > 0,
    credits,
    validDays,
    description,
  };
}
