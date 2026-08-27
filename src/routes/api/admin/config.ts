import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import {
  getAdminConfigs,
  getAllConfigs,
  isMaskedConfigValue,
  saveConfigs,
} from '@/modules/config/service';
import { hasPermission } from '@/modules/rbac/service';
import { respData, respErr, respOk } from '@/lib/resp';

const noStore = {
  headers: {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  },
};

/**
 * Never persist an enabled Turnstile switch without both credentials. The auth
 * wrapper fails closed too, but rejecting the save prevents an administrator
 * from accidentally publishing a configuration that blocks all identity
 * flows (or, in an older deployment, silently disabled protection).
 */
async function validateTurnstileConfig(updates: Record<string, unknown>) {
  const effective = await getAllConfigs(true);
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === 'string' && !isMaskedConfigValue(value)) {
      effective[key] = value;
    }
  }

  if (
    effective.turnstile_enabled === 'true' &&
    (!effective.turnstile_sitekey || !effective.turnstile_secret)
  ) {
    throw new Error(
      'Turnstile requires both the Site Key and Secret Key before it can be enabled.'
    );
  }
}

async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.settings.read');
    if (!isAdmin) return respErr('Forbidden');

    // Masked + protected-keys-stripped view — never send raw configs to a client.
    const configs = await getAdminConfigs();
    return respData(configs, noStore);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(
      session.user.id,
      'admin.settings.write'
    );
    if (!isAdmin) return respErr('Forbidden');

    const body = await request.json();
    if (!body || typeof body !== 'object') return respErr('Invalid body');

    await validateTurnstileConfig(body);
    await saveConfigs(body);
    return respOk(noStore);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/admin/config')({
  server: {
    handlers: { GET, POST },
  },
});
