import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getAllConfigs, saveConfigs } from '@/modules/config/service';
import { hasPermission } from '@/modules/rbac/service';
import { respData, respErr } from '@/lib/resp';

const KEYS = ['backlink_enabled', 'backlink_code'] as const;
async function authorize(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user || !(await hasPermission(session.user.id, 'admin.*')))
    return false;
  return true;
}
async function GET({ request }: { request: Request }) {
  if (!(await authorize(request))) return respErr('Forbidden');
  const configs = await getAllConfigs();
  return respData(
    Object.fromEntries(
      KEYS.map((key) => [
        key,
        configs[key] || (key === 'backlink_enabled' ? 'false' : ''),
      ])
    )
  );
}
async function POST({ request }: { request: Request }) {
  if (!(await authorize(request))) return respErr('Forbidden');
  const body = (await request.json()) as Record<string, unknown>;
  const code =
    typeof body.backlink_code === 'string' ? body.backlink_code.trim() : '';
  if (code.length > 10_000) return respErr('Backlink code is too long');
  if (/<\s*(script|iframe|object|embed)\b/i.test(code))
    return respErr('Only safe link HTML is allowed');
  await saveConfigs({
    backlink_enabled: body.backlink_enabled === 'true' ? 'true' : 'false',
    backlink_code: code,
  });
  return respData({ ok: true });
}
export const Route = createFileRoute('/api/admin/link/config')({
  server: { handlers: { GET, POST } },
});
