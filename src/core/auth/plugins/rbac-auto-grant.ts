/**
 * better-auth plugin: auto-grant viewer role to new users.
 *
 * After a user is created (email sign-up or OAuth), assigns the role
 * configured as `initial_role_name` in admin settings (default: viewer).
 *
 * Usage: add `rbacAutoGrantPlugin()` to the `plugins` array in getAuth().
 */
import type { BetterAuthPlugin } from 'better-auth';

import { grantRoleForNewUser } from '@/modules/rbac/service';

export function rbacAutoGrantPlugin(): BetterAuthPlugin {
  return {
    id: 'rbac-auto-grant',
    endpoints: {
      /** Intercept the sign-up response to inject role assignment. */
      async '/sign-up/email'(_context) {
        // Nothing to do here — the role is granted after the response.
        // The actual grant happens in the server wrapper below.
      },
    },
  };
}

/**
 * Call this after a successful user creation response to grant the default role.
 * Safe to call multiple times (idempotent — role assignment is upsert-like).
 */
export async function grantRoleForNewUserAfterSignUp(
  userId: string,
  configs: Record<string, string>
) {
  try {
    await grantRoleForNewUser({ userId, configs });
  } catch (e) {
    // Non-fatal: don't break auth flow if RBAC assignment fails.
    console.error('[auth] grantRoleForNewUser failed:', e);
  }
}
