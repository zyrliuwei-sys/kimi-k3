import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getDbConfigs } from '@/modules/config/service';
import { grantRoleForNewUser } from '@/modules/rbac/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';

/**
 * Wraps better-auth handler to auto-grant the default RBAC role after
 * a successful email sign-up. Other endpoints pass through unchanged.
 *
 * SECURITY: better-auth already includes per-endpoint brute-force protection,
 * but it does not stop a script that hammers `/sign-up/email` to fill the
 * `user` table. We add a coarse 3-second-per-IP+cookie floor here so a
 * single browser/IP can submit at most ~20 sign-ups/min, which is plenty
 * for legitimate retries but stops scripted abuse.
 */
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

  const configs = await getDbConfigs();
  const auth = getAuth(configs);
  const response = await auth.handler(request);

  // Only intercept successful sign-up responses to inject RBAC role.
  if (!isSignUp || response.status !== 200) return response;

  try {
    const body = await response.clone().json();
    if (body?.user?.id && body?.token) {
      // Fire-and-forget: don't delay the auth response.
      grantRoleForNewUser({ userId: body.user.id, configs }).catch((e) =>
        console.error('[auth] auto-grant role failed:', e)
      );
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
