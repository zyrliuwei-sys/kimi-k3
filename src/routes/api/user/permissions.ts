import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { matchPermission } from '@/core/auth/rbac';
import { getUserPermissionCodes } from '@/modules/rbac/service';
import { respData, respErr } from '@/lib/resp';

async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized');

    const permissions = await getUserPermissionCodes(session.user.id);
    const isAdmin = matchPermission('admin.*', permissions);
    return respData({ isAdmin, permissions });
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/user/permissions')({
  server: {
    handlers: { GET },
  },
});
