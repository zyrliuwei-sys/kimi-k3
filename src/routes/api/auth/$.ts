import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getConfig, getDbConfigs } from '@/modules/config/service';
import { grantForNewUser } from '@/modules/credits/service';
import { grantRoleForNewUser } from '@/modules/rbac/service';
import {
  enforceMinIntervalRateLimit,
  getClientIpFromRequest,
} from '@/lib/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';

/**
 * Wraps better-auth handler to auto-grant the default RBAC role after
 * a successful email sign-up. Other endpoints pass through unchanged.
 *
 * SECURITY: better-auth already includes per-endpoint brute-force protection,
 * but it does not stop a script that hammers `/sign-up/email` to fill the
 * `user` table. We add a coarse 3-second-per-IP+cookie floor here so a
 * single browser/IP can submit at most ~20 sign-ups/min, which is plenty
 * for legitimate retries but stops scripted abuse.
 *
 * BOT CHECK: sign-up / sign-in / request-password-reset additionally require
 * a valid Cloudflare Turnstile token (header `x-captcha-response`), verified
 * via canonical siteverify before better-auth runs. Social OAuth and session
 * reads are unaffected. Fails closed once TURNSTILE_SECRET is configured;
 * passes through (no-op) when it isn't, so the app works without Turnstile.
 */
// Credential endpoints that create or reset identity — worth a bot check.
const TURNSTILE_PROTECTED_PATHS = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
];

async function handle(request: Request) {
  // Coarse abuse throttle on POST (sign-up / sign-in / OAuth callbacks).
  // GET (session lookup, OAuth providers) is left unthrottled.
  if (request.method === 'POST') {
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: 3000,
      keyPrefix: 'auth',
    });
    if (limited) return limited;
  }

  const url = new URL(request.url);
  const isSignUp = url.pathname.endsWith('/sign-up/email');
  const needsCaptcha =
    request.method === 'POST' &&
    TURNSTILE_PROTECTED_PATHS.some((p) => url.pathname.endsWith(p));

  // Force-refresh the config cache — signup bonus decisions must reflect
  // the latest admin-set values, not whatever was cached up to 1h ago.
  const configs = await getDbConfigs(true);

  // Cloudflare Turnstile bot verification on credential endpoints. The
  // secret comes from the merged env+DB config; getConfig() reuses the
  // cache just populated above, so there's no extra DB hit. No secret
  // configured → feature is off → request passes through.
  if (needsCaptcha) {
    const secret = await getConfig('turnstile_secret');
    if (secret) {
      const token = request.headers.get('x-captcha-response') || '';
      const { success } = await verifyTurnstile({
        secret,
        response: token,
        remoteip: getClientIpFromRequest(request),
      });
      if (!success) {
        return Response.json(
          {
            message: 'Bot verification failed. Please refresh and try again.',
          },
          { status: 403 }
        );
      }
    }
  }

  const auth = getAuth(configs);
  const response = await auth.handler(request);

  // Only intercept successful sign-up responses to inject RBAC role.
  if (!isSignUp || response.status !== 200) return response;

  try {
    const body = await response.clone().json();
    if (body?.user?.id && body?.token) {
      // Fire-and-forget: don't delay the auth response. Both side-effects
      // (RBAC role + signup credits) run in parallel — they're independent.
      grantRoleForNewUser({ userId: body.user.id, configs }).catch((e) =>
        console.error('[auth] auto-grant role failed:', e)
      );
      grantForNewUser({
        userId: body.user.id,
        userEmail: body.user.email,
        configs,
      }).catch((e) => console.error('[auth] auto-grant credits failed:', e));
    }
  } catch {
    // Non-JSON response — let it through unchanged.
  }

  return response;
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
