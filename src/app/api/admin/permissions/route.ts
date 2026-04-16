import { headers } from 'next/headers';
import { respData, respPage, respOk, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { hasPermission, createPermission, updatePermission, deletePermission } from '@/modules/rbac/service';
import { db } from '@/core/db';
import { permission } from '@/config/db/schema';
import { count } from 'drizzle-orm';

async function checkAdmin() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error('Unauthorized');
  const isAdmin = await hasPermission(session.user.id, 'admin.*');
  if (!isAdmin) throw new Error('Forbidden');
  return session;
}

export async function GET(req: Request) {
  try {
    await checkAdmin();
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '10')));
    const offset = (page - 1) * pageSize;

    const [totalResult] = await db().select({ count: count() }).from(permission);
    const total = totalResult.count;

    const permissions = await db()
      .select()
      .from(permission)
      .limit(pageSize)
      .offset(offset);

    return respPage(permissions, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function POST(req: Request) {
  try {
    await checkAdmin();
    const { code, resource, action, title } = await req.json();
    if (!code || !resource || !action || !title) {
      return respErr('code, resource, action, and title are required');
    }
    const result = await createPermission({ code, resource, action, title });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function PUT(req: Request) {
  try {
    await checkAdmin();
    const { id, code, resource, action, title, description } = await req.json();
    if (!id) return respErr('ID is required');
    const result = await updatePermission(id, { code, resource, action, title, description });
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function DELETE(req: Request) {
  try {
    await checkAdmin();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return respErr('ID is required');
    await deletePermission(id);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
