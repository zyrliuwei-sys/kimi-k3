import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getAllConfigs } from '@/modules/config/service';
import {
  getIndexNowStatus,
  submitIndexNowUrls,
} from '@/modules/indexnow/service';
import { hasPermission } from '@/modules/rbac/service';
import { respData, respErr } from '@/lib/resp';

async function checkAdmin(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  if (!(await hasPermission(session.user.id, 'admin.*'))) {
    throw new Error('Forbidden');
  }
}

/** Returns setup status without exposing the verification key. */
async function GET({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    return respData(getIndexNowStatus(await getAllConfigs()));
  } catch (error) {
    return respErr(error instanceof Error ? error.message : 'Internal error');
  }
}

/** Submit explicitly supplied, same-host URLs (up to 10,000 per request). */
async function POST({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const body: unknown = await request.json();
    const urls =
      body && typeof body === 'object' && Array.isArray((body as any).urls)
        ? (body as { urls: unknown[] }).urls
        : null;
    if (!urls || !urls.every((url) => typeof url === 'string')) {
      return respErr('Body must contain a urls array of strings.');
    }

    const result = await submitIndexNowUrls({
      config: await getAllConfigs(),
      urls: urls as string[],
    });
    return respData(result);
  } catch (error) {
    return respErr(error instanceof Error ? error.message : 'Internal error');
  }
}

export const Route = createFileRoute('/api/admin/indexnow')({
  server: { handlers: { GET, POST } },
});
