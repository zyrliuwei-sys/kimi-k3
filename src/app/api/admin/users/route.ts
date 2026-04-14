import { headers } from 'next/headers';
import { respData, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { hasPermission } from '@/modules/rbac/service';
import { db } from '@/core/db';
import { user } from '@/config/db/schema';
import { desc } from 'drizzle-orm';

export async function GET() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.*');
    if (!isAdmin) return respErr('Forbidden');

    const users = await db()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(100);

    return respData(users);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
