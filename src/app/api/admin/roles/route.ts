import { headers } from 'next/headers';
import { respData, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { hasPermission, getRoles } from '@/modules/rbac/service';
import { db } from '@/core/db';
import { userRole } from '@/config/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.*');
    if (!isAdmin) return respErr('Forbidden');

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    // If userId provided, return that user's roles
    if (userId) {
      const roles = await db()
        .select()
        .from(userRole)
        .where(eq(userRole.userId, userId));
      return respData(roles);
    }

    // Otherwise return all roles
    const roles = await getRoles();
    return respData(roles);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
