import { createFileRoute } from '@tanstack/react-router';
import { DEFAULT_FOOTER_BADGES } from '@/features/footer-badges/defaults';
import {
  parseStoredFooterBadges,
  validateFooterBadges,
} from '@/features/footer-badges/validation';

import { getAuth } from '@/core/auth';
import {
  getStoredFooterBadges,
  saveStoredFooterBadges,
} from '@/modules/footer-badges/service';
import { hasPermission } from '@/modules/rbac/service';
import { respData, respErr } from '@/lib/resp';

const noStore = {
  headers: {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  },
};

async function checkSuperAdmin(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized', { status: 401 });

  // Footer badges are a global public-site setting, so only the built-in
  // super_admin permission can read or edit them.
  const allowed = await hasPermission(session.user.id, '*');
  if (!allowed) return respErr('Forbidden', { status: 403 });

  return null;
}

async function GET({ request }: { request: Request }) {
  try {
    const denied = await checkSuperAdmin(request);
    if (denied) return denied;

    const stored = await getStoredFooterBadges();
    return respData(
      stored === undefined
        ? DEFAULT_FOOTER_BADGES
        : parseStoredFooterBadges(stored),
      noStore
    );
  } catch (error) {
    return respErr(error instanceof Error ? error.message : 'Internal error');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    const denied = await checkSuperAdmin(request);
    if (denied) return denied;

    const body = await request.json();
    if (!body || typeof body !== 'object' || !('badges' in body)) {
      return respErr('Invalid footer badges payload');
    }

    const badges = validateFooterBadges(body.badges);
    await saveStoredFooterBadges(JSON.stringify(badges));
    return respData(badges, noStore);
  } catch (error) {
    return respErr(error instanceof Error ? error.message : 'Internal error');
  }
}

export const Route = createFileRoute('/api/admin/footer-badges')({
  server: { handlers: { GET, POST } },
});
