import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getDbConfigs } from '@/modules/config/service';
import { grantRoleForNewUser } from '@/modules/rbac/service';

/**
 * Wraps better-auth handler to auto-grant the default RBAC role after
 * a successful email sign-up. Other endpoints pass through unchanged.
 */
async function handle(request: Request) {
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
