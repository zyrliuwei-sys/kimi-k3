import { headers } from 'next/headers';
import { respData, respOk, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { hasPermission } from '@/modules/rbac/service';
import { getAllConfigs, saveConfigs } from '@/modules/config/service';

export async function GET() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.settings.read');
    if (!isAdmin) return respErr('Forbidden');

    const configs = await getAllConfigs();
    return respData(configs);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export async function POST(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const isAdmin = await hasPermission(session.user.id, 'admin.settings.write');
    if (!isAdmin) return respErr('Forbidden');

    const body = await req.json();
    if (!body || typeof body !== 'object') return respErr('Invalid body');

    await saveConfigs(body);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
