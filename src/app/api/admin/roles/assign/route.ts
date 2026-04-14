import { headers } from 'next/headers';
import { respOk, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { hasPermission, assignRoleToUser, removeRoleFromUser } from '@/modules/rbac/service';

export async function POST(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.*');
    if (!isAdmin) return respErr('Forbidden');

    const { userId, roleId } = await req.json();
    if (!userId || !roleId) return respErr('userId and roleId are required');

    await assignRoleToUser(userId, roleId);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.*');
    if (!isAdmin) return respErr('Forbidden');

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const roleId = searchParams.get('roleId');
    if (!userId || !roleId) return respErr('userId and roleId are required');

    await removeRoleFromUser(userId, roleId);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
