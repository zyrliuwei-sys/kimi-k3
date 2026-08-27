/**
 * Shared Turnstile action names. Keep these stable: the client embeds the
 * action in a widget token and the server verifies the same value returned by
 * Cloudflare Siteverify.
 */
export const TURNSTILE_ACTIONS = {
  credential: 'auth-credential',
  passwordReset: 'auth-password-reset',
  verificationEmail: 'auth-email-verification',
  magicLink: 'auth-magic-link',
} as const;

export type TurnstileAction =
  (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
