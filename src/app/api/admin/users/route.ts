import { headers } from 'next/headers';
import { respPage, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { hasPermission } from '@/modules/rbac/service';
import { db } from '@/core/db';
import { user } from '@/config/db/schema';
import { desc, count } from 'drizzle-orm';

export async function GET(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.*');
    if (!isAdmin) return respErr('Forbidden');

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '10')));
    const offset = (page - 1) * pageSize;

    const [totalResult] = await db().select({ count: count() }).from(user);
    const total = totalResult.count;

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
      .limit(pageSize)
      .offset(offset);

    return respPage(users, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
